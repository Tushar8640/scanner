import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  GestureResponderEvent,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useScanEngine } from '@/ui/components/ScanEngine';
import { FULL_QUAD, Point, Quad, clamp01, cloneQuad, isConvexQuad, isFullQuad } from '@/services/scanner/quad';

interface CropModalProps {
  visible: boolean;
  /** The uncropped source image. Re-cropping always starts from this, so edges can be widened again. */
  sourceUri: string;
  /** Current crop corners; null means detect automatically when opened. */
  initialCorners: Quad | null;
  onClose: () => void;
  /** sourceUri changes when the page was rotated inside the crop screen. */
  onApply: (result: { uri: string; corners: Quad; sourceUri: string }) => void;
  /** Shown as "2/5" when reviewing several new pages one after another. */
  progress?: { index: number; total: number };
}

type ActiveHandle = { kind: 'corner' | 'edge'; index: number } | null;

const VIEW_PADDING = 28;
const LOUPE_SIZE = 116;
const LOUPE_ZOOM = 2.2;
const INVALID_COLOR = '#E5484D';

export const CropModal: React.FC<CropModalProps> = ({ visible, onClose, ...rest }) => {
  if (!visible || !rest.sourceUri) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Mounted fresh on every open, so each page starts from its own corners */}
      <CropEditor key={rest.sourceUri} onClose={onClose} {...rest} />
    </Modal>
  );
};

/** Rotates normalised corners together with the image, keeping TL, TR, BR, BL order. */
function rotateQuad(q: Quad, clockwise: boolean): Quad {
  const m = q.map((p) => (clockwise ? { x: 1 - p.y, y: p.x } : { x: p.y, y: 1 - p.x }));
  return (clockwise ? [m[3], m[0], m[1], m[2]] : [m[1], m[2], m[3], m[0]]) as Quad;
}

