import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal, TextInput, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as Print from 'expo-print';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDocumentStore } from '@/store/useDocumentStore';
import { DatabaseService } from '@/services/database/DatabaseService';
import { PdfService } from '@/services/pdf/PdfService';
import { GalleryService } from '@/services/storage/GalleryService';
import { PremiumService } from '@/services/monetization/PremiumService';
import { useScanEngine } from '@/ui/components/ScanEngine';
import { ActionSheet } from '@/ui/components/ActionSheet';
import { ActionButton } from '@/ui/components/ActionButton';
import { Document, Page } from '@/core/types';

interface DocSelectionBarProps {
  /** Selected documents, in the order they were selected. */
  docs: Document[];
  /** Called after an action finished; the screen should leave selection and reload. */
  onDone: () => void;
}

/**
 * Bottom action bar for selected documents, like the reference app:
 * one selected: Share, Move/Copy, Rename, Delete, More; several: Share, Move/Copy, Merge, Delete, More.
 * Needs a ScanEngineProvider above it (pages are rendered with their filters).
 */
export const DocSelectionBar: React.FC<DocSelectionBarProps> = ({ docs, onDone }) => {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useSettingsStore();
  const engine = useScanEngine();
  const { softDelete, moveToFolder, updateTitle, mergeDocuments, copyDocument, folders } = useDocumentStore();
  const [sheet, setSheet] = useState<'more' | 'moveCopy' | null>(null);
  const [folderMode, setFolderMode] = useState<'move' | 'copy' | null>(null);
  const [renameText, setRenameText] = useState<string | null>(null);
  const [busyText, setBusyText] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      setBusyText(label);
      await fn();
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Something went wrong');
    } finally {
      setBusyText(null);
    }
  };

  const renderPage = (p: Page) => engine.renderFiltered(p.processed_path || p.original_path, p.filter, p.adjust, p.rotation);

  /** One document: its own PDF. Several: one temporary PDF with all their pages, in selection order. */
  const buildPdf = async (): Promise<{ path: string; name: string }> => {
    if (docs.length === 1) {
      const doc = docs[0];
      const pages = await DatabaseService.getPagesByDocumentId(doc.id);
      const path = await PdfService.generatePdf(doc.id, pages, { title: doc.title, renderPage });
      await DatabaseService.updateDocument(doc.id, { pdf_path: path });
      return { path, name: `${doc.title}.pdf` };
    }
    const pages: Page[] = [];
    for (const d of docs) pages.push(...(await DatabaseService.getPagesByDocumentId(d.id)));
    const title = t('docsCount').replace('{n}', String(docs.length));
    const path = await PdfService.generatePdf(docs[0].id, pages, { title, renderPage, temp: true });
    return { path, name: `${title}.pdf` };
  };

  const share = () =>
    run(t('generating'), async () => {
      const { path, name } = await buildPdf();
      setBusyText(null);
      await PdfService.shareFile(path, 'application/pdf', name);
      onDone();
    });

  const print = () =>
    run(t('generating'), async () => {
      const { path } = await buildPdf();
      setBusyText(null);
      await Print.printAsync({ uri: path });
      onDone();
    });

  const saveToGallery = () =>
    run(t('processing'), async () => {
      const files: string[] = [];
      for (const d of docs) {
        for (const p of await DatabaseService.getPagesByDocumentId(d.id)) files.push(await renderPage(p));
      }
      const n = await GalleryService.saveImages(files);
      setBusyText(null);
      Alert.alert(t('success'), t('savedToGallery').replace('{n}', String(n)));
      onDone();
    });

  const remove = () =>
    Alert.alert(t('deleteConfirmTitle'), t('deleteSelectedConfirm').replace('{n}', String(docs.length)), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () =>
          run(t('processing'), async () => {
            for (const d of docs) await softDelete(d.id);
            onDone();
          }),
      },
    ]);

  const merge = () => {
    if (!PremiumService.require('merge')) return;
    run(t('processing'), async () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const doc = await mergeDocuments(
        docs.map((x) => x.id),
        `${t('mergedTitle')} ${pad(d.getDate())}-${pad(d.getMonth() + 1)} ${pad(d.getHours())}.${pad(d.getMinutes())}`
      );
      onDone();
      router.push(`/document/${doc.id}`);
    });
  };

  const putInFolder = (folderId: string | null) => {
    const mode = folderMode;
    setFolderMode(null);
    run(t('processing'), async () => {
      for (const d of docs) {
        if (mode === 'copy') await copyDocument(d.id, folderId, `${d.title} (${t('copySuffix')})`);
        else await moveToFolder(d.id, folderId);
      }
      onDone();
    });
  };

  const saveRename = () => {
    const doc = docs[0];
    const name = renameText?.trim();
    setRenameText(null);
    if (!doc || !name) return;
    run(t('processing'), async () => {
      await updateTitle(doc.id, name);
      onDone();
    });
  };

  const none = docs.length === 0;

  return (
    <>
      <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
        <BarAction icon="share-social-outline" label={t('share')} color={colors.text} disabled={none} onPress={share} />
        <BarAction icon="copy-outline" label={t('moveCopy')} color={colors.text} disabled={none} onPress={() => setSheet('moveCopy')} />
        {docs.length >= 2 ? (
          <BarAction icon="git-merge-outline" label={t('merge')} color={colors.text} onPress={merge} />
        ) : (
          <BarAction
            icon="create-outline"
            label={t('rename')}
            color={colors.text}
            disabled={docs.length !== 1}
            onPress={() => docs[0] && setRenameText(docs[0].title)}
          />
        )}
        <BarAction icon="trash-outline" label={t('delete')} color={colors.text} disabled={none} onPress={remove} />
        <BarAction icon="ellipsis-vertical" label={t('more')} color={colors.text} disabled={none} onPress={() => setSheet('more')} />
      </View>

      <ActionSheet
        visible={sheet === 'moveCopy'}
        title={t('moveCopy')}
        onClose={() => setSheet(null)}
        items={[
          // Opened after the sheet closes, so the two never overlap
          { key: 'move', label: t('moveAction'), icon: 'enter-outline', onPress: () => setTimeout(() => setFolderMode('move'), 250) },
          { key: 'copy', label: t('copyAction'), icon: 'copy-outline', onPress: () => setTimeout(() => setFolderMode('copy'), 250) },
        ]}
      />
      <ActionSheet
        visible={sheet === 'more'}
        title={t('more')}
        onClose={() => setSheet(null)}
        items={[
          { key: 'gallery', label: t('saveToGallery'), icon: 'download-outline', onPress: saveToGallery },
          { key: 'print', label: t('print'), icon: 'print-outline', onPress: print },
        ]}
      />

      {/* Folder picker for Move / Copy */}
      <Modal visible={folderMode !== null} transparent animationType="fade" onRequestClose={() => setFolderMode(null)}>
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, { color: colors.text }]}>{folderMode === 'copy' ? t('copyToFolder') : t('moveToFolder')}</Text>
            <ScrollView style={styles.folderList}>
              {[{ id: null as string | null, name: t('noFolderRoot') }, ...folders].map((f) => (
                <TouchableOpacity key={f.id ?? 'root'} style={styles.folderRow} onPress={() => putInFolder(f.id)}>
                  <Ionicons name={f.id ? 'folder' : 'folder-outline'} size={22} color={colors.primary} />
                  <Text style={[styles.folderName, { color: colors.text }]}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ActionButton title={t('cancel')} variant="outline" onPress={() => setFolderMode(null)} />
          </View>
        </View>
      </Modal>

      {/* Rename */}
      <Modal visible={renameText !== null} transparent animationType="fade" onRequestClose={() => setRenameText(null)}>
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, { color: colors.text }]}>{t('rename')}</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceVariant }]}
              value={renameText ?? ''}
              onChangeText={setRenameText}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.actions}>
              <ActionButton title={t('cancel')} variant="outline" onPress={() => setRenameText(null)} style={styles.flex1} />
              <ActionButton title={t('save')} style={styles.flex1} disabled={!renameText?.trim()} onPress={saveRename} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={busyText !== null} transparent animationType="fade">
        <View style={styles.busy}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.busyText}>{busyText}</Text>
        </View>
      </Modal>
    </>
  );
};

const BarAction: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}> = ({ icon, label, color, disabled, onPress }) => (
  <TouchableOpacity style={[styles.action, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
    <Ionicons name={icon} size={26} color={color} />
    <Text style={[styles.actionText, { color }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  action: { flex: 1, alignItems: 'center', gap: 4 },
  actionText: { fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.35 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 16, padding: 20, gap: 14, maxHeight: 460 },
  title: { fontSize: 18, fontWeight: '700' },
  folderList: { maxHeight: 280 },
  folderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  folderName: { fontSize: 16 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 48, fontSize: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  busy: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  busyText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
