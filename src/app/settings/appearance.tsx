import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { AppTheme } from '@/core/types';
import { SettingsGroup, SettingsRow, settingsScreenStyles } from '@/ui/components/settings/SettingsUI';

/** Appearance: light, dark or follow the phone. */
export default function AppearanceSettingsScreen() {
  const colors = useThemeColors();
  const { t, theme, setTheme } = useSettingsStore();

  const options: { value: AppTheme; label: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'system', label: t('themeSystem'), subtitle: t('themeSystemDesc'), icon: 'phone-portrait-outline' },
    { value: 'light', label: t('themeLight'), subtitle: t('themeLightDesc'), icon: 'sunny-outline' },
    { value: 'dark', label: t('themeDark'), subtitle: t('themeDarkDesc'), icon: 'moon-outline' },
  ];

  return (
    <ScrollView style={[settingsScreenStyles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={settingsScreenStyles.content}>
      <Stack.Screen options={{ title: t('appearance') }} />
      <SettingsGroup title={t('theme')}>
        {options.map((o) => (
          <SettingsRow
            key={o.value}
            icon={o.icon}
            label={o.label}
            subtitle={o.subtitle}
            onPress={() => setTheme(o.value)}
            right={
              <Ionicons
                name={theme === o.value ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={theme === o.value ? colors.primary : colors.textMuted}
              />
            }
          />
        ))}
      </SettingsGroup>
    </ScrollView>
  );
}
