import { Image, Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Page, PageRotation, PdfPageSize, PdfQuality } from '@/core/types';
import { StorageService } from '../storage/StorageService';
import { ImageService } from '../image/ImageService';
import { generatePageMarkup } from '../image/FilterUtils';
import { SecurityService } from '../security/SecurityService';
import { OcrService, OcrLine } from '../ocr/OcrService';

const xmlEscape = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
}

/**
 * Invisible text over the page image, placed where OCR found each line. PDF viewers can then
 * search and copy the text while the page still looks exactly like the scan.
 */
function textLayer(lines: OcrLine[], width: number, height: number): string {
  if (!lines.length) return '';
  const items = lines
    .map((l) => {
      const f = l.frame;
      const size = Math.max(1, f.height * 0.82);
      return `<text x="${f.left.toFixed(1)}" y="${(f.top + f.height * 0.8).toFixed(1)}" font-size="${size.toFixed(1)}" textLength="${f.width.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${xmlEscape(l.text)}</text>`;
    })
    .join('');
  return `<svg class="ocr-layer" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><g fill="#000" fill-opacity="0.01" font-family="sans-serif">${items}</g></svg>`;
}

/** Compression presets for "Compress PDF": page image width in pixels and JPEG quality. */
export const PDF_COMPRESSION = {
  balanced: { maxDimension: 1200, compress: 0.55 },
  small: { maxDimension: 900, compress: 0.4 },
} as const;
export type PdfCompression = keyof typeof PDF_COMPRESSION;

export interface GeneratePdfOptions {
  title: string;
  pageSize?: PdfPageSize;
  quality?: PdfQuality;
  /**
   * Bakes a page's filter, adjustments and rotation into an image file (the scan engine).
   * Without it, filters fall back to a CSS approximation.
   */
  renderPage?: (page: Page) => Promise<string>;
  /** Smaller page images for a compressed copy. The result is a separate file; the saved PDF is untouched. */
  compression?: PdfCompression;
  /** Write to a temporary file (e.g. several documents shared together) instead of the document's PDF. */
  temp?: boolean;
  /** Adds an invisible OCR text layer so the PDF's text can be searched and copied. */
  searchable?: boolean;
}

