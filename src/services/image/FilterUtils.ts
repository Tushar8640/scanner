import { DEFAULT_ADJUST, PageAdjust, PageFilter } from '@/core/types';
import { FILTER_PIPELINE_JS } from './filterPipelineJs';

/** Filters shown in the editor, in display order. ('enhanced' is legacy and hidden.) */
export const FILTER_ORDER: PageFilter[] = ['original', 'lighten', 'magic', 'noshadow', 'bw', 'eco', 'grayscale', 'invert'];

/** Reads a page's adjustments, accepting the JSON string stored in SQLite. */
export function normaliseAdjust(value: unknown): PageAdjust {
  let v: any = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  if (!v || typeof v !== 'object') return { ...DEFAULT_ADJUST };
  const pick = (n: unknown) => (typeof n === 'number' && isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50);
  return { contrast: pick(v.contrast), brightness: pick(v.brightness), details: pick(v.details) };
}

export function isDefaultAdjust(a: PageAdjust | null | undefined): boolean {
  return !a || (a.contrast === 50 && a.brightness === 50 && a.details === 50);
}

/**
 * CSS approximation of a filter. Only used where the pixel pipeline cannot run
 * (PDF export without a page renderer).
 */
export interface FilterRecipe {
  css: string;
  dodgeOpacity: number; // 0 = no shadow-removal layer
  blurPx: number;
}

export function getFilterRecipe(filter: PageFilter): FilterRecipe {
  const blurPx = 16;
  switch (filter) {
    case 'lighten':
      return { css: 'brightness(115%) contrast(106%)', dodgeOpacity: 0.4, blurPx };
    case 'magic':
      return { css: 'contrast(135%) brightness(105%) saturate(115%)', dodgeOpacity: 0.7, blurPx };
    case 'enhanced':
      return { css: 'contrast(130%) brightness(105%) saturate(90%)', dodgeOpacity: 0, blurPx };
    case 'noshadow':
      return { css: 'contrast(110%) brightness(102%)', dodgeOpacity: 0.8, blurPx: 22 };
    case 'bw':
      return { css: 'grayscale(100%) contrast(250%) brightness(112%)', dodgeOpacity: 0.7, blurPx };
    case 'eco':
      return { css: 'grayscale(100%) contrast(160%) brightness(125%)', dodgeOpacity: 0.7, blurPx };
    case 'grayscale':
      return { css: 'grayscale(100%) contrast(120%) brightness(102%)', dodgeOpacity: 0.3, blurPx };
    case 'invert':
      return { css: 'invert(100%) contrast(120%)', dodgeOpacity: 0, blurPx };
    case 'original':
    default:
      return { css: 'none', dodgeOpacity: 0, blurPx };
  }
}

/** HTML for one page inside a PDF (CSS filters). Pages pre-rendered by the pipeline use filter 'original'. */
export interface PageMarkupOptions {
  base64: string;
  filter: PageFilter;
  rotation?: number;
  isForPdf?: boolean;
}

export function generatePageMarkup(options: PageMarkupOptions): string {
  const { base64, filter, rotation = 0, isForPdf = false } = options;
  const imgSrc = `data:image/jpeg;base64,${base64}`;
  const recipe = getFilterRecipe(filter);
  const dodge = recipe.dodgeOpacity > 0;
  return `
    <div class="doc-frame" style="transform: rotate(${rotation}deg); filter: ${recipe.css}; ${isForPdf ? 'box-shadow: none;' : ''}">
      <img class="doc-base" src="${imgSrc}" alt="Document" />
      <div class="dodge-clip" style="display: ${dodge ? 'block' : 'none'};">
        <img class="doc-dodge" src="${imgSrc}" style="filter: invert(100%) blur(${recipe.blurPx}px) grayscale(100%); opacity: ${recipe.dodgeOpacity};" alt="" />
      </div>
    </div>
  `;
}

