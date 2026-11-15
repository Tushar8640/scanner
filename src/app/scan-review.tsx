import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PageFilter, PageRotation } from '@/core/types';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { scannerService } from '@/services/scanner/ScannerService';
import { ActionButton } from '@/ui/components/ActionButton';
import { DocumentPageView } from '@/ui/components/DocumentPageView';
import { CropModal } from '@/ui/components/CropModal';
import { IntensitySlider } from '@/ui/components/IntensitySlider';
import { useThemeColors } from '@/core/theme/colors';

interface EditablePage {
  id: string;
  originalUri: string;
  previewUri: string;
  rotation: PageRotation;
  filter: PageFilter;
  intensity: number;
}

export default function ScanReviewScreen() {
  const params = useLocalSearchParams<{ rawImages?: string }>();
  const colors = useThemeColors();
  const { createDocument, activeFolderId, pendingScanImages } = useDocumentStore();
  const { default_filter, t } = useSettingsStore();

  const [pages, setPages] = useState<EditablePage[]>(() => {
    // Check pendingScanImages first (from Zustand store for instantaneous reliable loading)
    let list: { uri: string }[] = [];
    if (pendingScanImages && pendingScanImages.length > 0) {
      list = pendingScanImages;
    } else if (params.rawImages) {
      try {
        list = JSON.parse(params.rawImages);
      } catch (e) {
        console.error('Failed to parse params.rawImages:', e);
      }
    }
    return list.map((item, idx) => ({
      id: `page_${Date.now()}_${idx}`,
      originalUri: item.uri,
      previewUri: item.uri,
      rotation: 0,
      filter: 'magic' as PageFilter,
      intensity: 0.6,
    }));
  });
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [docTitle, setDocTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);

  const currentPage = pages[currentPageIndex];

  // Rotate current page by 90 degrees instantly (FR-11)
  const handleRotate = () => {
    if (!currentPage) return;
    const newRotation = (((currentPage.rotation + 90) % 360) as PageRotation);
    if (applyToAll) {
      setPages((prev) => prev.map((p) => ({ ...p, rotation: newRotation })));
    } else {
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === currentPageIndex ? { ...p, rotation: newRotation } : p
        )
      );
    }
  };

  // Apply Filter to current page or all pages instantly via GPU (FR-10, Batch Edit)
  const handleApplyFilter = (filter: PageFilter) => {
    if (!currentPage) return;
    if (applyToAll) {
      setPages((prev) => prev.map((p) => ({ ...p, filter })));
    } else {
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === currentPageIndex ? { ...p, filter } : p
        )
      );
    }
  };

  // Adjust filter intensity live with 60 FPS GPU update
  const handleIntensityChange = (intensity: number) => {
    if (!currentPage) return;
    if (applyToAll) {
      setPages((prev) => prev.map((p) => ({ ...p, intensity })));
    } else {
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === currentPageIndex ? { ...p, intensity } : p
        )
      );
    }
  };

  // Batch apply current page settings to all pages
  const handleBatchApply = () => {
    if (pages.length <= 1) {
      Alert.alert('Info', 'Only one page in document');
      return;
    }
    const currentIntensity = Math.round((currentPage.intensity ?? 0.6) * 100);
    Alert.alert(
      'Batch Edit',
      `Apply current filter "${currentPage.filter.toUpperCase()}" (${currentIntensity}%) to all ${pages.length} pages?`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: 'Apply to All',
          onPress: () => {
            setPages((prev) =>
              prev.map((p) => ({
                ...p,
                filter: currentPage.filter,
                intensity: currentPage.intensity ?? 0.6,
              }))
            );
            Alert.alert('Success', t('batchSuccess'));
          },
        },
      ]
    );
  };

  // Delete current page (FR-12)
  const handleDeletePage = () => {
    if (pages.length <= 1) {
      Alert.alert('Warning', 'At least one page is required');
      return;
    }

    Alert.alert('Delete Page', 'Are you sure you want to remove this page?', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          setPages((prev) => prev.filter((_, idx) => idx !== currentPageIndex));
          if (currentPageIndex > 0) {
            setCurrentPageIndex((prev) => prev - 1);
          }
        },
      },
    ]);
  };

  // Add more pages from camera or gallery (FR-12)
  const handleAddPage = async () => {
    Alert.alert(t('addPage'), 'Select source', [
      {
        text: t('scanDocument'),
        onPress: async () => {
          const res = await scannerService.scanWithCamera();
          if (res && res.pages.length > 0) {
            const newEntries: EditablePage[] = res.pages.map((item, idx) => ({
              id: `page_${Date.now()}_add_${idx}`,
              originalUri: item.uri,
              previewUri: item.uri,
              rotation: 0,
              filter: default_filter,
              intensity: 0.6,
            }));
            setPages((prev) => [...prev, ...newEntries]);
          }
        },
      },
      {
        text: t('importGallery'),
        onPress: async () => {
          const res = await scannerService.importFromGallery({ allowsMultiple: true });
          if (res && res.pages.length > 0) {
            const newEntries: EditablePage[] = res.pages.map((item, idx) => ({
              id: `page_${Date.now()}_add_${idx}`,
              originalUri: item.uri,
              previewUri: item.uri,
              rotation: 0,
              filter: default_filter,
              intensity: 0.6,
            }));
            setPages((prev) => [...prev, ...newEntries]);
          }
        },
      },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  // Save Document (FR-20, FR-30, FR-82)
  const handleSave = async () => {
    if (pages.length === 0) {
      Alert.alert('Warning', 'At least one page is required');
      return;
    }

    try {
      setIsSaving(true);
      const newDoc = await createDocument(
        docTitle.trim() || null,
        pages,
        activeFolderId,
        currentPage?.filter || 'magic'
      );
      setIsSaving(false);
      router.replace(`/document/${newDoc.id}`);
    } catch (e: any) {
      setIsSaving(false);
      console.error('Save failed:', e);
      Alert.alert('Save Error', e.message || 'Failed to save document. Please try again.');
    }
  };

  const filterOptions: { label: string; value: PageFilter; icon: string }[] = [
    { label: t('filterOriginal'), value: 'original', icon: 'image-outline' },
    { label: t('filterMagic'), value: 'magic', icon: 'sparkles' },
    { label: t('filterEnhanced'), value: 'enhanced', icon: 'color-wand-outline' },
    { label: t('filterBw'), value: 'bw', icon: 'contrast-outline' },
    { label: t('filterGrayscale'), value: 'grayscale', icon: 'radio-button-off-outline' },
  ];

  if (pages.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Title Input Bar */}
      <View style={[styles.titleBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
        <TextInput
          style={[styles.titleInput, { color: colors.text }]}
          value={docTitle}
          onChangeText={setDocTitle}
          placeholder="Document title (optional)..."
          placeholderTextColor={colors.textMuted}
        />
        <View style={[styles.pageBadge, { backgroundColor: colors.surfaceVariant }]}>
          <Text style={[styles.pageBadgeText, { color: colors.textSecondary }]}>
            {currentPageIndex + 1} / {pages.length}
          </Text>
        </View>
      </View>

      {/* Main Page Preview Area */}
      <View style={styles.previewContainer}>
        {currentPage && (
          <DocumentPageView
            uri={currentPage.originalUri}
            filter={currentPage.filter}
            intensity={currentPage.intensity ?? 0.6}
            rotation={currentPage.rotation}
          />
        )}
      </View>

      {/* Thumbnail Strip for Multi-Page Navigation */}
      <View style={[styles.thumbnailStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbScroll}>
          {pages.map((p, idx) => (
            <TouchableOpacity
              key={p.id}
              style={[
                styles.thumbWrapper,
                idx === currentPageIndex && { borderColor: colors.primary },
              ]}
              onPress={() => setCurrentPageIndex(idx)}
            >
              <Image source={{ uri: p.originalUri }} style={styles.thumbImg} />
              <View style={styles.thumbNum}>
                <Text style={styles.thumbNumText}>{idx + 1}</Text>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.addThumbBtn, { backgroundColor: colors.surfaceVariant, borderColor: colors.borderStrong }]}
            onPress={handleAddPage}
          >
            <Ionicons name="add" size={24} color={colors.primary} />
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Editing Controls: Filters & Actions */}
      <View style={[styles.editingControls, { backgroundColor: colors.surface }]}>
        {/* Filter Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {filterOptions.map((f) => (
            <TouchableOpacity
              key={f.value}
              style={[
                styles.filterPill,
                { backgroundColor: currentPage?.filter === f.value ? colors.primary : colors.surfaceVariant },
              ]}
              onPress={() => handleApplyFilter(f.value)}
            >
              <Text
                style={[
                  styles.filterPillText,
                  { color: currentPage?.filter === f.value ? '#FFFFFF' : colors.text },
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Dynamic Intensity Slider for Magic / Enhanced / B&W */}
        {currentPage && currentPage.filter !== 'original' && (
          <IntensitySlider
            title={
              currentPage.filter === 'magic'
                ? 'Magic Intensity'
                : currentPage.filter === 'bw'
                ? 'B&W Contrast Intensity'
                : 'Filter Intensity'
            }
            value={currentPage.intensity ?? 0.6}
            onChange={handleIntensityChange}
          />
        )}

        {/* Batch Edit Toggle Pill */}
        {pages.length > 1 && (
          <View style={styles.batchRow}>
            <TouchableOpacity
              style={[
                styles.batchToggle,
                { backgroundColor: applyToAll ? colors.primary : colors.surfaceVariant },
              ]}
              onPress={() => setApplyToAll(!applyToAll)}
            >
              <Ionicons
                name={applyToAll ? 'checkmark-circle' : 'layers-outline'}
                size={16}
                color={applyToAll ? '#FFFFFF' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.batchToggleText,
                  { color: applyToAll ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                {applyToAll ? `Editing all ${pages.length} pages` : `Apply edit to all ${pages.length} pages`}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action Row: Crop, Rotate, Batch, Delete, Add */}
        <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
          <TouchableOpacity style={styles.toolBtn} onPress={() => setCropModalVisible(true)}>
            <Ionicons name="crop-outline" size={22} color={colors.primary} />
            <Text style={[styles.toolBtnText, { color: colors.primary }]}>{t('crop')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.toolBtn} onPress={handleRotate}>
            <Ionicons name="refresh-outline" size={22} color={colors.text} />
            <Text style={[styles.toolBtnText, { color: colors.text }]}>{t('rotate')}</Text>
          </TouchableOpacity>

          {pages.length > 1 && (
            <TouchableOpacity style={styles.toolBtn} onPress={handleBatchApply}>
              <Ionicons name="copy-outline" size={22} color={colors.text} />
              <Text style={[styles.toolBtnText, { color: colors.text }]}>{t('batchEdit')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.toolBtn} onPress={handleDeletePage}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
            <Text style={[styles.toolBtnText, { color: colors.danger }]}>{t('delete')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.toolBtn} onPress={handleAddPage}>
            <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
            <Text style={[styles.toolBtnText, { color: colors.primary }]}>{t('addPage')}</Text>
          </TouchableOpacity>
        </View>

        {/* Save Button */}
        <View style={styles.saveContainer}>
          <ActionButton
            title={t('save')}
            loading={isSaving}
            onPress={handleSave}
            icon={<Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />}
            style={styles.saveBtn}
          />
        </View>

        {/* Interactive Crop & Auto Crop Modal */}
        {currentPage && (
          <CropModal
            visible={cropModalVisible}
            imageUri={currentPage.originalUri}
            onClose={() => setCropModalVisible(false)}
            onApplyCrop={(croppedUri) => {
              setPages((prev) =>
                prev.map((p, idx) =>
                  idx === currentPageIndex
                    ? { ...p, originalUri: croppedUri, previewUri: croppedUri }
                    : p
                )
              );
            }}
          />
        )}
      </View>
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
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  titleInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  pageBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pageBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    padding: 8,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    gap: 8,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  thumbnailStrip: {
    height: 76,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  thumbScroll: {
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
  },
  thumbWrapper: {
    width: 46,
    height: 60,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    position: 'relative',
  },
  activeThumbWrapper: {},
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbNum: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 3,
    paddingHorizontal: 3,
  },
  thumbNumText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  addThumbBtn: {
    width: 46,
    height: 60,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editingControls: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  filterRow: {
    gap: 8,
    paddingBottom: 8,
  },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 4,
    marginBottom: 6,
  },
  batchToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 6,
  },
  activeBatchToggle: {},
  batchToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  activeBatchToggleText: {
    color: '#FFFFFF',
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  activeFilterPill: {},
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  activeFilterPillText: {
    color: '#FFFFFF',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  toolBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  toolBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },
  saveContainer: {
    marginTop: 8,
  },
  saveBtn: {
    height: 48,
    borderRadius: 12,
  },
});
