import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, LayoutChangeEvent, Alert, type ScrollViewInstance } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useScanActions } from '@/ui/hooks/useScanActions';
import { scannerService } from '@/services/scanner/ScannerService';
import { ActionSheet } from '@/ui/components/ActionSheet';
import type { TranslationKey } from '@/i18n';

interface Tool {
  key: string;
  label: TranslationKey;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  onPress: () => void;
}

interface Section {
  key: string;
  title: TranslationKey;
  tools: Tool[];
}

/** Opens the Files tab and asks it to focus search or open Create Folder. */
function openFiles(action: 'search' | 'newFolder' | 'select') {
  router.navigate({ pathname: '/files', params: { [action]: String(Date.now()) } });
}

export default function ToolsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const { createDocument, activeFolderId } = useDocumentStore();
  const { busy, scanWithCamera, scanBatch, importImages } = useScanActions();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [activeSection, setActiveSection] = useState('scan');
  const [annotateActionTarget, setAnnotateActionTarget] = useState<'sign' | 'watermark' | null>(null);

  const handleAnnotateChoice = async (source: 'docs' | 'camera' | 'gallery') => {
    const mode = annotateActionTarget;
    setAnnotateActionTarget(null);
    if (!mode) return;

    if (source === 'docs') {
      router.navigate({ pathname: '/files', params: { toolAction: mode } });
      return;
    }

    try {
      const res =
        source === 'camera'
          ? await scannerService.scanWithCamera({ maxNumDocuments: 1 })
          : await scannerService.importFromGallery({ allowsMultiple: false });
      if (res && res.pages.length > 0) {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const title = `${t(mode)} ${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
        const doc = await createDocument(
          title,
          res.pages.map((p) => ({ originalUri: p.uri, previewUri: p.uri, filter: 'original', rotation: 0 })),
          activeFolderId,
          'original'
        );
        router.push({ pathname: '/document/[id]', params: { id: doc.id, action: mode } });
      }
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Operation failed');
    }
  };

  const sections: Section[] = [
    {
      key: 'scan',
      title: 'toolsScan',
      tools: [
        { key: 'smart', label: 'smartScan', icon: 'scan', tint: colors.primary, onPress: scanWithCamera },
        { key: 'batch', label: 'batchScan', icon: 'copy', tint: colors.primary, onPress: scanBatch },
        { key: 'id', label: 'idCard', icon: 'card', tint: colors.primary, onPress: () => router.push('/id-card') },
        { key: 'qr', label: 'scanQr', icon: 'qr-code', tint: '#8B5CF6', onPress: () => router.push('/qr-scan') },
      ],
    },
    {
      key: 'import',
      title: 'toolsImport',
      tools: [{ key: 'images', label: 'importImages', icon: 'image', tint: '#3B82F6', onPress: importImages }],
    },
    {
      key: 'convert',
      title: 'toolsConvert',
      tools: [
        { key: 'ocr', label: 'extractText', icon: 'text', tint: colors.primary, onPress: () => router.push('/extract-text') },
        { key: 'pdf', label: 'toPdf', icon: 'document', tint: '#EF4444', onPress: () => router.push('/to-pdf') },
      ],
    },
    {
      key: 'edit',
      title: 'toolsEdit',
      tools: [
        { key: 'merge', label: 'mergeDocs', icon: 'git-merge', tint: '#F59E0B', onPress: () => openFiles('select') },
        { key: 'sign', label: 'sign', icon: 'create', tint: colors.primary, onPress: () => setAnnotateActionTarget('sign') },
        { key: 'wm', label: 'watermark', icon: 'water', tint: '#3B82F6', onPress: () => setAnnotateActionTarget('watermark') },
      ],
    },
    {
      key: 'manage',
      title: 'toolsManage',
      tools: [
        {
          key: 'folder',
          label: 'createFolder',
          icon: 'folder-open',
          tint: '#3B82F6',
          onPress: () => openFiles('newFolder'),
        },
        { key: 'trash', label: 'trash', icon: 'trash', tint: '#EF4444', onPress: () => router.push('/trash') },
        { key: 'lock', label: 'appLockShort', icon: 'lock-closed', tint: '#10B981', onPress: () => router.push('/settings/security') },
      ],
    },
  ];

  const onSectionLayout = (key: string) => (e: LayoutChangeEvent) => {
    const y = e.nativeEvent.layout.y;
    setOffsets((prev) => (prev[key] === y ? prev : { ...prev, [key]: y }));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>{t('tools')}</Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => openFiles('search')}
          accessibilityLabel={t('search')}
        >
          <Ionicons name="search" size={26} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Category chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips}>
        {sections.map((s) => {
          const active = activeSection === s.key;
          return (
            <TouchableOpacity
              key={s.key}
              style={styles.chip}
              onPress={() => {
                setActiveSection(s.key);
                scrollRef.current?.scrollTo({ y: Math.max(0, (offsets[s.key] ?? 0) - 8), animated: true });
              }}
            >
              <Text style={[styles.chipText, { color: active ? colors.primary : colors.textMuted }]}>{t(s.title)}</Text>
              <View style={[styles.chipBar, { backgroundColor: active ? colors.primary : 'transparent' }]} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
        {sections.map((s) => (
          <View key={s.key} onLayout={onSectionLayout(s.key)} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t(s.title)}</Text>
            <View style={styles.grid}>
              {s.tools.map((tool) => (
                <TouchableOpacity key={tool.key} style={styles.tool} onPress={tool.onPress} disabled={busy}>
                  <View style={[styles.toolIcon, { backgroundColor: `${tool.tint}1F` }]}>
                    <Ionicons name={tool.icon} size={28} color={tool.tint} />
                  </View>
                  <Text style={[styles.toolLabel, { color: colors.text }]} numberOfLines={2}>
                    {t(tool.label)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <ActionSheet
        visible={annotateActionTarget !== null}
        title={annotateActionTarget === 'sign' ? t('sign') : t('watermark')}
        items={[
          {
            key: 'docs',
            label: 'Choose Existing Document',
            icon: 'folder-open-outline',
            onPress: () => handleAnnotateChoice('docs'),
          },
          {
            key: 'camera',
            label: 'Scan New Page',
            icon: 'camera-outline',
            onPress: () => handleAnnotateChoice('camera'),
          },
          {
            key: 'gallery',
            label: 'Import from Gallery',
            icon: 'images-outline',
            onPress: () => handleAnnotateChoice('gallery'),
          },
        ]}
        onClose={() => setAnnotateActionTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 10,
    paddingVertical: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsScroll: {
    flexGrow: 0,
  },
  chips: {
    paddingHorizontal: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingTop: 12,
    alignItems: 'center',
  },
  chipText: {
    fontSize: 17,
    fontWeight: '600',
  },
  chipBar: {
    marginTop: 8,
    width: 24,
    height: 3,
    borderRadius: 2,
  },
  body: {
    paddingBottom: 40,
  },
  section: {
    paddingTop: 18,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
  },
  tool: {
    width: '25%',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  toolIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolLabel: {
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
});