/**
 * Live page preview. The image is decoded once into a canvas; filters and adjustments run
 * through the shared pixel pipeline (FILTER_PIPELINE_JS), and the per-filter results are cached,
 * so switching filters or moving a slider only redraws.
 *
 * Messages to React Native: { type: 'thumbs', items: { [filter]: dataUrl } } when thumbs are requested.
 * Live updates from React Native: window.applyFilter(filter, adjust, rotation).
 */
export function generatePageHtml(options: {
  base64: string;
  filter: PageFilter;
  adjust?: PageAdjust | null;
  rotation?: number;
  backgroundColor?: string;
  /** Longest side of the working canvas. Smaller is faster (grid cells). */
  maxSide?: number;
  /** Filters to render small previews of, sent back as a 'thumbs' message. */
  thumbFilters?: PageFilter[];
}): string {
  const {
    base64,
    filter,
    adjust = null,
    rotation = 0,
    backgroundColor = '#1E1E1E',
    maxSide = 1600,
    thumbFilters = [],
  } = options;

  const init = JSON.stringify({ filter, adjust: adjust ?? DEFAULT_ADJUST, rotation, maxSide, thumbFilters });

  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${backgroundColor}; -webkit-user-select: none; user-select: none; }
      #wrap { position: absolute; inset: 8px; display: flex; align-items: center; justify-content: center; }
      #page { display: block; box-shadow: 0 4px 14px rgba(0,0,0,0.35); transform-origin: center center; }
    </style>
  </head>
  <body>
    <div id="wrap"><canvas id="page"></canvas></div>
    <img id="src" style="display:none" />
    <script>${FILTER_PIPELINE_JS}</script>
    <script>
      (function () {
        var cfg = ${init};
        var st = null, cur = { filter: cfg.filter, adjust: cfg.adjust, rotation: cfg.rotation };
        var view = document.getElementById('page'), wrap = document.getElementById('wrap');
        var pending = false;

        function layout() {
          if (!st) return;
          var rot = ((cur.rotation || 0) % 360 + 360) % 360, swap = rot === 90 || rot === 270;
          var bw = wrap.clientWidth, bh = wrap.clientHeight;
          var iw = swap ? st.h : st.w, ih = swap ? st.w : st.h;
          var s = Math.min(bw / iw, bh / ih);
          view.style.width = Math.round(st.w * s) + 'px';
          view.style.height = Math.round(st.h * s) + 'px';
          view.style.transform = 'rotate(' + rot + 'deg)';
        }

        function draw() {
          pending = false;
          if (!st) return;
          var data = DocFilter.adjust(st, DocFilter.base(st, cur.filter), cur.adjust);
          view.getContext('2d').putImageData(data, 0, 0);
          layout();
        }

        function schedule() {
          if (pending) return;
          pending = true;
          requestAnimationFrame(draw);
        }

        function thumbs() {
          if (!cfg.thumbFilters.length || !window.ReactNativeWebView) return;
          var tst = DocFilter.prepare(st.canvas, 220), out = {};
          var c = document.createElement('canvas'); c.width = tst.w; c.height = tst.h;
          var cx = c.getContext('2d');
          cfg.thumbFilters.forEach(function (f) {
            cx.putImageData(DocFilter.base(tst, f), 0, 0);
            out[f] = c.toDataURL('image/jpeg', 0.8);
          });
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'thumbs', items: out }));
        }

        window.applyFilter = function (filter, adjust, rotation) {
          cur = { filter: filter, adjust: adjust, rotation: rotation };
          schedule();
        };

        var img = document.getElementById('src');
        img.onload = function () {
          st = DocFilter.prepare(img, cfg.maxSide);
          view.width = st.w; view.height = st.h;
          draw();
          setTimeout(thumbs, 30);
        };
        window.addEventListener('resize', layout);
        img.src = 'data:image/jpeg;base64,${base64}';
      })();
    </script>
  </body>
</html>`;
}
