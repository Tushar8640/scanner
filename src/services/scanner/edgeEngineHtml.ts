import { FILTER_PIPELINE_JS } from '@/services/image/filterPipelineJs';

/**
 * Self-contained document edge detection and perspective correction engine.
 *
 * Runs inside a hidden WebView (canvas + typed arrays), so it works in Expo Go
 * as well as development and production builds without native OpenCV.
 *
 * Protocol (React Native -> WebView): window.__scan({ id, op, key, b64?, corners? })
 *   op 'detect' -> { width, height, corners: [{x,y} x4] | null }   (normalised 0..1, TL, TR, BR, BL)
 *   op 'warp'   -> { b64, width, height }                          (perspective-corrected JPEG)
 * Protocol (WebView -> React Native): postMessage(JSON) with { type: 'ready' } or { id, ok, result | error }.
 *
 * Detection pipeline:
 *   1. Downscale, grayscale, blur, Sobel gradients.
 *   2. Build candidate document regions from three masks: bright (Otsu), dark (Otsu) and
 *      closed edge map with holes filled. Morphology removes noise.
 *   3. For each region: convex hull -> maximum-area inscribed quadrilateral.
 *   4. Snap each side to the strongest nearby gradient line (least-squares line fit),
 *      then intersect adjacent lines to get sub-pixel corners.
 *   5. Score by edge support along the four sides and pick the best candidate.
 */
