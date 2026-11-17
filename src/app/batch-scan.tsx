import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  ScrollView,
  ActivityIndicator,
  BackHandler,
  Modal,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDocumentStore } from '@/store/useDocumentStore';
import { scannerService } from '@/services/scanner/ScannerService';
import { ActionButton } from '@/ui/components/ActionButton';
import { usePdfActions } from '@/ui/hooks/usePdfActions';

type CaptureMode = 'single' | 'batch';
type FlashSetting = 'off' | 'on' | 'auto' | 'torch';

interface CapturedPage {
  id: string;
  uri: string;
  cropped?: boolean;
}

/** Tabs under the preview. Single and Batch shoot here; the others open their own tool. */
type ModeTab = { key: string; label: 'extractText' | 'idCard' | 'batchModeSingle' | 'batchModeBatch' | 'scanQr'; route?: string };
const MODE_TABS: ModeTab[] = [
  { key: 'text', label: 'extractText', route: '/extract-text' },
  { key: 'single', label: 'batchModeSingle' },
  { key: 'batch', label: 'batchModeBatch' },
  { key: 'id', label: 'idCard', route: '/id-card' },
  { key: 'qr', label: 'scanQr', route: '/qr-scan' },
];

const MAX_PAGES = 50;
const FLASH_ORDER: FlashSetting[] = ['off', 'auto', 'on', 'torch'];
const FLASH_ICON: Record<FlashSetting, keyof typeof Ionicons.glyphMap> = {
  off: 'flash-off',
  auto: 'flash-outline',
  on: 'flash',
  torch: 'flashlight',
};
const BADGE = '#FF5A4E';

/**
 * Document camera. Single takes one page and opens the editor; Batch keeps shooting, the last
 * page shows as a thumbnail with a running count, and tapping it opens the editor with every page.
 *
 * Params:
 * - mode: 'single' | 'batch' (default batch)
 * - appendTo: document id; the reviewed pages are appended to that document.
 * - returnToReview: opened from the editor's Add page; pages go back to that screen.
 */
