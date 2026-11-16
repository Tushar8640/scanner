import { useState } from 'react';
import { ScrollView, Modal, View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { SecurityService } from '@/services/security/SecurityService';
import { ActionButton } from '@/ui/components/ActionButton';
import { SettingsGroup, SettingsRow, SettingsSwitch, settingsScreenStyles } from '@/ui/components/settings/SettingsUI';

/** Security: app lock with a 4-digit PIN (fingerprint/face unlock is offered when the phone supports it). */
export default function SecuritySettingsScreen() {
  const colors = useThemeColors();
  const { t, app_lock_enabled, setAppLockEnabled } = useSettingsStore();
  const [pinModal, setPinModal] = useState<'set' | 'change' | null>(null);
  const [pin, setPin] = useState('');

  const toggleLock = async (value: boolean) => {
    if (!value) {
      await setAppLockEnabled(false);
      return;
    }
    // Turning the lock on needs a PIN first
    if (await SecurityService.hasPin()) await setAppLockEnabled(true);
    else {
      setPin('');
      setPinModal('set');
    }
  };

  const savePin = async () => {
    if (pin.length !== 4) {
      Alert.alert(t('warning'), t('enterPin'));
      return;
    }
    const changing = pinModal === 'change';
    await SecurityService.setPin(pin);
    await setAppLockEnabled(true);
    setPinModal(null);
    setPin('');
    Alert.alert(t('success'), changing ? t('pinUpdated') : t('lockEnabled'));
  };

  return (
    <ScrollView style={[settingsScreenStyles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={settingsScreenStyles.content}>
      <Stack.Screen options={{ title: t('security') }} />

      <SettingsGroup title={t('appLock')} footer={t('appLockFooter')}>
        <SettingsSwitch icon="lock-closed-outline" label={t('appLock')} subtitle={t('appLockDesc')} value={app_lock_enabled} onValueChange={toggleLock} />
        {app_lock_enabled && (
          <SettingsRow
            icon="key-outline"
            label={t('changePin')}
            onPress={() => {
              setPin('');
              setPinModal('change');
            }}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={t('privacy')}>
        <SettingsRow icon="phone-portrait-outline" label={t('offlineBadge')} subtitle={t('offlineBadgeDesc')} />
      </SettingsGroup>

      <Modal visible={pinModal !== null} transparent animationType="fade" onRequestClose={() => setPinModal(null)}>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="key" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{pinModal === 'change' ? t('changePin') : t('setPin')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('enterPin')}</Text>
            <View style={styles.boxes}>
              {[0, 1, 2, 3].map((i) => {
                const filled = pin.length > i;
                return (
                  <View
                    key={i}
                    style={[
                      styles.box,
                      { borderColor: filled ? colors.primary : colors.border, backgroundColor: filled ? colors.primaryLight : colors.surfaceVariant },
                    ]}
                  >
                    {filled && <View style={[styles.dot, { backgroundColor: colors.primary }]} />}
                  </View>
                );
              })}
            </View>
            {/* Invisible input drives the four boxes */}
            <TextInput
              style={styles.hiddenInput}
              value={pin}
              onChangeText={(v) => setPin(v.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              autoFocus
              secureTextEntry
            />
            <View style={styles.actions}>
              <ActionButton title={t('cancel')} variant="outline" onPress={() => setPinModal(null)} style={styles.flex1} />
              <ActionButton title={t('save')} disabled={pin.length !== 4} onPress={savePin} style={styles.flex1} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, borderRadius: 18, padding: 22, alignItems: 'center' },
  iconBox: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 4 },
  boxes: { flexDirection: 'row', gap: 12, marginVertical: 20 },
  box: { width: 48, height: 56, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7 },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  flex1: { flex: 1 },
});
