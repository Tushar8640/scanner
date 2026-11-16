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
  var DETECT_MAX = 480;
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

  function detect(img) {
    var W0 = img.naturalWidth, H0 = img.naturalHeight;
    var sc = Math.min(1, DETECT_MAX / Math.max(W0, H0));
    var w = Math.max(8, Math.round(W0 * sc)), h = Math.max(8, Math.round(H0 * sc)), n = w * h;
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h).data, gray = new Float32Array(n), i;
    for (i = 0; i < n; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    gray = boxBlur(boxBlur(gray, w, h, 2), w, h, 2);
    var G = sobel(gray, w, h);
    var thr = Math.max(40, percentile(G.mag, n, 0.85));
    // Paper edges on a similar-coloured desk are much weaker than text strokes,
    // so side snapping and scoring use a lower threshold than the edge mask.
    var sideThr = Math.max(12, thr * 0.3);

    var cands = [], t = otsu(gray, n);
    var bright = new Uint8Array(n), dark = new Uint8Array(n), edges = new Uint8Array(n);
    for (i = 0; i < n; i++) { bright[i] = gray[i] > t ? 1 : 0; dark[i] = bright[i] ? 0 : 1; edges[i] = G.mag[i] > thr ? 1 : 0; }
    candidatesFromMask(closeOpen(bright, w, h, 2, 3), w, h, cands);
    candidatesFromMask(closeOpen(dark, w, h, 2, 3), w, h, cands);
    var edgeFilled = fillHoles(morph(edges, w, h, 1, true), w, h);
    candidatesFromMask(morph(morph(edgeFilled, w, h, 3, false), w, h, 3, true), w, h, cands);

    var diag = Math.sqrt(w * w + h * h), best = null, bestScore = 0;
    cands.forEach(function (c) {
      var q = refineQuad(c.quad, G, w, h, sideThr, Math.max(4, Math.round(diag * 0.03)));
      q = refineQuad(q, G, w, h, sideThr, 3);
      if (!isConvex(q)) return;
      var areaFrac = polyArea(q) / n;
      if (areaFrac < 0.1) return;
      var support = edgeSupport(q, G, w, h, sideThr);
      if (support < 0.35) return;
      var score = support * (0.6 + 0.4 * areaFrac) * (1 - 0.5 * c.borderFrac);
      if (score > bestScore) { bestScore = score; best = q; }
    });

    return {
      width: W0,
      height: H0,
      corners: best ? orderQuad(best).map(function (p) {
        return { x: Math.max(0, Math.min(1, (p.x + 0.5) / w)), y: Math.max(0, Math.min(1, (p.y + 0.5) / h)) };
      }) : null,
    };
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
    var W0 = img.naturalWidth, H0 = img.naturalHeight;
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

  window.__scan = function (req) {
    getImage(req).then(function (img) {
      if (req.op === 'detect') return detect(img);
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
<body style="margin:0;background:transparent"><script>${ENGINE_JS}</script></body></html>`;
