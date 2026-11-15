import { PageFilter } from '@/core/types';

/**
 * Returns hardware-accelerated CSS filter string corresponding to PageFilter and intensity (0.1 to 1.0)
 */
export function getCssFilter(filter: PageFilter, intensity: number = 0.6): string {
  const normIntensity = Math.max(0.1, Math.min(1.0, intensity));

  switch (filter) {
    case 'magic': {
      // Magic Color: balanced contrast + brightness + slight saturation normalization
      const mcContrast = Math.round(112 + normIntensity * 36); // 115% to 148%
      const mcBrightness = Math.round(101 + normIntensity * 8);  // 102% to 109%
      return `contrast(${mcContrast}%) brightness(${mcBrightness}%) saturate(85%)`;
    }
    case 'bw': {
      // Clean B&W Photocopy
      const bwContrast = Math.round(180 + normIntensity * 150); // 195% to 330%
      const bwBrightness = Math.round(104 + normIntensity * 14); // 105% to 118%
      return `grayscale(100%) contrast(${bwContrast}%) brightness(${bwBrightness}%)`;
    }
    case 'grayscale': {
      const grayContrast = Math.round(108 + normIntensity * 20); // 110% to 128%
      return `grayscale(100%) contrast(${grayContrast}%) brightness(102%)`;
    }
    case 'enhanced': {
      const enhContrast = Math.round(112 + normIntensity * 32); // 115% to 144%
      const enhBrightness = Math.round(101 + normIntensity * 9);  // 102% to 110%
      return `contrast(${enhContrast}%) brightness(${enhBrightness}%) saturate(88%)`;
    }
    case 'original':
    default:
      return 'none';
  }
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

  const containerFilter = getCssFilter(filter, normIntensity);
  const isMagicMode = filter === 'magic' || filter === 'bw';

  const dodgeOpacity =
    filter === 'bw'
      ? Math.min(0.92, 0.45 + normIntensity * 0.45)
      : Math.min(0.88, 0.35 + normIntensity * 0.52);
  const blurPx = Math.round(10 + normIntensity * 10);
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
          // Instant 60 FPS live filter and intensity update without reloading WebView
          window.applyFilterUpdate = function(filterName, intensityVal, rotDeg) {
            var frame = document.getElementById('docFrame');
            var dodgeClip = document.getElementById('dodgeClip');
            var docDodge = document.getElementById('docDodge');
            if (!frame) return;

            if (rotDeg !== undefined) {
              frame.style.transform = 'rotate(' + rotDeg + 'deg)';
            }

            var intVal = (intensityVal !== undefined && intensityVal >= 0 && intensityVal <= 1) ? intensityVal : 0.6;
            var dodgeOpacity = Math.min(0.88, 0.35 + intVal * 0.52);
            var blurPx = Math.round(10 + intVal * 10);

            if (filterName === 'magic') {
              if (dodgeClip) dodgeClip.style.display = 'block';
              if (docDodge) {
                docDodge.style.opacity = dodgeOpacity;
                docDodge.style.filter = 'invert(100%) blur(' + blurPx + 'px) grayscale(100%)';
              }
              var c = Math.round(112 + intVal * 36);
              var b = Math.round(101 + intVal * 8);
              frame.style.filter = 'contrast(' + c + '%) brightness(' + b + '%) saturate(85%)';
            } else if (filterName === 'bw') {
              if (dodgeClip) dodgeClip.style.display = 'block';
              if (docDodge) {
                docDodge.style.opacity = Math.min(0.92, 0.45 + intVal * 0.45);
                docDodge.style.filter = 'invert(100%) blur(' + blurPx + 'px) grayscale(100%)';
              }
              var bwC = Math.round(180 + intVal * 150);
              var bwB = Math.round(104 + intVal * 14);
              frame.style.filter = 'grayscale(100%) contrast(' + bwC + '%) brightness(' + bwB + '%)';
            } else if (filterName === 'enhanced') {
              if (dodgeClip) dodgeClip.style.display = 'none';
              var enhC = Math.round(112 + intVal * 32);
              var enhB = Math.round(101 + intVal * 9);
              frame.style.filter = 'contrast(' + enhC + '%) brightness(' + enhB + '%) saturate(88%)';
            } else if (filterName === 'grayscale') {
              if (dodgeClip) dodgeClip.style.display = 'none';
              var grayC = Math.round(108 + intVal * 20);
              frame.style.filter = 'grayscale(100%) contrast(' + grayC + '%) brightness(102%)';
            } else {
              // original
              if (dodgeClip) dodgeClip.style.display = 'none';
              frame.style.filter = 'none';
            }
          };

          function handleMsg(e) {
            try {
              var data = JSON.parse(e.data);
              if (data && data.type === 'UPDATE_FILTER') {
                window.applyFilterUpdate(data.filter, data.intensity, data.rotation);
              }
            } catch (err) {}
          }
          window.addEventListener('message', handleMsg);
          document.addEventListener('message', handleMsg);
        </script>
      </body>
    </html>
  `;
}