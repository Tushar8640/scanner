import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';

export interface ActionSheetItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  selected?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  title?: string;
  items: ActionSheetItem[];
  onClose: () => void;
}

/** Bottom sheet menu used for document "more" actions, sorting and similar choices. */
export const ActionSheet: React.FC<ActionSheetProps> = ({ visible, title, items, onClose }) => {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 12) }]}
          onPress={() => {}}
        >
          <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
          {title ? (
            <Text style={[styles.title, { color: colors.textSecondary }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {items.map((item) => {
            const tint = item.destructive ? colors.danger : item.selected ? colors.primary : colors.text;
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.row}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
              >
                <Ionicons name={item.icon} size={22} color={tint} />
                <Text style={[styles.label, { color: tint }]}>{item.label}</Text>
                {item.selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
              </TouchableOpacity>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  label: {
    flex: 1,
    fontSize: 16,
  },
});
