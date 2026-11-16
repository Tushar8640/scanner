import { PageFilter } from '@/core/types';

/** Filters shown in the editor, in display order. */
export const FILTER_ORDER: PageFilter[] = ['original', 'lighten', 'magic', 'enhanced', 'noshadow', 'bw', 'grayscale'];

/**
 * Everything needed to render one filter: a CSS filter for the page and an optional
 * colour-dodge layer (inverted, blurred copy) that flattens shadows and uneven light.
 * Used by the live preview, the PDF export and the WebView update script.
 */
export interface FilterRecipe {
  css: string;
  dodgeOpacity: number; // 0 = no shadow-removal layer
  blurPx: number;
}

export function getFilterRecipe(filter: PageFilter, intensity: number = 0.6): FilterRecipe {
  const k = Math.max(0.1, Math.min(1.0, intensity));
  const blurPx = Math.round(10 + k * 10);
  const r = (v: number) => Math.round(v);
  switch (filter) {
    case 'lighten':
      // Brighter, cleaner paper with colours kept
      return {
        css: `brightness(${r(106 + k * 14)}%) contrast(${r(102 + k * 8)}%)`,
        dodgeOpacity: Math.min(0.6, 0.15 + k * 0.4),
        blurPx,
      };
    case 'magic':
      // Magic Color: shadow removal + contrast, slightly reduced saturation
      return {
        css: `contrast(${r(112 + k * 36)}%) brightness(${r(101 + k * 8)}%) saturate(85%)`,
        dodgeOpacity: Math.min(0.88, 0.35 + k * 0.52),
        blurPx,
      };
    case 'enhanced':
      return { css: `contrast(${r(112 + k * 32)}%) brightness(${r(101 + k * 9)}%) saturate(88%)`, dodgeOpacity: 0, blurPx };
    case 'noshadow':
      // Strong shadow removal with natural colours and mild contrast
      return {
        css: `contrast(${r(104 + k * 10)}%) brightness(${r(100 + k * 4)}%)`,
        dodgeOpacity: Math.min(0.95, 0.55 + k * 0.4),
        blurPx: Math.round(14 + k * 12),
      };
    case 'bw':
      // Clean B&W photocopy
      return {
        css: `grayscale(100%) contrast(${r(180 + k * 150)}%) brightness(${r(104 + k * 14)}%)`,
        dodgeOpacity: Math.min(0.92, 0.45 + k * 0.45),
        blurPx,
      };
    case 'grayscale':
      return { css: `grayscale(100%) contrast(${r(108 + k * 20)}%) brightness(102%)`, dodgeOpacity: 0, blurPx };
    case 'original':
    default:
      return { css: 'none', dodgeOpacity: 0, blurPx };
  }
}

/** CSS filter string for a filter and intensity (0.1 to 1.0). */
export function getCssFilter(filter: PageFilter, intensity: number = 0.6): string {
  return getFilterRecipe(filter, intensity).css;
}

/**
 * Builds the HTML markup for a single document page using GPU-accelerated filter layers
 * (CSS filter plus the colour-dodge blend layer for shadow removal).
 */
export interface PageMarkupOptions {
  base64: string;
  filter: PageFilter;
  intensity?: number;
  rotation?: number;
  isForPdf?: boolean;
  frameId?: string;
  baseId?: string;
  clipId?: string;
  dodgeId?: string;
}

export function generatePageMarkup(options: PageMarkupOptions): string {
  const {
    base64,
    filter,
    intensity = 0.6,
    rotation = 0,
    isForPdf = false,
    frameId,
    baseId,
    clipId,
    dodgeId,
  } = options;

  const imgSrc = `data:image/jpeg;base64,${base64}`;
  const normIntensity = Math.max(0.1, Math.min(1.0, intensity));

  const recipe = getFilterRecipe(filter, normIntensity);
  const containerFilter = recipe.css;
  const isMagicMode = recipe.dodgeOpacity > 0;
  const dodgeOpacity = recipe.dodgeOpacity;
  const blurPx = recipe.blurPx;
  const dodgeFilter = `invert(100%) blur(${blurPx}px) grayscale(100%)`;

  const frameIdAttr = frameId ? `id="${frameId}"` : '';
  const baseIdAttr = baseId ? `id="${baseId}"` : '';
  const clipIdAttr = clipId ? `id="${clipId}"` : '';
  const dodgeIdAttr = dodgeId ? `id="${dodgeId}"` : '';

  return `
    <div class="doc-frame" ${frameIdAttr} style="transform: rotate(${rotation}deg); filter: ${containerFilter}; ${isForPdf ? 'box-shadow: none;' : ''}">
      <img class="doc-base" ${baseIdAttr} src="${imgSrc}" alt="Document" />
      <div class="dodge-clip" ${clipIdAttr} style="display: ${isMagicMode ? 'block' : 'none'};">
        <img class="doc-dodge" ${dodgeIdAttr} src="${imgSrc}" style="filter: ${dodgeFilter}; opacity: ${dodgeOpacity};" alt="" />
      </div>
    </div>
  `;
}

