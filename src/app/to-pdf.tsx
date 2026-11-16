import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Document, Page, PdfPageSize, PdfQuality } from '@/core/types';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDocumentStore } from '@/store/useDocumentStore';
import { PdfService } from '@/services/pdf/PdfService';
import { DatabaseService } from '@/services/database/DatabaseService';
import { scannerService } from '@/services/scanner/ScannerService';
import { ActionButton } from '@/ui/components/ActionButton';
import { PremiumService } from '@/services/monetization/PremiumService';

interface SelectedSource {
  type: 'document' | 'images';
  title: string;
  pages: Page[];
}

export default function ToPdfScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t, default_page_size, default_quality } = useSettingsStore();
  const { documents } = useDocumentStore();

  const [selectedSource, setSelectedSource] = useState<SelectedSource | null>(null);
  const [pageSize, setPageSize] = useState<PdfPageSize>(default_page_size);
  const [quality, setQuality] = useState<PdfQuality>(default_quality);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [generatedPdfPath, setGeneratedPdfPath] = useState<string | null>(null);

  const selectDocument = async (doc: Document) => {
    try {
      setBusy(true);
      setBusyText(t('loading'));
      const docPages = await DatabaseService.getPagesByDocumentId(doc.id);
      if (docPages.length === 0) {
        Alert.alert(t('error'), 'This document has no pages.');
        return;
      }
      setSelectedSource({
        type: 'document',
        title: doc.title,
        pages: docPages,
      });
      setGeneratedPdfPath(null);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Failed to load document');
    } finally {
      setBusy(false);
    }
  };

  const importFromGallery = async () => {
    try {
      setBusy(true);
      setBusyText(t('loading'));
      const result = await scannerService.importFromGallery({ allowsMultiple: true });
      if (!result || result.pages.length === 0) return;

      const dateStr = new Date().toLocaleDateString();
      const pages: Page[] = result.pages.map((p, idx) => ({
        id: `img_${Date.now()}_${idx}`,
        document_id: 'temp_doc',
        position: idx,
        original_path: p.uri,
        processed_path: p.uri,
        rotation: 0,
        filter: 'original',
        intensity: 0.6,
        ocr_text: null,
      }));

      setSelectedSource({
        type: 'images',
        title: `Images ${dateStr}`,
        pages,
      });
      setGeneratedPdfPath(null);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Failed to import images');
    } finally {
      setBusy(false);
    }
  };

  const scanWithCamera = async () => {
    try {
      setBusy(true);
      setBusyText(t('loading'));
      const result = await scannerService.scanWithCamera({ batch: true, maxNumDocuments: 50 });
      if (!result || result.pages.length === 0) return;

      const dateStr = new Date().toLocaleDateString();
      const pages: Page[] = result.pages.map((p, idx) => ({
        id: `scan_${Date.now()}_${idx}`,
        document_id: 'temp_doc',
        position: idx,
        original_path: p.uri,
        processed_path: p.uri,
        rotation: 0,
        filter: 'original',
        intensity: 0.6,
        ocr_text: null,
      }));

      setSelectedSource({
        type: 'images',
        title: `Scan ${dateStr}`,
        pages,
      });
      setGeneratedPdfPath(null);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Failed to scan');
    } finally {
      setBusy(false);
    }
  };

  const handleGeneratePdf = async (action: 'share' | 'print') => {
    if (!selectedSource || selectedSource.pages.length === 0) return;

    if (quality === 'high' && !PremiumService.require('pdf_high_quality')) {
      return;
    }

    try {
      setBusy(true);
      setBusyText(t('generating'));
      const pdfPath = await PdfService.generatePdf(
        `export_${Date.now()}`,
        selectedSource.pages,
        {
          title: selectedSource.title,
          pageSize,
          quality,
        }
      );
      setGeneratedPdfPath(pdfPath);

      if (action === 'share') {
        await PdfService.shareFile(
          pdfPath,
          'application/pdf',
          `${selectedSource.title.replace(/[^a-zA-Z0-9_\-ঀ-৿]/g, '_')}.pdf`
        );
      } else if (action === 'print') {
        await Print.printAsync({ uri: pdfPath });
      }
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'PDF generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('toPdf') }} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) + 20 }]}>
        {/* Source Cards */}
        {!selectedSource && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Choose Source</Text>
            <View style={styles.actionCards}>
              <TouchableOpacity
                style={[styles.actionCard, { backgroundColor: colors.surface }]}
                onPress={importFromGallery}
                disabled={busy}
              >
                <View style={[styles.actionIcon, { backgroundColor: '#3B82F620' }]}>
                  <Ionicons name="images" size={28} color="#3B82F6" />
                </View>
                <Text style={[styles.actionCardTitle, { color: colors.text }]}>{t('importImages')}</Text>
                <Text style={[styles.actionCardSub, { color: colors.textSecondary }]}>
                  Convert gallery pictures
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionCard, { backgroundColor: colors.surface }]}
                onPress={scanWithCamera}
                disabled={busy}
              >
                <View style={[styles.actionIcon, { backgroundColor: `${colors.primary}20` }]}>
                  <Ionicons name="camera" size={28} color={colors.primary} />
                </View>
                <Text style={[styles.actionCardTitle, { color: colors.text }]}>{t('scan')}</Text>
                <Text style={[styles.actionCardSub, { color: colors.textSecondary }]}>
                  Scan pages with camera
                </Text>
              </TouchableOpacity>
            </View>

            {/* List of existing documents */}
            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>
              {t('savedDocuments')}
            </Text>
            {documents.length === 0 ? (
              <View style={[styles.emptyDocs, { backgroundColor: colors.surface }]}>
                <Ionicons name="document-outline" size={36} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, fontSize: 14 }}>{t('noDocuments')}</Text>
              </View>
            ) : (
              <View style={[styles.docList, { backgroundColor: colors.surface }]}>
                {documents.map((doc, idx) => (
                  <TouchableOpacity
                    key={doc.id}
                    style={[
                      styles.docRow,
                      idx < documents.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                    ]}
                    onPress={() => selectDocument(doc)}
                    disabled={busy}
                  >
                    <Ionicons name="document-text" size={24} color={colors.primary} />
                    <View style={styles.docInfo}>
                      <Text style={[styles.docTitle, { color: colors.text }]} numberOfLines={1}>
                        {doc.title}
                      </Text>
                      <Text style={[styles.docMeta, { color: colors.textSecondary }]}>
                        {doc.page_count} {doc.page_count === 1 ? 'page' : 'pages'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Selected Document / Images View */}
        {selectedSource && (
          <View style={styles.section}>
            <View style={[styles.selectedHeader, { backgroundColor: colors.surface }]}>
              <View style={styles.selectedInfo}>
                <Ionicons
                  name={selectedSource.type === 'document' ? 'document-text' : 'images'}
                  size={32}
                  color={colors.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.selectedTitle, { color: colors.text }]} numberOfLines={1}>
                    {selectedSource.title}
                  </Text>
                  <Text style={[styles.selectedSub, { color: colors.textSecondary }]}>
                    {selectedSource.pages.length} {selectedSource.pages.length === 1 ? 'page' : 'pages'} selected
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.changeBtn, { borderColor: colors.borderStrong }]}
                onPress={() => {
                  setSelectedSource(null);
                  setGeneratedPdfPath(null);
                }}
              >
                <Text style={[styles.changeBtnText, { color: colors.primary }]}>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>

            {/* Thumbnails row */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbsScroll}>
              {selectedSource.pages.map((p, idx) => (
                <View key={p.id} style={[styles.thumbWrap, { borderColor: colors.border }]}>
                  <Image source={{ uri: p.processed_path || p.original_path }} style={styles.thumb} resizeMode="cover" />
                  <View style={styles.thumbBadge}>
                    <Text style={styles.thumbBadgeText}>{idx + 1}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Options */}
            <View style={[styles.optionsCard, { backgroundColor: colors.surface }]}>
              <Text style={[styles.optionHeading, { color: colors.text }]}>Page Size</Text>
              <View style={styles.pills}>
                {(['A4', 'Letter', 'Fit'] as PdfPageSize[]).map((sz) => (
                  <TouchableOpacity
                    key={sz}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: pageSize === sz ? colors.primary : colors.surfaceVariant,
                        borderColor: pageSize === sz ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setPageSize(sz)}
                  >
                    <Text style={[styles.pillText, { color: pageSize === sz ? '#FFFFFF' : colors.text }]}>
                      {sz === 'Fit' ? t('sizeFit') : sz}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.optionHeading, { color: colors.text, marginTop: 16 }]}>Quality</Text>
              <View style={styles.pills}>
                {(['low', 'medium', 'high'] as PdfQuality[]).map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: quality === q ? colors.primary : colors.surfaceVariant,
                        borderColor: quality === q ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setQuality(q)}
                  >
                    <Text
                      style={[styles.pillText, { color: quality === q ? '#FFFFFF' : colors.text, textTransform: 'capitalize' }]}
                    >
                      {t(`quality${q.charAt(0).toUpperCase() + q.slice(1)}` as any) || q}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Generate & Actions */}
            {busy ? (
              <View style={styles.busyWrap}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.busyText, { color: colors.textSecondary }]}>{busyText}</Text>
              </View>
            ) : (
              <View style={styles.ctaWrap}>
                <ActionButton
                  title="Generate & Share PDF"
                  icon="share-outline"
                  onPress={() => handleGeneratePdf('share')}
                />
                <TouchableOpacity
                  style={[styles.printBtn, { borderColor: colors.primary }]}
                  onPress={() => handleGeneratePdf('print')}
                >
                  <Ionicons name="print-outline" size={20} color={colors.primary} />
                  <Text style={[styles.printBtnText, { color: colors.primary }]}>{t('print')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {generatedPdfPath && !busy && (
              <View style={[styles.successBanner, { backgroundColor: `${colors.primary}15` }]}>
                <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                <Text style={[styles.successText, { color: colors.primary }]}>
                  PDF ready! You can share or print again.
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  actionCards: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  actionCardSub: {
    fontSize: 12,
    textAlign: 'center',
  },
  emptyDocs: {
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  docList: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  docInfo: {
    flex: 1,
  },
  docTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  docMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  selectedHeader: {
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  selectedTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  selectedSub: {
    fontSize: 13,
    marginTop: 2,
  },
  changeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 8,
  },
  changeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  thumbsScroll: {
    gap: 10,
    paddingVertical: 4,
  },
  thumbWrap: {
    width: 76,
    height: 100,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  thumbBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  optionsCard: {
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  optionHeading: {
    fontSize: 14,
    fontWeight: '600',
  },
  pills: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  busyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  busyText: {
    fontSize: 14,
  },
  ctaWrap: {
    gap: 10,
    marginTop: 8,
  },
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  printBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    gap: 10,
    marginTop: 4,
  },
  successText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});