const CropEditor: React.FC<Omit<CropModalProps, 'visible'>> = ({ sourceUri, initialCorners, onClose, onApply, progress }) => {
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const insets = useSafeAreaInsets();
  const engine = useScanEngine();

  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [corners, setCorners] = useState<Quad>(() => cloneQuad(initialCorners ?? FULL_QUAD));
  const [active, setActive] = useState<ActiveHandle>(null);
  const [detecting, setDetecting] = useState(initialCorners === null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [src, setSrc] = useState(sourceUri);
  const [rotating, setRotating] = useState(false);
  // Last auto-detected corners, so "All" can toggle back to them
  const [detected, setDetected] = useState<Quad | null>(initialCorners && !isFullQuad(initialCorners) ? initialCorners : null);

  const cornersRef = useRef<Quad>(corners);
  const startRef = useRef<Quad>(corners);
  const touchStartRef = useRef({ x: 0, y: 0 });

  const updateCorners = (q: Quad) => {
    cornersRef.current = q;
    setCorners(q);
  };

  // Runs edge detection; callers set `detecting` first. State is only set in the promise callbacks.
  const detectEdges = () => {
    const finish = (found: Quad | null) => {
      if (found) setDetected(found);
      updateCorners(found ?? cloneQuad(FULL_QUAD));
      setNotice(found ? null : t('noEdgesFound'));
      setDetecting(false);
    };
    engine.detect(src).then(
      (res) => finish(res.corners),
      (e) => {
        console.warn('Edge detection failed:', e);
        finish(null);
      }
    );
  };

  // "All" selects the whole image; pressed again ("Auto") it returns to the detected edges
  const handleToggleAll = () => {
    setNotice(null);
    if (!isFullQuad(cornersRef.current)) {
      updateCorners(cloneQuad(FULL_QUAD));
    } else if (detected) {
      updateCorners(cloneQuad(detected));
    } else {
      setDetecting(true);
      detectEdges();
    }
  };

  const handleRotate = async (clockwise: boolean) => {
    if (rotating) return;
    try {
      setRotating(true);
      const ref = await ImageManipulator.manipulate(src).rotate(clockwise ? 90 : -90).renderAsync();
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
      setImageSize({ w: out.width, h: out.height });
      setSrc(out.uri);
      updateCorners(rotateQuad(cornersRef.current, clockwise));
      setDetected((d) => (d ? rotateQuad(d, clockwise) : d));
    } catch (e) {
      console.warn('Rotate failed:', e);
    } finally {
      setRotating(false);
    }
  };

  useEffect(() => {
    Image.getSize(
      sourceUri,
      (w, h) => setImageSize({ w, h }),
      (err) => console.warn('Failed to read image size for crop:', err)
    );
    if (initialCorners === null) detectEdges();
    // Runs once per mount; CropEditor is keyed by sourceUri.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit the image inside the measured area
  let dispW = 0;
  let dispH = 0;
  if (imageSize && area) {
    const maxW = area.w - VIEW_PADDING * 2;
    const maxH = area.h - VIEW_PADDING * 2;
    const scale = Math.min(maxW / imageSize.w, maxH / imageSize.h);
    dispW = imageSize.w * scale;
    dispH = imageSize.h * scale;
  }

  // Touch handling via responder props; refs are only read inside the event callbacks
  const handleProps = (kind: 'corner' | 'edge', index: number) => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      startRef.current = cloneQuad(cornersRef.current);
      touchStartRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      setActive({ kind, index });
      setNotice(null);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      if (dispW <= 0 || dispH <= 0) return;
      const dx = e.nativeEvent.pageX - touchStartRef.current.x;
      const dy = e.nativeEvent.pageY - touchStartRef.current.y;
      const s = startRef.current;
      const q = cloneQuad(s);
      if (kind === 'corner') {
        q[index] = { x: clamp01(s[index].x + dx / dispW), y: clamp01(s[index].y + dy / dispH) };
      } else {
        // Edge handle: move both corners of this side along the side's normal
        const a = index;
        const b = (index + 1) % 4;
        const ex = (s[b].x - s[a].x) * dispW;
        const ey = (s[b].y - s[a].y) * dispH;
        const len = Math.hypot(ex, ey) || 1;
        const nx = -ey / len;
        const ny = ex / len;
        const proj = dx * nx + dy * ny;
        q[a] = { x: clamp01(s[a].x + (nx * proj) / dispW), y: clamp01(s[a].y + (ny * proj) / dispH) };
        q[b] = { x: clamp01(s[b].x + (nx * proj) / dispW), y: clamp01(s[b].y + (ny * proj) / dispH) };
      }
      updateCorners(q);
    },
    onResponderRelease: () => setActive(null),
    onResponderTerminate: () => setActive(null),
  });

  const valid = isConvexQuad(corners);
  const lineColor = valid ? colors.primary : INVALID_COLOR;
  const px = (p: Point) => ({ x: p.x * dispW, y: p.y * dispH });

  const handleApply = async () => {
    if (!valid || applying) return;
    try {
      setApplying(true);
      const q = cloneQuad(cornersRef.current);
      const uri = isFullQuad(q) ? src : await engine.warp(src, q);
      onApply({ uri, corners: q, sourceUri: src });
      onClose();
    } catch (e) {
      console.warn('Crop failed:', e);
      setNotice(t('cropFailed'));
    } finally {
      setApplying(false);
    }
  };

  const onAreaLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  };

  // Loupe: shows the area under the dragged corner, placed in the top corner away from the finger
  let loupe: React.ReactNode = null;
  if (active?.kind === 'corner' && dispW > 0) {
    const p = px(corners[active.index]);
    const onLeft = p.x < dispW / 2;
    loupe = (
      <View
        pointerEvents="none"
        style={[
          styles.loupe,
          { borderColor: lineColor, top: 8 },
          onLeft ? { right: 12 } : { left: 12 },
        ]}
      >
        <Image
          source={{ uri: src }}
          style={{
            position: 'absolute',
            width: dispW * LOUPE_ZOOM,
            height: dispH * LOUPE_ZOOM,
            left: LOUPE_SIZE / 2 - p.x * LOUPE_ZOOM,
            top: LOUPE_SIZE / 2 - p.y * LOUPE_ZOOM,
          }}
        />
        <View style={[styles.crossH, { backgroundColor: lineColor }]} />
        <View style={[styles.crossV, { backgroundColor: lineColor }]} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityLabel={t('cancel')}>
            <Ionicons name="arrow-back" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{t('crop')}</Text>
            <Text style={[styles.subtitle, !valid && { color: INVALID_COLOR }]} numberOfLines={1}>
              {valid ? t('cropHint') : t('invalidCrop')}
            </Text>
          </View>
          {progress && progress.total > 1 ? (
            <Text style={styles.progress}>
              {progress.index}/{progress.total}
            </Text>
          ) : null}
        </View>

        {/* Image + quad editor */}
        <View style={styles.area} onLayout={onAreaLayout}>
          {dispW > 0 && (
            <View style={{ width: dispW, height: dispH }}>
              <Image source={{ uri: src }} style={{ width: dispW, height: dispH }} />

              {/* Quad outline */}
              {corners.map((c, i) => (
                <Segment key={`s${i}`} a={px(c)} b={px(corners[(i + 1) % 4])} color={lineColor} />
              ))}

              {/* Edge handles at side midpoints */}
              {corners.map((c, i) => {
                const a = px(c);
                const b = px(corners[(i + 1) % 4]);
                const angle = Math.atan2(b.y - a.y, b.x - a.x);
                return (
                  <View
                    key={`e${i}`}
                    {...handleProps('edge', i)}
                    style={[styles.handleTouch, { left: (a.x + b.x) / 2 - 22, top: (a.y + b.y) / 2 - 22 }]}
                  >
                    <View
                      style={[
                        styles.edgePill,
                        { borderColor: lineColor, transform: [{ rotate: `${angle}rad` }] },
                      ]}
                    />
                  </View>
                );
              })}

              {/* Corner handles */}
              {corners.map((c, i) => {
                const p = px(c);
                const isActive = active?.kind === 'corner' && active.index === i;
                return (
                  <View
                    key={`c${i}`}
                    {...handleProps('corner', i)}
                    style={[styles.cornerTouch, { left: p.x - 26, top: p.y - 26 }]}
                  >
                    <View
                      style={[
                        styles.cornerDot,
                        { borderColor: lineColor },
                        isActive && { backgroundColor: 'rgba(255,255,255,0.35)' },
                      ]}
                    />
                  </View>
                );
              })}
            </View>
          )}

          {loupe}

          {(detecting || rotating || !imageSize) && (
            <View style={styles.busy}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.busyText}>{t('detectingEdges')}</Text>
            </View>
          )}
        </View>

        {notice && (
          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={16} color="#FFFFFF" />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        {/* Bottom bar: rotate left/right, whole image <-> auto edges, next */}
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.tool} onPress={() => handleRotate(false)} disabled={detecting || applying || rotating}>
            <Ionicons name="return-up-back" size={24} color="#FFFFFF" />
            <Text style={styles.toolText}>{t('rotateLeft')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tool} onPress={() => handleRotate(true)} disabled={detecting || applying || rotating}>
            <Ionicons name="return-up-forward" size={24} color="#FFFFFF" />
            <Text style={styles.toolText}>{t('rotateRight')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tool} onPress={handleToggleAll} disabled={detecting || applying || rotating}>
            <Ionicons name={isFullQuad(corners) ? 'scan-outline' : 'expand-outline'} size={24} color="#FFFFFF" />
            <Text style={styles.toolText}>{isFullQuad(corners) ? t('autoShort') : t('all')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tool, !valid && styles.toolDisabled]}
            onPress={handleApply}
            disabled={!valid || detecting || applying || rotating}
            accessibilityLabel={t('applyCrop')}
          >
            {applying ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="arrow-forward" size={24} color={colors.primary} />
            )}
            <Text style={[styles.toolText, { color: colors.primary }]}>{t('next')}</Text>
          </TouchableOpacity>
        </View>
    </View>
  );
};