/**
 * Generates high-fidelity GPU-accelerated HTML markup for document page rendering.
 * Uses Background Division (Inverted Illumination Blur + Color-Dodge blend)
 * to remove uneven shadows, bleed-through from the back of the paper, and background noise.
 *
 * Full-Page Fix:
 * To eliminate edge vignetting / falloff (dark edges), the blurred dodge layer is scaled
 * by 12% (-6% inset) inside an overflow:hidden clip container, ensuring the blur roll-off
 * is pushed completely outside the visible document borders.
 */
export function generatePageHtml(options: {
  base64: string;
  filter: PageFilter;
  intensity?: number;
  rotation?: number;
  backgroundColor?: string;
  isForPdf?: boolean;
}): string {
  const {
    base64,
    filter,
    intensity = 0.6,
    rotation = 0,
    backgroundColor = '#1E1E1E',
    isForPdf = false,
  } = options;

  const normIntensity = Math.max(0.1, Math.min(1.0, intensity));

  const pageMarkup = generatePageMarkup({
    base64,
    filter,
    intensity: normIntensity,
    rotation,
    isForPdf,
    frameId: 'docFrame',
    baseId: 'docBase',
    clipId: 'dodgeClip',
    dodgeId: 'docDodge',
  });

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <style>
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
          }
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background-color: ${isForPdf ? '#FFFFFF' : backgroundColor};
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            -webkit-user-select: none;
            user-select: none;
          }
          .page-container {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            padding: ${isForPdf ? '0' : '8px'};
            box-sizing: border-box;
          }
          .doc-frame {
            position: relative;
            display: inline-block;
            line-height: 0;
            max-width: 98%;
            max-height: 98%;
            transform-origin: center center;
            box-shadow: ${isForPdf ? 'none' : '0 4px 14px rgba(0,0,0,0.35)'};
            border-radius: 2px;
            overflow: hidden;
            transition: filter 0.1s ease;
          }
          .doc-base {
            display: block;
            max-width: 100%;
            max-height: ${isForPdf ? '100%' : 'calc(100vh - 24px)'};
            width: auto;
            height: auto;
            object-fit: contain;
          }
          .dodge-clip {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            pointer-events: none;
          }
          .doc-dodge {
            position: absolute;
            /* Full-page coverage fix: scale 112% and offset -6% so blur vignetting is pushed outside */
            top: -6%;
            left: -6%;
            width: 112%;
            height: 112%;
            object-fit: fill;
            mix-blend-mode: color-dodge;
            pointer-events: none;
            transition: opacity 0.1s ease;
          }
        </style>
      </head>
      <body>
        <div class="page-container">
          ${pageMarkup}
        </div>

        <script>
          // Live filter update without reloading the WebView. The recipe (CSS filter and
          // shadow-removal layer) is computed in React Native by getFilterRecipe().
          window.applyRecipe = function(css, dodgeOpacity, blurPx, rotDeg) {
            var frame = document.getElementById('docFrame');
            var dodgeClip = document.getElementById('dodgeClip');
            var docDodge = document.getElementById('docDodge');
            if (!frame) return;
            if (rotDeg !== undefined) frame.style.transform = 'rotate(' + rotDeg + 'deg)';
            frame.style.filter = css;
            if (dodgeClip) dodgeClip.style.display = dodgeOpacity > 0 ? 'block' : 'none';
            if (docDodge && dodgeOpacity > 0) {
              docDodge.style.opacity = dodgeOpacity;
              docDodge.style.filter = 'invert(100%) blur(' + blurPx + 'px) grayscale(100%)';
            }
          };
        </script>
      </body>
    </html>
  `;
}