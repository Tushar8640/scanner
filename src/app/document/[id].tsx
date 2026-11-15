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
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { Document, Page, PdfPageSize, PdfQuality } from '@/core/types';
import { DatabaseService } from '@/services/database/DatabaseService';
import { PdfService } from '@/services/pdf/PdfService';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ActionButton } from '@/ui/components/ActionButton';
import { DocumentPageView } from '@/ui/components/DocumentPageView';
import { useThemeColors } from '@/core/theme/colors';

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { updateTitle, softDelete, moveToFolder, folders } = useDocumentStore();
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Details Header */}
      <View style={[styles.infoBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.titleArea}>
          <Text style={[styles.docTitle, { color: colors.text }]} numberOfLines={1}>
            {document.title}
          </Text>
          <Text style={[styles.docSub, { color: colors.textSecondary }]}>
            {pages.length} Pages • {new Date(document.created_at).toLocaleDateString()}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.renameBtn, { backgroundColor: colors.primaryLight }]}
          onPress={() => setRenameModalVisible(true)}
        >
          <Ionicons name="pencil" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Pages Preview ScrollView */}
      <ScrollView contentContainerStyle={styles.scrollPages} showsVerticalScrollIndicator={false}>
        {pages.map((p, index) => (
          <View key={p.id} style={[styles.pageCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <DocumentPageView
              uri={p.processed_path || p.original_path}
              filter={p.filter}
              intensity={p.intensity ?? 0.6}
              rotation={p.rotation}
              backgroundColor={colors.surface}
            />
            <View style={styles.pageIndicator}>
              <Text style={styles.pageIndicatorText}>
                {index + 1} / {pages.length}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <TouchableOpacity style={styles.toolAction} onPress={() => setPdfModalVisible(true)}>
          <Ionicons name="document-text-outline" size={22} color={colors.primary} />
          <Text style={[styles.toolActionText, { color: colors.text }]}>{t('exportPdf')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolAction} onPress={handleShare}>
          <Ionicons name="share-social-outline" size={22} color={colors.primary} />
          <Text style={[styles.toolActionText, { color: colors.text }]}>{t('share')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolAction} onPress={() => setMoveModalVisible(true)}>
          <Ionicons name="folder-outline" size={22} color={colors.primary} />
          <Text style={[styles.toolActionText, { color: colors.text }]}>Move</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolAction} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
          <Text style={[styles.toolActionText, { color: colors.danger }]}>{t('delete')}</Text>
        </TouchableOpacity>
      </View>

      {/* PDF Export & Setting Modal (FR-20, FR-21, FR-22) */}
      <Modal visible={pdfModalVisible} transparent animationType="slide">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('exportPdf')}</Text>
              <TouchableOpacity onPress={() => setPdfModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Page Size Option */}
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('pageSize')}</Text>
            <View style={styles.pillRow}>
              {(['A4', 'Letter', 'Fit'] as PdfPageSize[]).map((sz) => (
                <TouchableOpacity
                  key={sz}
                  style={[
                    styles.pill,
                    { backgroundColor: pageSize === sz ? colors.primary : colors.surfaceVariant },
                  ]}
                  onPress={() => setPageSize(sz)}
                >
                  <Text style={[styles.pillText, { color: pageSize === sz ? colors.primaryContrast : colors.text }]}>
                    {sz}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Quality Option */}
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('quality')}</Text>
            <View style={styles.pillRow}>
              {(['low', 'medium', 'high'] as PdfQuality[]).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[
                    styles.pill,
                    { backgroundColor: quality === q ? colors.primary : colors.surfaceVariant },
                  ]}
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

      {/* Move to Folder Modal */}
      <Modal visible={moveModalVisible} transparent animationType="fade">
        <View style={[styles.modalCenterOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.moveModalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('moveToFolder')}</Text>
            <ScrollView style={{ maxHeight: 240, marginVertical: 12 }}>
              <TouchableOpacity
                style={[
                  styles.folderOptionItem,
                  document.folder_id === null && { backgroundColor: colors.primaryLight },
                  { borderBottomColor: colors.border },
                ]}
                onPress={() => handleSelectFolder(null)}
              >
                <Ionicons name="folder-outline" size={20} color={colors.primary} />
                <Text style={[styles.folderOptionText, { color: colors.text }]}>{t('noFolderRoot')}</Text>
                {document.folder_id === null && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
              {folders.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.folderOptionItem,
                    document.folder_id === f.id && { backgroundColor: colors.primaryLight },
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => handleSelectFolder(f.id)}
                >
                  <Ionicons name="folder" size={20} color={colors.primary} />
                  <Text style={[styles.folderOptionText, { color: colors.text }]}>{f.name}</Text>
                  {document.folder_id === f.id && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ActionButton
              title={t('cancel')}
              variant="outline"
              onPress={() => setMoveModalVisible(false)}
            />
          </View>
        </View>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={renameModalVisible} transparent animationType="fade">
        <View style={[styles.modalCenterOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.moveModalCard, { backgroundColor: colors.surface }]}>
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
                style={{ flex: 1 }}
              />
              <ActionButton
                title={t('save')}
                onPress={handleSaveRename}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  titleArea: {
    flex: 1,
  },
  docTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  docSub: {
    fontSize: 13,
    marginTop: 2,
  },
  renameBtn: {
    padding: 8,
    borderRadius: 8,
  },
  scrollPages: {
    padding: 16,
    gap: 16,
    paddingBottom: 90,
  },
  pageCard: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
    height: 480,
  },
  pageImage: {
    width: '100%',
    height: '100%',
  },
  pageIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pageIndicatorText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 72,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toolAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  toolActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalCenterOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  moveModalCard: {
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
    marginTop: 8,
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
  folderOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderRadius: 8,
  },
  folderOptionText: {
    fontSize: 15,
    flex: 1,
  },
});
