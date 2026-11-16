import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useScanActions } from '@/ui/hooks/useScanActions';

/** Floating camera button shown at the bottom right of the Home and Files tabs. */
export const ScanFab: React.FC = () => {
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const { busy, scanWithCamera } = useScanActions();

  return (
    <TouchableOpacity
      style={[styles.fab, { backgroundColor: colors.primary }]}
      onPress={scanWithCamera}
      disabled={busy}
      accessibilityLabel={t('scan')}
      activeOpacity={0.85}
    >
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="camera" size={30} color="#FFFFFF" />}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});