const ENGINE_JS = String.raw`
(function () {
  'use strict';
  var DETECT_MAX = 640;
  var WARP_SRC_MAX = 3000;
  var WARP_OUT_MAX = 2600;
  var cache = { key: null, img: null };

  function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }

  function loadImage(b64) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not decode image')); };
      img.src = 'data:image/jpeg;base64,' + b64;
    });
  }

  function getImage(req) {
    if (req.b64) {
      return loadImage(req.b64).then(function (img) {
        cache.key = req.key; cache.img = img; return img;
      });
    }
    if (cache.img && cache.key === req.key) return Promise.resolve(cache.img);
    return Promise.reject(new Error('NO_IMAGE'));
  }

  /* ---------------- pixel operations ---------------- */

  function boxBlur(src, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    var win = 2 * r + 1, x, y, k, acc;
    for (y = 0; y < h; y++) {
      var row = y * w; acc = 0;
      for (k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
      for (x = 0; x < w; x++) {
        tmp[row + x] = acc / win;
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      acc = 0;
      for (k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (y = 0; y < h; y++) {
        out[y * w + x] = acc / win;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  function sobel(g, w, h) {
    var n = w * h, gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var a = g[i - w - 1], b = g[i - w], c = g[i - w + 1];
        var d = g[i - 1], f = g[i + 1];
        var p = g[i + w - 1], q = g[i + w], r = g[i + w + 1];
        var sx = (c + 2 * f + r) - (a + 2 * d + p);
        var sy = (p + 2 * q + r) - (a + 2 * b + c);
        gx[i] = sx; gy[i] = sy; mag[i] = Math.sqrt(sx * sx + sy * sy);
      }
    }
    return { gx: gx, gy: gy, mag: mag };
  }

  function otsu(g, n) {
    var hist = new Float64Array(256), t, sum = 0;
    for (var i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Math.round(g[i])))]++;
    for (t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, best = -1, thr = 127;
    for (t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  function percentile(arr, n, p) {
    var step = Math.max(1, Math.floor(n / 20000)), s = [];
    for (var i = 0; i < n; i += step) s.push(arr[i]);
    s.sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0;
  }

  // Separable square morphology. dilate=true -> max filter, false -> min filter.
  function morph1D(src, dst, w, h, r, dilate, horizontal) {
    var lines = horizontal ? h : w, len = horizontal ? w : h;
    var stride = horizontal ? 1 : w;
    for (var l = 0; l < lines; l++) {
      var base = horizontal ? l * w : l, count = 0, inWin = 0, k;
      for (k = 0; k <= Math.min(len - 1, r); k++) { count += src[base + k * stride]; inWin++; }
      for (var p = 0; p < len; p++) {
        dst[base + p * stride] = dilate ? (count > 0 ? 1 : 0) : (count === inWin ? 1 : 0);
        var add = p + r + 1, rem = p - r;
        if (add < len) { count += src[base + add * stride]; inWin++; }
        if (rem >= 0) { count -= src[base + rem * stride]; inWin--; }
      }
    }
  }
  function morph(mask, w, h, r, dilate) {
    var tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    morph1D(mask, tmp, w, h, r, dilate, true);
    morph1D(tmp, out, w, h, r, dilate, false);
    return out;
  }
  function closeOpen(mask, w, h, rc, ro) {
    var m = morph(morph(mask, w, h, rc, true), w, h, rc, false);
    return morph(morph(m, w, h, ro, false), w, h, ro, true);
  }

  function label(mask, w, h) {
    var n = w * h, labels = new Int32Array(n), stack = new Int32Array(n), comps = [], next = 1;
    for (var s = 0; s < n; s++) {
      if (!mask[s] || labels[s]) continue;
      var top = 0, area = 0, border = 0;
      stack[top++] = s; labels[s] = next;
      while (top > 0) {
        var i = stack[--top], x = i % w, y = (i - x) / w;
        area++;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border++;
        if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = next; stack[top++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = next; stack[top++] = i + 1; }
        if (y > 0 && mask[i - w] && !labels[i - w]) { labels[i - w] = next; stack[top++] = i - w; }
        if (y < h - 1 && mask[i + w] && !labels[i + w]) { labels[i + w] = next; stack[top++] = i + w; }
      }
      comps.push({ id: next, area: area, border: border });
      next++;
    }
    return { labels: labels, comps: comps };
  }

  function fillHoles(mask, w, h) {
    var n = w * h, inv = new Uint8Array(n), i;
    for (i = 0; i < n; i++) inv[i] = mask[i] ? 0 : 1;
    var lab = label(inv, w, h), holes = {};
    lab.comps.forEach(function (c) { if (c.border === 0) holes[c.id] = true; });
    var out = new Uint8Array(n);
    for (i = 0; i < n; i++) out[i] = mask[i] || holes[lab.labels[i]] ? 1 : 0;
    return out;
  }

  /* ---------------- geometry ---------------- */

  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }

  function convexHull(pts) {
    if (pts.length < 3) return pts.slice();
    pts.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    var lower = [], upper = [], i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  function polyArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i++) {
      var j = (i + 1) % p.length;
      a += p[i].x * p[j].y - p[j].x * p[i].y;
    }
    return Math.abs(a) / 2;
  }

  function triArea(a, b, c) { return Math.abs(cross(a, b, c)) / 2; }

  // Largest-area quadrilateral whose corners are hull vertices.
  function maxAreaQuad(hull) {
    var n = hull.length;
    if (n < 4) return null;
    if (n > 64) {
      var sub = [];
      for (var s = 0; s < 64; s++) sub.push(hull[Math.floor(s * n / 64)]);
      hull = sub; n = 64;
    }
    var best = 0, bestQ = null;
    for (var i = 0; i < n; i++) {
      for (var k = i + 2; k < n; k++) {
        if (n - (k - i) < 2) continue;
        var bj = -1, ba = -1, bl = -1, bb = -1, t, a;
        for (t = i + 1; t < k; t++) { a = triArea(hull[i], hull[t], hull[k]); if (a > ba) { ba = a; bj = t; } }
        for (t = k + 1; t < i + n; t++) { a = triArea(hull[k], hull[t % n], hull[i]); if (a > bb) { bb = a; bl = t % n; } }
        if (ba + bb > best) { best = ba + bb; bestQ = [hull[i], hull[bj], hull[k], hull[bl]]; }
      }
    }
    return bestQ;
  }

  function orderQuad(q) {
    var cx = 0, cy = 0;
    q.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
    var s = q.slice().sort(function (a, b) {
      return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });
    var start = 0;
    for (var i = 1; i < 4; i++) if (s[i].x + s[i].y < s[start].x + s[start].y) start = i;
    return [s[start], s[(start + 1) % 4], s[(start + 2) % 4], s[(start + 3) % 4]];
  }

  function isConvex(q) {
    var sign = 0;
    for (var i = 0; i < 4; i++) {
      var c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
      if (Math.abs(c) < 1e-6) return false;
      var sg = c > 0 ? 1 : -1;
      if (!sign) sign = sg; else if (sg !== sign) return false;
    }
    return true;
  }

  /* ---------------- edge snapping & scoring ---------------- */

  function sideNormal(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { nx: -dy / len, ny: dx / len, len: len };
  }

  function gradAt(G, w, h, x, y, nx, ny) {
    var xi = Math.round(x), yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return 0;
    var i = yi * w + xi;
    return Math.abs(G.gx[i] * nx + G.gy[i] * ny);
  }

  function edgeSupport(q, G, w, h, thr) {
    var total = 0, hit = 0;
    for (var s = 0; s < 4; s++) {
      var a = q[s], b = q[(s + 1) % 4], nm = sideNormal(a, b);
      for (var k = 0; k < 30; k++) {
        var t = 0.1 + 0.8 * k / 29, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t, best = 0;
        for (var o = -3; o <= 3; o++) best = Math.max(best, gradAt(G, w, h, px + nm.nx * o, py + nm.ny * o, nm.nx, nm.ny));
        total++; if (best > thr) hit++;
      }
    }
    return hit / total;
  }

  function fitLine(pts) {
    var mx = 0, my = 0, n = pts.length, i;
    for (i = 0; i < n; i++) { mx += pts[i].x; my += pts[i].y; }
    mx /= n; my /= n;
    var sxx = 0, sxy = 0, syy = 0;
    for (i = 0; i < n; i++) {
      var dx = pts[i].x - mx, dy = pts[i].y - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    var th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var nx = -Math.sin(th), ny = Math.cos(th);
    return { nx: nx, ny: ny, c: nx * mx + ny * my };
  }

  function robustLine(pts) {
    var line = fitLine(pts);
    var d = pts.map(function (p) { return Math.abs(line.nx * p.x + line.ny * p.y - line.c); });
    var sorted = d.slice().sort(function (a, b) { return a - b; });
    var lim = Math.max(1.5, 2.5 * sorted[Math.floor(sorted.length / 2)]);
    var kept = pts.filter(function (_, i) { return d[i] <= lim; });
    return kept.length >= 6 ? fitLine(kept) : line;
  }

  function lineThrough(a, b) {
    var nm = sideNormal(a, b);
    return { nx: nm.nx, ny: nm.ny, c: nm.nx * a.x + nm.ny * a.y };
  }

  function intersect(l1, l2) {
    var det = l1.nx * l2.ny - l1.ny * l2.nx;
    if (Math.abs(det) < 1e-6) return null;
    return { x: (l1.c * l2.ny - l1.ny * l2.c) / det, y: (l1.nx * l2.c - l1.c * l2.nx) / det };
  }

  function refineQuad(q, G, w, h, thr, R) {
    var lines = [];
    for (var s = 0; s < 4; s++) {
      var a = q[s], b = q[(s + 1) % 4], nm = sideNormal(a, b), pts = [];
      for (var k = 0; k < 40; k++) {
        var t = 0.08 + 0.84 * k / 39, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        // Prefer the strong gradient peak closest to the current side, so text lines
        // inside the page cannot pull the edge inwards.
        var vals = [], best = 0, bo = 0, o;
        for (o = -R; o <= R; o++) {
          var v = gradAt(G, w, h, px + nm.nx * o, py + nm.ny * o, nm.nx, nm.ny);
          vals.push(v); if (v > best) best = v;
        }
        if (best <= thr) continue;
        var bestDist = R + 1;
        for (o = -R; o <= R; o++) {
          var vi = vals[o + R];
          var isPeak = (o === -R || vi >= vals[o + R - 1]) && (o === R || vi >= vals[o + R + 1]);
          if (isPeak && vi >= 0.6 * best && Math.abs(o) < bestDist) { bestDist = Math.abs(o); bo = o; }
        }
        pts.push({ x: px + nm.nx * bo, y: py + nm.ny * bo });
      }
      lines.push(pts.length >= 10 ? robustLine(pts) : lineThrough(a, b));
    }
    var out = [];
    for (var c = 0; c < 4; c++) {
      var p = intersect(lines[(c + 3) % 4], lines[c]);
      if (!p || p.x < -0.03 * w || p.y < -0.03 * h || p.x > 1.03 * w || p.y > 1.03 * h) return q;
      out.push({ x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)) });
    }
    if (!isConvex(out)) return q;
    var ratio = polyArea(out) / Math.max(1, polyArea(q));
    return ratio > 0.6 && ratio < 1.6 ? out : q;
  }

  /* ---------------- detection ---------------- */

  function candidatesFromMask(mask, w, h, out) {
    var lab = label(mask, w, h), n = w * h, per = 2 * (w + h) - 4;
    var comps = lab.comps.filter(function (c) {
      return c.area >= 0.08 * n && c.area <= 0.98 * n && c.border / per < 0.5;
    }).sort(function (a, b) { return b.area - a.area; }).slice(0, 3);
    comps.forEach(function (c) {
      var minX = new Int32Array(h).fill(-1), maxX = new Int32Array(h).fill(-1), x, y;
      for (y = 0; y < h; y++) {
        var row = y * w;
        for (x = 0; x < w; x++) {
          if (lab.labels[row + x] === c.id) { if (minX[y] < 0) minX[y] = x; maxX[y] = x; }
        }
      }
      var pts = [];
      // Coordinates are pixel centres throughout detection; normalised as (p + 0.5) / size at the end.
      for (y = 0; y < h; y++) if (minX[y] >= 0) { pts.push({ x: minX[y], y: y }); pts.push({ x: maxX[y], y: y }); }
      var quad = maxAreaQuad(convexHull(pts));
      if (quad) out.push({ quad: orderQuad(quad), borderFrac: c.border / per });
    });
  }

  function dims(img) {
    return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  }

  // Gradients from luminance plus two opponent colour channels, so a coloured page on a
  // table of the same brightness still produces edges. Per pixel the strongest channel wins.
  function colourGradients(d, w, h) {
    var n = w * h, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), i;
    for (i = 0; i < n; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      A[i] = r - g;
      B[i] = (r + g) * 0.5 - b;
    }
    L = boxBlur(boxBlur(L, w, h, 1), w, h, 1);
    A = boxBlur(boxBlur(A, w, h, 1), w, h, 1);
    B = boxBlur(boxBlur(B, w, h, 1), w, h, 1);
    var GL = sobel(L, w, h), GA = sobel(A, w, h), GB = sobel(B, w, h);
    for (i = 0; i < n; i++) {
      var ma = GA.mag[i] * 0.8, mb = GB.mag[i] * 0.8;
      if (ma > GL.mag[i] && ma >= mb) { GL.gx[i] = GA.gx[i] * 0.8; GL.gy[i] = GA.gy[i] * 0.8; GL.mag[i] = ma; }
      else if (mb > GL.mag[i]) { GL.gx[i] = GB.gx[i] * 0.8; GL.gy[i] = GB.gy[i] * 0.8; GL.mag[i] = mb; }
    }
    return { G: GL, gray: L, chans: [L, A, B] };
  }

  // Canny: non-maximum suppression along the gradient, then hysteresis.
  function canny(G, w, h, hi, lo) {
    var n = w * h, nms = new Float32Array(n), edges = new Uint8Array(n), stack = new Int32Array(n), top = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x, m = G.mag[i];
        if (m < lo) continue;
        var gx = G.gx[i], gy = G.gy[i], ax = Math.abs(gx), ay = Math.abs(gy), n1, n2;
        if (ay <= ax * 0.4142) { n1 = i - 1; n2 = i + 1; }
        else if (ay >= ax * 2.4142) { n1 = i - w; n2 = i + w; }
        else if (gx * gy > 0) { n1 = i - w - 1; n2 = i + w + 1; }
        else { n1 = i - w + 1; n2 = i + w - 1; }
        if (m >= G.mag[n1] && m > G.mag[n2]) nms[i] = m;
      }
    }
    for (var s = 0; s < n; s++) if (nms[s] >= hi && !edges[s]) { edges[s] = 1; stack[top++] = s; }
    while (top > 0) {
      var p = stack[--top], px = p % w, py = (p - px) / w;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var qx = px + dx, qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        var q = qy * w + qx;
        if (!edges[q] && nms[q] >= lo) { edges[q] = 1; stack[top++] = q; }
      }
    }
    return edges;
  }

  // Hough transform; each edge pixel only votes for line angles near its own gradient direction.
  function houghLines(edges, G, w, h, maxLines) {
    var nT = 180, diag = Math.ceil(Math.sqrt(w * w + h * h)), nR = 2 * diag + 1;
    var cosT = new Float32Array(nT), sinT = new Float32Array(nT), t, i;
    for (t = 0; t < nT; t++) { cosT[t] = Math.cos(t * Math.PI / nT); sinT[t] = Math.sin(t * Math.PI / nT); }
    var acc = new Float32Array(nT * nR);
    for (i = 0; i < w * h; i++) {
      if (!edges[i]) continue;
      var x = i % w, y = (i - x) / w;
      var phi = Math.atan2(G.gy[i], G.gx[i]); if (phi < 0) phi += Math.PI;
      var t0 = Math.round(phi * nT / Math.PI);
      for (var dt = -6; dt <= 6; dt++) {
        var tt = t0 + dt;
        if (tt < 0) tt += nT; else if (tt >= nT) tt -= nT;
        var r = Math.round(x * cosT[tt] + y * sinT[tt]);
        acc[tt * nR + r + diag] += 1;
      }
    }
    var minVotes = Math.max(20, 0.1 * Math.min(w, h)), peaks = [];
    for (t = 0; t < nT; t++) {
      for (var rr = 1; rr < nR - 1; rr++) {
        var v = acc[t * nR + rr];
        if (v < minVotes) continue;
        var isMax = true;
        for (var a = -2; a <= 2 && isMax; a++) for (var b = -2; b <= 2; b++) {
          if (!a && !b) continue;
          var ta = t + a, rb = rr + b;
          if (ta < 0 || ta >= nT || rb < 0 || rb >= nR) continue;
          if (acc[ta * nR + rb] > v) { isMax = false; break; }
        }
        if (isMax) peaks.push({ t: t, r: rr - diag, v: v });
      }
    }
    peaks.sort(function (p, q) { return q.v - p.v; });
    var kept = [];
    for (i = 0; i < peaks.length && kept.length < maxLines; i++) {
      var p = peaks[i], dup = false;
      for (var k = 0; k < kept.length && !dup; k++) {
        var o = kept[k], dT = Math.abs(p.t - o.t);
        if (dT <= 4 && Math.abs(p.r - o.r) <= 10) dup = true;
        if (nT - dT <= 4 && Math.abs(p.r + o.r) <= 10) dup = true;
      }
      if (!dup) kept.push(p);
    }
    return kept.map(function (p) {
      var th = p.t * Math.PI / nT;
      return { nx: Math.cos(th), ny: Math.sin(th), c: p.r, theta: th, votes: p.v };
    });
  }

  function angleBetween(a, b) {
    var d = Math.abs(a.theta - b.theta);
    return Math.min(d, Math.PI - d);
  }

  function interiorAnglesOk(q) {
    for (var i = 0; i < 4; i++) {
      var p = q[(i + 3) % 4], c = q[i], n = q[(i + 1) % 4];
      var ax = p.x - c.x, ay = p.y - c.y, bx = n.x - c.x, by = n.y - c.y;
      var cos = (ax * bx + ay * by) / ((Math.sqrt(ax * ax + ay * ay) * Math.sqrt(bx * bx + by * by)) || 1);
      if (cos > 0.77 || cos < -0.77) return false; // outside roughly 40..140 degrees
    }
    return true;
  }

  // Builds quads from two roughly parallel line pairs that cross each other.
  function quadsFromLines(lines, w, h, out) {
    var pairs = [], i, j, minSep = 0.12 * Math.min(w, h), cx = w / 2, cy = h / 2;
    for (i = 0; i < lines.length; i++) {
      for (j = i + 1; j < lines.length; j++) {
        if (angleBetween(lines[i], lines[j]) > 0.45) continue;
        var di = lines[i].nx * cx + lines[i].ny * cy - lines[i].c;
        var dj = lines[j].nx * cx + lines[j].ny * cy - lines[j].c;
        var same = lines[i].nx * lines[j].nx + lines[i].ny * lines[j].ny > 0 ? 1 : -1;
        if (Math.abs(di - same * dj) < minSep) continue;
        pairs.push([lines[i], lines[j]]);
      }
    }
    // Keep the strongest pairs only, so patterned backgrounds cannot explode the search
    pairs.sort(function (p, q2) { return q2[0].votes + q2[1].votes - p[0].votes - p[1].votes; });
    if (pairs.length > 320) pairs.length = 320;
    var tolX = 0.12 * w, tolY = 0.12 * h, minArea = 0.08 * w * h;
    for (i = 0; i < pairs.length; i++) {
      for (j = i + 1; j < pairs.length; j++) {
        var A = pairs[i], B = pairs[j];
        if (A[0] === B[0] || A[0] === B[1] || A[1] === B[0] || A[1] === B[1]) continue;
        if (angleBetween(A[0], B[0]) < 0.7) continue;
        var p1 = intersect(A[0], B[0]), p2 = intersect(A[0], B[1]), p3 = intersect(A[1], B[1]), p4 = intersect(A[1], B[0]);
        if (!p1 || !p2 || !p3 || !p4) continue;
        var q = [p1, p2, p3, p4], bad = false;
        for (var k = 0; k < 4; k++) {
          if (q[k].x < -tolX || q[k].y < -tolY || q[k].x > w + tolX || q[k].y > h + tolY) { bad = true; break; }
        }
        if (bad) continue;
        q = orderQuad(q);
        if (!isConvex(q) || polyArea(q) < minArea || !interiorAnglesOk(q)) continue;
        out.push({ quad: q, source: 'lines' });
      }
    }
  }

  // Scores how much a quad looks like a real document outline.
  // chans: [luminance, red-green, yellow-blue] blurred channels.
  function scoreQuad(q, G, edges, chans, w, h) {
    var cx = 0, cy = 0, s, k, ch;
    for (k = 0; k < 4; k++) { cx += q[k].x / 4; cy += q[k].y / 4; }
    var sides = [], cohs = [];
    for (s = 0; s < 4; s++) {
      var a = q[s], b = q[(s + 1) % 4], nm = sideNormal(a, b);
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var inward = nm.nx * (cx - mx) + nm.ny * (cy - my) > 0 ? 1 : -1;
      var hits = 0, total = 0, diffN = 0, dSum = [0, 0, 0], dAbs = [0, 0, 0];
      for (k = 0; k < 40; k++) {
        var t = 0.05 + 0.9 * k / 39, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        if (px < 2 || py < 2 || px > w - 3 || py > h - 3) continue;
        total++;
        for (var o = -2; o <= 2; o++) {
          var xi = Math.round(px + nm.nx * o), yi = Math.round(py + nm.ny * o);
          if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
          var i = yi * w + xi;
          if (!edges[i]) continue;
          var align = Math.abs(G.gx[i] * nm.nx + G.gy[i] * nm.ny) / (G.mag[i] || 1);
          if (align > 0.85) { hits++; break; }
        }
        var ix = Math.round(px + nm.nx * inward * 4), iy = Math.round(py + nm.ny * inward * 4);
        var ox = Math.round(px - nm.nx * inward * 4), oy = Math.round(py - nm.ny * inward * 4);
        if (ix >= 0 && iy >= 0 && ix < w && iy < h && ox >= 0 && oy >= 0 && ox < w && oy < h) {
          for (ch = 0; ch < 3; ch++) {
            var df = chans[ch][iy * w + ix] - chans[ch][oy * w + ox];
            dSum[ch] += df; dAbs[ch] += Math.abs(df);
          }
          diffN++;
        }
      }
      // A side mostly outside the frame (document cut off) is treated as neutral
      sides.push(total >= 8 ? hits / total : 0.5);
      // Coherence: a real page edge keeps the same inside/outside contrast along its whole
      // length, while lines in a patterned background alternate. Best channel counts.
      var coh = 0;
      if (diffN >= 8) {
        for (ch = 0; ch < 3; ch++) {
          if (dAbs[ch] / diffN < 4) continue;
          coh = Math.max(coh, Math.abs(dSum[ch]) / dAbs[ch]);
        }
      } else {
        coh = 0.7;
      }
      cohs.push(coh);
    }
    var mean = (sides[0] + sides[1] + sides[2] + sides[3]) / 4;
    var minSide = Math.min(sides[0], sides[1], sides[2], sides[3]);
    var cohMean = (cohs[0] + cohs[1] + cohs[2] + cohs[3]) / 4;
    var areaFrac = polyArea(clipQuad(q, w, h)) / (w * h);
    return {
      support: mean,
      minSide: minSide,
      score: mean * (0.4 + 0.6 * minSide) * Math.sqrt(areaFrac) * (0.25 + 0.75 * cohMean * cohMean),
    };
  }

  function clipQuad(q, w, h) {
    return q.map(function (p) { return { x: Math.max(0, Math.min(w - 1, p.x)), y: Math.max(0, Math.min(h - 1, p.y)) }; });
  }

  function detect(img) {
    var D = dims(img);
    var sc = Math.min(1, DETECT_MAX / Math.max(D.w, D.h));
    var w = Math.max(8, Math.round(D.w * sc)), h = Math.max(8, Math.round(D.h * sc)), n = w * h, i;
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data;
    var CG = colourGradients(d, w, h), G = CG.G, gray = CG.gray, chans = CG.chans;

    var hi = Math.max(16, percentile(G.mag, n, 0.9) * 0.3), lo = hi * 0.5;
    var edges = canny(G, w, h, hi, lo);
    // Paper edges on a similar-coloured desk are much weaker than text strokes,
    // so side snapping uses a lower threshold than the edge detector.
    var sideThr = Math.max(10, lo * 0.6);

    var cands = [];
    quadsFromLines(houghLines(edges, G, w, h, 48), w, h, cands);

    // Region-based candidates (bright / dark / closed-edge blobs) cover curled or torn pages
    var t = otsu(gray, n), bright = new Uint8Array(n), dark = new Uint8Array(n);
    for (i = 0; i < n; i++) { bright[i] = gray[i] > t ? 1 : 0; dark[i] = bright[i] ? 0 : 1; }
    candidatesFromMask(closeOpen(bright, w, h, 2, 3), w, h, cands);
    candidatesFromMask(closeOpen(dark, w, h, 2, 3), w, h, cands);
    var edgeFilled = fillHoles(morph(edges, w, h, 2, true), w, h);
    candidatesFromMask(morph(morph(edgeFilled, w, h, 3, false), w, h, 3, true), w, h, cands);

    var scored = [];
    cands.forEach(function (c) {
      var sc0 = scoreQuad(c.quad, G, edges, chans, w, h);
      if (sc0.support >= 0.3) scored.push({ quad: c.quad, s: sc0 });
    });
    scored.sort(function (a, b) { return b.s.score - a.s.score; });

    // Sub-pixel refinement of the best few; keep a refinement only if it does not hurt the score
    var best = null, bestScore = 0, diag = Math.sqrt(w * w + h * h);
    scored.slice(0, 6).forEach(function (c) {
      var q = c.quad, s = c.s;
      var r = refineQuad(q, G, w, h, sideThr, Math.max(3, Math.round(diag * 0.012)));
      r = refineQuad(r, G, w, h, sideThr, 2);
      if (isConvex(r)) {
        var rs = scoreQuad(r, G, edges, chans, w, h);
        if (rs.score >= s.score * 0.97) { q = r; s = rs; }
      }
      if (s.support >= 0.45 && s.minSide >= 0.2 && s.score > bestScore) { bestScore = s.score; best = q; }
    });

    return {
      width: D.w,
      height: D.h,
      corners: best ? orderQuad(best).map(function (p) {
        return { x: Math.max(0, Math.min(1, (p.x + 0.5) / w)), y: Math.max(0, Math.min(1, (p.y + 0.5) / h)) };
      }) : null,
    };
  }

  // Bakes EXIF orientation into the pixels and caps the size, so React Native and the
  // engine see the same image. Returns the normalised JPEG plus the detected corners.
  function prepare(img, alias) {
    var D = dims(img), sc = Math.min(1, WARP_SRC_MAX / Math.max(D.w, D.h));
    var w = Math.round(D.w * sc), h = Math.round(D.h * sc);
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
    var url = cv.toDataURL('image/jpeg', 0.93);
    cache.key = alias; cache.img = cv;
    var det = detect(cv);
    return { b64: url.substring(url.indexOf(',') + 1), width: w, height: h, corners: det.corners };
  }

  /* ---------------- perspective warp ---------------- */

  // Solves the 3x3 homography (h33 = 1) that maps src[i] -> dst[i].
  function homography(src, dst) {
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x = src[i].x, y = src[i].y, u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (i = 0; i < 8; i++) {
      var piv = i;
      for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
      if (Math.abs(A[i][i]) < 1e-12) throw new Error('Degenerate crop corners');
      for (j = i + 1; j < 8; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < 9; k++) A[j][k] -= f * A[i][k];
      }
    }
    var hv = new Array(8);
    for (i = 7; i >= 0; i--) {
      var s = A[i][8];
      for (j = i + 1; j < 8; j++) s -= A[i][j] * hv[j];
      hv[i] = s / A[i][i];
    }
    return hv;
  }

  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  function warp(img, corners) {
    var D0 = dims(img), W0 = D0.w, H0 = D0.h;
    var sc = Math.min(1, WARP_SRC_MAX / Math.max(W0, H0));
    var sw = Math.round(W0 * sc), sh = Math.round(H0 * sc);
    var cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
    var ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, sw, sh);
    var src = ctx.getImageData(0, 0, sw, sh).data;
    cv.width = 1; cv.height = 1; // release source canvas memory early

    var P = corners.map(function (c) { return { x: c.x * sw, y: c.y * sh }; });
    var ow = Math.max(dist(P[0], P[1]), dist(P[3], P[2]));
    var oh = Math.max(dist(P[0], P[3]), dist(P[1], P[2]));
    var os = Math.min(1, WARP_OUT_MAX / Math.max(ow, oh));
    ow = Math.max(1, Math.round(ow * os)); oh = Math.max(1, Math.round(oh * os));

    var H = homography([{ x: 0, y: 0 }, { x: ow, y: 0 }, { x: ow, y: oh }, { x: 0, y: oh }], P);
    var out = document.createElement('canvas'); out.width = ow; out.height = oh;
    var octx = out.getContext('2d'), od = octx.createImageData(ow, oh), o = od.data;
    var maxX = sw - 1, maxY = sh - 1;
    for (var y = 0; y < oh; y++) {
      var yy = y + 0.5;
      for (var x = 0; x < ow; x++) {
        var xx = x + 0.5;
        var den = H[6] * xx + H[7] * yy + 1;
        var sx = (H[0] * xx + H[1] * yy + H[2]) / den - 0.5;
        var sy = (H[3] * xx + H[4] * yy + H[5]) / den - 0.5;
        if (sx < 0) sx = 0; else if (sx > maxX) sx = maxX;
        if (sy < 0) sy = 0; else if (sy > maxY) sy = maxY;
        var x0 = sx | 0, y0 = sy | 0, x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
        var fx = sx - x0, fy = sy - y0;
        var i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        var di = (y * ow + x) * 4;
        for (var ch = 0; ch < 3; ch++) {
          var top = src[i00 + ch] + (src[i10 + ch] - src[i00 + ch]) * fx;
          var bot = src[i01 + ch] + (src[i11 + ch] - src[i01 + ch]) * fx;
          o[di + ch] = top + (bot - top) * fy;
        }
        o[di + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    var url = out.toDataURL('image/jpeg', 0.92);
    return { b64: url.substring(url.indexOf(',') + 1), width: ow, height: oh };
  }

  // Bakes the page filter, adjustments (shared pixel pipeline, same as the live preview)
  // and rotation into a JPEG.
  var RENDER_MAX = 2400;
  function renderFiltered(img, filter, adjust, rotation) {
    var src = window.DocFilter.render(img, RENDER_MAX, filter || 'original', adjust || null);
    var w = src.width, h = src.height;
    var rot = ((rotation || 0) % 360 + 360) % 360, swap = rot === 90 || rot === 270;
    var out = document.createElement('canvas'); out.width = swap ? h : w; out.height = swap ? w : h;
    var o = out.getContext('2d');
    o.fillStyle = '#FFFFFF'; o.fillRect(0, 0, out.width, out.height);
    o.translate(out.width / 2, out.height / 2);
    o.rotate(rot * Math.PI / 180);
    o.drawImage(src, -w / 2, -h / 2);
    var url = out.toDataURL('image/jpeg', 0.92);
    return { b64: url.substring(url.indexOf(',') + 1), width: out.width, height: out.height };
  }

  // ID card: front and back centred on one white A4 page (top half / bottom half)
  function composeIdCard(imgs) {
    var W = 1654, H = 2339; // A4 at 200 dpi
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, H);
    var maxW = W * 0.62, maxH = H * 0.4;
    for (var i = 0; i < imgs.length; i++) {
      var D = dims(imgs[i]), s = Math.min(maxW / D.w, maxH / D.h);
      var w = D.w * s, h = D.h * s, cy = H * (imgs.length === 1 ? 0.5 : i === 0 ? 0.27 : 0.73);
      c.drawImage(imgs[i], (W - w) / 2, cy - h / 2, w, h);
    }
    var url = cv.toDataURL('image/jpeg', 0.93);
    return { b64: url.substring(url.indexOf(',') + 1), width: W, height: H };
  }

  window.__scan = function (req) {
    if (req.op === 'compose') {
      Promise.all(req.images.map(loadImage)).then(function (imgs) {
        post({ id: req.id, ok: true, result: composeIdCard(imgs) });
      }).catch(function (e) {
        post({ id: req.id, ok: false, error: String((e && e.message) || e) });
      });
      return;
    }
    getImage(req).then(function (img) {
      if (req.op === 'detect') return detect(img);
      if (req.op === 'prepare') return prepare(img, req.alias);
      if (req.op === 'render') return renderFiltered(img, req.filter, req.adjust, req.rotation);
      if (req.op === 'warp') return warp(img, req.corners);
      throw new Error('Unknown operation: ' + req.op);
    }).then(function (result) {
      post({ id: req.id, ok: true, result: result });
    }).catch(function (e) {
      post({ id: req.id, ok: false, error: String((e && e.message) || e) });
    });
  };

  post({ type: 'ready' });
})();
`;

export const EDGE_ENGINE_HTML = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;background:transparent"><script>${FILTER_PIPELINE_JS}</script><script>${ENGINE_JS}</script></body></html>`;
