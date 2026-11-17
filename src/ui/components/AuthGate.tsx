import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '@/store/useSettingsStore';
import { SecurityService } from '@/services/security/SecurityService';
import { useThemeColors } from '@/core/theme/colors';

/** Time in the background before the app asks for the PIN again. */
const RELOCK_AFTER_MS = 3000;

export const AuthGate: React.FC = () => {
  const { app_lock_enabled, isAuthenticated, setIsAuthenticated, t } = useSettingsStore();
  const colors = useThemeColors();
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [biometricReady, setBiometricReady] = useState(false);
  // Neutral notice (e.g. fingerprint not set up); does not mark the PIN as wrong
  const [infoMsg, setInfoMsg] = useState('');
  const backgroundAtRef = useRef(0);

  // Lock again when the user comes back after leaving the app (Home, app switcher, screen off).
  // Our own camera, gallery and share trips are excluded (SecurityService.whileLeavingApp).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundAtRef.current = SecurityService.isLeavingApp() ? 0 : Date.now();
      } else if (state === 'active') {
        const since = backgroundAtRef.current;
        backgroundAtRef.current = 0;
        const s = useSettingsStore.getState();
        if (since && s.app_lock_enabled && s.isAuthenticated && Date.now() - since >= RELOCK_AFTER_MS) {
          setPin('');
          setErrorMsg('');
          s.setIsAuthenticated(false);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const attemptBiometrics = async (manual = false) => {
    try {
      const result = await SecurityService.authenticateWithBiometrics(t('unlockPrompt'));
      if (result === 'success') {
        setIsAuthenticated(true);
        setPin('');
        setErrorMsg('');
      } else if (result === 'unavailable' && manual) {
        setInfoMsg(t('biometricNotSetUp'));
      }
    } catch {
      // User can still enter PIN
    }
  };

  useEffect(() => {
    async function checkLockout() {
      const remaining = await SecurityService.getLockoutRemaining();
      if (remaining > 0) {
        setLockoutSeconds(remaining);
        setErrorMsg(`Too many attempts! Locked for ${remaining}s`);
      }
    }
    if (app_lock_enabled && !isAuthenticated) {
      checkLockout();
      SecurityService.isBiometricAvailable().then((ok) => {
        setBiometricReady(ok);
        if (ok) attemptBiometrics();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app_lock_enabled, isAuthenticated]);

  // Cooldown countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          setErrorMsg('');
          return 0;
        }
        setErrorMsg(`Too many attempts! Locked for ${prev - 1}s`);
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const handleKeyPress = (num: string) => {
    if (lockoutSeconds > 0) return;
    setInfoMsg('');
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        verify(newPin);
      }
    }
  };

  const handleDelete = () => {
    if (lockoutSeconds > 0) return;
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg('');
  };

  const verify = async (enteredPin: string) => {
    const result = await SecurityService.verifyPin(enteredPin);
    if (result.success) {
      setIsAuthenticated(true);
      setPin('');
      setErrorMsg('');
      setLockoutSeconds(0);
    } else if (result.lockedOut) {
      const sec = result.lockoutRemainingSeconds || 30;
      setLockoutSeconds(sec);
      setErrorMsg(`Too many attempts! Locked for ${sec}s`);
      setPin('');
    } else {
      const remaining = result.remainingAttempts !== undefined ? ` (${result.remainingAttempts} left)` : '';
      setErrorMsg(`Incorrect PIN! Please try again${remaining}`);
      setPin('');
    }
  };

  if (!app_lock_enabled || isAuthenticated) {
    return null;
  }

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={() => {}}>
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="lock-closed" size={36} color={colors.primary} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{t('appName')}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('enterPin')}</Text>
        </View>

        {/* PIN Indicators */}
        <View style={styles.dotsContainer}>
          {[0, 1, 2, 3].map((index) => (
            <View
              key={index}
              style={[
                styles.dot,
                { borderColor: colors.borderStrong },
                pin.length > index && { backgroundColor: colors.primary, borderColor: colors.primary },
                errorMsg ? { borderColor: colors.danger, backgroundColor: colors.danger } : null,
              ]}
            />
          ))}
        </View>

        {errorMsg ? (
          <Text style={[styles.errorText, { color: colors.danger }]}>{errorMsg}</Text>
        ) : infoMsg ? (
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{infoMsg}</Text>
        ) : null}

        {/* Keypad */}
        <View style={styles.keypad}>
          {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row, rIdx) => (
            <View key={rIdx} style={styles.keyRow}>
              {row.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[styles.key, { backgroundColor: colors.surfaceVariant }]}
                  disabled={lockoutSeconds > 0}
                  onPress={() => handleKeyPress(item)}
                >
                  <Text style={[styles.keyText, { color: colors.text }]}>{item}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          <View style={styles.keyRow}>
            <TouchableOpacity
              style={[styles.key, { backgroundColor: colors.surfaceVariant }]}
              disabled={lockoutSeconds > 0}
              onPress={() => attemptBiometrics(true)}
              accessibilityLabel={t('useBiometric')}
            >
              <Ionicons name="finger-print" size={28} color={biometricReady ? colors.primary : colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.key, { backgroundColor: colors.surfaceVariant }]}
              disabled={lockoutSeconds > 0}
              onPress={() => handleKeyPress('0')}
            >
              <Text style={[styles.keyText, { color: colors.text }]}>0</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.key, { backgroundColor: colors.surfaceVariant }]}
              disabled={lockoutSeconds > 0}
              onPress={handleDelete}
            >
              <Ionicons name="backspace-outline" size={26} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 50,
  },
  header: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginVertical: 20,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  keypad: {
    width: '80%',
    maxWidth: 320,
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    fontSize: 26,
    fontWeight: '600',
  },
});
