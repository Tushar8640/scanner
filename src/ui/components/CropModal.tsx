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
  onApply: (result: { uri: string; corners: Quad }) => void;
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

const CropEditor: React.FC<Omit<CropModalProps, 'visible'>> = ({ sourceUri, initialCorners, onClose, onApply }) => {
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
      updateCorners(found ?? cloneQuad(FULL_QUAD));
      setNotice(found ? null : t('noEdgesFound'));
      setDetecting(false);
    };
    engine.detect(sourceUri).then(
      (res) => finish(res.corners),
      (e) => {
        console.warn('Edge detection failed:', e);
        finish(null);
      }
    );
  };

  const handleAutoDetect = () => {
    setDetecting(true);
    setNotice(null);
    detectEdges();
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

  const handleWholePage = () => {
    setNotice(null);
    updateCorners(cloneQuad(FULL_QUAD));
  };

  const handleApply = async () => {
    if (!valid || applying) return;
    try {
      setApplying(true);
      const q = cloneQuad(cornersRef.current);
      const uri = isFullQuad(q) ? sourceUri : await engine.warp(sourceUri, q);
      onApply({ uri, corners: q });
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
          source={{ uri: sourceUri }}
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
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{t('cropTitle')}</Text>
            <Text style={[styles.subtitle, !valid && { color: INVALID_COLOR }]}>
              {valid ? t('cropHint') : t('invalidCrop')}
            </Text>
          </View>
          <View style={styles.iconBtn} />
        </View>

        {/* Image + quad editor */}
        <View style={styles.area} onLayout={onAreaLayout}>
          {dispW > 0 && (
            <View style={{ width: dispW, height: dispH }}>
              <Image source={{ uri: sourceUri }} style={{ width: dispW, height: dispH }} />

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

          {(detecting || !imageSize) && (
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

        {/* Bottom bar */}
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.tool} onPress={handleAutoDetect} disabled={detecting || applying}>
            <Ionicons name="scan-outline" size={24} color="#FFFFFF" />
            <Text style={styles.toolText}>{t('autoCrop')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tool} onPress={handleWholePage} disabled={detecting || applying}>
            <Ionicons name="expand-outline" size={24} color="#FFFFFF" />
            <Text style={styles.toolText}>{t('wholePage')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: valid ? colors.primary : '#555555' }]}
            onPress={handleApply}
            disabled={!valid || detecting || applying}
            accessibilityLabel={t('applyCrop')}
          >
            {applying ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="checkmark" size={28} color="#FFFFFF" />
            )}
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
    alignItems: 'center',
    flex: 1,
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