export class PdfService {
  /**
   * Generates a multi-page PDF strictly on-device without any watermarks (FR-20, FR-82)
   */
  static async generatePdf(
    documentId: string,
    pages: Page[],
    options: GeneratePdfOptions
  ): Promise<string> {
    if (!pages || pages.length === 0) {
      throw new Error('At least one page is required to generate a PDF.');
    }

    const pageSize = options.pageSize || 'A4';

    // Page dimensions in PostScript points (72 points per inch)
    let width = 595;
    let height = 842;
    let cssPageSize = 'A4';

    if (pageSize === 'Letter') {
      width = 612;
      height = 792;
      cssPageSize = 'letter';
    } else if (pageSize === 'Fit') {
      cssPageSize = 'auto';
    }

    // Build pages HTML with embedded base64 images for reliable offline rendering
    const pageDivs: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const imageUri = page.processed_path || page.original_path;

      let base64 = '';
      let baked = false;
      let overlay = '';
      try {
        let sourcePath = imageUri;
        if (options.renderPage) {
          try {
            sourcePath = await options.renderPage(page);
            baked = true;
          } catch (err) {
            console.warn(`Page render failed, using CSS filter fallback [${i}]:`, err);
          }
        }
        const fileInfo = await FileSystem.getInfoAsync(sourcePath);
        if (!baked && !fileInfo.exists && page.original_path) {
          const fallbackInfo = await FileSystem.getInfoAsync(page.original_path);
          if (fallbackInfo.exists) {
            sourcePath = page.original_path;
          }
        }

        // Apply physical rotation and requested quality compression before base64
        const transformedUri = await ImageService.transformPage(
          sourcePath,
          (baked ? 0 : page.rotation || 0) as PageRotation,
          'original',
          options.quality || 'medium',
          options.compression ? PDF_COMPRESSION[options.compression] : undefined
        );

        const transformedInfo = await FileSystem.getInfoAsync(transformedUri);
        if (transformedInfo.exists) {
          base64 = await FileSystem.readAsStringAsync(transformedUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (options.searchable) {
            try {
              // OCR the exact image placed in the PDF, so the text lines up with it
              const [ocr, size] = await Promise.all([OcrService.recognize(transformedUri), imageSize(transformedUri)]);
              overlay = textLayer(ocr.lines, size.width, size.height);
            } catch (err) {
              console.warn(`OCR text layer skipped [${i}]:`, err);
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to process page image for PDF [${i}]:`, err);
      }

      if (!base64) continue;

      pageDivs.push(`
        <div class="page-container">
          ${generatePageMarkup({
            base64,
            // Baked pages already have their filter applied
            filter: baked ? 'original' : page.filter,
            rotation: 0,
            isForPdf: true,
            overlay,
          })}
        </div>
      `);
    }

    if (pageDivs.length === 0) {
      throw new Error('Could not load any document page images to generate PDF.');
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
          <style>
            @page {
              size: ${cssPageSize};
              margin: 0;
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            html, body {
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100%;
              background-color: #FFFFFF;
            }
            .page-container {
              width: 100%;
              height: 100%;
              page-break-after: always;
              page-break-inside: avoid;
              break-inside: avoid;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              background-color: #FFFFFF;
              padding: 0;
              box-sizing: border-box;
            }
            .page-container:last-child {
              page-break-after: auto;
            }
            .doc-frame {
              position: relative;
              display: inline-block;
              line-height: 0;
              max-width: 100%;
              max-height: 100%;
              transform-origin: center center;
              overflow: hidden;
            }
            .doc-base {
              display: block;
              max-width: 100%;
              max-height: 100%;
              width: auto;
              height: auto;
              object-fit: contain;
            }
            .ocr-layer {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              pointer-events: none;
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
              top: -6%;
              left: -6%;
              width: 112%;
              height: 112%;
              object-fit: fill;
              mix-blend-mode: color-dodge;
              pointer-events: none;
            }
          </style>
        </head>
        <body>
          ${pageDivs.join('\n')}
        </body>
      </html>
    `;

    // Render to PDF using native Print module
    const printOptions: Print.FilePrintOptions = {
      html,
      base64: false,
    };
    if (pageSize !== 'Fit') {
      printOptions.width = width;
      printOptions.height = height;
    }

    const printResult = await Print.printToFileAsync(printOptions);

    // Ensure document directory exists
    const docDir = StorageService.getDocumentDir(documentId);
    const dirInfo = await FileSystem.getInfoAsync(docDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(docDir, { intermediates: true });
    }

    // A compressed copy is a temporary file for sharing; it never replaces the document's PDF
    if (options.compression || options.temp) {
      const out = `${FileSystem.cacheDirectory}${options.compression ? 'compressed' : 'share'}_${Date.now()}.pdf`;
      await FileSystem.copyAsync({ from: printResult.uri, to: out });
      return out;
    }

    // Copy to persistent document folder (remove existing first to avoid overwrite errors)
    const targetPdfPath = StorageService.getExportPdfPath(documentId);
    const targetInfo = await FileSystem.getInfoAsync(targetPdfPath);
    if (targetInfo.exists) {
      await FileSystem.deleteAsync(targetPdfPath, { idempotent: true });
    }

    await FileSystem.copyAsync({
      from: printResult.uri,
      to: targetPdfPath,
    });

    return targetPdfPath;
  }

  /**
   * Saves PDF directly to user's device Downloads/Documents folder on Android via SAF
   */
  static async saveToDownloads(pdfPath: string, fileName: string): Promise<boolean> {
    if (Platform.OS === 'android' && FileSystem.StorageAccessFramework) {
      try {
        const permissions = await SecurityService.whileLeavingApp(() =>
          FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
        );
        if (permissions.granted) {
          const base64 = await FileSystem.readAsStringAsync(pdfPath, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'application/pdf'
          );
          await FileSystem.writeAsStringAsync(createdUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return true;
        }
      } catch (e) {
        console.warn('StorageAccessFramework save error:', e);
      }
    }
    return false;
  }

  /**
   * Shares PDF or image via system share sheet (FR-50)
   */
  static async shareFile(fileUri: string, mimeType: string = 'application/pdf', title: string = 'Share Document'): Promise<void> {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new Error('Sharing is not available on this device');
    }

    // Verify file exists before opening share sheet
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
      throw new Error('File does not exist at specified path.');
    }

    await SecurityService.whileLeavingApp(() =>
      Sharing.shareAsync(fileUri, {
        mimeType,
        dialogTitle: title,
        UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.jpeg',
      })
    );
  }
}
