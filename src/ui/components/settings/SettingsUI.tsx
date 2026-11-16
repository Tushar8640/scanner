import { Modal, Pressable, StyleSheet, Switch, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';

/** A titled white card holding settings rows (list style used across the settings screens). */
export const SettingsGroup: React.FC<{ title?: string; footer?: string; children: React.ReactNode }> = ({ title, footer, children }) => {
  const colors = useThemeColors();
  return (
    <View style={styles.group}>
      {title ? <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>{title}</Text> : null}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>{children}</View>
      {footer ? <Text style={[styles.groupFooter, { color: colors.textMuted }]}>{footer}</Text> : null}
    </View>
  );
};

interface RowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  badge?: string;
  right?: React.ReactNode;
  disabled?: boolean;
}

export const SettingsRow: React.FC<RowProps> = ({ icon, label, subtitle, value, onPress, danger, badge, right, disabled }) => {
  const colors = useThemeColors();
  const tint = danger ? colors.danger : colors.text;
  return (
    <TouchableOpacity style={[styles.row, disabled && { opacity: 0.45 }]} onPress={onPress} disabled={!onPress || disabled} activeOpacity={0.6}>
      <Ionicons name={icon} size={23} color={danger ? colors.danger : colors.textSecondary} />
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowLabel, { color: tint }]} numberOfLines={1}>
            {label}
          </Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? <Text style={[styles.rowSub, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, { color: colors.textMuted }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null)}
    </TouchableOpacity>
  );
};

export const SettingsSwitch: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}> = ({ icon, label, subtitle, value, onValueChange }) => {
  const colors = useThemeColors();
  return (
    <SettingsRow
      icon={icon}
      label={label}
      subtitle={subtitle}
      onPress={() => onValueChange(!value)}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: colors.borderStrong, true: colors.primaryLight }}
          thumbColor={value ? colors.primary : '#F4F4F5'}
        />
      }
    />
  );
};

export interface OptionItem<T> {
  value: T;
  title: string;
  subtitle?: string;
  badge?: string;
}

/** Bottom sheet with a single-choice list (used for filter, page size, quality, theme...). */
export function OptionSheet<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: OptionItem<T>[];
  value: T;
  onSelect: (v: T) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 12) }]} onPress={() => {}}>
          <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
          <ScrollView style={styles.sheetList}>
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.option, selected && { backgroundColor: colors.primaryLight }]}
                  onPress={() => {
                    onSelect(o.value);
                    onClose();
                  }}
                >
                  <View style={styles.rowText}>
                    <View style={styles.rowTitleLine}>
                      <Text style={[styles.optionTitle, { color: selected ? colors.primary : colors.text }]}>{o.title}</Text>
                      {o.badge ? (
                        <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
                          <Text style={[styles.badgeText, { color: colors.primary }]}>{o.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    {o.subtitle ? <Text style={[styles.rowSub, { color: colors.textSecondary }]}>{o.subtitle}</Text> : null}
                  </View>
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={selected ? colors.primary : colors.textMuted}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const settingsScreenStyles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
});

const styles = StyleSheet.create({
  group: { marginBottom: 18 },
  groupTitle: { fontSize: 13, fontWeight: '600', marginLeft: 6, marginBottom: 8 },
  groupFooter: { fontSize: 12, lineHeight: 17, marginTop: 6, marginHorizontal: 6 },
  card: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 15, minHeight: 56 },
  rowText: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 16, flexShrink: 1 },
  rowSub: { fontSize: 12.5, lineHeight: 17 },
  rowValue: { fontSize: 14, maxWidth: 140 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, paddingHorizontal: 8, maxHeight: '80%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  sheetTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 12, marginBottom: 8 },
  sheetList: { flexGrow: 0 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 10 },
  optionTitle: { fontSize: 15.5, fontWeight: '600' },
});
