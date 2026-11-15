import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '@/store/useSettingsStore';
import { SecurityService } from '@/services/security/SecurityService';
import { useThemeColors } from '@/core/theme/colors';

export const AuthGate: React.FC = () => {
  const { app_lock_enabled, isAuthenticated, setIsAuthenticated, t } = useSettingsStore();
  const colors = useThemeColors();
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  const attemptBiometrics = async () => {
    try {
      const success = await SecurityService.authenticateWithBiometrics();
      if (success) {
        setIsAuthenticated(true);
      }
    } catch {
      // User can still enter PIN
    }
  };

  useEffect(() => {
    if (app_lock_enabled && !isAuthenticated) {
      attemptBiometrics();
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
    <Modal visible animationType="fade" transparent={false}>
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
              onPress={attemptBiometrics}
            >
              <Ionicons name="finger-print" size={28} color={colors.primary} />
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
