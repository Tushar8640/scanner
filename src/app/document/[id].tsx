import { useCallback, useRef, useState } from 'react';
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
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { Document, Page, PageRotation, PdfPageSize, PdfQuality } from '@/core/types';
import { DatabaseService } from '@/services/database/DatabaseService';
import { PdfService } from '@/services/pdf/PdfService';
import { GalleryService } from '@/services/storage/GalleryService';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ActionButton } from '@/ui/components/ActionButton';
import { ActionSheet, ActionSheetItem } from '@/ui/components/ActionSheet';
import { AnnotateModal, AnnotateMode } from '@/ui/components/AnnotateModal';
import { DocumentPageView } from '@/ui/components/DocumentPageView';
import { DraggableGrid, moveItem } from '@/ui/components/DraggableGrid';
import { ScanEngineProvider, useScanEngine } from '@/ui/components/ScanEngine';
import { scannerService } from '@/services/scanner/ScannerService';
import { PremiumService } from '@/services/monetization/PremiumService';
import { AdsService } from '@/services/monetization/AdsService';
import { useThemeColors } from '@/core/theme/colors';
import { ImageService } from '@/services/image/ImageService';
import { StorageService } from '@/services/storage/StorageService';

const GRID_PADDING = 12;
const GRID_GAP = 12;

export default function DocumentScreen() {
  // The scan engine renders filtered JPGs for "Save to Gallery"
  return (
    <ScanEngineProvider>
      <DocumentDetail />
    </ScanEngineProvider>
  );
}

function safeFileName(title: string): string {
  return title.replace(/[^a-zA-Z0-9_\-ঀ-৿]/g, '_');
}

