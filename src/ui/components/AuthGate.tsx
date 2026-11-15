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
import { lightColors } from '@/core/theme/colors';

export const AuthGate: React.FC = () => {
  const { app_lock_enabled, isAuthenticated, setIsAuthenticated, t } = useSettingsStore();
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

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

  const handleKeyPress = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        verify(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg('');
  };

  const verify = async (enteredPin: string) => {
    const isCorrect = await SecurityService.verifyPin(enteredPin);
    if (isCorrect) {
      setIsAuthenticated(true);
      setPin('');
      setErrorMsg('');
    } else {
      setErrorMsg('Incorrect PIN! Please try again');
      setPin('');
    }
  };

  if (!app_lock_enabled || isAuthenticated) {
    return null;
  }

  return (
    <Modal visible animationType="fade" transparent={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name="lock-closed" size={36} color={lightColors.primary} />
          </View>
          <Text style={styles.title}>{t('appName')}</Text>
          <Text style={styles.subtitle}>{t('enterPin')}</Text>
        </View>

        {/* PIN Indicators */}
        <View style={styles.dotsContainer}>
          {[0, 1, 2, 3].map((index) => (
            <View
              key={index}
              style={[
                styles.dot,
                pin.length > index && styles.filledDot,
                errorMsg ? styles.errorDot : null,
              ]}
            />
          ))}
        </View>

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        {/* Keypad */}
        <View style={styles.keypad}>
          {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row, rIdx) => (
            <View key={rIdx} style={styles.keyRow}>
              {row.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={styles.key}
                  onPress={() => handleKeyPress(item)}
                >
                  <Text style={styles.keyText}>{item}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          <View style={styles.keyRow}>
            <TouchableOpacity style={styles.key} onPress={attemptBiometrics}>
              <Ionicons name="finger-print" size={28} color={lightColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.key} onPress={() => handleKeyPress('0')}>
              <Text style={styles.keyText}>0</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.key} onPress={handleDelete}>
              <Ionicons name="backspace-outline" size={26} color={lightColors.text} />
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
    backgroundColor: '#FFFFFF',
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
    backgroundColor: lightColors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: lightColors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: lightColors.textSecondary,
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
    borderColor: lightColors.borderStrong,
  },
  filledDot: {
    backgroundColor: lightColors.primary,
    borderColor: lightColors.primary,
  },
  errorDot: {
    borderColor: lightColors.danger,
    backgroundColor: lightColors.danger,
  },
  errorText: {
    color: lightColors.danger,
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
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    fontSize: 26,
    fontWeight: '600',
    color: lightColors.text,
  },
});
