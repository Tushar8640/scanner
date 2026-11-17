import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PageAdjust } from '@/core/types';

export type AdjustKey = keyof PageAdjust;

interface AdjustPanelProps {
  value: PageAdjust;
  onChange: (value: PageAdjust) => void;
  onCancel: () => void;
  onApply: () => void;
  labels: Record<AdjustKey, string>;
  accent: string;
  bottomInset: number;
  cancelLabel: string;
  applyLabel: string;
}

const TABS: { key: AdjustKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'contrast', icon: 'contrast' },
  { key: 'brightness', icon: 'sunny' },
  { key: 'details', icon: 'sparkles' },
];

/** Fine-tuning for the selected filter: one 0-100 slider per setting, cancel or apply. */
export const AdjustPanel: React.FC<AdjustPanelProps> = ({
  value,
  onChange,
  onCancel,
  onApply,
  labels,
  accent,
  bottomInset,
  cancelLabel,
  applyLabel,
}) => {
  const [tab, setTab] = useState<AdjustKey>('contrast');
  const current = value[tab];

  return (
    <View style={[styles.panel, { paddingBottom: Math.max(bottomInset, 10) }]}>
      <View style={styles.sliderRow}>
        <Slider value={current} accent={accent} onChange={(v) => onChange({ ...value, [tab]: v })} />
        <Text style={styles.value}>{current}</Text>
      </View>
      <View style={styles.tabsRow}>
        <TouchableOpacity style={styles.edgeBtn} onPress={onCancel} accessibilityLabel={cancelLabel}>
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <TouchableOpacity key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
                <Ionicons name={t.icon} size={24} color={active ? accent : '#FFFFFF'} />
                <Text style={[styles.tabText, active && { color: accent }]}>{labels[t.key]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.edgeBtn} onPress={onApply} accessibilityLabel={applyLabel}>
          <Ionicons name="checkmark" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

/** 0-100 slider; tap or drag anywhere on the track. */
const Slider: React.FC<{ value: number; accent: string; onChange: (v: number) => void }> = ({ value, accent, onChange }) => {
  const widthRef = useRef(0);

  const update = (e: GestureResponderEvent) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const next = Math.round(Math.max(0, Math.min(1, e.nativeEvent.locationX / w)) * 100);
    if (next !== value) onChange(next);
  };

  const pct = `${value}%` as const;
  return (
    <View
      style={styles.track}
      onLayout={(e: LayoutChangeEvent) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={update}
      onResponderMove={update}
    >
      <View style={styles.rail} pointerEvents="none">
        <View style={[styles.fill, { width: pct, backgroundColor: accent }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: pct, backgroundColor: accent }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  panel: { backgroundColor: '#000000', paddingTop: 18 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 36, paddingRight: 20, gap: 18 },
  value: { color: '#FFFFFF', fontSize: 18, fontWeight: '500', width: 44, textAlign: 'left' },
  track: { flex: 1, height: 40, justifyContent: 'center' },
  rail: { height: 4, borderRadius: 2, backgroundColor: '#5A5F66', overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, marginLeft: -11, top: 9 },
  tabsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 14 },
  edgeBtn: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  tabs: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 22 },
  tab: { alignItems: 'center', gap: 6, minWidth: 72 },
  tabText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
});
