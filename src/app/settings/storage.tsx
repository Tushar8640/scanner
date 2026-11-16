import { useCallback, useState } from 'react';
import { ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { DatabaseService } from '@/services/database/DatabaseService';
import { SettingsGroup, SettingsRow, settingsScreenStyles } from '@/ui/components/settings/SettingsUI';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Total size of a folder, including sub-folders. */
async function folderSize(dir: string): Promise<number> {
  let total = 0;
  let names: string[] = [];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const path = `${dir}${name}`;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) continue;
      if (info.isDirectory) total += await folderSize(`${path}/`);
      else if (typeof info.size === 'number') total += info.size;
    } catch {
      // skip files that disappear while counting
    }
  }
  return total;
}

/** Storage: space used by documents and temporary files, clear temporary files, trash. */
export default function StorageSettingsScreen() {
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const [docsSize, setDocsSize] = useState<string | null>(null);
  const [cacheSize, setCacheSize] = useState<string | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [trashCount, setTrashCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    const base = FileSystem.documentDirectory;
    const cache = FileSystem.cacheDirectory;
    setDocsSize(formatBytes(base ? await folderSize(`${base}documents/`) : 0));
    setCacheSize(formatBytes(cache ? await folderSize(cache) : 0));
    try {
      setDocCount((await DatabaseService.getDocuments()).length);
      setTrashCount((await DatabaseService.getDocuments(undefined, true)).length);
    } catch {
      setDocCount(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const clearCache = () =>
    Alert.alert(t('clearCache'), t('clearCacheDesc'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('clearCache'),
        style: 'destructive',
        onPress: async () => {
          setClearing(true);
          try {
            // Only temporary files live here; saved documents are in the document directory
            const cache = FileSystem.cacheDirectory;
            if (cache) {
              for (const name of await FileSystem.readDirectoryAsync(cache)) {
                await FileSystem.deleteAsync(`${cache}${name}`, { idempotent: true }).catch(() => undefined);
              }
            }
            await refresh();
            Alert.alert(t('success'), t('cacheCleared'));
          } finally {
            setClearing(false);
          }
        },
      },
    ]);

  return (
    <ScrollView style={[settingsScreenStyles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={settingsScreenStyles.content}>
      <Stack.Screen options={{ title: t('storageAndData') }} />

      <SettingsGroup title={t('storageUsage')}>
        <SettingsRow
          icon="documents-outline"
          label={t('savedDocuments')}
          subtitle={docCount !== null ? t(docCount === 1 ? 'documentsCountOne' : 'documentsCount').replace('{n}', String(docCount)) : undefined}
          value={docsSize ?? '…'}
        />
        <SettingsRow icon="time-outline" label={t('tempFiles')} subtitle={t('clearCacheDesc')} value={cacheSize ?? '…'} />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          icon="trash-bin-outline"
          label={t('clearCache')}
          onPress={clearing ? undefined : clearCache}
          right={clearing ? <ActivityIndicator color={colors.primary} /> : undefined}
        />
        <SettingsRow
          icon="trash-outline"
          label={t('trash')}
          value={trashCount !== null ? String(trashCount) : undefined}
          onPress={() => router.push('/trash')}
        />
      </SettingsGroup>
    </ScrollView>
  );
}
