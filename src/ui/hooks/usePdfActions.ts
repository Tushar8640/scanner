import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { PdfImportService, ImportedPdf } from '@/services/pdf/PdfImportService';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';

export type PdfDocAction = 'open' | 'merge' | 'split' | 'sign' | 'watermark';

/** Importing PDFs: into the editor, or straight into a document for merge, split, sign and watermark. */
export function usePdfActions() {
  const { t } = useSettingsStore();
  const [busy, setBusy] = useState(false);

  const pick = async (multiple: boolean): Promise<ImportedPdf[] | null> => {
    if (!PdfImportService.isSupported) {
      Alert.alert(t('importPdf'), t('pdfNeedsBuild'));
      return null;
    }
    setBusy(true);
    try {
      return await PdfImportService.pickAndRender({ multiple });
    } finally {
      setBusy(false);
    }
  };

  const fail = (e: any) => {
    setBusy(false);
    Alert.alert(t('error'), e?.message || 'Could not open the PDF');
  };

  /** Import PDF: every page opens in the editor (filters, crop, sign...), then Save makes a document. */
  const importToEditor = async (options: { replace?: boolean } = {}) => {
    try {
      const files = await pick(true);
      if (!files?.length) return;
      useDocumentStore.getState().setPendingScanImages(files.flatMap((f) => f.pages.map((uri) => ({ uri, cropped: true }))));
      const target = { pathname: '/scan-review' as const, params: { title: files.map((f) => f.name).join(' + '), pdf: '1' } };
      if (options.replace) router.replace(target);
      else router.push(target);
    } catch (e) {
      fail(e);
    }
  };

  /** Turns picked PDFs into one document and opens it, ready for the given action. */
  const importAsDocument = async (action: PdfDocAction) => {
    try {
      const files = await pick(action === 'merge');
      if (!files?.length) return;
      if (action === 'merge' && files.length < 2) {
        Alert.alert(t('mergePdf'), t('pickTwoPdfs'));
        return;
      }
      setBusy(true);
      const { createDocument, activeFolderId } = useDocumentStore.getState();
      const title = action === 'merge' ? `${t('mergedTitle')} (${files.length})` : files[0].name;
      const doc = await createDocument(
        title,
        files.flatMap((f) => f.pages.map((uri) => ({ originalUri: uri, previewUri: uri, filter: 'original' as const, rotation: 0 as const }))),
        activeFolderId,
        'original'
      );
      setBusy(false);
      router.push({
        pathname: '/document/[id]',
        params: action === 'open' || action === 'merge' ? { id: doc.id } : { id: doc.id, action },
      });
    } catch (e) {
      fail(e);
    }
  };

  return { busy, importToEditor, importAsDocument };
}
