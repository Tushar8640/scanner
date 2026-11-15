import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Page, PdfPageSize, PdfQuality } from '@/core/types';
import { StorageService } from '../storage/StorageService';

export interface GeneratePdfOptions {
  title: string;
  pageSize?: PdfPageSize;
  quality?: PdfQuality;
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
      try {
        const fileInfo = await FileSystem.getInfoAsync(imageUri);
        if (fileInfo.exists) {
          base64 = await FileSystem.readAsStringAsync(imageUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } else if (page.original_path) {
          const fallbackInfo = await FileSystem.getInfoAsync(page.original_path);
          if (fallbackInfo.exists) {
            base64 = await FileSystem.readAsStringAsync(page.original_path, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to read page image for PDF [${i}]:`, err);
      }

      if (!base64) continue;

      const pageIntensity = page.intensity ?? 0.6;
      let filterStyle = '';
      if (page.filter === 'bw') {
        filterStyle = `filter: grayscale(100%) contrast(250%) brightness(115%);`;
      } else if (page.filter === 'grayscale') {
        filterStyle = `filter: grayscale(100%) contrast(115%);`;
      } else if (page.filter === 'magic' || page.filter === 'enhanced') {
        const c = Math.round(116 + pageIntensity * 26);
        const b = Math.round(102 + pageIntensity * 6);
        filterStyle = `filter: contrast(${c}%) brightness(${b}%);`;
      }

      pageDivs.push(`
        <div class="page-container">
          <img class="doc-img" src="data:image/jpeg;base64,${base64}" style="transform: rotate(${page.rotation || 0}deg); ${filterStyle}" alt="Page ${i + 1}" />
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
            }
            .page-container:last-child {
              page-break-after: auto;
            }
            .doc-img {
              max-width: 100%;
              max-height: 100%;
              width: auto;
              height: auto;
              object-fit: contain;
              display: block;
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
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
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

    await Sharing.shareAsync(fileUri, {
      mimeType,
      dialogTitle: title,
      UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.jpeg',
    });
  }
}