export default function BatchScanScreen() {
  const params = useLocalSearchParams<{ appendTo?: string; returnToReview?: string; mode?: string }>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useSettingsStore();
  const setPendingScanImages = useDocumentStore((s) => s.setPendingScanImages);
  const setReviewAppendImages = useDocumentStore((s) => s.setReviewAppendImages);
  const [permission, requestPermission] = useCameraPermissions();
  const pdf = usePdfActions();

  // Typed as any: CameraView's class typings conflict with React 19 ref types
  const cameraRef = useRef<any>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [mode, setMode] = useState<CaptureMode>(params.mode === 'single' ? 'single' : 'batch');
  const [flash, setFlash] = useState<FlashSetting>('off');
  const [hd, setHd] = useState(true);
  const [grid, setGrid] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [importing, setImporting] = useState(false);
  const finishedRef = useRef(false);
  const tabsRef = useRef<any>(null);
  const tabLayouts = useRef<Record<string, { x: number; w: number }>>({});

  const [flashAnim] = useState(() => new Animated.Value(0));
  const [thumbAnim] = useState(() => new Animated.Value(1));

  const previewHeight = Math.round((width * 4) / 3);
  const started = pages.length > 0;

  const finish = (list: CapturedPage[]) => {
    if (list.length === 0 || finishedRef.current) return;
    finishedRef.current = true;
    const images = list.map(({ uri, cropped }) => ({ uri, cropped }));
    if (params.returnToReview) {
      setReviewAppendImages(images);
      router.back();
      return;
    }
    setPendingScanImages(images);
    router.replace(params.appendTo ? { pathname: '/scan-review', params: { appendTo: params.appendTo } } : '/scan-review');
  };

  const confirmClose = () => {
    if (pages.length === 0) {
      router.back();
      return;
    }
    Alert.alert(t('discardTitle'), t('discardMsg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('discard'), style: 'destructive', onPress: () => router.back() },
    ]);
  };

  // Android back button asks before throwing captured pages away
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pages.length === 0) return false;
      confirmClose();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length]);

  // Keep the selected tab centred under the shutter
  const centreTab = (key: string, animated = true) => {
    const l = tabLayouts.current[key];
    if (l) tabsRef.current?.scrollTo({ x: Math.max(0, l.x + l.w / 2 - width / 2), animated });
  };

  const onTabPress = (tab: ModeTab) => {
    if (tab.route) {
      router.replace(tab.route as any);
      return;
    }
    const m = tab.key as CaptureMode;
    setMode(m);
    centreTab(m);
  };

  const playCaptureFeedback = () => {
    flashAnim.setValue(0.85);
    Animated.timing(flashAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    thumbAnim.setValue(1.35);
    Animated.spring(thumbAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  };

  const capture = async () => {
    if (!cameraReady || capturing || !cameraRef.current) return;
    if (pages.length >= MAX_PAGES) {
      Alert.alert(t('batchScan'), t('batchLimitReached').replace('{n}', String(MAX_PAGES)));
      return;
    }
    try {
      setCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: hd ? 1 : 0.7 });
      if (!photo?.uri) return;
      const page: CapturedPage = { id: `cap_${Date.now()}_${pages.length}`, uri: photo.uri };
      const next = [...pages, page];
      setPages(next);
      playCaptureFeedback();
      if (mode === 'single') finish(next);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Could not take the picture');
    } finally {
      setCapturing(false);
    }
  };

  const importFromGallery = async () => {
    try {
      setImporting(true);
      const res = await scannerService.importFromGallery({ allowsMultiple: true });
      if (!res || res.pages.length === 0) return;
      const room = MAX_PAGES - pages.length;
      const added = res.pages.slice(0, room).map((p, i) => ({ id: `imp_${Date.now()}_${i}`, uri: p.uri, cropped: p.cropped }));
      // Imported pages go straight to the editor, like the reference app
      finish([...pages, ...added]);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Something went wrong');
    } finally {
      setImporting(false);
    }
  };

  const undoLast = () => setPages((prev) => prev.slice(0, -1));

  const cycleFlash = () => setFlash((f) => FLASH_ORDER[(FLASH_ORDER.indexOf(f) + 1) % FLASH_ORDER.length]);

  if (!permission) return <View style={styles.black} />;

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: true, title: t('scanDocument') }} />
        <Ionicons name="camera-outline" size={56} color={colors.primary} />
        <Text style={[styles.permText, { color: colors.text }]}>{t('cameraPermissionScan')}</Text>
        <ActionButton title={t('allowCamera')} onPress={requestPermission} />
      </View>
    );
  }

  const lastPage = pages[pages.length - 1];
  const visibleTabs = started ? MODE_TABS.filter((m) => m.key === mode) : MODE_TABS;

  return (
    <View style={styles.black}>
      <StatusBar style="light" />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={confirmClose} accessibilityLabel={t('cancel')}>
          <Ionicons name="close" size={30} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.topRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={cycleFlash} accessibilityLabel={t('flash')}>
            <Ionicons name={FLASH_ICON[flash]} size={26} color={flash === 'off' ? '#FFFFFF' : '#FFD54F'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setHd((v) => !v)} accessibilityLabel="HD">
            <View style={[styles.hdBadge, !hd && styles.hdOff]}>
              <Text style={[styles.hdText, !hd && styles.hdTextOff]}>HD</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setMenuVisible(true)} accessibilityLabel={t('more')}>
            <Ionicons name="ellipsis-vertical" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 3:4 preview */}
      <View style={{ width, height: previewHeight }}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          ratio="4:3"
          flash={flash === 'torch' ? 'off' : flash}
          enableTorch={flash === 'torch'}
          onCameraReady={() => setCameraReady(true)}
          onMountError={(e) => Alert.alert(t('error'), e.message)}
        />
        {grid && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[styles.gridV, { left: '33.33%' }]} />
            <View style={[styles.gridV, { left: '66.66%' }]} />
            <View style={[styles.gridH, { top: '33.33%' }]} />
            <View style={[styles.gridH, { top: '66.66%' }]} />
          </View>
        )}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flashOverlay, { opacity: flashAnim }]} />
      </View>

      {/* Mode tabs */}
      <ScrollView
        ref={tabsRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={[styles.tabsRow, { paddingHorizontal: width / 2 }]}
        scrollEnabled={!started}
      >
        {visibleTabs.map((m) => {
          const active = m.key === mode;
          return (
            <TouchableOpacity
              key={m.key}
              style={styles.tab}
              onPress={() => onTabPress(m)}
              disabled={started}
              onLayout={(e) => {
                tabLayouts.current[m.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
                if (m.key === mode) requestAnimationFrame(() => centreTab(m.key, false));
              }}
            >
              {active && <View style={[styles.tabIndicator, { backgroundColor: colors.primary }]} />}
              <Text style={[styles.tabText, active && { color: colors.primary }]}>{t(m.label)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Bottom controls */}
      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.side}>
          {started ? (
            <TouchableOpacity style={styles.sideBtn} onPress={undoLast} accessibilityLabel={t('undo')}>
              <Ionicons name="arrow-undo-outline" size={30} color="#FFFFFF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.sideBtn} onPress={() => router.replace('/tools')}>
              <Ionicons name="apps" size={30} color="#FFFFFF" />
              <Text style={styles.sideText}>{t('allFeatures')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.shutter, { borderColor: colors.primary }, (!cameraReady || capturing) && styles.shutterBusy]}
          onPress={capture}
          disabled={!cameraReady || capturing}
          accessibilityLabel={t('scan')}
        >
          <View style={styles.shutterInner}>{capturing && <ActivityIndicator color={colors.primary} />}</View>
        </TouchableOpacity>

        <View style={styles.side}>
          {lastPage ? (
            <TouchableOpacity style={styles.thumbBtn} onPress={() => finish(pages)} accessibilityLabel={t('batchDone')}>
              <Animated.View style={{ transform: [{ scale: thumbAnim }] }}>
                <Image source={{ uri: lastPage.uri }} style={styles.thumb} />
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pages.length}</Text>
                </View>
              </Animated.View>
              <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          ) : (
            <View style={styles.importRow}>
              <TouchableOpacity style={styles.sideBtn} onPress={importFromGallery} disabled={importing || pdf.busy}>
                {importing ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="images-outline" size={28} color="#FFFFFF" />}
                <Text style={styles.sideText}>{t('importImages')}</Text>
              </TouchableOpacity>
              {/* PDFs open in the editor, like the reference camera's Import Files */}
              <TouchableOpacity style={styles.sideBtn} onPress={() => pdf.importToEditor({ replace: true })} disabled={importing || pdf.busy}>
                {pdf.busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="document-attach-outline" size={28} color="#FFFFFF" />}
                <Text style={styles.sideText}>{t('importFiles')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* More menu */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={[styles.menu, { top: insets.top + 64 }]}>
            <View style={styles.menuRow}>
              <Ionicons name="grid-outline" size={20} color="#FFFFFF" />
              <Text style={styles.menuText}>{t('showGrid')}</Text>
              <Switch value={grid} onValueChange={setGrid} trackColor={{ true: colors.primary }} />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const THUMB_W = 52;
const THUMB_H = 64;

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  permText: { fontSize: 15, textAlign: 'center' },
  flashOverlay: { backgroundColor: '#FFFFFF' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hdBadge: { backgroundColor: '#FFFFFF', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  hdOff: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#FFFFFF' },
  hdText: { color: '#000000', fontSize: 13, fontWeight: '900' },
  hdTextOff: { color: '#FFFFFF' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.6)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.6)' },
  tabsScroll: { flexGrow: 0 },
  tabsRow: { alignItems: 'center', gap: 6 },
  tab: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, alignItems: 'center' },
  tabIndicator: { position: 'absolute', top: 0, width: 28, height: 4, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  tabText: { color: '#D0D3D8', fontSize: 16, fontWeight: '500' },
  controls: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  side: { width: 130, alignItems: 'center' },
  importRow: { flexDirection: 'row', gap: 6 },
  sideBtn: { alignItems: 'center', gap: 6, minWidth: 62 },
  sideText: { color: '#FFFFFF', fontSize: 13, textAlign: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 6, alignItems: 'center', justifyContent: 'center' },
  shutterBusy: { opacity: 0.6 },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F1F1F1', alignItems: 'center', justifyContent: 'center' },
  thumbBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: 3, backgroundColor: '#333' },
  badge: {
    position: 'absolute',
    top: -12,
    right: -12,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 6,
    backgroundColor: BADGE,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  menuBackdrop: { flex: 1 },
  menu: { position: 'absolute', right: 12, backgroundColor: '#26272B', borderRadius: 10, paddingVertical: 4, minWidth: 200 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  menuText: { color: '#FFFFFF', fontSize: 15, flex: 1 },
});
