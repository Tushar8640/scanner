import { useRef, useState } from 'react';
import { ScrollView, Modal, View, Text, TextInput, StyleSheet, Alert, Pressable } from 'react-native';
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
  // purpose: what happens when the flow finishes. step: which PIN is being typed.
  const [flow, setFlow] = useState<{ purpose: 'enable' | 'change' | 'disable'; step: 'current' | 'new' | 'confirm' } | null>(
    null
  );
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<any>(null);

  const focusInput = () => {
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const startFlow = (purpose: 'enable' | 'change' | 'disable', step: 'current' | 'new') => {
    setPin('');
    setFirstPin('');
    setError('');
    setFlow({ purpose, step });
  };

  const closeFlow = () => {
    setFlow(null);
    setPin('');
    setFirstPin('');
    setError('');
  };

  const toggleLock = async (value: boolean) => {
    if (!value) {
      // Turning the lock off needs the current PIN, so someone holding the open phone cannot disable it
      if (await SecurityService.hasPin()) startFlow('disable', 'current');
      else await setAppLockEnabled(false);
      return;
    }
    startFlow('enable', 'new');
  };

  const submit = async (value: string) => {
    if (!flow || value.length !== 4) return;
    if (flow.step === 'current') {
      const res = await SecurityService.verifyPin(value);
      if (!res.success) {
        setPin('');
        setError(res.lockedOut ? `${t('wrongPin')} (${res.lockoutRemainingSeconds}s)` : t('wrongPin'));
        return;
      }
      if (flow.purpose === 'disable') {
        await setAppLockEnabled(false);
        closeFlow();
        return;
      }
      setPin('');
      setError('');
      setFlow({ ...flow, step: 'new' });
      return;
    }
    if (flow.step === 'new') {
      setFirstPin(value);
      setPin('');
      setError('');
      setFlow({ ...flow, step: 'confirm' });
      return;
    }
    if (value !== firstPin) {
      setPin('');
      setFirstPin('');
      setError(t('pinMismatch'));
      setFlow({ ...flow, step: 'new' });
      return;
    }
    await SecurityService.setPin(value);
    await setAppLockEnabled(true);
    const changing = flow.purpose === 'change';
    closeFlow();
    Alert.alert(t('success'), changing ? t('pinUpdated') : t('lockEnabled'));
  };

  const onChangePin = (v: string) => {
    const clean = v.replace(/[^0-9]/g, '').slice(0, 4);
    setPin(clean);
    if (clean.length > 0) setError('');
    if (clean.length === 4) submit(clean);
  };

  const stepTitle =
    flow?.step === 'current' ? t('currentPin') : flow?.step === 'confirm' ? t('confirmPin') : t('enterPin');

  return (
    <ScrollView style={[settingsScreenStyles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={settingsScreenStyles.content}>
      <Stack.Screen options={{ title: t('security') }} />

      <SettingsGroup title={t('appLock')} footer={t('appLockFooter')}>
        <SettingsSwitch icon="lock-closed-outline" label={t('appLock')} subtitle={t('appLockDesc')} value={app_lock_enabled} onValueChange={toggleLock} />
        {app_lock_enabled && (
          <SettingsRow
            icon="key-outline"
            label={t('changePin')}
            onPress={() => startFlow('change', 'current')}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={t('privacy')}>
        <SettingsRow icon="phone-portrait-outline" label={t('offlineBadge')} subtitle={t('offlineBadgeDesc')} />
      </SettingsGroup>

      <Modal visible={flow !== null} transparent animationType="fade" onRequestClose={closeFlow} onShow={focusInput}>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="key" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{flow?.purpose === 'change' ? t('changePin') : flow?.purpose === 'disable' ? t('appLock') : t('setPin')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{stepTitle}</Text>
            {/* Tapping the boxes opens the number keyboard */}
            <Pressable style={styles.boxes} onPress={focusInput}>
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
            </Pressable>
            {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
            {/* Invisible input drives the four boxes */}
            <TextInput
              ref={inputRef}
              style={styles.hiddenInput}
              value={pin}
              onChangeText={onChangePin}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              caretHidden
            />
            <View style={styles.actions}>
              <ActionButton title={t('cancel')} variant="outline" onPress={closeFlow} style={styles.flex1} />
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
  error: { fontSize: 13, marginTop: -8, marginBottom: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  flex1: { flex: 1 },
});
