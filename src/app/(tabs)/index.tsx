import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { DatabaseService } from '@/services/database/DatabaseService';
import { Document } from '@/core/types';
import { useScanActions } from '@/ui/hooks/useScanActions';
import { ScanFab } from '@/ui/components/ScanFab';
import type { TranslationKey } from '@/i18n';

const RECENT_LIMIT = 10;

interface QuickTool {
  key: string;
  label: TranslationKey;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  onPress: () => void;
}

function formatDocDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Opens the Files tab and asks it to focus search or open Create Folder. */
function openFiles(action: 'search' | 'newFolder' | 'select') {
  router.navigate({ pathname: '/files', params: { [action]: String(Date.now()) } });
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const { busy, scanWithCamera, importImages } = useScanActions();
  const [recents, setRecents] = useState<Document[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadRecents = useCallback(async () => {
    try {
      const docs = await DatabaseService.getDocuments();
      docs.sort((a, b) => (b.updated_at || b.created_at) - (a.updated_at || a.created_at));
      setRecents(docs.slice(0, RECENT_LIMIT));
    } catch (e) {
      console.warn('Failed to load recent documents:', e);
    }
  }, []);

  // Refresh whenever the tab comes back into view (after saving, deleting, renaming…)
  useFocusEffect(
    useCallback(() => {
      loadRecents();
    }, [loadRecents])
  );

  const tools: QuickTool[] = [
    { key: 'scan', label: 'smartScan', icon: 'scan', tint: colors.primary, onPress: scanWithCamera },
    { key: 'import', label: 'importImages', icon: 'image', tint: '#3B82F6', onPress: importImages },
    { key: 'id', label: 'idCard', icon: 'card', tint: colors.primary, onPress: () => router.push('/id-card') },
    { key: 'ocr', label: 'extractText', icon: 'text', tint: colors.primary, onPress: () => router.push('/extract-text') },
    { key: 'qr', label: 'scanQr', icon: 'qr-code', tint: '#8B5CF6', onPress: () => router.push('/qr-scan') },
    { key: 'merge', label: 'mergeDocs', icon: 'git-merge', tint: '#F59E0B', onPress: () => openFiles('select') },
    {
      key: 'folder',
      label: 'createFolder',
      icon: 'folder-open',
      tint: '#3B82F6',
      onPress: () => openFiles('newFolder'),
    },
    { key: 'all', label: 'allTools', icon: 'apps', tint: '#10B981', onPress: () => router.navigate('/tools') },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadRecents();
              setRefreshing(false);
            }}
            tintColor={colors.primary}
          />
        }
      >
        {/* Search */}
        <TouchableOpacity
          activeOpacity={0.8}
          style={[styles.search, { backgroundColor: colors.surfaceVariant }]}
          onPress={() => openFiles('search')}
        >
          <Ionicons name="search" size={22} color={colors.textSecondary} />
          <Text style={[styles.searchText, { color: colors.textMuted }]}>{t('search')}</Text>
        </TouchableOpacity>

        {/* Tool grid */}
        <View style={styles.grid}>
          {tools.map((tool) => (
            <TouchableOpacity key={tool.key} style={styles.tool} onPress={tool.onPress} disabled={busy}>
              <View style={[styles.toolIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name={tool.icon} size={28} color={tool.tint} />
              </View>
              <Text style={[styles.toolLabel, { color: colors.text }]} numberOfLines={1}>
                {t(tool.label)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Recents */}
        <View style={[styles.recents, { backgroundColor: colors.surface }]}>
          <View style={styles.recentsHeader}>
            <Text style={[styles.recentsTitle, { color: colors.text }]}>{t('recents')}</Text>
            <TouchableOpacity style={styles.viewAll} onPress={() => router.navigate('/files')}>
              <Text style={[styles.viewAllText, { color: colors.textMuted }]}>{t('viewAll')}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {recents.length === 0 ? (
            <View style={styles.empty}>
              <View style={[styles.emptyDoc, { borderColor: colors.borderStrong, backgroundColor: colors.surfaceVariant }]}>
                {[0.7, 0.85, 0.85, 0.85, 0.55].map((w, i) => (
                  <View key={i} style={[styles.emptyLine, { width: `${w * 100}%`, backgroundColor: colors.borderStrong }]} />
                ))}
              </View>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('noRecentFile')}</Text>
              <TouchableOpacity style={[styles.emptyBtn, { borderColor: colors.primary }]} onPress={scanWithCamera}>
                <Text style={[styles.emptyBtnText, { color: colors.primary }]}>{t('scanNewDocs')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            recents.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => router.push(`/document/${doc.id}`)}
              >
                <View style={[styles.thumb, { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}>
                  {doc.thumbnail_path ? (
                    <Image source={{ uri: doc.thumbnail_path }} style={styles.thumbImg} />
                  ) : (
                    <Ionicons name="document-text-outline" size={24} color={colors.textMuted} />
                  )}
                </View>
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                    {doc.title}
                  </Text>
                  <View style={styles.rowMeta}>
                    <Text style={[styles.rowDate, { color: colors.textSecondary }]}>
                      {formatDocDate(doc.updated_at || doc.created_at)}
                    </Text>
                    <View style={[styles.pagePill, { backgroundColor: colors.surfaceVariant }]}>
                      <Ionicons name="documents-outline" size={11} color={colors.textSecondary} />
                      <Text style={[styles.pagePillText, { color: colors.textSecondary }]}>{doc.page_count}</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      <ScanFab />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingBottom: 110,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 16,
    height: 46,
    borderRadius: 10,
  },
  searchText: {
    fontSize: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingTop: 18,
    paddingBottom: 6,
  },
  tool: {
    width: '25%',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  toolIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolLabel: {
    fontSize: 13,
    paddingHorizontal: 2,
  },
  recents: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 18,
    minHeight: 420,
  },
  recentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  recentsTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    fontSize: 14,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 14,
  },
  emptyDoc: {
    width: 96,
    height: 116,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 4,
    padding: 14,
    gap: 10,
    justifyContent: 'center',
  },
  emptyLine: {
    height: 3,
    borderRadius: 2,
  },
  emptyText: {
    fontSize: 16,
  },
  emptyBtn: {
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  emptyBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 14,
  },
  thumb: {
    width: 52,
    height: 68,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  rowInfo: {
    flex: 1,
    gap: 6,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowDate: {
    fontSize: 12,
  },
  pagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  pagePillText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
