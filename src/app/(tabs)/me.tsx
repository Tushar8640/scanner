import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { usePremiumStore } from '@/store/usePremiumStore';
import { PREMIUM_ENABLED } from '@/core/config/monetization';
import { SettingsGroup, SettingsRow } from '@/ui/components/settings/SettingsUI';
import type { TranslationKey } from '@/i18n';

export default function MeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { t, theme, app_lock_enabled, auto_crop } = useSettingsStore();
  const isPremium = usePremiumStore((s) => s.isPremium);

  const themeLabel = theme === 'dark' ? t('themeDark') : theme === 'light' ? t('themeLight') : t('themeSystem');

  const shortcuts: { key: string; label: TranslationKey; icon: keyof typeof Ionicons.glyphMap; tint: string; onPress: () => void }[] = [
    { key: 'files', label: 'files', icon: 'document-text', tint: '#3B82F6', onPress: () => router.navigate('/files') },
    { key: 'trash', label: 'trash', icon: 'trash', tint: '#EF4444', onPress: () => router.push('/trash') },
    { key: 'lock', label: 'appLockShort', icon: 'lock-closed', tint: '#F59E0B', onPress: () => router.push('/settings/security') },
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      {/* Top card: upgrade offer when Premium is switched on, otherwise the free app card */}
      {PREMIUM_ENABLED && !isPremium ? (
        <TouchableOpacity style={[styles.premiumCard, { backgroundColor: colors.primary }]} onPress={() => router.push('/premium')}>
          <View style={styles.premiumText}>
            <Text style={styles.premiumTitle}>{t('premiumUpgradeTitle')}</Text>
            <Text style={styles.premiumSub}>{t('premiumUpgradeSub')}</Text>
          </View>
          <View style={styles.premiumBtn}>
            <Text style={[styles.premiumBtnText, { color: colors.primary }]}>{t('premiumUpgradeCta')}</Text>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={[styles.appCard, { backgroundColor: colors.surface }]}>
          <View style={[styles.appIcon, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name={isPremium ? 'diamond' : 'scan'} size={30} color={colors.primary} />
          </View>
          <View style={styles.appInfo}>
            <Text style={[styles.appName, { color: colors.text }]}>{t('appName')}</Text>
            <Text style={[styles.appSub, { color: colors.textSecondary }]}>
              {isPremium ? t('premiumActiveShort') : t('freeAndNoWatermark')}
            </Text>
          </View>
        </View>
      )}

      <View style={[styles.shortcuts, { backgroundColor: colors.surface }]}>
        {shortcuts.map((s) => (
          <TouchableOpacity key={s.key} style={styles.shortcut} onPress={s.onPress}>
            <Ionicons name={s.icon} size={30} color={s.tint} />
            <Text style={[styles.shortcutLabel, { color: colors.text }]}>{t(s.label)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <SettingsGroup>
        <SettingsRow
          icon="scan-outline"
          label={t('scanSettings')}
          value={auto_crop ? t('autoCropOnShort') : undefined}
          onPress={() => router.push('/settings/scan')}
        />
        <SettingsRow icon="document-text-outline" label={t('documentSettings')} onPress={() => router.push('/settings/documents')} />
        <SettingsRow
          icon="shield-checkmark-outline"
          label={t('security')}
          value={app_lock_enabled ? t('on') : t('off')}
          onPress={() => router.push('/settings/security')}
        />
        <SettingsRow icon="contrast-outline" label={t('appearance')} value={themeLabel} onPress={() => router.push('/settings/appearance')} />
        <SettingsRow icon="server-outline" label={t('storageAndData')} onPress={() => router.push('/settings/storage')} />
        <SettingsRow icon="settings-outline" label={t('moreSettings')} onPress={() => router.push('/settings')} />
      </SettingsGroup>

      <SettingsGroup>
        {PREMIUM_ENABLED && <SettingsRow icon="diamond-outline" label={t('premiumTitle')} onPress={() => router.push('/premium')} />}
        <SettingsRow icon="information-circle-outline" label={t('aboutApp')} onPress={() => router.push('/settings/about')} />
      </SettingsGroup>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 14 },
  premiumCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 18, gap: 12 },
  premiumText: { flex: 1, gap: 4 },
  premiumTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  premiumSub: { color: '#E6FFFA', fontSize: 13 },
  premiumBtn: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9 },
  premiumBtnText: { fontSize: 14, fontWeight: '800' },
  appCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 14 },
  appIcon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  appInfo: { flex: 1, gap: 4 },
  appName: { fontSize: 20, fontWeight: '700' },
  appSub: { fontSize: 13 },
  shortcuts: { flexDirection: 'row', borderRadius: 14, paddingVertical: 20 },
  shortcut: { flex: 1, alignItems: 'center', gap: 8 },
  shortcutLabel: { fontSize: 14 },
});
