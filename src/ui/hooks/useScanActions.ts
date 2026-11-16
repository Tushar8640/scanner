import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { scannerService } from '@/services/scanner/ScannerService';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';

/** Camera scan and gallery import, shared by every screen that can start a new scan. */
export function useScanActions() {
  const setPendingScanImages = useDocumentStore((s) => s.setPendingScanImages);
  const { t } = useSettingsStore();
  const [busy, setBusy] = useState(false);

  const run = async (source: 'camera' | 'gallery') => {
    if (busy) return;
    try {
      setBusy(true);
      const result =
        source === 'camera'
          ? await scannerService.scanWithCamera({ maxNumDocuments: 50 })
          : await scannerService.importFromGallery({ allowsMultiple: true });
      if (result && result.pages.length > 0) {
        setPendingScanImages(result.pages);
        router.push('/scan-review');
      }
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    scanWithCamera: () => run('camera'),
    importImages: () => run('gallery'),
  };
}