function DocumentDetail() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: AnnotateMode | 'pdf' }>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const engine = useScanEngine();
  const { updateTitle, softDelete, moveToFolder, folders, loadAll, replacePageImage, setPendingScanImages } = useDocumentStore();
  const { default_page_size, default_quality, t } = useSettingsStore();
  const { width: windowWidth } = useWindowDimensions();

  const [document, setDocument] = useState<Document | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [gridDragging, setGridDragging] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // `uri` is the page rendered with its filter and rotation, so the editor shows what the user sees
  const [annotate, setAnnotate] = useState<{ mode: AnnotateMode; page: Page; uri: string } | null>(null);
  const [viewerHint, setViewerHint] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'more' | 'share' | 'add' | null>(null);
  const [pdfModalVisible, setPdfModalVisible] = useState(false);
  const [pageSize, setPageSize] = useState<PdfPageSize>(default_page_size);
  const [quality, setQuality] = useState<PdfQuality>(default_quality);
  const [renameVisible, setRenameVisible] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [moveVisible, setMoveVisible] = useState(false);
  const actionHandledRef = useRef(false);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const doc = await DatabaseService.getDocumentById(id);
      const list = await DatabaseService.getPagesByDocumentId(id);
      setDocument(doc);
      setPages(list);
      if (doc) setTitleInput(doc.title);
      if (!actionHandledRef.current && action && list.length > 0) {
        actionHandledRef.current = true;
        if (action === 'pdf') {
          setPdfModalVisible(true);
        } else if (action === 'sign' && list.length > 1) {
          // Let the user pick which page to sign
          setViewerHint(t('signPickPage'));
          setViewerIndex(list.length - 1);
        } else if (action === 'sign' || action === 'watermark' || action === 'markup') {
          const page = list[0];
          setLoading(false);
          setBusyText(t('processing'));
          try {
            const uri = await engine.renderFiltered(
              page.processed_path || page.original_path,
              page.filter,
              page.adjust,
              page.rotation
            );
            setAnnotate({ mode: action, page, uri });
          } finally {
            setBusyText(null);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load document:', e);
    } finally {
      setLoading(false);
    }
  }, [action, id, engine, t]);

  // Reload when returning from "Add pages"
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const columns = viewMode === 'list' ? 1 : 2;
  const cellWidth = (windowWidth - GRID_PADDING * 2 - GRID_GAP * (columns - 1)) / columns;
  const cellHeight = cellWidth * (4 / 3);

  /* ---------- actions ---------- */

  /** PDF pages go through the same filter pipeline as the preview. */
  const renderPdfPage = (p: Page) => engine.renderFiltered(p.processed_path || p.original_path, p.filter, p.adjust, p.rotation);

  const ensurePdf = async (): Promise<string> => {
    if (!document) throw new Error('No document');
    if (document.pdf_path) {
      const info = await FileSystem.getInfoAsync(document.pdf_path);
      if (info.exists) return document.pdf_path;
    }
    const path = await PdfService.generatePdf(document.id, pages, { title: document.title, pageSize, quality, renderPage: renderPdfPage });
    await DatabaseService.updateDocument(document.id, { pdf_path: path });
    setDocument((prev) => (prev ? { ...prev, pdf_path: path } : prev));
    return path;
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    try {
      setBusyText(label);
      await fn();
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Something went wrong');
    } finally {
      setBusyText(null);
    }
  };

  const sharePdf = () =>
    withBusy(t('generating'), async () => {
      if (!document) return;
      const path = await ensurePdf();
      setBusyText(null);
      await PdfService.shareFile(path, 'application/pdf', `${safeFileName(document.title)}.pdf`);
    });

  /** Renders pages with their filter and rotation baked in, as JPG files. */
  const renderPages = async (list: Page[]): Promise<string[]> => {
    const out: string[] = [];
    for (const p of list) {
      out.push(await engine.renderFiltered(p.processed_path || p.original_path, p.filter, p.adjust, p.rotation));
    }
    return out;
  };

  const openAnnotate = (mode: AnnotateMode, page: Page) =>
    withBusy(t('processing'), async () => {
      const [uri] = await renderPages([page]);
      setAnnotate({ mode, page, uri });
    });

  /** Sign on a multi-page document: let the user pick the page in the viewer first. */
  const startSign = (list: Page[]) => {
    if (list.length === 1) {
      openAnnotate('sign', list[0]);
    } else {
      setViewerHint(t('signPickPage'));
      setViewerIndex(list.length - 1);
    }
  };

  const otherPagesFor = (page: Page) => pages.filter((p) => p.id !== page.id);

  const applyAnnotation = async (uris: string[]) => {
    if (!annotate) return;
    const targets = [annotate.page, ...otherPagesFor(annotate.page)].slice(0, uris.length);
    await withBusy(t('saving'), async () => {
      const updatedById = new Map<string, Page>();
      for (let i = 0; i < targets.length; i++) {
        const updated = await replacePageImage(targets[i], uris[i], { baked: true });
        updatedById.set(updated.id, updated);
      }
      setPages((prev) => prev.map((p) => updatedById.get(p.id) ?? p));
      setDocument((prev) => (prev ? { ...prev, pdf_path: null } : prev));
    });
  };

  const shareImage = (index: number) =>
    withBusy(t('processing'), async () => {
      const [uri] = await renderPages([pages[index]]);
      setBusyText(null);
      await PdfService.shareFile(uri, 'image/jpeg', `${safeFileName(document?.title || 'page')}_${index + 1}.jpg`);
    });

  const saveToGallery = (list: Page[]) =>
    withBusy(t('processing'), async () => {
      const files = await renderPages(list);
      const n = await GalleryService.saveImages(files);
      setBusyText(null);
      Alert.alert(t('success'), t('savedToGallery').replace('{n}', String(n)));
    });

  const generatePdfWithOptions = () =>
    withBusy(t('generating'), async () => {
      if (!document || pages.length === 0) return;
      const path = await PdfService.generatePdf(document.id, pages, { title: document.title, pageSize, quality, renderPage: renderPdfPage });
      await DatabaseService.updateDocument(document.id, { pdf_path: path });
      setDocument((prev) => (prev ? { ...prev, pdf_path: path } : prev));
      setPdfModalVisible(false);
      setBusyText(null);
      AdsService.maybeShowInterstitial('after_export');
      const fileName = `${safeFileName(document.title)}.pdf`;
      Alert.alert(t('pdfExported'), t('choosePdfAction'), [
        {
          text: t('saveToDownloads'),
          onPress: async () => {
            const saved = await PdfService.saveToDownloads(path, fileName);
            if (saved) Alert.alert(t('success'), t('pdfSavedToDownloads'));
            else await PdfService.shareFile(path, 'application/pdf', fileName);
          },
        },
        { text: t('share'), onPress: () => PdfService.shareFile(path, 'application/pdf', fileName) },
        { text: t('cancel'), style: 'cancel' },
      ]);
    });

  const addPages = (source: 'camera' | 'gallery') => {
    if (!document) return;
    // Pages go through the normal crop + edit flow, then get appended to this document
    if (source === 'camera') {
      // Batch camera, then the normal review screen, which appends to this document
      router.push({ pathname: '/batch-scan', params: { appendTo: document.id } });
      return;
    }
    const go = (res: { pages: { uri: string; cropped?: boolean }[] } | null) => {
      if (res && res.pages.length > 0) {
        setPendingScanImages(res.pages);
        router.push({ pathname: '/scan-review', params: { appendTo: document.id } });
      }
    };
    scannerService.importFromGallery({ allowsMultiple: true }).then(go, (e: any) => Alert.alert(t('error'), e?.message || 'Something went wrong'));
  };

  const deleteDocument = () => {
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

  const saveRename = async () => {
    if (!document || !titleInput.trim()) return;
    await updateTitle(document.id, titleInput.trim());
    setDocument((prev) => (prev ? { ...prev, title: titleInput.trim() } : prev));
    setRenameVisible(false);
  };

  const refreshCover = async (doc: Document, first: Page) => {
    const thumb = await ImageService.generateThumbnail(first.processed_path || first.original_path, first.rotation);
    const thumbPath = await StorageService.saveThumbnail(doc.id, thumb);
    await DatabaseService.updateDocument(doc.id, { thumbnail_path: thumbPath });
    setDocument((prev) => (prev ? { ...prev, thumbnail_path: thumbPath } : prev));
  };

  /** Saves new positions; marks the PDF stale; refreshes the cover when the first page changes. */
  const reorderPages = async (from: number, to: number) => {
    if (!document) return;
    const previous = pages;
    const reordered = moveItem(pages, from, to).map((p, i) => ({ ...p, position: i }));
    setPages(reordered);
    try {
      for (const p of reordered) {
        const old = previous.find((o) => o.id === p.id);
        if (old && old.position !== p.position) await DatabaseService.updatePage(p.id, { position: p.position });
      }
      await DatabaseService.updateDocument(document.id, { pdf_path: null, updated_at: Date.now() });
      setDocument((prev) => (prev ? { ...prev, pdf_path: null } : prev));
      if (reordered[0].id !== previous[0]?.id) await refreshCover(document, reordered[0]);
      loadAll().catch(() => undefined);
    } catch (e: any) {
      setPages(previous);
      Alert.alert(t('error'), e?.message || 'Failed to reorder pages');
    }
  };

  const rotatePage = async (index: number) => {
    if (!document) return;
    const p = pages[index];
    const rotation = ((p.rotation + 90) % 360) as PageRotation;
    await DatabaseService.updatePage(p.id, { rotation });
    await DatabaseService.updateDocument(document.id, { pdf_path: null, updated_at: Date.now() });
    const updated = pages.map((x, i) => (i === index ? { ...x, rotation } : x));
    setPages(updated);
    setDocument((prev) => (prev ? { ...prev, pdf_path: null } : prev));
    if (index === 0) await refreshCover(document, updated[0]);
    loadAll().catch(() => undefined);
  };

  const deletePage = (index: number) => {
    if (!document) return;
    if (pages.length <= 1) {
      Alert.alert(t('warning'), t('lastPageWarning'));
      return;
    }
    Alert.alert(t('delete'), t('deletePageConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          const remaining = pages.filter((_, i) => i !== index).map((p, i) => ({ ...p, position: i }));
          await DatabaseService.deletePage(pages[index].id);
          for (const p of remaining) await DatabaseService.updatePage(p.id, { position: p.position });
          await DatabaseService.updateDocument(document.id, { page_count: remaining.length, pdf_path: null, updated_at: Date.now() });
          setPages(remaining);
          setDocument((prev) => (prev ? { ...prev, page_count: remaining.length, pdf_path: null } : prev));
          if (index === 0) await refreshCover(document, remaining[0]);
          setViewerIndex((v) => (v === null ? null : Math.min(v, remaining.length - 1)));
          loadAll().catch(() => undefined);
        },
      },
    ]);
  };

  /* ---------- render ---------- */

  if (loading || !document) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const moreItems: ActionSheetItem[] = [
    { key: 'rename', label: t('rename'), icon: 'create-outline', onPress: () => setRenameVisible(true) },
    { key: 'move', label: t('moveToFolder'), icon: 'folder-outline', onPress: () => setMoveVisible(true) },
    { key: 'gallery', label: t('saveToGallery'), icon: 'images-outline', onPress: () => saveToGallery(pages) },
    { key: 'pdf', label: t('exportPdf'), icon: 'document-text-outline', onPress: () => setPdfModalVisible(true) },
    { key: 'delete', label: t('delete'), icon: 'trash-outline', destructive: true, onPress: deleteDocument },
  ];
  const shareItems: ActionSheetItem[] = [
    { key: 'pdf', label: t('sharePdf'), icon: 'document-text-outline', onPress: sharePdf },
    ...(pages.length === 1
      ? [{ key: 'jpg', label: t('shareJpg'), icon: 'image-outline' as const, onPress: () => shareImage(0) }]
      : []),
    { key: 'gallery', label: t('saveToGallery'), icon: 'download-outline', onPress: () => saveToGallery(pages) },
  ];
  const addItems: ActionSheetItem[] = [
    { key: 'scan', label: t('scanDocument'), icon: 'camera-outline', onPress: () => addPages('camera') },
    { key: 'import', label: t('importImages'), icon: 'images-outline', onPress: () => addPages('gallery') },
  ];

  const viewerPage = viewerIndex !== null ? pages[viewerIndex] : null;

  const annotateOthers = annotate?.mode === 'watermark' ? otherPagesFor(annotate.page) : [];
  const annotateModal = annotate ? (
    <AnnotateModal
      visible
      mode={annotate.mode}
      imageUri={annotate.uri}
      onClose={() => setAnnotate(null)}
      otherPages={
        annotateOthers.length > 0
          ? { count: annotateOthers.length, prepare: async (i) => (await renderPages([annotateOthers[i]]))[0] }
          : undefined
      }
      onApply={applyAnnotation}
    />
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} accessibilityLabel={t('home')}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.titleArea} onPress={() => setRenameVisible(true)}>
          <Text style={[styles.docTitle, { color: colors.text, borderBottomColor: colors.borderStrong }]} numberOfLines={1}>
            {document.title}
          </Text>
          <Ionicons name="pencil" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
          accessibilityLabel="Toggle view"
        >
          <Ionicons name={viewMode === 'list' ? 'grid-outline' : 'square-outline'} size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setSheet('more')} accessibilityLabel={t('more')}>
          <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Pages */}
      <ScrollView contentContainerStyle={styles.gridContent} scrollEnabled={!gridDragging}>
        <DraggableGrid
          key={viewMode}
          data={pages}
          keyExtractor={(p) => p.id}
          columns={columns}
          cellWidth={cellWidth}
          cellHeight={cellHeight}
          gap={GRID_GAP}
          onReorder={reorderPages}
          onPressItem={setViewerIndex}
          onDragActiveChange={setGridDragging}
          renderItem={(item, index) => (
            <View style={[styles.pageCell, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.flex1} pointerEvents="none">
                <DocumentPageView
                  uri={item.processed_path || item.original_path}
                  filter={item.filter}
                  adjust={item.adjust}
                  maxSide={700}
                  rotation={item.rotation}
                  backgroundColor={colors.surface}
                />
              </View>
              <View style={styles.pageBadge}>
                <Text style={styles.pageBadgeText}>
                  {index + 1}/{pages.length}
                </Text>
              </View>
            </View>
          )}
        />
        <TouchableOpacity
          style={[styles.addCard, { borderColor: colors.borderStrong, marginTop: GRID_GAP }]}
          onPress={() => setSheet('add')}
        >
          <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
          <Text style={[styles.addCardText, { color: colors.textMuted }]}>{t('add')}</Text>
        </TouchableOpacity>
        <Text style={[styles.dragHint, { color: colors.textMuted }]}>{t('dragToReorder')}</Text>
      </ScrollView>

      {/* Bottom bar */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        <BarButton icon="camera-outline" label={t('add')} color={colors.text} onPress={() => setSheet('add')} />
        <BarButton
          icon="create-outline"
          label={t('edit')}
          color={colors.text}
          onPress={() => document && router.push({ pathname: '/scan-review', params: { editDoc: document.id } })}
        />
        <BarButton icon="share-social-outline" label={t('share')} color={colors.text} onPress={() => setSheet('share')} />
        <BarButton icon="document-text-outline" label="PDF" color={colors.text} onPress={() => setPdfModalVisible(true)} />
        <BarButton
          icon="pencil-outline"
          label={t('sign')}
          color={colors.text}
          onPress={() => startSign(pages)}
        />
      </View>

      {busyText && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.busyText}>{busyText}</Text>
        </View>
      )}

      <ActionSheet visible={sheet === 'more'} title={document.title} items={moreItems} onClose={() => setSheet(null)} />
      <ActionSheet visible={sheet === 'share'} title={t('share')} items={shareItems} onClose={() => setSheet(null)} />
      <ActionSheet visible={sheet === 'add'} title={t('addPage')} items={addItems} onClose={() => setSheet(null)} />

      {/* Page viewer with per-page tools */}
      <Modal visible={viewerPage !== null} animationType="fade" onRequestClose={() => { setViewerIndex(null); setViewerHint(null); }} statusBarTranslucent>
        <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.viewerHeader}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => { setViewerIndex(null); setViewerHint(null); }}>
              <Ionicons name="arrow-back" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.viewerTitle}>
              {(viewerIndex ?? 0) + 1}/{pages.length}
            </Text>
            <TouchableOpacity style={styles.headerBtn} onPress={() => viewerIndex !== null && shareImage(viewerIndex)}>
              <Ionicons name="share-social-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.viewerBody}>
            {viewerPage && (
              <DocumentPageView
                key={`${viewerPage.id}:${viewerPage.processed_path}`}
                uri={viewerPage.processed_path || viewerPage.original_path}
                filter={viewerPage.filter}
                adjust={viewerPage.adjust}
                rotation={viewerPage.rotation}
                backgroundColor="#000000"
              />
            )}
            {(viewerIndex ?? 0) > 0 && (
              <TouchableOpacity style={[styles.navBtn, { left: 8 }]} onPress={() => setViewerIndex((i) => Math.max(0, (i ?? 0) - 1))}>
                <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
              </TouchableOpacity>
            )}
            {(viewerIndex ?? 0) < pages.length - 1 && (
              <TouchableOpacity
                style={[styles.navBtn, { right: 8 }]}
                onPress={() => setViewerIndex((i) => Math.min(pages.length - 1, (i ?? 0) + 1))}
              >
                <Ionicons name="chevron-forward" size={28} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>
          {viewerHint && (
            <TouchableOpacity style={styles.viewerHint} onPress={() => setViewerHint(null)}>
              <Ionicons name="information-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.viewerHintText}>{viewerHint}</Text>
            </TouchableOpacity>
          )}
          {viewerPage && viewerIndex !== null && (
            <View style={styles.viewerTools}>
              <ViewerTool
                icon="options-outline"
                label={t('edit')}
                onPress={() => {
                  const index = viewerIndex;
                  setViewerIndex(null);
                  if (document) router.push({ pathname: '/scan-review', params: { editDoc: document.id, page: String(index) } });
                }}
              />
              <ViewerTool icon="refresh" label={t('rotate')} onPress={() => rotatePage(viewerIndex)} />
              <ViewerTool icon="brush-outline" label={t('markup')} onPress={() => openAnnotate('markup', viewerPage)} />
              <ViewerTool icon="create-outline" label={t('sign')} onPress={() => { setViewerHint(null); openAnnotate('sign', viewerPage); }} />
              <ViewerTool icon="water-outline" label={t('watermark')} onPress={() => openAnnotate('watermark', viewerPage)} />
              <ViewerTool
                icon="text"
                label={t('text')}
                onPress={() => router.push({ pathname: '/extract-text', params: { uri: viewerPage.processed_path || viewerPage.original_path } })}
              />
              <ViewerTool icon="trash-outline" label={t('delete')} danger onPress={() => deletePage(viewerIndex)} />
            </View>
          )}
        </View>

        {busyText && (
          <View style={styles.busyOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.busyText}>{busyText}</Text>
          </View>
        )}
        {annotateModal}
      </Modal>

      {/* Annotate straight from the bottom bar or from a tool action */}
      {viewerPage === null && annotateModal}

      {/* PDF export settings */}
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
                  <Text style={[styles.pillText, { color: pageSize === sz ? colors.primaryContrast : colors.text }]}>{sz}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('quality')}</Text>
            <View style={styles.pillRow}>
              {(['low', 'medium', 'high'] as PdfQuality[]).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.pill, { backgroundColor: quality === q ? colors.primary : colors.surfaceVariant }]}
                  onPress={() => {
                    if (q === 'high' && !PremiumService.require('pdf_high_quality')) return;
                    setQuality(q);
                  }}
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
            <ActionButton title={t('exportPdf')} loading={busyText !== null} onPress={generatePdfWithOptions} style={{ marginTop: 16 }} />
          </View>
        </View>
      </Modal>

      {/* Move to folder */}
      <Modal visible={moveVisible} transparent animationType="fade" onRequestClose={() => setMoveVisible(false)}>
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
                    onPress={async () => {
                      await moveToFolder(document.id, f.id);
                      setDocument((prev) => (prev ? { ...prev, folder_id: f.id } : prev));
                      setMoveVisible(false);
                    }}
                  >
                    <Ionicons name={f.id ? 'folder' : 'folder-outline'} size={20} color={colors.primary} />
                    <Text style={[styles.folderOptionText, { color: colors.text }]}>{f.name}</Text>
                    {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ActionButton title={t('cancel')} variant="outline" onPress={() => setMoveVisible(false)} />
          </View>
        </View>
      </Modal>

      {/* Rename */}
      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <View style={[styles.modalCenterOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.centerCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('rename')}</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.surfaceVariant }]}
              value={titleInput}
              onChangeText={setTitleInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <ActionButton title={t('cancel')} variant="outline" onPress={() => setRenameVisible(false)} style={styles.flex1} />
              <ActionButton title={t('save')} onPress={saveRename} style={styles.flex1} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const BarButton: React.FC<{ icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void }> = ({
  icon,
  label,
  color,
  onPress,
}) => (
  <TouchableOpacity style={styles.barBtn} onPress={onPress}>
    <Ionicons name={icon} size={24} color={color} />
    <Text style={[styles.barBtnText, { color }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const ViewerTool: React.FC<{ icon: keyof typeof Ionicons.glyphMap; label: string; danger?: boolean; onPress: () => void }> = ({
  icon,
  label,
  danger,
  onPress,
}) => (
  <TouchableOpacity style={styles.viewerTool} onPress={onPress}>
    <Ionicons name={icon} size={23} color={danger ? '#FF6B6B' : '#FFFFFF'} />
    <Text style={[styles.viewerToolText, danger && { color: '#FF6B6B' }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  docTitle: { fontSize: 18, fontWeight: '600', flexShrink: 1, borderBottomWidth: 1, borderStyle: 'dashed', paddingBottom: 2 },
  gridContent: { padding: GRID_PADDING, paddingBottom: 110 },
  pageCell: { flex: 1, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  pageBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomRightRadius: 6,
  },
  pageBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  addCard: {
    height: 84,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  addCardText: { fontSize: 18 },
  dragHint: { fontSize: 12, textAlign: 'center', marginTop: 12 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  barBtn: { flex: 1, alignItems: 'center', gap: 3 },
  barBtnText: { fontSize: 12, fontWeight: '500' },
  busyOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  busyText: { color: '#FFFFFF', fontSize: 14 },
  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  viewerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  viewerBody: { flex: 1 },
  navBtn: {
    position: 'absolute',
    top: '45%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#0FA58E' },
  viewerHintText: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  viewerTools: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10, backgroundColor: '#181B20' },
  viewerTool: { alignItems: 'center', gap: 4, minWidth: 52 },
  viewerToolText: { color: '#FFFFFF', fontSize: 11 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalCenterOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  centerCard: { width: '100%', maxWidth: 340, borderRadius: 16, padding: 20 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  sectionLabel: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 13, fontWeight: '600' },
  modalInput: { height: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 15, marginTop: 12, marginBottom: 16 },
  watermarkBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, marginTop: 14 },
  watermarkText: { fontSize: 13, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 10 },
  folderList: { maxHeight: 240, marginVertical: 12 },
  folderOptionItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  folderOptionText: { fontSize: 15, flex: 1 },
});
