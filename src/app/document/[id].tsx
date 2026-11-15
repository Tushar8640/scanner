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
import { lightColors } from '@/core/theme/colors';

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { updateTitle, softDelete } = useDocumentStore();
  const { default_page_size, default_quality, t } = useSettingsStore();

  const [document, setDocument] = useState<Document | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // PDF Settings modal
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [pageSize, setPageSize] = useState<PdfPageSize>(default_page_size);
  const [quality, setQuality] = useState<PdfQuality>(default_quality);
  const [password, setPassword] = useState('');

  // Rename modal
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [titleInput, setTitleInput] = useState('');

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
        'PDF Exported',
        'Choose how you want to save or share your PDF:',
        [
          {
            text: 'Save to Downloads',
            onPress: async () => {
              const saved = await PdfService.saveToDownloads(newPdfPath, fileName);
              if (saved) {
                Alert.alert('Success', 'PDF saved to your Downloads folder!');
              } else {
                await PdfService.shareFile(newPdfPath, 'application/pdf', fileName);
              }
            },
          },
          {
            text: 'Share / Save to Files',
            onPress: () => PdfService.shareFile(newPdfPath, 'application/pdf', fileName),
          },
          { text: 'Done', style: 'cancel' },
        ]
      );
    } catch (e: any) {
      setIsExporting(false);
      console.error('Failed to generate PDF:', e);
      Alert.alert('Export Error', e.message || 'Failed to generate PDF');
    }
  };

  const handleSaveRename = async () => {
    if (document && titleInput.trim().length > 0) {
      await updateTitle(document.id, titleInput.trim());
      setDocument((prev) => (prev ? { ...prev, title: titleInput.trim() } : null));
      setRenameModalVisible(false);
    }
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
      <View style={styles.center}>
        <ActivityIndicator size="large" color={lightColors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Details Header */}
      <View style={styles.infoBar}>
        <View style={styles.titleArea}>
          <Text style={styles.docTitle} numberOfLines={1}>
            {document.title}
          </Text>
          <Text style={styles.docSub}>
            {pages.length} Pages • {new Date(document.created_at).toLocaleDateString()}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.renameBtn}
          onPress={() => setRenameModalVisible(true)}
        >
          <Ionicons name="pencil" size={18} color={lightColors.primary} />
        </TouchableOpacity>
      </View>

      {/* Pages Preview ScrollView */}
      <ScrollView contentContainerStyle={styles.scrollPages} showsVerticalScrollIndicator={false}>
        {pages.map((p, index) => (
          <View key={p.id} style={styles.pageCard}>
            <DocumentPageView
              uri={p.processed_path || p.original_path}
              filter={p.filter}
              intensity={p.intensity ?? 0.6}
              rotation={p.rotation}
              backgroundColor="#FFFFFF"
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
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.toolAction} onPress={() => setPdfModalVisible(true)}>
          <Ionicons name="document-text-outline" size={22} color={lightColors.primary} />
          <Text style={styles.toolActionText}>{t('exportPdf')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolAction} onPress={handleShare}>
          <Ionicons name="share-social-outline" size={22} color={lightColors.primary} />
          <Text style={styles.toolActionText}>{t('share')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolAction} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={22} color={lightColors.danger} />
          <Text style={[styles.toolActionText, { color: lightColors.danger }]}>{t('delete')}</Text>
        </TouchableOpacity>
      </View>

      {/* PDF Export & Setting Modal (FR-20, FR-21, FR-22, FR-24) */}
      <Modal visible={pdfModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('exportPdf')}</Text>
              <TouchableOpacity onPress={() => setPdfModalVisible(false)}>
                <Ionicons name="close" size={24} color={lightColors.text} />
              </TouchableOpacity>
            </View>

            {/* Page Size Option */}
            <Text style={styles.sectionLabel}>{t('pageSize')}</Text>
            <View style={styles.pillRow}>
              {(['A4', 'Letter', 'Fit'] as PdfPageSize[]).map((sz) => (
                <TouchableOpacity
                  key={sz}
                  style={[styles.pill, pageSize === sz && styles.activePill]}
                  onPress={() => setPageSize(sz)}
                >
                  <Text style={[styles.pillText, pageSize === sz && styles.activePillText]}>
                    {sz}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Quality Option */}
            <Text style={styles.sectionLabel}>{t('quality')}</Text>
            <View style={styles.pillRow}>
              {(['low', 'medium', 'high'] as PdfQuality[]).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.pill, quality === q && styles.activePill]}
                  onPress={() => setQuality(q)}
                >
                  <Text style={[styles.pillText, quality === q && styles.activePillText]}>
                    {q === 'low' ? t('qualityLow') : q === 'medium' ? t('qualityMedium') : t('qualityHigh')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Password Protection (FR-24) */}
            <Text style={styles.sectionLabel}>{t('passwordProtect')} (Optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={password}
              onChangeText={setPassword}
              placeholder={t('enterPassword')}
              secureTextEntry
            />

            <View style={styles.watermarkBadge}>
              <Ionicons name="shield-checkmark" size={16} color={lightColors.success} />
              <Text style={styles.watermarkText}>{t('noWatermark')}</Text>
            </View>

            <ActionButton
              title={isExporting ? 'Generating...' : t('exportPdf')}
              loading={isExporting}
              onPress={handleGeneratePdfWithOptions}
              style={{ marginTop: 16 }}
            />
          </View>
        </View>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={renameModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('rename')}</Text>
            <TextInput
              style={styles.modalInput}
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
    backgroundColor: lightColors.background,
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
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: lightColors.border,
  },
  titleArea: {
    flex: 1,
  },
  docTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: lightColors.text,
  },
  docSub: {
    fontSize: 13,
    color: lightColors.textSecondary,
    marginTop: 2,
  },
  renameBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: lightColors.primaryLight,
  },
  scrollPages: {
    padding: 16,
    gap: 16,
    paddingBottom: 90,
  },
  pageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: lightColors.border,
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
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: lightColors.border,
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
    color: lightColors.text,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
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
    color: lightColors.text,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: lightColors.textSecondary,
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
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePill: {
    backgroundColor: lightColors.primary,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: lightColors.text,
  },
  activePillText: {
    color: '#FFFFFF',
  },
  modalInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: lightColors.borderStrong,
    paddingHorizontal: 12,
    fontSize: 15,
    color: lightColors.text,
  },
  watermarkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: lightColors.successLight,
    padding: 10,
    borderRadius: 8,
    marginTop: 14,
  },
  watermarkText: {
    fontSize: 13,
    color: lightColors.success,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
});
