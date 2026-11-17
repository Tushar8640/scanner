/**
 * Document filter pipeline, as plain JavaScript source that runs inside a WebView
 * (the live page preview and the hidden scan engine). Both use this one source, so the
 * preview, saved images and PDFs always look the same.
 *
 * Defines `window.DocFilter`:
 *   prepare(source, maxSide) -> state   draws the image and caches the paper illumination map
 *   base(state, filter)      -> ImageData   filter result, cached per filter
 *   adjust(state, data, adj) -> ImageData   contrast / brightness / details (0..100, 50 = neutral)
 *   render(source, maxSide, filter, adj) -> canvas
 *
 * How the shadow removal works: a small copy of the page is dilated (ink disappears, paper
 * stays), blurred and scaled back up. That is the light falling on the paper. Dividing each
 * pixel by it makes the paper evenly white and removes shadows and colour casts, while ink
 * keeps its contrast. Every size is relative to the image, so any resolution gives the same look.
 */
export const FILTER_PIPELINE_JS = String.raw`
(function () {
  'use strict';

  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function smooth(e0, e1, x) { var t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function srcSize(s) { return { w: s.naturalWidth || s.width, h: s.naturalHeight || s.height }; }

  // Separable max filter (grey-level dilation) on an RGBA buffer, per channel
  function dilate(a, w, h, r) {
    var tmp = new Uint8ClampedArray(a.length), out = new Uint8ClampedArray(a.length);
    var x, y, k, c, m, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = (y * w + x) * 4;
      for (c = 0; c < 3; c++) {
        m = 0;
        for (k = -r; k <= r; k++) { var xx = x + k; if (xx < 0 || xx >= w) continue; var v = a[(y * w + xx) * 4 + c]; if (v > m) m = v; }
        tmp[i + c] = m;
      }
      tmp[i + 3] = 255;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = (y * w + x) * 4;
      for (c = 0; c < 3; c++) {
        m = 0;
        for (k = -r; k <= r; k++) { var yy = y + k; if (yy < 0 || yy >= h) continue; var v2 = tmp[(yy * w + x) * 4 + c]; if (v2 > m) m = v2; }
        out[i + c] = m;
      }
      out[i + 3] = 255;
    }
    return out;
  }

  // Separable box blur with edge clamping, per channel (3 channels of an RGBA buffer)
  function boxBlur(a, w, h, r) {
    if (r < 1) return new Uint8ClampedArray(a);
    var tmp = new Float32Array(w * h * 3), out = new Uint8ClampedArray(a.length);
    var x, y, c, k, s, n = 2 * r + 1;
    for (y = 0; y < h; y++) for (c = 0; c < 3; c++) {
      s = 0;
      for (k = -r; k <= r; k++) s += a[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + c];
      for (x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = s / n;
        var xo = Math.max(0, x - r), xi = Math.min(w - 1, x + r + 1);
        s += a[(y * w + xi) * 4 + c] - a[(y * w + xo) * 4 + c];
      }
    }
    for (x = 0; x < w; x++) for (c = 0; c < 3; c++) {
      s = 0;
      for (k = -r; k <= r; k++) s += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 3 + c];
      for (y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = s / n;
        var yo = Math.max(0, y - r), yi = Math.min(h - 1, y + r + 1);
        s += tmp[(yi * w + x) * 3 + c] - tmp[(yo * w + x) * 3 + c];
      }
    }
    for (var i = 3; i < out.length; i += 4) out[i] = 255;
    return out;
  }

  // Paper illumination map at full working size
  function illumination(canvas, w, h) {
    var sw = Math.max(24, Math.round(w / 8)), sh = Math.max(24, Math.round(h / 8));
    var small = makeCanvas(sw, sh), sc = small.getContext('2d');
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(canvas, 0, 0, sw, sh);
    var d = sc.getImageData(0, 0, sw, sh);
    var r = Math.max(2, Math.round(Math.min(sw, sh) / 45));
    var a = dilate(d.data, sw, sh, r);
    a = boxBlur(a, sw, sh, r * 2);
    a = boxBlur(a, sw, sh, r * 2);
    d.data.set(a);
    sc.putImageData(d, 0, 0);
    var big = makeCanvas(w, h), bc = big.getContext('2d');
    bc.imageSmoothingQuality = 'high';
    bc.drawImage(small, 0, 0, w, h);
    return bc.getImageData(0, 0, w, h).data;
  }

  function prepare(source, maxSide) {
    var S = srcSize(source), sc = Math.min(1, maxSide / Math.max(S.w, S.h));
    var w = Math.max(1, Math.round(S.w * sc)), h = Math.max(1, Math.round(S.h * sc));
    var cv = makeCanvas(w, h), cx = cv.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(source, 0, 0, w, h);
    return { canvas: cv, w: w, h: h, src: cx.getImageData(0, 0, w, h), bg: null, cache: {} };
  }

  function getBg(st) {
    if (!st.bg) st.bg = illumination(st.canvas, st.w, st.h);
    return st.bg;
  }

  var NEEDS_BG = { lighten: 1, magic: 1, enhanced: 1, noshadow: 1, bw: 1, eco: 1, grayscale: 1, invert: 1 };

  function base(st, filter) {
    if (st.cache[filter]) return st.cache[filter];
    var w = st.w, h = st.h, s = st.src.data;
    var out = new ImageData(w, h), o = out.data;
    if (filter === 'original' || !NEEDS_BG[filter]) {
      o.set(s);
      st.cache[filter] = out;
      return out;
    }
    var bg = getBg(st);
    // No Shadow also lifts deep shadows; the others leave very dark areas alone
    var lo = filter === 'noshadow' ? 6 : 25, hi = filter === 'noshadow' ? 40 : 85;
    for (var i = 0; i < s.length; i += 4) {
      var r = s[i], g = s[i + 1], b = s[i + 2];
      var br = bg[i] || 1, bgc = bg[i + 1] || 1, bb = bg[i + 2] || 1;
      var bl = 0.299 * br + 0.587 * bgc + 0.114 * bb;
      // Only flatten where there is paper; very dark surroundings would turn into noise
      var wgt = smooth(lo, hi, bl);
      var nr = Math.min(255, r * 255 / br), ng = Math.min(255, g * 255 / bgc), nb = Math.min(255, b * 255 / bb);
      nr = r + (nr - r) * wgt; ng = g + (ng - g) * wgt; nb = b + (nb - b) * wgt;
      var R, G, B, L, v, bp;
      switch (filter) {
        case 'lighten':
          // Brighter, cleaner paper, colours kept
          R = r + (nr - r) * 0.65; G = g + (ng - g) * 0.65; B = b + (nb - b) * 0.65;
          R = 255 * Math.pow(R / 255, 0.85); G = 255 * Math.pow(G / 255, 0.85); B = 255 * Math.pow(B / 255, 0.85);
          break;
        case 'magic':
          // Enhance: white paper, darker text, livelier colours
          bp = 38;
          R = (nr - bp) * 255 / (255 - bp); G = (ng - bp) * 255 / (255 - bp); B = (nb - bp) * 255 / (255 - bp);
          R = 255 * Math.pow(clamp(R) / 255, 1.25); G = 255 * Math.pow(clamp(G) / 255, 1.25); B = 255 * Math.pow(clamp(B) / 255, 1.25);
          L = 0.299 * R + 0.587 * G + 0.114 * B;
          R = L + (R - L) * 1.3; G = L + (G - L) * 1.3; B = L + (B - L) * 1.3;
          break;
        case 'enhanced':
          R = r + (nr - r) * 0.5; G = g + (ng - g) * 0.5; B = b + (nb - b) * 0.5;
          R = (R - 128) * 1.25 + 128; G = (G - 128) * 1.25 + 128; B = (B - 128) * 1.25 + 128;
          break;
        case 'noshadow':
          // Shadows gone, natural colours, gentle contrast
          bp = 12;
          R = (nr - bp) * 255 / (255 - bp); G = (ng - bp) * 255 / (255 - bp); B = (nb - bp) * 255 / (255 - bp);
          break;
        case 'bw':
          // Crisp black text on white paper (soft threshold keeps edges smooth)
          L = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          v = (L - 170) * 255 / 50;
          R = G = B = v;
          break;
        case 'eco':
          // Ink saver: like B&W, but faint marks drop out and thin strokes stay thin
          L = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          v = clamp((L - 125) * 255 / 45);
          R = G = B = 30 + v * (225 / 255);
          break;
        case 'grayscale':
          L = 0.299 * (r + (nr - r) * 0.7) + 0.587 * (g + (ng - g) * 0.7) + 0.114 * (b + (nb - b) * 0.7);
          v = (L - 20) * 255 / 235;
          R = G = B = 255 * Math.pow(clamp(v) / 255, 1.15);
          break;
        case 'invert':
          bp = 30;
          R = 255 - (nr - bp) * 255 / (255 - bp); G = 255 - (ng - bp) * 255 / (255 - bp); B = 255 - (nb - bp) * 255 / (255 - bp);
          break;
        default:
          R = r; G = g; B = b;
      }
      o[i] = clamp(R); o[i + 1] = clamp(G); o[i + 2] = clamp(B); o[i + 3] = 255;
    }
    st.cache[filter] = out;
    return out;
  }

  function isNeutral(adj) {
    return !adj || (adj.contrast === 50 && adj.brightness === 50 && adj.details === 50);
  }

  function adjust(st, data, adj) {
    if (isNeutral(adj)) return data;
    var w = st.w, h = st.h, s = data.data;
    var out = new ImageData(w, h), o = out.data;
    var det = ((adj.details == null ? 50 : adj.details) - 50) / 50;
    var f = 1 + ((adj.contrast == null ? 50 : adj.contrast) - 50) / 50 * 0.9;
    var off = ((adj.brightness == null ? 50 : adj.brightness) - 50) / 50 * 70;
    var blur = det !== 0 ? boxBlur(s, w, h, Math.max(1, Math.round(Math.max(w, h) / 900))) : null;
    var amt = det > 0 ? det * 1.6 : det;
    for (var i = 0; i < s.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var v = s[i + c];
        if (blur) v = v + (v - blur[i + c]) * amt;
        v = (v - 128) * f + 128 + off;
        o[i + c] = clamp(v);
      }
      o[i + 3] = 255;
    }
    return out;
  }

  function render(source, maxSide, filter, adj) {
    var st = prepare(source, maxSide);
    var data = adjust(st, base(st, filter), adj);
    st.canvas.getContext('2d').putImageData(data, 0, 0);
    return st.canvas;
  }

  window.DocFilter = { prepare: prepare, base: base, adjust: adjust, render: render };
})();
`;
