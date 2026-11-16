import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { Document, Page, PdfPageSize, PdfQuality } from '@/core/types';
import { DatabaseService } from '@/services/database/DatabaseService';
import { PdfService } from '@/services/pdf/PdfService';
import { StorageService } from '@/services/storage/StorageService';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ActionButton } from '@/ui/components/ActionButton';
import { DocumentPageView } from '@/ui/components/DocumentPageView';
import { ActionSheet, ActionSheetItem } from '@/ui/components/ActionSheet';
import { DraggableGrid, moveItem } from '@/ui/components/DraggableGrid';
import { ImageService } from '@/services/image/ImageService';
import { useThemeColors } from '@/core/theme/colors';

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { updateTitle, softDelete, moveToFolder, folders, loadAll } = useDocumentStore();
  const { default_page_size, default_quality, t } = useSettingsStore();

  const [document, setDocument] = useState<Document | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // PDF Settings modal
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [pageSize, setPageSize] = useState<PdfPageSize>(default_page_size);
  const [quality, setQuality] = useState<PdfQuality>(default_quality);

  // Rename modal
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [titleInput, setTitleInput] = useState('');

  // Move to folder modal
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [moreSheetVisible, setMoreSheetVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [gridDragging, setGridDragging] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const cellWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP) / 2;

  useEffect(() => {
    let isMounted = true;
    async function fetchDoc() {
      if (!id) return;
      try {
        const doc = await DatabaseService.getDocumentById(id);
        const pageList = await DatabaseService.getPagesByDocumentId(id);
        if (isMounted) {
          setDocument(doc);
          setPages(pageList);
          if (doc) {
            setTitleInput(doc.title);
          }
          setLoading(false);
        }
      } catch (e) {
        console.error('Failed to load document:', e);
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchDoc();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const handleShare = async () => {
    if (!document) return;
    try {
      setIsExporting(true);
      let pdfPath = document.pdf_path;
      let fileExists = false;
      if (pdfPath) {
        const info = await FileSystem.getInfoAsync(pdfPath);
        fileExists = info.exists;
      }

      if (!pdfPath || !fileExists) {
        pdfPath = await PdfService.generatePdf(document.id, pages, {
          title: document.title,
          pageSize,
          quality,
        });
        await DatabaseService.updateDocument(document.id, { pdf_path: pdfPath });
        setDocument((prev) => (prev ? { ...prev, pdf_path: pdfPath } : null));
      }
      setIsExporting(false);
      const fileName = `${document.title.replace(/[^a-zA-Z0-9_\-\u0980-\u09FF]/g, '_')}.pdf`;
      await PdfService.shareFile(pdfPath, 'application/pdf', fileName);
    } catch (e: any) {
      setIsExporting(false);
      Alert.alert('Share Error', e.message || 'Failed to share file');
    }
  };

  const handleGeneratePdfWithOptions = async () => {
    if (!document) return;
    if (pages.length === 0) {
      Alert.alert('Error', 'No pages found in this document');
      return;
    }

    try {
      setIsExporting(true);
      const newPdfPath = await PdfService.generatePdf(document.id, pages, {
        title: document.title,
        pageSize,
        quality,
      });
      await DatabaseService.updateDocument(document.id, { pdf_path: newPdfPath });
      setDocument((prev) => (prev ? { ...prev, pdf_path: newPdfPath } : null));
      setIsExporting(false);
      setPdfModalVisible(false);

      const fileName = `${document.title.replace(/[^a-zA-Z0-9_\-\u0980-\u09FF]/g, '_')}.pdf`;

      Alert.alert(
        t('pdfExported'),
        t('choosePdfAction'),
        [
          {
            text: t('saveToDownloads'),
            onPress: async () => {
              const saved = await PdfService.saveToDownloads(newPdfPath, fileName);
              if (saved) {
                Alert.alert(t('success'), t('pdfSavedToDownloads'));
              } else {
                await PdfService.shareFile(newPdfPath, 'application/pdf', fileName);
              }
            },
          },
          {
            text: t('share'),
            onPress: async () => {
              await PdfService.shareFile(newPdfPath, 'application/pdf', fileName);
            },
          },
          {
            text: t('cancel'),
            style: 'cancel',
          },
        ]
      );
    } catch (e: any) {
      setIsExporting(false);
      Alert.alert('Export Error', e.message || 'Failed to export PDF');
    }
  };

  // Drag-to-reorder pages; saves the new order, marks the old PDF as stale and
  // refreshes the cover thumbnail when the first page changes.
  const handleReorderPages = async (from: number, to: number) => {
    if (!document) return;
    const previous = pages;
    const reordered = moveItem(pages, from, to).map((p, i) => ({ ...p, position: i }));
    setPages(reordered);
    try {
      for (const p of reordered) {
        const old = previous.find((o) => o.id === p.id);
        if (old && old.position !== p.position) {
          await DatabaseService.updatePage(p.id, { position: p.position });
        }
      }
      const updates: Partial<Document> = { pdf_path: null, updated_at: Date.now() };
      if (reordered[0].id !== previous[0]?.id) {
        const thumb = await ImageService.generateThumbnail(reordered[0].processed_path || reordered[0].original_path);
        // New file name so cached images of the old cover are not reused
        const thumbPath = `${StorageService.getDocumentDir(document.id)}thumb_${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: thumb, to: thumbPath });
        if (document.thumbnail_path && document.thumbnail_path !== thumbPath) {
          await FileSystem.deleteAsync(document.thumbnail_path, { idempotent: true });
        }
        updates.thumbnail_path = thumbPath;
      }
      await DatabaseService.updateDocument(document.id, updates);
      setDocument((prev) => (prev ? { ...prev, ...updates } : null));
      loadAll().catch(() => undefined);
    } catch (e: any) {
      console.warn('Reorder failed:', e);
      setPages(previous);
      Alert.alert(t('error'), e.message || 'Failed to reorder pages');
    }
  };

  const handleSaveRename = async () => {
    if (!document) return;
    if (titleInput.trim().length === 0) {
      Alert.alert('Warning', 'Title cannot be empty');
      return;
    }
    await updateTitle(document.id, titleInput.trim());
    setDocument((prev) => (prev ? { ...prev, title: titleInput.trim() } : null));
    setRenameModalVisible(false);
  };

  const handleSelectFolder = async (folderId: string | null) => {
    if (!document) return;
    await moveToFolder(document.id, folderId);
    setDocument((prev) => (prev ? { ...prev, folder_id: folderId } : null));
    setMoveModalVisible(false);
  };

  const handleDelete = () => {
    if (!document) return;
    Alert.alert(t('deleteConfirmTitle'), t('deleteConfirmMsg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await softDelete(document.id);
          router.replace('/');
        },
      },
    ]);
  };

  if (loading || !document) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const moreItems: ActionSheetItem[] = [
    { key: 'rename', label: t('rename'), icon: 'create-outline', onPress: () => setRenameModalVisible(true) },
    { key: 'move', label: t('moveToFolder'), icon: 'folder-outline', onPress: () => setMoveModalVisible(true) },
    { key: 'pdf', label: t('exportPdf'), icon: 'document-text-outline', onPress: () => setPdfModalVisible(true) },
    { key: 'delete', label: t('delete'), icon: 'trash-outline', destructive: true, onPress: handleDelete },
  ];

  const viewerPage = viewerIndex !== null ? pages[viewerIndex] : null;
  const createdAt = new Date(document.created_at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateLabel = `${pad(createdAt.getDate())}/${pad(createdAt.getMonth() + 1)}/${createdAt.getFullYear()}`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} accessibilityLabel={t('home')}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.titleArea} onPress={() => setRenameModalVisible(true)}>
          <View style={styles.titleRow}>
            <Text style={[styles.docTitle, { color: colors.text }]} numberOfLines={1}>
              {document.title}
            </Text>
            <Ionicons name="pencil" size={14} color={colors.textSecondary} />
          </View>
          <Text style={[styles.docSub, { color: colors.textSecondary }]}>
            {pages.length} {t('pagesLabel')} · {dateLabel}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setMoreSheetVisible(true)} accessibilityLabel="More">
          <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Page grid */}
      <ScrollView contentContainerStyle={styles.gridContent} scrollEnabled={!gridDragging}>
        <Text style={[styles.dragHint, { color: colors.textSecondary }]}>{t('dragToReorder')}</Text>
        <DraggableGrid
          data={pages}
          keyExtractor={(p) => p.id}
          columns={2}
          cellWidth={cellWidth}
          cellHeight={cellWidth * (4 / 3)}
          gap={GRID_GAP}
          onReorder={handleReorderPages}
          onPressItem={setViewerIndex}
          onDragActiveChange={setGridDragging}
          renderItem={(item, index) => (
          <View style={[styles.pageCell, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.pageCellInner} pointerEvents="none">
              <DocumentPageView
                uri={item.processed_path || item.original_path}
                filter={item.filter}
                intensity={item.intensity ?? 0.6}
                rotation={item.rotation}
                backgroundColor={colors.surface}
              />
            </View>
            <View style={[styles.pageNum, { backgroundColor: colors.primary }]}>
              <Text style={styles.pageNumText}>{index + 1}</Text>
            </View>
          </View>
          )}
        />
      </ScrollView>

      {/* Bottom toolbar */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        <BarButton icon="share-social-outline" label={t('share')} color={colors.text} onPress={handleShare} />
        <BarButton icon="document-text-outline" label="PDF" color={colors.text} onPress={() => setPdfModalVisible(true)} />
        <BarButton icon="create-outline" label={t('rename')} color={colors.text} onPress={() => setRenameModalVisible(true)} />
        <BarButton icon="folder-outline" label={t('moveShort')} color={colors.text} onPress={() => setMoveModalVisible(true)} />
        <BarButton icon="trash-outline" label={t('delete')} color={colors.danger} onPress={handleDelete} />
      </View>

      {isExporting && (
        <View style={styles.exportOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.exportText}>{t('generating')}</Text>
        </View>
      )}

      <ActionSheet
        visible={moreSheetVisible}
        title={document.title}
        items={moreItems}
        onClose={() => setMoreSheetVisible(false)}
      />

      {/* Full-screen page viewer */}
      <Modal
        visible={viewerPage !== null}
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
        statusBarTranslucent
      >
        <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.viewerHeader}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setViewerIndex(null)}>
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.viewerTitle}>
              {(viewerIndex ?? 0) + 1} / {pages.length}
            </Text>
            <View style={styles.headerBtn} />
          </View>
          <View style={styles.viewerBody}>
            {viewerPage && (
              <DocumentPageView
                key={viewerPage.id}
                uri={viewerPage.processed_path || viewerPage.original_path}
                filter={viewerPage.filter}
                intensity={viewerPage.intensity ?? 0.6}
                rotation={viewerPage.rotation}
                backgroundColor="#000000"
              />
            )}
          </View>
          <View style={styles.viewerNav}>
            <TouchableOpacity
              style={styles.viewerNavBtn}
              disabled={(viewerIndex ?? 0) <= 0}
              onPress={() => setViewerIndex((i) => Math.max(0, (i ?? 0) - 1))}
            >
              <Ionicons name="chevron-back" size={28} color={(viewerIndex ?? 0) <= 0 ? '#555555' : '#FFFFFF'} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.viewerNavBtn}
              disabled={(viewerIndex ?? 0) >= pages.length - 1}
              onPress={() => setViewerIndex((i) => Math.min(pages.length - 1, (i ?? 0) + 1))}
            >
              <Ionicons
                name="chevron-forward"
                size={28}
                color={(viewerIndex ?? 0) >= pages.length - 1 ? '#555555' : '#FFFFFF'}
              />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PDF export settings (FR-20, FR-21, FR-22) */}
      <Modal visible={pdfModalVisible} transparent animationType="slide" onRequestClose={() => setPdfModalVisible(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('exportPdf')}</Text>
              <TouchableOpacity onPress={() => setPdfModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('pageSize')}</Text>
            <View style={styles.pillRow}>
              {(['A4', 'Letter', 'Fit'] as PdfPageSize[]).map((sz) => (
                <TouchableOpacity
                  key={sz}
                  style={[styles.pill, { backgroundColor: pageSize === sz ? colors.primary : colors.surfaceVariant }]}
                  onPress={() => setPageSize(sz)}
                >
                  <Text style={[styles.pillText, { color: pageSize === sz ? colors.primaryContrast : colors.text }]}>
                    {sz}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('quality')}</Text>
            <View style={styles.pillRow}>
              {(['low', 'medium', 'high'] as PdfQuality[]).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.pill, { backgroundColor: quality === q ? colors.primary : colors.surfaceVariant }]}
                  onPress={() => setQuality(q)}
                >
                  <Text style={[styles.pillText, { color: quality === q ? colors.primaryContrast : colors.text }]}>
                    {q === 'low' ? t('qualityLow') : q === 'medium' ? t('qualityMedium') : t('qualityHigh')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={[styles.watermarkBadge, { backgroundColor: colors.successLight }]}>
              <Ionicons name="shield-checkmark" size={16} color={colors.success} />
              <Text style={[styles.watermarkText, { color: colors.success }]}>{t('noWatermark')}</Text>
            </View>

            <ActionButton
              title={isExporting ? t('generating') : t('exportPdf')}
              loading={isExporting}
              onPress={handleGeneratePdfWithOptions}
              style={{ marginTop: 16 }}
            />
          </View>
        </View>
      </Modal>

      {/* Move to folder */}
      <Modal visible={moveModalVisible} transparent animationType="fade" onRequestClose={() => setMoveModalVisible(false)}>
        <View style={[styles.modalCenterOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.centerCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('moveToFolder')}</Text>
            <ScrollView style={styles.folderList}>
              {[{ id: null as string | null, name: t('noFolderRoot') }, ...folders].map((f) => {
                const selected = document.folder_id === f.id;
                return (
                  <TouchableOpacity
                    key={f.id ?? 'root'}
                    style={[styles.folderOptionItem, selected && { backgroundColor: colors.primaryLight }]}
                    onPress={() => handleSelectFolder(f.id)}
                  >
                    <Ionicons name={f.id ? 'folder' : 'folder-outline'} size={20} color={colors.primary} />
                    <Text style={[styles.folderOptionText, { color: colors.text }]}>{f.name}</Text>
                    {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ActionButton title={t('cancel')} variant="outline" onPress={() => setMoveModalVisible(false)} />
          </View>
        </View>
      </Modal>

      {/* Rename */}
      <Modal visible={renameModalVisible} transparent animationType="fade" onRequestClose={() => setRenameModalVisible(false)}>
        <View style={[styles.modalCenterOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.centerCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('rename')}</Text>
            <TextInput
              style={[
                styles.modalInput,
                { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.surfaceVariant },
              ]}
              value={titleInput}
              onChangeText={setTitleInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <ActionButton
                title={t('cancel')}
                variant="outline"
                onPress={() => setRenameModalVisible(false)}
                style={styles.flex1}
              />
              <ActionButton title={t('save')} onPress={handleSaveRename} style={styles.flex1} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const BarButton: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}> = ({ icon, label, color, onPress }) => (
  <TouchableOpacity style={styles.barBtn} onPress={onPress}>
    <Ionicons name={icon} size={22} color={color} />
    <Text style={[styles.barBtnText, { color }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const GRID_PADDING = 12;
const GRID_GAP = 12;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleArea: {
    flex: 1,
    paddingHorizontal: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  docTitle: {
    fontSize: 17,
    fontWeight: '700',
    flexShrink: 1,
  },
  docSub: {
    fontSize: 12,
    marginTop: 2,
  },
  gridContent: {
    padding: GRID_PADDING,
    paddingBottom: 100,
  },
  dragHint: {
    fontSize: 12,
    marginBottom: 8,
  },
  pageCell: {
    flex: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pageCellInner: {
    flex: 1,
  },
  pageNum: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNumText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  barBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  barBtnText: {
    fontSize: 11,
    fontWeight: '500',
  },
  exportOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  exportText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  viewer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  viewerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  viewerBody: {
    flex: 1,
  },
  viewerNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  viewerNavBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCenterOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  centerCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    marginTop: 12,
    marginBottom: 16,
  },
  watermarkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 8,
    marginTop: 14,
  },
  watermarkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  folderList: {
    maxHeight: 240,
    marginVertical: 12,
  },
  folderOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  folderOptionText: {
    fontSize: 15,
    flex: 1,
  },
});
