/**
 * Canvas page editor used for Markup (freehand pen / highlighter), Sign (place a signature
 * image, drag and resize it) and Watermark (tiled diagonal text).
 *
 * React Native drives it with window.__cmd({ type, ... }) and receives:
 *   { type: 'ready' }                         page image loaded
 *   { type: 'state', strokes, hasSig }        after every change (for undo / apply buttons)
 *   { type: 'applied', b64 }                  flattened full-resolution JPEG
 *   { type: 'error', message }
 * Annotations are stored in coordinates normalised to the page, so the final render at
 * full resolution matches what the user saw on screen.
 */
const ANNOTATE_JS = String.raw`
(function () {
  'use strict';
  var MAX_OUT = 3000;
  var img = new Image();
  var page = document.getElementById('page');
  var wrap = document.getElementById('wrap');
  var ink = document.getElementById('ink');
  var sigBox = document.getElementById('sig');
  var sigImg = document.getElementById('sigImg');
  var handle = document.getElementById('sigHandle');
  var ctx = ink.getContext('2d');
  var dw = 0, dh = 0, dpr = window.devicePixelRatio || 1;
  var S = {
    mode: 'markup', tool: 'pen', color: '#1F4FD8', width: 0.006,
    strokes: [], current: null,
    wm: { text: '', color: '#9AA0A6', opacity: 0.25, size: 0.06 },
    sig: null // { src, x, y, w, aspect } normalised to page width/height
  };

  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function notify() { post({ type: 'state', strokes: S.strokes.length, hasSig: !!S.sig }); }

  function layout() {
    var W = window.innerWidth - 24, H = window.innerHeight - 24;
    if (W <= 0 || H <= 0) { requestAnimationFrame(layout); return; }
    var r =Math.min(W / img.naturalWidth, H / img.naturalHeight);
    dw = Math.round(img.naturalWidth * r); dh = Math.round(img.naturalHeight * r);
    wrap.style.width = dw + 'px'; wrap.style.height = dh + 'px';
    page.style.width = dw + 'px'; page.style.height = dh + 'px';
    ink.width = dw * dpr; ink.height = dh * dpr;
    ink.style.width = dw + 'px'; ink.style.height = dh + 'px';
    render(); placeSigBox();
  }

  function drawStroke(c, s, W, H, scale) {
    if (s.points.length < 1) return;
    c.save();
    c.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
    c.strokeStyle = s.color; c.fillStyle = s.color;
    c.lineCap = s.tool === 'highlighter' ? 'butt' : 'round';
    c.lineJoin = 'round';
    c.lineWidth = s.width * W * (s.tool === 'highlighter' ? 4 : 1);
    c.beginPath();
    c.moveTo(s.points[0][0] * W, s.points[0][1] * H);
    for (var i = 1; i < s.points.length; i++) c.lineTo(s.points[i][0] * W, s.points[i][1] * H);
    if (s.points.length === 1) c.lineTo(s.points[0][0] * W + 0.1, s.points[0][1] * H);
    c.stroke();
    c.restore();
  }

  function drawWatermark(c, W, H) {
    var wm = S.wm;
    if (!wm.text) return;
    var fs = Math.max(8, wm.size * W);
    c.save();
    c.globalAlpha = wm.opacity;
    c.fillStyle = wm.color;
    c.font = 'bold ' + fs + 'px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.translate(W / 2, H / 2);
    c.rotate(-Math.PI / 6);
    var stepX = Math.max(c.measureText(wm.text).width + fs * 2, fs * 4), stepY = fs * 4;
    var R = Math.sqrt(W * W + H * H);
    for (var y = -R; y <= R; y += stepY) {
      var offset = (Math.round(y / stepY) % 2) * stepX / 2;
      for (var x = -R; x <= R; x += stepX) c.fillText(wm.text, x + offset, y);
    }
    c.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    if (S.mode === 'watermark') drawWatermark(ctx, dw, dh);
    for (var i = 0; i < S.strokes.length; i++) drawStroke(ctx, S.strokes[i], dw, dh);
    if (S.current) drawStroke(ctx, S.current, dw, dh);
  }

  function placeSigBox() {
    if (!S.sig) { sigBox.style.display = 'none'; return; }
    var w = S.sig.w * dw, h = w / S.sig.aspect;
    sigBox.style.display = 'block';
    sigBox.style.left = S.sig.x * dw + 'px'; sigBox.style.top = S.sig.y * dh + 'px';
    sigBox.style.width = w + 'px'; sigBox.style.height = h + 'px';
  }

  function local(e) {
    var r = wrap.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / dw)), Math.min(1, Math.max(0, (e.clientY - r.top) / dh))];
  }

  // Freehand drawing
  ink.addEventListener('pointerdown', function (e) {
    if (S.mode !== 'markup') return;
    ink.setPointerCapture(e.pointerId);
    S.current = { tool: S.tool, color: S.color, width: S.width, points: [local(e)] };
    render();
  });
  ink.addEventListener('pointermove', function (e) {
    if (!S.current) return;
    S.current.points.push(local(e));
    render();
  });
  function endStroke() {
    if (!S.current) return;
    S.strokes.push(S.current); S.current = null; render(); notify();
  }
  ink.addEventListener('pointerup', endStroke);
  ink.addEventListener('pointercancel', endStroke);

  // Signature: drag the box, resize from the corner handle (keeps aspect ratio)
  var drag = null;
  sigBox.addEventListener('pointerdown', function (e) {
    if (!S.sig) return;
    sigBox.setPointerCapture(e.pointerId);
    drag = { kind: e.target === handle ? 'resize' : 'move', x: e.clientX, y: e.clientY, start: JSON.parse(JSON.stringify(S.sig)) };
    e.stopPropagation();
  });
  sigBox.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = (e.clientX - drag.x) / dw, dy = (e.clientY - drag.y) / dh, s = drag.start;
    if (drag.kind === 'move') {
      S.sig.x = Math.min(1 - s.w * 0.2, Math.max(-s.w * 0.8, s.x + dx));
      S.sig.y = Math.min(0.98, Math.max(-0.02, s.y + dy));
    } else {
      S.sig.w = Math.min(1, Math.max(0.06, s.w + dx));
    }
    placeSigBox();
  });
  sigBox.addEventListener('pointerup', function () { drag = null; });
  sigBox.addEventListener('pointercancel', function () { drag = null; });

  function apply() {
    var sc = Math.min(1, MAX_OUT / Math.max(img.naturalWidth, img.naturalHeight));
    var W = Math.round(img.naturalWidth * sc), H = Math.round(img.naturalHeight * sc);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.drawImage(img, 0, 0, W, H);
    drawWatermark(c, W, H);
    for (var i = 0; i < S.strokes.length; i++) drawStroke(c, S.strokes[i], W, H);
    function finish() {
      var url = cv.toDataURL('image/jpeg', 0.93);
      post({ type: 'applied', b64: url.substring(url.indexOf(',') + 1) });
    }
    if (S.sig) {
      var si = new Image();
      si.onload = function () {
        var w = S.sig.w * W, h = w / S.sig.aspect;
        c.drawImage(si, S.sig.x * W, S.sig.y * H, w, h);
        finish();
      };
      si.onerror = function () { post({ type: 'error', message: 'Signature image failed to load' }); };
      si.src = S.sig.src;
    } else {
      finish();
    }
  }

  window.__cmd = function (m) {
    try {
      switch (m.type) {
        case 'mode': S.mode = m.mode; ink.style.pointerEvents = m.mode === 'markup' ? 'auto' : 'none'; render(); break;
        case 'tool': S.tool = m.tool; break;
        case 'color': S.color = m.color; break;
        case 'width': S.width = m.width; break;
        case 'undo': S.strokes.pop(); render(); notify(); break;
        case 'clear': S.strokes = []; render(); notify(); break;
        case 'watermark': S.wm = Object.assign(S.wm, m.wm); render(); break;
        case 'signature':
          sigImg.src = m.src;
          var probe = new Image();
          probe.onload = function () {
            var aspect = probe.naturalWidth / probe.naturalHeight || 3;
            var w = 0.38;
            S.sig = { src: m.src, aspect: aspect, w: w, x: 0.55 - w / 2 + 0.2, y: 0.78 - (w * dw / aspect) / dh / 2 };
            if (S.sig.x + w > 1) S.sig.x = 1 - w - 0.04;
            placeSigBox(); notify();
          };
          probe.src = m.src;
          break;
        case 'removeSignature': S.sig = null; placeSigBox(); notify(); break;
        case 'apply': apply(); break;
      }
    } catch (err) {
      post({ type: 'error', message: String(err && err.message || err) });
    }
  };

  img.onload = function () { page.src = img.src; layout(); post({ type: 'ready' }); };
  img.onerror = function () { post({ type: 'error', message: 'Could not load page image' }); };
  window.__load = function (b64) { img.src = 'data:image/jpeg;base64,' + b64; };
  window.addEventListener('resize', function () { if (img.naturalWidth) layout(); });
  post({ type: 'booted' });
})();
`;

