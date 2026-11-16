import React, { useEffect, useRef, useState } from 'react';
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
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PageFilter, PageRotation } from '@/core/types';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { scannerService } from '@/services/scanner/ScannerService';
import { DocumentPageView } from '@/ui/components/DocumentPageView';
import { CropModal } from '@/ui/components/CropModal';
import { AnnotateModal, AnnotateMode } from '@/ui/components/AnnotateModal';
import { ActionSheet } from '@/ui/components/ActionSheet';
import { FILTER_ORDER, getFilterRecipe } from '@/services/image/FilterUtils';
import { DraggableGrid, moveItem } from '@/ui/components/DraggableGrid';
import { ScanEngineProvider, useScanEngine } from '@/ui/components/ScanEngine';
import { Quad, isFullQuad } from '@/services/scanner/quad';
import { IntensitySlider } from '@/ui/components/IntensitySlider';
import { darkColors, useThemeColors } from '@/core/theme/colors';

interface EditablePage {
  id: string;
  /** Uncropped capture. Manual re-crops start from this so edges can be widened again. */
  sourceUri: string;
  /** Current crop corners on sourceUri; null means the whole image. */
  corners: Quad | null;
  /** 'pending' until automatic edge detection and perspective correction has run. */
  cropState: 'pending' | 'done';
  originalUri: string;
  previewUri: string;
  rotation: PageRotation;
  filter: PageFilter;
  intensity: number;
}

function toEditablePages(
  items: { uri: string; cropped?: boolean }[],
  idPrefix: string,
  filter: PageFilter
): EditablePage[] {
  return items.map((item, idx) => ({
    id: `${idPrefix}_${Date.now()}_${idx}`,
    sourceUri: item.uri,
    corners: null,
    cropState: item.cropped ? 'done' : 'pending',
    originalUri: item.uri,
    previewUri: item.uri,
    rotation: 0,
    filter,
    intensity: 0.6,
  }));
}

export default function ScanReviewScreen() {
  return (
    <ScanEngineProvider>
      <ScanReviewContent />
    </ScanEngineProvider>
  );
}

