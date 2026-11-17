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
import { DEFAULT_ADJUST, PageAdjust, PageFilter, PageRotation } from '@/core/types';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { scannerService } from '@/services/scanner/ScannerService';
import { DocumentPageView } from '@/ui/components/DocumentPageView';
import { CropModal } from '@/ui/components/CropModal';
import { AdsService } from '@/services/monetization/AdsService';
import { AnnotateModal, AnnotateMode } from '@/ui/components/AnnotateModal';
import { FILTER_ORDER } from '@/services/image/FilterUtils';
import { DraggableGrid, moveItem } from '@/ui/components/DraggableGrid';
import { ScanEngineProvider, useScanEngine } from '@/ui/components/ScanEngine';
import { FULL_QUAD, Quad, isFullQuad } from '@/services/scanner/quad';
import { AdjustPanel } from '@/ui/components/AdjustPanel';
import { useThemeColors } from '@/core/theme/colors';

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
  adjust: PageAdjust;
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
    adjust: { ...DEFAULT_ADJUST },
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
  const { default_filter, auto_crop, crop_review, t } = useSettingsStore();

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
    return toEditablePages(list, 'page', useSettingsStore.getState().default_filter);
  });
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [docTitle, setDocTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  const [stripDragging, setStripDragging] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [annotateMode, setAnnotateMode] = useState<AnnotateMode | null>(null);
  // Fine-tuning panel for the selected filter; holds the values to restore on cancel
  const [adjustBackup, setAdjustBackup] = useState<PageAdjust | null>(null);
  // Real filter previews of the current page, rendered by the page view
  const [thumbs, setThumbs] = useState<{ uri: string; items: Partial<Record<PageFilter, string>> } | null>(null);
  // New pages wait here for the user to confirm their crop, one after another
  const [reviewQueue, setReviewQueue] = useState<string[]>([]);
  const [reviewedCount, setReviewedCount] = useState(0);
  const cropAppliedRef = useRef(false);
  // Typed as any: TextInput's instance typings conflict with React 19 ref types
  const titleRef = useRef<any>(null);

  const currentPage = pages[currentPageIndex];
  const engine = useScanEngine();
  const autoCropBusyRef = useRef(false);
  const pendingCount = pages.filter((p) => p.cropState === 'pending').length;
  const adjusting = adjustBackup !== null;

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
        // Settings > Scan > Auto Crop: when off, keep the whole (orientation-fixed) image
        if (auto_crop && prepared.corners && !isFullQuad(prepared.corners)) {
          const croppedUri = await engine.warp(prepared.uri, prepared.corners);
          update = { ...update, corners: prepared.corners, originalUri: croppedUri, previewUri: croppedUri };
        }
      } catch (e) {
        console.warn('Auto crop failed, keeping the full image:', e);
      }
      autoCropBusyRef.current = false;
      setPages((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...update } : p)));
      // Settings > Scan > Review crop: show the crop screen for each new page
      if (crop_review) setReviewQueue((q) => [...q, next.id]);
    })();
  }, [pages, engine, auto_crop, crop_review]);

  const reviewPage = reviewQueue.length > 0 ? pages.find((p) => p.id === reviewQueue[0]) : undefined;
  const reviewing = !!reviewPage;
  const cropTarget = reviewPage ?? (cropModalVisible ? currentPage : undefined);

  /** Updates the current page, or every page when "Apply to all pages" is on. */
  const updatePages = (patch: Partial<EditablePage>, forceAll = false) => {
    const all = forceAll || applyToAll;
    setPages((prev) => prev.map((p, idx) => (all || idx === currentPageIndex ? { ...p, ...patch } : p)));
  };

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

  const goToPage = (idx: number) => {
    if (idx < 0 || idx >= pages.length || adjusting) return;
    setCurrentPageIndex(idx);
  };

  // Rotate left by 90 degrees (FR-11)
  const handleRotateLeft = () => {
    if (!currentPage) return;
    updatePages({ rotation: ((currentPage.rotation + 270) % 360) as PageRotation });
  };

  // First tap picks a filter; tapping the selected filter again opens fine-tuning
  const handleFilterPress = (filter: PageFilter) => {
    if (!currentPage) return;
    if (currentPage.filter === filter) {
      setAdjustBackup({ ...currentPage.adjust });
      return;
    }
    // A new filter starts from neutral settings
    updatePages({ filter, adjust: { ...DEFAULT_ADJUST } });
  };

  // Slider moves preview on the current page only; Apply copies to all pages when that is on
  const handleAdjustChange = (adjust: PageAdjust) => {
    setPages((prev) => prev.map((p, idx) => (idx === currentPageIndex ? { ...p, adjust } : p)));
  };

  const handleAdjustCancel = () => {
    if (adjustBackup) handleAdjustChange(adjustBackup);
    setAdjustBackup(null);
  };

  const handleAdjustApply = () => {
    if (applyToAll && currentPage) updatePages({ filter: currentPage.filter, adjust: currentPage.adjust }, true);
    setAdjustBackup(null);
  };

  // Batch apply current page filter and adjustments to all pages
  const handleBatchApply = () => {
    if (!currentPage || pages.length <= 1) return;
    Alert.alert(t('batchEdit'), `${t('applyEditsToAll')}?`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('applyToAll'),
        onPress: () => {
          updatePages({ filter: currentPage.filter, adjust: { ...currentPage.adjust } }, true);
          Alert.alert(t('success'), t('batchSuccess'));
        },
      },
    ]);
  };

  // Delete current page (FR-12)
  const handleDeletePage = () => {
    if (pages.length <= 1) {
      Alert.alert(t('warning'), t('atLeastOnePage'));
      return;
    }

    Alert.alert(t('deletePageTitle'), t('deletePageMsg'), [
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

  // Pages shot on the batch camera (opened from Add page) join the end of this scan
  useEffect(
    () =>
      useDocumentStore.subscribe((state) => {
        const images = state.reviewAppendImages;
        if (images.length === 0) return;
        state.setReviewAppendImages([]);
        const newEntries = toEditablePages(images, 'page_add', useSettingsStore.getState().default_filter);
        setPages((prev) => {
          setCurrentPageIndex(prev.length);
          return [...prev, ...newEntries];
        });
      }),
    []
  );

  // Add more pages from camera or gallery (FR-12)
  const handleAddPage = async () => {
    Alert.alert(t('addPage'), t('selectSource'), [
      {
        text: t('scanDocument'),
        onPress: () => router.push({ pathname: '/batch-scan', params: { returnToReview: '1' } }),
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
      Alert.alert(t('warning'), t('atLeastOnePage'));
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
      const newDoc = await createDocument(docTitle.trim() || null, pages, activeFolderId, currentPage?.filter || 'magic');
      setIsSaving(false);
      router.replace(`/document/${newDoc.id}`);
      AdsService.maybeShowInterstitial('after_save');
    } catch (e: any) {
      setIsSaving(false);
      console.error('Save failed:', e);
      Alert.alert(t('error'), e.message || 'Failed to save document. Please try again.');
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
    eco: t('filterEco'),
    grayscale: t('filterGrayscale'),
    invert: t('filterInvert'),
  };

  if (pages.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: EDITOR.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const pageBusy = currentPage?.cropState === 'pending';
  const pageThumbs = thumbs && currentPage && thumbs.uri === currentPage.originalUri ? thumbs.items : null;

  const tools: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }[] = [
    { key: 'import', icon: 'images-outline', label: t('importShort'), onPress: handleAddPage },
    { key: 'left', icon: 'arrow-undo-outline', label: t('rotateLeft'), onPress: handleRotateLeft },
    { key: 'crop', icon: 'crop', label: t('crop'), onPress: () => setCropModalVisible(true), disabled: pageBusy },
    {
      key: 'text',
      icon: 'scan-outline',
      label: t('extractText'),
      onPress: () => currentPage && router.push({ pathname: '/extract-text', params: { uri: currentPage.originalUri } }),
      disabled: pageBusy,
    },
    { key: 'sign', icon: 'create-outline', label: t('sign'), onPress: () => setAnnotateMode('sign'), disabled: pageBusy },
    { key: 'markup', icon: 'brush-outline', label: t('markup'), onPress: () => setAnnotateMode('markup'), disabled: pageBusy },
    { key: 'wm', icon: 'water-outline', label: t('watermark'), onPress: () => setAnnotateMode('watermark'), disabled: pageBusy },
    ...(pages.length > 1 ? [{ key: 'batch', icon: 'copy-outline' as const, label: t('batchEdit'), onPress: handleBatchApply }] : []),
    { key: 'delete', icon: 'trash-outline', label: t('delete'), onPress: handleDeletePage, danger: true },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Top bar: back and editable title */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBtn} onPress={handleClose} accessibilityLabel={t('cancel')}>
          <Ionicons name="arrow-back" size={26} color="#FFFFFF" />
        </TouchableOpacity>
        <TextInput
          ref={titleRef}
          style={styles.titleInput}
          value={docTitle}
          onChangeText={setDocTitle}
          placeholder={t('docTitlePlaceholder')}
          placeholderTextColor="#C9CDD2"
          numberOfLines={1}
        />
        <TouchableOpacity style={styles.topBtn} onPress={() => titleRef.current?.focus()} accessibilityLabel={t('rename')}>
          <Ionicons name="pencil-outline" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Page preview */}
      <View style={styles.previewContainer}>
        {currentPage && (
          <DocumentPageView
            key={currentPage.originalUri}
            uri={currentPage.originalUri}
            filter={comparing ? 'original' : currentPage.filter}
            adjust={comparing ? null : currentPage.adjust}
            rotation={currentPage.rotation}
            backgroundColor={EDITOR.background}
            thumbFilters={FILTER_ORDER}
            onThumbnails={(items) => setThumbs({ uri: currentPage.originalUri, items })}
          />
        )}
        {pageBusy && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.loadingText}>{t('detectingEdges')}</Text>
          </View>
        )}
      </View>

      {/* Page navigation and compare */}
      <View style={styles.navRow}>
        <View style={styles.navSide}>
          {pages.length > 1 && !adjusting && (
            <TouchableOpacity
              style={[styles.applyAllChip, applyToAll && { backgroundColor: colors.primary }]}
              onPress={() => setApplyToAll(!applyToAll)}
            >
              <Ionicons name={applyToAll ? 'checkmark-circle' : 'ellipse-outline'} size={15} color="#FFFFFF" />
              <Text style={styles.applyAllText} numberOfLines={1}>
                {t('applyToAllPages')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.pager}>
          <TouchableOpacity onPress={() => goToPage(currentPageIndex - 1)} disabled={currentPageIndex === 0} style={styles.pagerBtn}>
            <Ionicons name="caret-back" size={16} color={currentPageIndex === 0 ? '#555A61' : '#C9CDD2'} />
          </TouchableOpacity>
          <Text style={styles.pagerText}>
            {currentPageIndex + 1}/{pages.length}
          </Text>
          <TouchableOpacity
            onPress={() => goToPage(currentPageIndex + 1)}
            disabled={currentPageIndex >= pages.length - 1}
            style={styles.pagerBtn}
          >
            <Ionicons name="caret-forward" size={16} color={currentPageIndex >= pages.length - 1 ? '#555A61' : '#C9CDD2'} />
          </TouchableOpacity>
        </View>
        <View style={[styles.navSide, styles.navRight]}>
          {!adjusting && (
            <TouchableOpacity
              style={[styles.compareBtn, comparing && { backgroundColor: colors.primary }]}
              onPressIn={() => setComparing(true)}
              onPressOut={() => setComparing(false)}
              activeOpacity={1}
              accessibilityLabel={t('compare')}
            >
              <Ionicons name="git-compare-outline" size={18} color="#FFFFFF" />
              <Text style={styles.compareText}>{t('compare')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Page strip, only for multi-page scans: tap to open, long-press and drag to reorder */}
      {pages.length > 1 && !adjusting && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.stripScroll}
          contentContainerStyle={styles.strip}
          scrollEnabled={!stripDragging}
        >
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
        </ScrollView>
      )}

      {adjusting && currentPage ? (
        <AdjustPanel
          value={currentPage.adjust}
          onChange={handleAdjustChange}
          onCancel={handleAdjustCancel}
          onApply={handleAdjustApply}
          labels={{ contrast: t('adjustContrast'), brightness: t('adjustBrightness'), details: t('adjustDetails') }}
          accent={colors.primary}
          bottomInset={insets.bottom}
          cancelLabel={t('cancel')}
          applyLabel={t('apply')}
        />
      ) : (
        <>
          {/* Filters: real previews of this page; tap the selected one again to fine-tune */}
          <View style={styles.filterPanel}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {FILTER_ORDER.map((f) => {
                const selected = currentPage?.filter === f;
                const thumbUri = pageThumbs?.[f];
                return (
                  <TouchableOpacity
                    key={f}
                    style={[styles.filterTile, selected && { borderColor: colors.primary }]}
                    onPress={() => handleFilterPress(f)}
                    disabled={pageBusy}
                    accessibilityLabel={filterLabels[f]}
                  >
                    {thumbUri ? (
                      <Image source={{ uri: thumbUri }} style={styles.filterImg} />
                    ) : (
                      <View style={styles.filterImgLoading}>
                        <ActivityIndicator size="small" color="#8A8F98" />
                      </View>
                    )}
                    {selected && (
                      <View style={[styles.filterSelectedTint, { backgroundColor: colors.primary }]}>
                        <Ionicons name="options-outline" size={26} color="#FFFFFF" />
                      </View>
                    )}
                    <View style={[styles.filterLabelBar, selected && { backgroundColor: colors.primary }]}>
                      <Text style={styles.filterLabel} numberOfLines={1}>
                        {filterLabels[f]}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Tools (scrolls sideways) and the save button */}
          <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom + 4, 12) }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRow} style={styles.toolScroll}>
              {tools.map((tool) => (
                <TouchableOpacity
                  key={tool.key}
                  style={[styles.toolBtn, tool.disabled && styles.toolBtnDisabled]}
                  onPress={tool.onPress}
                  disabled={tool.disabled}
                >
                  <Ionicons name={tool.icon} size={24} color={tool.danger ? '#FF6B6B' : '#FFFFFF'} />
                  <Text style={[styles.toolBtnText, tool.danger && { color: '#FF6B6B' }]} numberOfLines={1}>
                    {tool.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: pendingCount > 0 ? '#3A3F47' : colors.primary }]}
              onPress={handleSave}
              disabled={pendingCount > 0 || isSaving}
              accessibilityLabel={t('save')}
            >
              {isSaving || pendingCount > 0 ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="checkmark" size={30} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {currentPage && annotateMode && (
        <AnnotateModal
          visible
          mode={annotateMode}
          imageUri={currentPage.originalUri}
          onClose={() => setAnnotateMode(null)}
          onApply={(uris) => {
            const uri = uris[0];
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
          // With Auto Crop off, start from the whole image instead of detecting edges
          initialCorners={cropTarget.corners ?? (auto_crop ? null : FULL_QUAD)}
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

const THUMB_W = 44;
const THUMB_H = 58;
const FILTER_SIZE = 84;

// The editor is always dark, like a camera app, regardless of the app theme
const EDITOR = {
  background: '#1E1F22',
  panel: '#26272B',
  tile: '#34363B',
  text: '#FFFFFF',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: EDITOR.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleInput: {
    flex: 1,
    color: EDITOR.text,
    fontSize: 18,
    fontWeight: '500',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: '#8A8F98',
  },
  previewContainer: { flex: 1, backgroundColor: EDITOR.background },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: { color: '#FFFFFF', fontSize: 14 },
  navRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  navSide: { flex: 1 },
  navRight: { alignItems: 'flex-end' },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: EDITOR.tile,
    borderRadius: 6,
    height: 38,
  },
  pagerBtn: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center' },
  pagerText: { color: '#FFFFFF', fontSize: 15, minWidth: 40, textAlign: 'center' },
  compareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 6,
    backgroundColor: EDITOR.tile,
  },
  compareText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  applyAllChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    backgroundColor: EDITOR.tile,
    maxWidth: 130,
  },
  applyAllText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  stripScroll: { flexGrow: 0 },
  strip: { paddingHorizontal: 12, paddingBottom: 8, gap: 8, alignItems: 'center' },
  thumbWrapper: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: EDITOR.tile,
  },
  thumbImg: { width: '100%', height: '100%' },
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
  thumbNumText: { color: '#FFFFFF', fontSize: 9, fontWeight: '700' },
  filterPanel: {
    backgroundColor: EDITOR.panel,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 12,
  },
  filterRow: { paddingHorizontal: 12, gap: 10 },
  filterTile: {
    width: FILTER_SIZE,
    height: FILTER_SIZE,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: EDITOR.tile,
  },
  filterImg: { width: '100%', height: '100%' },
  filterImgLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filterSelectedTint: {
    ...StyleSheet.absoluteFill,
    opacity: 0.6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 18,
  },
  filterLabelBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 4,
    backgroundColor: 'rgba(60,62,66,0.85)',
  },
  filterLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '500', textAlign: 'center' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: EDITOR.panel,
    paddingTop: 10,
    paddingRight: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3A3C41',
  },
  toolScroll: { flex: 1 },
  toolRow: { paddingHorizontal: 4 },
  toolBtn: { width: 76, alignItems: 'center', gap: 4, paddingVertical: 2 },
  toolBtnDisabled: { opacity: 0.35 },
  toolBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '500' },
  saveBtn: {
    width: 64,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
