import * as DocumentPicker from 'expo-document-picker';
import { isPdfSupported, renderPages } from '../../../modules/pdf-pages';
import { SecurityService } from '../security/SecurityService';

export interface ImportedPdf {
  /** File name without the .pdf extension, used as the document title. */
  name: string;
  /** One JPEG per page, in order. */
  pages: string[];
}

/** Long edge of each rendered page in pixels; sharp enough to read and re-print. */
const PAGE_MAX_SIDE = 2000;

export const PdfImportService = {
  isSupported: isPdfSupported,

  /**
   * Lets the user pick one or more PDFs and turns every page into an image, so imported
   * PDFs can be edited, merged, split, signed and watermarked like scans. Returns null when cancelled.
   */
  async pickAndRender(options: { multiple?: boolean } = {}): Promise<ImportedPdf[] | null> {
    if (!isPdfSupported) throw new Error('PDF import needs the latest app build');
    const res = await SecurityService.whileLeavingApp(() =>
      DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: options.multiple ?? false, copyToCacheDirectory: true })
    );
    if (res.canceled || !res.assets?.length) return null;
    const out: ImportedPdf[] = [];
    for (const asset of res.assets) {
      const pages = await renderPages(asset.uri, PAGE_MAX_SIDE, 90);
      if (pages.length) out.push({ name: asset.name.replace(/\.pdf$/i, ''), pages });
    }
    return out;
  },
};