/** A straight line between two points, drawn as a rotated view. */
const Segment: React.FC<{ a: Point; b: Point; color: string }> = ({ a, b, color }) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (a.x + b.x) / 2 - len / 2,
        top: (a.y + b.y) / 2 - 1,
        width: len,
        height: 2,
        backgroundColor: color,
        transform: [{ rotate: `${angle}rad` }],
      }}
    />
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111111',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    paddingLeft: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: '#BBBBBB',
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  area: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleTouch: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edgePill: {
    width: 26,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    backgroundColor: '#FFFFFF',
  },
  cornerTouch: {
    position: 'absolute',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  loupe: {
    position: 'absolute',
    width: LOUPE_SIZE,
    height: LOUPE_SIZE,
    borderRadius: LOUPE_SIZE / 2,
    borderWidth: 3,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  crossH: {
    position: 'absolute',
    left: LOUPE_SIZE / 2 - 10,
    top: LOUPE_SIZE / 2 - 1,
    width: 20,
    height: 2,
  },
  crossV: {
    position: 'absolute',
    left: LOUPE_SIZE / 2 - 1,
    top: LOUPE_SIZE / 2 - 10,
    width: 2,
    height: 20,
  },
  busy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  busyText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  noticeText: {
    color: '#FFFFFF',
    fontSize: 12,
    flexShrink: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tool: {
    alignItems: 'center',
    gap: 4,
    minWidth: 72,
  },
  toolDisabled: {
    opacity: 0.4,
  },
  progress: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 12,
  },
  toolText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  doneBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
