import { ScrollView } from 'react-native';
import { Stack, router } from 'expo-router';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { usePremiumStore } from '@/store/usePremiumStore';
import { PREMIUM_ENABLED } from '@/core/config/monetization';
import { SettingsGroup, SettingsRow, settingsScreenStyles } from '@/ui/components/settings/SettingsUI';

/** "More Settings": every settings category in one list. */
export default function SettingsScreen() {
  const colors = useThemeColors();
  const { t, theme, app_lock_enabled, auto_crop } = useSettingsStore();
  const isPremium = usePremiumStore((s) => s.isPremium);

  const themeLabel = theme === 'dark' ? t('themeDark') : theme === 'light' ? t('themeLight') : t('themeSystem');

  return (
    <ScrollView style={[settingsScreenStyles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={settingsScreenStyles.content}>
      <Stack.Screen options={{ title: t('settings') }} />

      {PREMIUM_ENABLED && (
        <SettingsGroup>
          <SettingsRow
            icon="diamond-outline"
            label={t('premiumTitle')}
            value={isPremium ? t('premiumActiveShort') : undefined}
            onPress={() => router.push('/premium')}
          />
        </SettingsGroup>
      )}

      <SettingsGroup title={t('settingsGeneral')}>
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
      </SettingsGroup>

      <SettingsGroup title={t('about')}>
        <SettingsRow icon="information-circle-outline" label={t('aboutApp')} onPress={() => router.push('/settings/about')} />
      </SettingsGroup>
    </ScrollView>
  );
}