function ScanReviewContent() {
  // appendTo: opened from a document's "Add" card, so Save appends pages instead of creating a document
  const params = useLocalSearchParams<{ rawImages?: string; appendTo?: string }>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { createDocument, addPages, activeFolderId, pendingScanImages } = useDocumentStore();
  const { default_filter, t } = useSettingsStore();

  const [pages, setPages] = useState<EditablePage[]>(() => {
    // Check pendingScanImages first (from Zustand store for instantaneous reliable loading)
    let list: { uri: string; cropped?: boolean }[] = [];
    if (pendingScanImages && pendingScanImages.length > 0) {
      list = pendingScanImages;
    } else if (params.rawImages) {
      try {
        list = JSON.parse(params.rawImages);
      } catch (e) {
        console.error('Failed to parse params.rawImages:', e);
      }
    }
    return toEditablePages(list, 'page', 'magic');
  });
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [docTitle, setDocTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  const [stripDragging, setStripDragging] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [annotateMode, setAnnotateMode] = useState<AnnotateMode | null>(null);
  const [moreVisible, setMoreVisible] = useState(false);
  // New pages wait here for the user to confirm their crop, one after another (like the reference flow)
  const [reviewQueue, setReviewQueue] = useState<string[]>([]);
  const [reviewedCount, setReviewedCount] = useState(0);
  const cropAppliedRef = useRef(false);

  const currentPage = pages[currentPageIndex];
  const engine = useScanEngine();
  const autoCropBusyRef = useRef(false);
  const pendingCount = pages.filter((p) => p.cropState === 'pending').length;

  // Automatic edge detection + perspective correction for every new page (FR-02),
  // processed one page at a time in the background.
  useEffect(() => {
    if (autoCropBusyRef.current) return;
    const next = pages.find((p) => p.cropState === 'pending');
    if (!next) return;
    autoCropBusyRef.current = true;
    (async () => {
      let update: Partial<EditablePage> = { cropState: 'done' };
      try {
        // prepare() also fixes EXIF rotation, so the crop screen and the engine agree on orientation
        const prepared = await engine.prepare(next.sourceUri);
        update = { ...update, sourceUri: prepared.uri, originalUri: prepared.uri, previewUri: prepared.uri };
        if (prepared.corners && !isFullQuad(prepared.corners)) {
          const croppedUri = await engine.warp(prepared.uri, prepared.corners);
          update = { ...update, corners: prepared.corners, originalUri: croppedUri, previewUri: croppedUri };
        }
      } catch (e) {
        console.warn('Auto crop failed, keeping the full image:', e);
      }
      autoCropBusyRef.current = false;
      setPages((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...update } : p)));
      setReviewQueue((q) => [...q, next.id]);
    })();
  }, [pages, engine]);

  const reviewPage = reviewQueue.length > 0 ? pages.find((p) => p.id === reviewQueue[0]) : undefined;
  const reviewing = !!reviewPage;
  const cropTarget = reviewPage ?? (cropModalVisible ? currentPage : undefined);

  // Drag-to-reorder from the page strip; the selected page stays selected
  const handleReorder = (from: number, to: number) => {
    setPages((prev) => moveItem(prev, from, to));
    setCurrentPageIndex((cur) => {
      if (cur === from) return to;
      if (from < cur && to >= cur) return cur - 1;
      if (from > cur && to <= cur) return cur + 1;
      return cur;
    });
  };

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
            const newEntries = toEditablePages(res.pages, 'page_add', default_filter);
            setPages((prev) => [...prev, ...newEntries]);
          }
        },
      },
      {
        text: t('importGallery'),
        onPress: async () => {
          const res = await scannerService.importFromGallery({ allowsMultiple: true });
          if (res && res.pages.length > 0) {
            const newEntries = toEditablePages(res.pages, 'page_add', default_filter);
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
    if (pendingCount > 0) return;

    try {
      setIsSaving(true);
      if (params.appendTo) {
        await addPages(params.appendTo, pages);
        setIsSaving(false);
        router.back();
        return;
      }
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

  const handleClose = () => {
    Alert.alert(t('discardTitle'), t('discardMsg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('discard'), style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const filterLabels: Record<PageFilter, string> = {
    original: t('filterOriginal'),
    lighten: t('filterLighten'),
    magic: t('filterMagic'),
    enhanced: t('filterEnhanced'),
    noshadow: t('filterNoShadow'),
    bw: t('filterBw'),
    grayscale: t('filterGrayscale'),
  };

  if (pages.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: EDITOR.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const pageBusy = currentPage?.cropState === 'pending';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Top bar: close, editable title, save */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBtn} onPress={handleClose} accessibilityLabel={t('cancel')}>
          <Ionicons name="arrow-back" size={26} color="#FFFFFF" />
        </TouchableOpacity>
        <TextInput
          style={styles.titleInput}
          value={docTitle}
          onChangeText={setDocTitle}
          placeholder={t('docTitlePlaceholder')}
          placeholderTextColor="#8A8F98"
          numberOfLines={1}
        />
      </View>

      {/* Page preview */}
      <View style={styles.previewContainer}>
        {currentPage && (
          <DocumentPageView
            uri={currentPage.originalUri}
            filter={comparing ? 'original' : currentPage.filter}
            intensity={currentPage.intensity ?? 0.6}
            rotation={currentPage.rotation}
            backgroundColor={EDITOR.background}
          />
        )}
        {pageBusy && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.loadingText}>{t('detectingEdges')}</Text>
          </View>
        )}
        <View style={styles.pageCounter}>
          <Text style={styles.pageCounterText}>
            {currentPageIndex + 1}/{pages.length}
          </Text>
        </View>
        {currentPage && currentPage.filter !== 'original' && (
          <TouchableOpacity
            style={[styles.compareBtn, comparing && { backgroundColor: colors.primary }]}
            onPressIn={() => setComparing(true)}
            onPressOut={() => setComparing(false)}
            activeOpacity={1}
          >
            <Ionicons name="git-compare-outline" size={18} color="#FFFFFF" />
            <Text style={styles.compareText}>{t('compare')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Pages strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stripScroll}
        contentContainerStyle={styles.strip}
        scrollEnabled={!stripDragging}
      >
        {/* Long-press and drag a page to change its position */}
        <DraggableGrid
          data={pages}
          keyExtractor={(p) => p.id}
          columns={pages.length}
          cellWidth={THUMB_W}
          cellHeight={THUMB_H}
          gap={8}
          onReorder={handleReorder}
          onPressItem={setCurrentPageIndex}
          onDragActiveChange={setStripDragging}
          renderItem={(p, idx) => (
            <View style={[styles.thumbWrapper, idx === currentPageIndex && { borderColor: colors.primary }]}>
              <Image source={{ uri: p.originalUri }} style={styles.thumbImg} />
              {p.cropState === 'pending' && (
                <View style={styles.thumbBusy}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              )}
              <View style={styles.thumbNum}>
                <Text style={styles.thumbNumText}>{idx + 1}</Text>
              </View>
            </View>
          )}
        />
        <TouchableOpacity style={styles.addThumbBtn} onPress={handleAddPage} accessibilityLabel={t('addPage')}>
          <Ionicons name="add" size={26} color="#FFFFFF" />
        </TouchableOpacity>
      </ScrollView>

      {/* Filters */}
      <View style={styles.filterPanel}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTER_ORDER.map((f) => {
            const selected = currentPage?.filter === f;
            return (
              <TouchableOpacity key={f} style={styles.filterTile} onPress={() => handleApplyFilter(f)}>
                <View style={[styles.filterThumb, selected && { borderColor: colors.primary }]}>
                  {currentPage && (
                    <Image
                      source={{ uri: currentPage.originalUri }}
                      style={[styles.thumbImg, { filter: toNativeFilter(getFilterRecipe(f, currentPage.intensity ?? 0.6).css) } as any]}
                    />
                  )}
                  <View style={[styles.filterLabelBar, selected && { backgroundColor: colors.primary }]}>
                    <Text style={styles.filterLabel} numberOfLines={1}>
                      {filterLabels[f]}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {currentPage && currentPage.filter !== 'original' && (
          <IntensitySlider
            title={t('filterIntensity')}
            value={currentPage.intensity ?? 0.6}
            onChange={handleIntensityChange}
            palette={EDITOR_PALETTE}
          />
        )}

        {pages.length > 1 && (
          <TouchableOpacity
            style={[styles.applyAllChip, applyToAll && { backgroundColor: colors.primary }]}
            onPress={() => setApplyToAll(!applyToAll)}
          >
            <Ionicons name={applyToAll ? 'checkmark-circle' : 'ellipse-outline'} size={16} color="#FFFFFF" />
            <Text style={styles.applyAllText}>{t('applyEditsToAll')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom tools + save, like the reference editor */}
      <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom + 4, 12) }]}>
        <ToolButton icon="refresh" label={t('rotateShort')} onPress={handleRotate} />
        <ToolButton icon="crop" label={t('crop')} onPress={() => setCropModalVisible(true)} disabled={pageBusy} />
        <ToolButton icon="brush-outline" label={t('markup')} onPress={() => setAnnotateMode('markup')} disabled={pageBusy} />
        <ToolButton icon="create-outline" label={t('sign')} onPress={() => setAnnotateMode('sign')} disabled={pageBusy} />
        <ToolButton
          icon="text"
          label={t('text')}
          onPress={() => currentPage && router.push({ pathname: '/extract-text', params: { uri: currentPage.originalUri } })}
          disabled={pageBusy}
        />
        <ToolButton icon="ellipsis-horizontal" label={t('more')} onPress={() => setMoreVisible(true)} />
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: pendingCount > 0 ? '#3A3F47' : colors.primary }]}
          onPress={handleSave}
          disabled={pendingCount > 0 || isSaving}
          accessibilityLabel={t('save')}
        >
          {isSaving || pendingCount > 0 ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="checkmark" size={26} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>

      <ActionSheet
        visible={moreVisible}
        onClose={() => setMoreVisible(false)}
        items={[
          { key: 'add', label: t('addPage'), icon: 'add-circle-outline', onPress: handleAddPage },
          { key: 'wm', label: t('watermark'), icon: 'water-outline', onPress: () => setAnnotateMode('watermark') },
          ...(pages.length > 1
            ? [{ key: 'batch', label: t('batchEdit'), icon: 'copy-outline' as const, onPress: handleBatchApply }]
            : []),
          { key: 'delete', label: t('delete'), icon: 'trash-outline', destructive: true, onPress: handleDeletePage },
        ]}
      />

      {currentPage && annotateMode && (
        <AnnotateModal
          visible
          mode={annotateMode}
          imageUri={currentPage.originalUri}
          onClose={() => setAnnotateMode(null)}
          onApply={(uri) => {
            const pageId = currentPage.id;
            // The annotation is baked into the page; later re-crops start from it too
            setPages((prev) =>
              prev.map((p) => (p.id === pageId ? { ...p, sourceUri: uri, corners: null, originalUri: uri, previewUri: uri } : p))
            );
          }}
        />
      )}

      {cropTarget && (
        <CropModal
          visible={reviewing || cropModalVisible}
          sourceUri={cropTarget.sourceUri}
          initialCorners={cropTarget.corners}
          progress={reviewing ? { index: reviewedCount + 1, total: reviewedCount + reviewQueue.length + pendingCount } : undefined}
          onClose={() => {
            if (reviewing) {
              if (cropAppliedRef.current) {
                // Next: move on to the following new page
                setReviewQueue((q) => q.slice(1));
                setReviewedCount((n) => (reviewQueue.length <= 1 && pendingCount === 0 ? 0 : n + 1));
              } else {
                // Back: keep the automatic crops for the remaining pages and go to the editor
                setReviewQueue([]);
                setReviewedCount(0);
              }
            }
            cropAppliedRef.current = false;
            setCropModalVisible(false);
          }}
          onApply={({ uri, corners, sourceUri }) => {
            cropAppliedRef.current = true;
            const pageId = cropTarget.id;
            setPages((prev) =>
              prev.map((p) =>
                p.id === pageId
                  ? { ...p, sourceUri, corners: isFullQuad(corners) ? null : corners, originalUri: uri, previewUri: uri }
                  : p
              )
            );
            const idx = pages.findIndex((p) => p.id === pageId);
            if (idx >= 0) setCurrentPageIndex(idx);
          }}
        />
      )}
    </View>
  );
}

const ToolButton: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}> = ({ icon, label, onPress, disabled, danger }) => (
  <TouchableOpacity style={[styles.toolBtn, disabled && styles.toolBtnDisabled]} onPress={onPress} disabled={disabled}>
    <Ionicons name={icon} size={24} color={danger ? '#FF6B6B' : '#FFFFFF'} />
    <Text style={[styles.toolBtnText, danger && { color: '#FF6B6B' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
      {label}
    </Text>
  </TouchableOpacity>
);

/** Converts the CSS filter recipe into React Native's style `filter` syntax for thumbnails. */
function toNativeFilter(css: string): string | undefined {
  if (!css || css === 'none') return undefined;
  return css.replace(/(\d+(?:\.\d+)?)%/g, (_, n) => String(Number(n) / 100));
}

const THUMB_W = 50;
const THUMB_H = 66;

// The editor is always dark, like a camera app, regardless of the app theme
const EDITOR = {
  background: '#0E1013',
  panel: '#181B20',
  tile: '#262A31',
  text: '#FFFFFF',
  textMuted: '#A3A9B2',
};
const EDITOR_PALETTE = { ...darkColors, surfaceVariant: EDITOR.tile, border: EDITOR.tile };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: EDITOR.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  topBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleInput: {
    flex: 1,
    color: EDITOR.text,
    fontSize: 17,
    fontWeight: '600',
    paddingVertical: 6,
  },
  saveBtn: {
    width: 52,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: EDITOR.background,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  pageCounter: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pageCounterText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  stripScroll: {
    flexGrow: 0,
  },
  strip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  thumbWrapper: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: EDITOR.tile,
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbBusy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbNum: {
    position: 'absolute',
    bottom: 1,
    right: 1,
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
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 5,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#5A606A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPanel: {
    backgroundColor: EDITOR.panel,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 6,
  },
  filterRow: {
    paddingHorizontal: 12,
    gap: 10,
  },
  filterTile: {
    alignItems: 'center',
  },
  filterThumb: {
    width: 76,
    height: 92,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: EDITOR.tile,
  },
  filterIconBadge: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterLabelBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  filterLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  compareBtn: {
    position: 'absolute',
    top: 10,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  compareText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  applyAllChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginHorizontal: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: EDITOR.tile,
  },
  applyAllText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: EDITOR.panel,
    paddingTop: 10,
    paddingLeft: 4,
    paddingRight: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2C3038',
  },
  // Tools share the width equally, so the bar never overflows on narrow phones
  toolBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  toolBtnDisabled: {
    opacity: 0.35,
  },
  toolBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '500',
  },
});
