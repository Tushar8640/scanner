import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/core/theme/colors';

interface IntensitySliderProps {
  value: number; // 0.1 to 1.0
  onChange: (value: number) => void;
  title?: string;
}

let gTrackWidth = 0;
let gOnChange: (v: number) => void = () => {};

export const IntensitySlider: React.FC<IntensitySliderProps> = ({
  value,
  onChange,
  title = 'Magic Intensity',
}) => {
  const colors = useThemeColors();
  const [trackWidth, setTrackWidth] = useState<number>(0);

  useEffect(() => {
    gTrackWidth = trackWidth;
    gOnChange = onChange;
  }, [trackWidth, onChange]);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          if (gTrackWidth <= 0) return;
          const clampedX = Math.max(0, Math.min(gTrackWidth, evt.nativeEvent.locationX));
          const ratio = clampedX / gTrackWidth;
          const newValue = Math.round((0.1 + ratio * 0.9) * 100) / 100;
          gOnChange(newValue);
        },
        onPanResponderMove: (evt) => {
          if (gTrackWidth <= 0) return;
          const clampedX = Math.max(0, Math.min(gTrackWidth, evt.nativeEvent.locationX));
          const ratio = clampedX / gTrackWidth;
          const newValue = Math.round((0.1 + ratio * 0.9) * 100) / 100;
          gOnChange(newValue);
        },
      }),
    []
  );

  const percentage = Math.round(value * 100);
  // Calculate thumb position percentage (from 0 to 100% of track)
  const thumbPercent = Math.max(0, Math.min(100, ((value - 0.1) / 0.9) * 100));

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}>
      {/* Header Info: Title & Live Percentage Badge */}
      <View style={styles.headerRow}>
        <View style={styles.labelGroup}>
          <Ionicons name="sparkles" size={15} color={colors.primary} />
          <Text style={[styles.label, { color: colors.text }]}>{title}</Text>
        </View>
        <View style={[styles.valueBadge, { backgroundColor: colors.primaryLight }]}>
          <Text style={[styles.valueBadgeText, { color: colors.primary }]}>{percentage}%</Text>
        </View>
      </View>

      {/* Pure Touch Slider Track & Thumb (Buttons Removed as Requested) */}
      <View
        style={styles.trackContainer}
        onLayout={onTrackLayout}
        {...panResponder.panHandlers}
      >
        <View style={[styles.trackBackground, { backgroundColor: colors.borderStrong }]}>
          <View style={[styles.trackActiveFill, { width: `${thumbPercent}%`, backgroundColor: colors.primary }]} />
        </View>
        <View
          style={[
            styles.thumbHandle,
            { left: `${thumbPercent}%`, backgroundColor: colors.primary, borderColor: colors.surface },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  valueBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  valueBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  trackContainer: {
    width: '100%',
    height: 44,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBackground: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  trackActiveFill: {
    height: '100%',
    borderRadius: 4,
  },
  thumbHandle: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    marginLeft: -13,
    top: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
});
