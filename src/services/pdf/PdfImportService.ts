import * as DocumentPicker from 'expo-document-picker';
import { isPdfSupported, renderPages } from '../../../modules/pdf-pages';
import { SecurityService } from '../security/SecurityService';
import { askText } from '@/ui/components/PromptHost';
import { useSettingsStore } from '@/store/useSettingsStore';

export interface ImportedPdf {
  /** File name without the .pdf extension, used as the document title. */
  name: string;
  /** One JPEG per page, in order. */
  pages: string[];
}

/** Long edge of each rendered page in pixels; sharp enough to read and re-print. */
const PAGE_MAX_SIDE = 2000;

/** Renders a PDF, asking for its password when it is protected (and again if the password is wrong). */
async function renderWithPassword(uri: string, name: string): Promise<string[] | null> {
  const { t } = useSettingsStore.getState();
  let password = '';
  let message = t('pdfPasswordMsg').replace('{name}', name);
  for (;;) {
    try {
      return await renderPages(uri, PAGE_MAX_SIDE, 90, password);
    } catch (e: any) {
      const code = String(e?.code ?? '');
      if (code !== 'PDF_PASSWORD' && code !== 'PDF_WRONG_PASSWORD') throw e;
      if (code === 'PDF_WRONG_PASSWORD') message = t('pdfWrongPassword');
      const entered = await askText({ title: t('pdfPasswordTitle'), message, secure: true, placeholder: t('password') });
      if (entered == null) return null; // cancelled: skip this file
      password = entered;
    }
  }
}

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
      const name = asset.name.replace(/\.pdf$/i, '');
      const pages = await renderWithPassword(asset.uri, name);
      if (pages?.length) out.push({ name, pages });
    }
    return out.length ? out : null;
  },
};
