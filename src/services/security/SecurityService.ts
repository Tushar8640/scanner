import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'scanner_user_pin';
const LOCK_ENABLED_KEY = 'scanner_lock_enabled';

export class SecurityService {
  static async isLockEnabled(): Promise<boolean> {
    const val = await SecureStore.getItemAsync(LOCK_ENABLED_KEY);
    return val === 'true';
  }

  static async setLockEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(LOCK_ENABLED_KEY, enabled ? 'true' : 'false');
  }

  static async hasPin(): Promise<boolean> {
    const pin = await SecureStore.getItemAsync(PIN_KEY);
    return !!pin && pin.length > 0;
  }

  static async setPin(pin: string): Promise<void> {
    await SecureStore.setItemAsync(PIN_KEY, pin);
  }

  static async verifyPin(enteredPin: string): Promise<boolean> {
    const storedPin = await SecureStore.getItemAsync(PIN_KEY);
    return storedPin === enteredPin;
  }

  static async authenticateWithBiometrics(prompt: string = 'ডকুমেন্ট স্ক্যানার আনলক করুন'): Promise<boolean> {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      fallbackLabel: 'পিন ব্যবহার করুন',
      disableDeviceFallback: false,
    });

    return result.success;
  }
}
