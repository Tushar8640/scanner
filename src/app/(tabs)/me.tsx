import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { TranslationKey } from '@/i18n';

interface Row {
  key: string;
  label: TranslationKey;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  value?: string;
}

export default function MeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { t, language, theme, app_lock_enabled } = useSettingsStore();

  const openSettings = () => router.push('/settings');

  const shortcuts: { key: string; label: TranslationKey; icon: keyof typeof Ionicons.glyphMap; tint: string; onPress: () => void }[] = [
    { key: 'files', label: 'files', icon: 'document-text', tint: '#3B82F6', onPress: () => router.navigate('/files') },
    { key: 'trash', label: 'trash', icon: 'trash', tint: '#EF4444', onPress: () => router.push('/trash') },
    { key: 'lock', label: 'appLockShort', icon: 'lock-closed', tint: '#F59E0B', onPress: openSettings },
  ];

  const rows: Row[] = [
    { key: 'lang', label: 'language', icon: 'language-outline', onPress: openSettings, value: language === 'bn' ? 'বাংলা' : 'English' },
    {
      key: 'theme',
      label: 'theme',
      icon: 'contrast-outline',
      onPress: openSettings,
      value: theme === 'dark' ? t('themeDark') : theme === 'light' ? t('themeLight') : t('themeSystem'),
    },
    { key: 'security', label: 'security', icon: 'shield-checkmark-outline', onPress: openSettings, value: app_lock_enabled ? 'ON' : 'OFF' },
    { key: 'scan', label: 'defaultSettings', icon: 'scan-outline', onPress: openSettings },
    { key: 'manage', label: 'manageDocuments', icon: 'document-text-outline', onPress: () => router.navigate('/files') },
    { key: 'more', label: 'moreSettings', icon: 'settings-outline', onPress: openSettings },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
    >
      {/* App card (no account or upsell: the app is free and fully offline) */}
      <View style={[styles.appCard, { backgroundColor: colors.surface }]}>
        <View style={[styles.appIcon, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="scan" size={30} color={colors.primary} />
        </View>
        <View style={styles.appInfo}>
          <Text style={[styles.appName, { color: colors.text }]}>{t('appName')}</Text>
          <Text style={[styles.appSub, { color: colors.textSecondary }]}>{t('freeAndNoWatermark')}</Text>
        </View>
      </View>

      <View style={[styles.shortcuts, { backgroundColor: colors.surface }]}>
        {shortcuts.map((s) => (
          <TouchableOpacity key={s.key} style={styles.shortcut} onPress={s.onPress}>
            <Ionicons name={s.icon} size={30} color={s.tint} />
            <Text style={[styles.shortcutLabel, { color: colors.text }]}>{t(s.label)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.list, { backgroundColor: colors.surface }]}>
        {rows.map((r) => (
          <TouchableOpacity key={r.key} style={styles.row} onPress={r.onPress}>
            <Ionicons name={r.icon} size={24} color={colors.text} />
            <Text style={[styles.rowLabel, { color: colors.text }]}>{t(r.label)}</Text>
            {r.value ? <Text style={[styles.rowValue, { color: colors.textMuted }]}>{r.value}</Text> : null}
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.list, { backgroundColor: colors.surface }]}>
        <View style={styles.row}>
          <Ionicons name="lock-closed-outline" size={24} color={colors.success} />
          <Text style={[styles.privacy, { color: colors.textSecondary }]}>{t('privacyNote')}</Text>
        </View>
        <View style={styles.row}>
          <Ionicons name="information-circle-outline" size={24} color={colors.text} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('about')}</Text>
          <Text style={[styles.rowValue, { color: colors.textMuted }]}>{t('version')}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 14,
  },
  appCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 14,
  },
  appIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appInfo: {
    flex: 1,
    gap: 4,
  },
  appName: {
    fontSize: 20,
    fontWeight: '700',
  },
  appSub: {
    fontSize: 13,
  },
  shortcuts: {
    flexDirection: 'row',
    borderRadius: 14,
    paddingVertical: 20,
  },
  shortcut: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  shortcutLabel: {
    fontSize: 14,
  },
  list: {
    borderRadius: 14,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rowLabel: {
    flex: 1,
    fontSize: 17,
  },
  rowValue: {
    fontSize: 14,
  },
  privacy: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
});
