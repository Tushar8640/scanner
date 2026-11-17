import { ScrollView, View, Text, Image, StyleSheet, Linking, Alert } from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { SettingsGroup, SettingsRow, settingsScreenStyles } from '@/ui/components/settings/SettingsUI';

const APP_ICON = require('../../../assets/icon.png');

/** About: app name, version, developer, and privacy information. */
export default function AboutScreen() {
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const handleEmailPress = async () => {
    const email = t('developerEmail');
    const mailtoUrl = `mailto:${email}`;
    try {
      const supported = await Linking.canOpenURL(mailtoUrl);
      if (supported) {
        await Linking.openURL(mailtoUrl);
      } else {
        await Clipboard.setStringAsync(email);
        Alert.alert(t('emailCopied'), email);
      }
    } catch {
      await Clipboard.setStringAsync(email);
      Alert.alert(t('emailCopied'), email);
    }
  };

  const handleGithubPress = () => {
    Linking.openURL(t('developerGithubUrl')).catch(console.warn);
  };

  return (
    <ScrollView style={[settingsScreenStyles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={settingsScreenStyles.content}>
      <Stack.Screen options={{ title: t('aboutApp') }} />
      <View style={styles.hero}>
        <Image source={APP_ICON} style={styles.icon} />
        <Text style={[styles.name, { color: colors.text }]}>{t('appName')}</Text>
        <Text style={[styles.version, { color: colors.textSecondary }]}>{t('versionLabel').replace('{v}', version)}</Text>
      </View>

      <SettingsGroup>
        <SettingsRow icon="shield-checkmark-outline" label={t('offlineBadge')} subtitle={t('offlineBadgeDesc')} />
        <SettingsRow icon="lock-closed-outline" label={t('privacy')} subtitle={t('privacyNote')} />
        <SettingsRow icon="ribbon-outline" label={t('freeAndNoWatermark')} />
      </SettingsGroup>

      <SettingsGroup title={t('developer')}>
        <SettingsRow
          icon="person-outline"
          label={t('developerName')}
          subtitle={t('developerRole')}
        />
        <SettingsRow
          icon="logo-github"
          label={t('developerGithub')}
          subtitle={t('github')}
          onPress={handleGithubPress}
        />
        <SettingsRow
          icon="mail-outline"
          label={t('developerEmail')}
          subtitle={t('email')}
          onPress={handleEmailPress}
        />
      </SettingsGroup>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  icon: { width: 88, height: 88, borderRadius: 22, marginBottom: 8 },
  name: { fontSize: 22, fontWeight: '800' },
  version: { fontSize: 14 },
});
