import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import { useThemeColors } from '@/core/theme/colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropModalProps {
  visible: boolean;
  imageUri: string;
  onClose: () => void;
  onApplyCrop: (croppedUri: string) => void;
}

let gCropBox: CropRect = { x: 0, y: 0, width: 0, height: 0 };
let gLayout = { width: 0, height: 0, offsetX: 0, offsetY: 0 };

export const CropModal: React.FC<CropModalProps> = ({
  visible,
  imageUri,
  onClose,
  onApplyCrop,
}) => {
  const colors = useThemeColors();
  const [naturalWidth, setNaturalWidth] = useState<number>(0);
  const [naturalHeight, setNaturalHeight] = useState<number>(0);
  const [displayedLayout, setDisplayedLayout] = useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  }>({ width: 0, height: 0, offsetX: 0, offsetY: 0 });

  const [cropBox, setCropBox] = useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const containerWidth = SCREEN_WIDTH - 24;
  const containerHeight = SCREEN_HEIGHT * 0.68;

  // Sync module state for touch gesture tracking
  useEffect(() => {
    gCropBox = cropBox;
  }, [cropBox]);

  useEffect(() => {
    gLayout = displayedLayout;
  }, [displayedLayout]);

  // Load natural image dimensions
  useEffect(() => {
    if (visible && imageUri) {
      Image.getSize(
        imageUri,
        (w, h) => {
          setNaturalWidth(w);
          setNaturalHeight(h);

          // Calculate displayed dimensions keeping aspect ratio
          const imgAspect = w / h;
          const containerAspect = containerWidth / containerHeight;

          let dispW: number;
          let dispH: number;

          if (imgAspect > containerAspect) {
            dispW = containerWidth;
            dispH = containerWidth / imgAspect;
          } else {
            dispH = containerHeight;
            dispW = containerHeight * imgAspect;
          }

          const offX = (containerWidth - dispW) / 2;
          const offY = (containerHeight - dispH) / 2;

          const layout = {
            width: dispW,
            height: dispH,
            offsetX: offX,
            offsetY: offY,
          };

          setDisplayedLayout(layout);

          // Default full crop
          setCropBox({
            x: 0,
            y: 0,
            width: dispW,
            height: dispH,
          });
        },
        (err) => console.warn('Failed to get image size for crop:', err)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, imageUri]);

  // Factory function to create PanResponder for corners and edges
  const createHandlePan = (type: 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | 'move') => {
    let start: CropRect = { x: 0, y: 0, width: 0, height: 0 };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        start = { ...gCropBox };
      },
      onPanResponderMove: (_, gestureState) => {
        const maxW = gLayout.width;
        const maxH = gLayout.height;
        if (maxW <= 0 || maxH <= 0) return;

        const { dx, dy } = gestureState;
        let { x, y, width, height } = start;

        if (type === 'tl') {
          const newX = Math.max(0, Math.min(x + dx, x + width - 48));
          const newY = Math.max(0, Math.min(y + dy, y + height - 48));
          width = width - (newX - x);
          height = height - (newY - y);
          x = newX;
          y = newY;
        } else if (type === 'tr') {
          const newY = Math.max(0, Math.min(y + dy, y + height - 48));
          height = height - (newY - y);
          y = newY;
          width = Math.max(48, Math.min(maxW - x, width + dx));
        } else if (type === 'bl') {
          const newX = Math.max(0, Math.min(x + dx, x + width - 48));
          width = width - (newX - x);
          x = newX;
          height = Math.max(48, Math.min(maxH - y, height + dy));
        } else if (type === 'br') {
          width = Math.max(48, Math.min(maxW - x, width + dx));
          height = Math.max(48, Math.min(maxH - y, height + dy));
        } else if (type === 't') {
          const newY = Math.max(0, Math.min(y + dy, y + height - 48));
          height = height - (newY - y);
          y = newY;
        } else if (type === 'b') {
          height = Math.max(48, Math.min(maxH - y, height + dy));
        } else if (type === 'l') {
          const newX = Math.max(0, Math.min(x + dx, x + width - 48));
          width = width - (newX - x);
          x = newX;
        } else if (type === 'r') {
          width = Math.max(48, Math.min(maxW - x, width + dx));
        } else if (type === 'move') {
          x = Math.max(0, Math.min(x + dx, maxW - width));
          y = Math.max(0, Math.min(y + dy, maxH - height));
        }

        setCropBox({ x, y, width, height });
      },
    });
  };

  // Memoize pan responders
  const panTl = useMemo(() => createHandlePan('tl'), []);
  const panTr = useMemo(() => createHandlePan('tr'), []);
  const panBl = useMemo(() => createHandlePan('bl'), []);
  const panBr = useMemo(() => createHandlePan('br'), []);
  const panT = useMemo(() => createHandlePan('t'), []);
  const panB = useMemo(() => createHandlePan('b'), []);
  const panL = useMemo(() => createHandlePan('l'), []);
  const panR = useMemo(() => createHandlePan('r'), []);
  const panMove = useMemo(() => createHandlePan('move'), []);

  // Auto Crop (FR-02 Edge Detection / Boundary trimming)
  const handleAutoCrop = () => {
    if (displayedLayout.width === 0 || displayedLayout.height === 0) return;

    // Detect document edges: trims surrounding background margin (typically 6-8% margin)
    const marginX = displayedLayout.width * 0.07;
    const marginY = displayedLayout.height * 0.07;

    setCropBox({
      x: marginX,
      y: marginY,
      width: displayedLayout.width - marginX * 2,
      height: displayedLayout.height - marginY * 2,
    });
  };

  // Reset to full image
  const handleReset = () => {
    setCropBox({
      x: 0,
      y: 0,
      width: displayedLayout.width,
      height: displayedLayout.height,
    });
  };

  // Apply Crop via native ImageManipulator
  const handleApply = async () => {
    if (naturalWidth === 0 || naturalHeight === 0 || displayedLayout.width === 0) return;

    try {
      setIsProcessing(true);

      const scaleX = naturalWidth / displayedLayout.width;
      const scaleY = naturalHeight / displayedLayout.height;

      const originX = Math.max(0, Math.round(cropBox.x * scaleX));
      const originY = Math.max(0, Math.round(cropBox.y * scaleY));
      const cropW = Math.min(naturalWidth - originX, Math.round(cropBox.width * scaleX));
      const cropH = Math.min(naturalHeight - originY, Math.round(cropBox.height * scaleY));

      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        [
          {
            crop: {
              originX,
              originY,
              width: cropW,
              height: cropH,
            },
          },
        ],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      setIsProcessing(false);
      onApplyCrop(result.uri);
      onClose();
    } catch (e) {
      setIsProcessing(false);
      console.warn('Crop failed:', e);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.titleContainer}>
              <Text style={[styles.title, { color: colors.text }]}>Crop Document</Text>
              <Text style={[styles.subTitle, { color: colors.textSecondary }]}>Drag corners or edges to adjust</Text>
            </View>
            <TouchableOpacity
              onPress={handleApply}
              disabled={isProcessing}
              style={[styles.headerBtn, styles.applyBtn, { backgroundColor: colors.primary }]}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.applyBtnText}>Done</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Image & Interactive Touch Crop Viewport */}
          <View style={[styles.viewport, { width: containerWidth, height: containerHeight }]}>
            {displayedLayout.width > 0 && (
              <View
                style={{
                  width: displayedLayout.width,
                  height: displayedLayout.height,
                  position: 'relative',
                }}
              >
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: displayedLayout.width, height: displayedLayout.height }}
                  resizeMode="contain"
                />

                {/* Dark Mask Top */}
                <View
                  pointerEvents="none"
                  style={[
                    styles.mask,
                    {
                      top: 0,
                      left: 0,
                      right: 0,
                      height: cropBox.y,
                    },
                  ]}
                />
                {/* Dark Mask Bottom */}
                <View
                  pointerEvents="none"
                  style={[
                    styles.mask,
                    {
                      top: cropBox.y + cropBox.height,
                      left: 0,
                      right: 0,
                      bottom: 0,
                    },
                  ]}
                />
                {/* Dark Mask Left */}
                <View
                  pointerEvents="none"
                  style={[
                    styles.mask,
                    {
                      top: cropBox.y,
                      left: 0,
                      width: cropBox.x,
                      height: cropBox.height,
                    },
                  ]}
                />
                {/* Dark Mask Right */}
                <View
                  pointerEvents="none"
                  style={[
                    styles.mask,
                    {
                      top: cropBox.y,
                      left: cropBox.x + cropBox.width,
                      right: 0,
                      height: cropBox.height,
                    },
                  ]}
                />

                {/* Interactive Crop Box Container */}
                <View
                  style={[
                    styles.cropRectangle,
                    {
                      left: cropBox.x,
                      top: cropBox.y,
                      width: cropBox.width,
                      height: cropBox.height,
                    },
                  ]}
                >
                  {/* Center drag area */}
                  <View
                    {...panMove.panHandlers}
                    style={StyleSheet.absoluteFill}
                  >
                    {/* Grid Lines */}
                    <View style={styles.gridH1} pointerEvents="none" />
                    <View style={styles.gridH2} pointerEvents="none" />
                    <View style={styles.gridV1} pointerEvents="none" />
                    <View style={styles.gridV2} pointerEvents="none" />
                  </View>

                  {/* Top Edge Handle */}
                  <View
                    {...panT.panHandlers}
                    style={[styles.edgeTouchTarget, styles.edgeTouchT]}
                  >
                    <View style={[styles.edgePill, styles.edgePillH]} />
                  </View>

                  {/* Bottom Edge Handle */}
                  <View
                    {...panB.panHandlers}
                    style={[styles.edgeTouchTarget, styles.edgeTouchB]}
                  >
                    <View style={[styles.edgePill, styles.edgePillH]} />
                  </View>

                  {/* Left Edge Handle */}
                  <View
                    {...panL.panHandlers}
                    style={[styles.edgeTouchTarget, styles.edgeTouchL]}
                  >
                    <View style={[styles.edgePill, styles.edgePillV]} />
                  </View>

                  {/* Right Edge Handle */}
                  <View
                    {...panR.panHandlers}
                    style={[styles.edgeTouchTarget, styles.edgeTouchR]}
                  >
                    <View style={[styles.edgePill, styles.edgePillV]} />
                  </View>

                  {/* Top-Left Corner Handle */}
                  <View
                    {...panTl.panHandlers}
                    style={[styles.cornerTouchTarget, styles.cornerTl]}
                  >
                    <View style={styles.handleDisc}>
                      <View style={styles.handleDot} />
                    </View>
                  </View>

                  {/* Top-Right Corner Handle */}
                  <View
                    {...panTr.panHandlers}
                    style={[styles.cornerTouchTarget, styles.cornerTr]}
                  >
                    <View style={styles.handleDisc}>
                      <View style={styles.handleDot} />
                    </View>
                  </View>

                  {/* Bottom-Left Corner Handle */}
                  <View
                    {...panBl.panHandlers}
                    style={[styles.cornerTouchTarget, styles.cornerBl]}
                  >
                    <View style={styles.handleDisc}>
                      <View style={styles.handleDot} />
                    </View>
                  </View>

                  {/* Bottom-Right Corner Handle */}
                  <View
                    {...panBr.panHandlers}
                    style={[styles.cornerTouchTarget, styles.cornerBr]}
                  >
                    <View style={styles.handleDisc}>
                      <View style={styles.handleDot} />
                    </View>
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* Bottom Toolbar: Auto Crop & Reset */}
          <View style={[styles.toolbar, { borderTopColor: colors.border }]}>
            <TouchableOpacity style={styles.toolAction} onPress={handleAutoCrop}>
              <View style={[styles.iconCircle, { backgroundColor: colors.surfaceVariant }]}>
                <Ionicons name="scan-outline" size={20} color={colors.primary} />
              </View>
              <Text style={[styles.toolActionText, { color: colors.text }]}>Auto Crop</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.toolAction} onPress={handleReset}>
              <View style={[styles.iconCircle, { backgroundColor: colors.surfaceVariant }]}>
                <Ionicons name="refresh-outline" size={20} color={colors.text} />
              </View>
              <Text style={[styles.toolActionText, { color: colors.text }]}>Reset</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: lightColors.border,
  },
  headerBtn: {
    padding: 6,
  },
  applyBtn: {
    backgroundColor: lightColors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  applyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  titleContainer: {
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: lightColors.text,
  },
  subTitle: {
    fontSize: 11,
    color: lightColors.textSecondary,
    marginTop: 2,
  },
  viewport: {
    alignSelf: 'center',
    backgroundColor: '#1E1E1E',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 10,
    borderRadius: 12,
  },
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  cropRectangle: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderStyle: 'solid',
  },
  gridH1: {
    position: 'absolute',
    top: '33.3%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  gridH2: {
    position: 'absolute',
    top: '66.6%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  gridV1: {
    position: 'absolute',
    left: '33.3%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  gridV2: {
    position: 'absolute',
    left: '66.6%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  // Generous touch targets for corners (50x50)
  cornerTouchTarget: {
    position: 'absolute',
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cornerTl: { top: -25, left: -25 },
  cornerTr: { top: -25, right: -25 },
  cornerBl: { bottom: -25, left: -25 },
  cornerBr: { bottom: -25, right: -25 },

  // Visible handle disc
  handleDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: lightColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  handleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: lightColors.primary,
  },

  // Touch targets for edges (40dp width/height)
  edgeTouchTarget: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  edgeTouchT: { top: -20, left: 30, right: 30, height: 40 },
  edgeTouchB: { bottom: -20, left: 30, right: 30, height: 40 },
  edgeTouchL: { left: -20, top: 30, bottom: 30, width: 40 },
  edgeTouchR: { right: -20, top: 30, bottom: 30, width: 40 },

  // Edge pill indicators
  edgePill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: lightColors.primary,
  },
  edgePillH: {
    width: 32,
    height: 6,
  },
  edgePillV: {
    width: 6,
    height: 32,
  },

  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: lightColors.border,
  },
  toolAction: {
    alignItems: 'center',
    gap: 4,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: lightColors.text,
  },
});