export const ANNOTATE_HTML = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; height: 100%; background: #0E1013; overflow: hidden; touch-action: none; -webkit-user-select: none; user-select: none; }
  #stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  #wrap { position: relative; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
  #page { display: block; }
  #ink { position: absolute; left: 0; top: 0; touch-action: none; }
  #sig { position: absolute; display: none; border: 1.5px dashed #2CC4AA; touch-action: none; }
  #sigImg { width: 100%; height: 100%; pointer-events: none; }
  #sigHandle { position: absolute; right: -14px; bottom: -14px; width: 28px; height: 28px; border-radius: 14px;
    background: #2CC4AA; border: 2px solid #fff; box-sizing: border-box; }
</style></head>
<body><div id="stage"><div id="wrap"><img id="page" alt="" /><canvas id="ink"></canvas>
<div id="sig"><img id="sigImg" alt="" /><div id="sigHandle"></div></div></div></div>
<script>${ANNOTATE_JS}</script>
</body></html>`;

/** Signature pad: draw with a finger, export a trimmed transparent PNG. */
const PAD_JS = String.raw`
(function () {
  'use strict';
  var cv = document.getElementById('pad'), c = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
  var color = '#111111', strokes = [], cur = null;
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  // The backing store is dpr x larger than the CSS box. Without an explicit CSS size the canvas
  // is laid out at its backing size, so strokes land off screen and the pad looks blank.
  function size() {
    var w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) { requestAnimationFrame(size); return; }
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    draw();
  }
  function draw() {
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    var all = cur ? strokes.concat([cur]) : strokes;
    for (var i = 0; i < all.length; i++) {
      var s = all[i]; c.strokeStyle = s.color; c.lineWidth = 3.2 * dpr; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(s.p[0][0] * dpr, s.p[0][1] * dpr);
      for (var j = 1; j < s.p.length; j++) c.lineTo(s.p[j][0] * dpr, s.p[j][1] * dpr);
      if (s.p.length === 1) c.lineTo(s.p[0][0] * dpr + 0.1, s.p[0][1] * dpr);
      c.stroke();
    }
  }
  cv.addEventListener('pointerdown', function (e) { cv.setPointerCapture(e.pointerId); cur = { color: color, p: [[e.clientX, e.clientY]] }; draw(); });
  cv.addEventListener('pointermove', function (e) { if (!cur) return; cur.p.push([e.clientX, e.clientY]); draw(); });
  function end() { if (!cur) return; strokes.push(cur); cur = null; draw(); post({ type: 'state', strokes: strokes.length }); }
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  window.__cmd = function (m) {
    if (m.type === 'color') { color = m.color; strokes.forEach(function (s) { s.color = color; }); draw(); }
    if (m.type === 'clear') { strokes = []; draw(); post({ type: 'state', strokes: 0 }); }
    if (m.type === 'done') {
      var d = c.getImageData(0, 0, cv.width, cv.height).data, minX = cv.width, minY = cv.height, maxX = -1, maxY = -1;
      for (var y = 0; y < cv.height; y++) for (var x = 0; x < cv.width; x++) {
        if (d[(y * cv.width + x) * 4 + 3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      if (maxX < 0) { post({ type: 'empty' }); return; }
      var m2 = 8 * dpr; minX = Math.max(0, minX - m2); minY = Math.max(0, minY - m2);
      maxX = Math.min(cv.width - 1, maxX + m2); maxY = Math.min(cv.height - 1, maxY + m2);
      var out = document.createElement('canvas'); out.width = maxX - minX + 1; out.height = maxY - minY + 1;
      out.getContext('2d').drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
      post({ type: 'signature', dataUrl: out.toDataURL('image/png') });
    }
  };
  window.addEventListener('resize', size); size();
})();
`;

export const SIGNATURE_PAD_HTML = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>html,body{margin:0;height:100%;overflow:hidden;background:#FFFFFF;touch-action:none}
#pad{display:block;touch-action:none}
#line{position:absolute;left:8%;right:8%;bottom:28%;border-bottom:1.5px dashed #C9CDD2;pointer-events:none}</style></head>
<body><canvas id="pad"></canvas><div id="line"></div><script>${PAD_JS}</script></body></html>`;
