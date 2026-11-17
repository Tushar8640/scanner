import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  Modal,
  ScrollView,
  ActivityIndicator,
  BackHandler,
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

type CaptureMode = 'single' | 'batch';
type FlashSetting = 'off' | 'on' | 'auto' | 'torch';

interface CapturedPage {
  id: string;
  uri: string;
  cropped?: boolean;
}

const MAX_PAGES = 50;
const FLASH_ORDER: FlashSetting[] = ['off', 'auto', 'on', 'torch'];
const FLASH_ICON: Record<FlashSetting, keyof typeof Ionicons.glyphMap> = {
  off: 'flash-off',
  auto: 'flash-outline',
  on: 'flash',
  torch: 'flashlight',
};

/**
 * Batch camera: shoot page after page without leaving the camera. The last page shows as a
 * thumbnail with a running count; Done sends every page to the review screen, where edges are
 * detected and cropped automatically.
 *
 * Params:
 * - appendTo: document id; the reviewed pages are appended to that document.
 * - returnToReview: opened from the review screen's Add page; pages go back to that screen.
 */
export default function BatchScanScreen() {
  const params = useLocalSearchParams<{ appendTo?: string; returnToReview?: string }>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useSettingsStore();
  const setPendingScanImages = useDocumentStore((s) => s.setPendingScanImages);
  const setReviewAppendImages = useDocumentStore((s) => s.setReviewAppendImages);
  const [permission, requestPermission] = useCameraPermissions();

  // Typed as any: CameraView's class typings conflict with React 19 ref types (same as WebView here)
  const cameraRef = useRef<any>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [mode, setMode] = useState<CaptureMode>('batch');
  const [flash, setFlash] = useState<FlashSetting>('off');
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [trayVisible, setTrayVisible] = useState(false);
  const [importing, setImporting] = useState(false);
  const finishedRef = useRef(false);

  const [flashAnim] = useState(() => new Animated.Value(0));
  const [thumbAnim] = useState(() => new Animated.Value(1));

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
      if (trayVisible) {
        setTrayVisible(false);
        return true;
      }
      if (pages.length === 0) return false;
      confirmClose();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length, trayVisible]);

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
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
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
      const next = [...pages, ...added];
      setPages(next);
      if (mode === 'single') finish(next);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Something went wrong');
    } finally {
      setImporting(false);
    }
  };

  const removePage = (id: string) => {
    setPages((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length === 0) setTrayVisible(false);
      return next;
    });
  };

  const cycleFlash = () => setFlash((f) => FLASH_ORDER[(FLASH_ORDER.indexOf(f) + 1) % FLASH_ORDER.length]);

  if (!permission) return <View style={styles.black} />;

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: true, title: t('batchScan') }} />
        <Ionicons name="camera-outline" size={56} color={colors.primary} />
        <Text style={[styles.permText, { color: colors.text }]}>{t('cameraPermissionScan')}</Text>
        <ActionButton title={t('allowCamera')} onPress={requestPermission} />
      </View>
    );
  }

  const lastPage = pages[pages.length - 1];

  return (
    <View style={styles.black}>
      <StatusBar style="light" />
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={flash === 'torch' ? 'off' : flash}
        enableTorch={flash === 'torch'}
        onCameraReady={() => setCameraReady(true)}
        onMountError={(e) => Alert.alert(t('error'), e.message)}
      />

      {/* Shutter flash */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flashOverlay, { opacity: flashAnim }]} />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={confirmClose} accessibilityLabel={t('cancel')}>
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{mode === 'batch' ? t('batchScan') : t('batchModeSingle')}</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={cycleFlash} accessibilityLabel={t('flash')}>
          <Ionicons name={FLASH_ICON[flash]} size={24} color={flash === 'off' ? '#FFFFFF' : '#FFD54F'} />
        </TouchableOpacity>
      </View>

      {/* Framing guide */}
      <View pointerEvents="none" style={styles.guideWrap}>
        <View style={styles.guide}>
          <View style={[styles.corner, styles.cTL]} />
          <View style={[styles.corner, styles.cTR]} />
          <View style={[styles.corner, styles.cBL]} />
          <View style={[styles.corner, styles.cBR]} />
        </View>
        <Text style={styles.hint}>
          {pages.length > 0 && mode === 'batch'
            ? t('batchNextPageHint').replace('{n}', String(pages.length + 1))
            : t('batchHint')}
        </Text>
      </View>

      {/* Bottom controls */}
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        {/* Single / Batch switch; locked once pages are captured so nothing is lost */}
        <View style={styles.modeRow}>
          {(['single', 'batch'] as CaptureMode[]).map((m) => {
            const active = mode === m;
            const locked = pages.length > 0 && !active;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => setMode(m)}
                disabled={locked}
                style={[styles.modeChip, active && { backgroundColor: colors.primary }, locked && styles.modeLocked]}
              >
                <Text style={styles.modeText}>{m === 'single' ? t('batchModeSingle') : t('batchModeBatch')}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.controls}>
          {/* Left: stack of captured pages, or gallery import before the first shot */}
          <View style={styles.side}>
            {lastPage ? (
              <TouchableOpacity onPress={() => setTrayVisible(true)} accessibilityLabel={t('capturedPages')}>
                <Animated.View style={[styles.stack, { transform: [{ scale: thumbAnim }] }]}>
                  {pages.length > 1 && <View style={[styles.stackBehind, { borderColor: '#FFFFFF' }]} />}
                  <Image source={{ uri: lastPage.uri }} style={styles.stackImg} />
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.badgeText}>{pages.length}</Text>
                  </View>
                </Animated.View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.roundBtn} onPress={importFromGallery} disabled={importing} accessibilityLabel={t('importGallery')}>
                {importing ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="images-outline" size={26} color="#FFFFFF" />}
              </TouchableOpacity>
            )}
          </View>

          {/* Shutter */}
          <TouchableOpacity
            style={[styles.shutter, (!cameraReady || capturing) && styles.shutterBusy]}
            onPress={capture}
            disabled={!cameraReady || capturing}
            accessibilityLabel={t('scan')}
          >
            <View style={styles.shutterInner}>{capturing && <ActivityIndicator color={colors.primary} />}</View>
          </TouchableOpacity>

          {/* Right: Done once there are pages */}
          <View style={styles.side}>
            {pages.length > 0 ? (
              <TouchableOpacity
                style={[styles.doneBtn, { backgroundColor: colors.primary }]}
                onPress={() => finish(pages)}
                disabled={capturing}
                accessibilityLabel={t('batchDone')}
              >
                <Ionicons name="checkmark" size={22} color="#FFFFFF" />
                <Text style={styles.doneText}>{t('batchDone')}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.roundBtnPlaceholder} />
            )}
          </View>
        </View>
      </View>

      {/* Captured pages tray: review, delete a bad shot, then keep scanning */}
      <Modal visible={trayVisible} transparent animationType="slide" onRequestClose={() => setTrayVisible(false)}>
        <View style={styles.trayBackdrop}>
          <View style={[styles.tray, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.trayHeader}>
              <Text style={styles.trayTitle}>
                {t('capturedPages')} ({pages.length})
              </Text>
              <TouchableOpacity onPress={() => setTrayVisible(false)} style={styles.iconBtn} accessibilityLabel={t('cancel')}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.trayGrid}>
              {pages.map((p, idx) => (
                <View key={p.id} style={styles.trayItem}>
                  <Image source={{ uri: p.uri }} style={styles.trayImg} />
                  <View style={styles.trayNum}>
                    <Text style={styles.trayNumText}>{idx + 1}</Text>
                  </View>
                  <TouchableOpacity style={styles.trayDelete} onPress={() => removePage(p.id)} accessibilityLabel={t('delete')}>
                    <Ionicons name="trash" size={16} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <View style={styles.trayActions}>
              <TouchableOpacity style={[styles.trayBtn, styles.trayBtnGhost]} onPress={() => setTrayVisible(false)}>
                <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
                <Text style={styles.trayBtnText}>{t('continueScanning')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.trayBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setTrayVisible(false);
                  finish(pages);
                }}
              >
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.trayBtnText}>{t('batchDone')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const CORNER = 28;
const STACK_W = 52;
const STACK_H = 68;

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  permText: { fontSize: 15, textAlign: 'center' },
  flashOverlay: { backgroundColor: '#FFFFFF' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  topTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  guideWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 120 },
  guide: { width: '78%', aspectRatio: 1 / 1.35 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: 'rgba(255,255,255,0.9)' },
  cTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  hint: {
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
    textShadowColor: '#000000',
    textShadowRadius: 4,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    gap: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modeRow: { flexDirection: 'row', alignSelf: 'center', gap: 8 },
  modeChip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)' },
  modeLocked: { opacity: 0.35 },
  modeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  side: { width: 96, alignItems: 'center' },
  roundBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnPlaceholder: { width: 52, height: 52 },
  stack: { width: STACK_W, height: STACK_H },
  stackBehind: {
    position: 'absolute',
    top: -4,
    left: 4,
    width: STACK_W,
    height: STACK_H,
    borderRadius: 6,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  stackImg: { width: STACK_W, height: STACK_H, borderRadius: 6, borderWidth: 2, borderColor: '#FFFFFF' },
  badge: {
    position: 'absolute',
    top: -8,
    right: -8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: { opacity: 0.6 },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 22,
  },
  doneText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  trayBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  tray: {
    maxHeight: '75%',
    backgroundColor: '#181B20',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
  },
  trayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4 },
  trayTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  trayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  trayItem: { width: '30%', aspectRatio: 0.75, borderRadius: 8, overflow: 'hidden', backgroundColor: '#262A31' },
  trayImg: { width: '100%', height: '100%' },
  trayNum: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    paddingHorizontal: 5,
  },
  trayNumText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  trayDelete: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(220,53,69,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  trayBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: 10,
  },
  trayBtnGhost: { backgroundColor: '#262A31' },
  trayBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
