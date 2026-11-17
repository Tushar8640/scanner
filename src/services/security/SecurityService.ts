import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const PIN_KEY = 'scanner_user_pin'; // legacy key
const PIN_HASH_KEY = 'scanner_user_pin_hash';
const PIN_SALT_KEY = 'scanner_user_pin_salt';
const PIN_VERSION_KEY = 'scanner_pin_version';
const LOCK_ENABLED_KEY = 'scanner_lock_enabled';
const LOCKOUT_UNTIL_KEY = 'scanner_pin_lockout_until';
const FAILED_ATTEMPTS_KEY = 'scanner_pin_failed_attempts';

const MAX_FAILED_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;

export interface VerifyPinResult {
  success: boolean;
  lockedOut?: boolean;
  lockoutRemainingSeconds?: number;
  remainingAttempts?: number;
}

async function generateSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}:${salt}`,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
}

export type BiometricResult = 'success' | 'unavailable' | 'failed';

// Counts our own trips out of the app (camera, gallery, share sheet, biometric prompt),
// so coming back from them does not lock the app again.
let leavingDepth = 0;

export class SecurityService {
  /** Runs fn while the app is expected to go to the background without needing a re-lock. */
  static async whileLeavingApp<T>(fn: () => Promise<T>): Promise<T> {
    leavingDepth++;
    try {
      return await fn();
    } finally {
      // The 'active' event can arrive just after fn resolves
      setTimeout(() => {
        leavingDepth = Math.max(0, leavingDepth - 1);
      }, 1500);
    }
  }

  static isLeavingApp(): boolean {
    return leavingDepth > 0;
  }

  static async isBiometricAvailable(): Promise<boolean> {
    try {
      return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    } catch {
      return false;
    }
  }

  static async isLockEnabled(): Promise<boolean> {
    const val = await SecureStore.getItemAsync(LOCK_ENABLED_KEY);
    return val === 'true';
  }

  static async setLockEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(LOCK_ENABLED_KEY, enabled ? 'true' : 'false');
  }

  static async hasPin(): Promise<boolean> {
    const version = await SecureStore.getItemAsync(PIN_VERSION_KEY);
    if (version !== '2') {
      // Clear legacy/unversioned test PINs (Option B)
      await SecureStore.deleteItemAsync(PIN_KEY);
      await SecureStore.deleteItemAsync(PIN_HASH_KEY);
      await SecureStore.deleteItemAsync(PIN_SALT_KEY);
      return false;
    }
    const hash = await SecureStore.getItemAsync(PIN_HASH_KEY);
    return !!hash && hash.length > 0;
  }

  static async setPin(pin: string): Promise<void> {
    const salt = await generateSalt();
    const hash = await hashPinWithSalt(pin, salt);
    await SecureStore.setItemAsync(PIN_SALT_KEY, salt);
    await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
    await SecureStore.setItemAsync(PIN_VERSION_KEY, '2');
    await SecureStore.deleteItemAsync(PIN_KEY);
    await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
    await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
  }

  static async getLockoutRemaining(): Promise<number> {
    const lockoutStr = await SecureStore.getItemAsync(LOCKOUT_UNTIL_KEY);
    const lockoutUntil = lockoutStr ? parseInt(lockoutStr, 10) : 0;
    const now = Date.now();
    if (lockoutUntil > now) {
      return Math.ceil((lockoutUntil - now) / 1000);
    }
    return 0;
  }

  static async verifyPin(enteredPin: string): Promise<VerifyPinResult> {
    const now = Date.now();

    // Check if cooldown lockout is currently active
    const lockoutRemaining = await this.getLockoutRemaining();
    if (lockoutRemaining > 0) {
      return {
        success: false,
        lockedOut: true,
        lockoutRemainingSeconds: lockoutRemaining,
      };
    }

    const version = await SecureStore.getItemAsync(PIN_VERSION_KEY);
    if (version !== '2') {
      // Clear legacy/unversioned test keys (Option B)
      await SecureStore.deleteItemAsync(PIN_KEY);
      await SecureStore.deleteItemAsync(PIN_HASH_KEY);
      await SecureStore.deleteItemAsync(PIN_SALT_KEY);
      return { success: false };
    }

    const storedHash = await SecureStore.getItemAsync(PIN_HASH_KEY);
    const salt = await SecureStore.getItemAsync(PIN_SALT_KEY);

    if (!storedHash || !salt) {
      return { success: false };
    }

    const inputHash = await hashPinWithSalt(enteredPin, salt);
    if (inputHash === storedHash) {
      // Successful authentication: clear failure count
      await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
      await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
      return { success: true };
    }

    // Failed attempt
    const attemptsStr = await SecureStore.getItemAsync(FAILED_ATTEMPTS_KEY);
    const attempts = (attemptsStr ? parseInt(attemptsStr, 10) : 0) + 1;

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockUntilTime = now + COOLDOWN_SECONDS * 1000;
      await SecureStore.setItemAsync(LOCKOUT_UNTIL_KEY, String(lockUntilTime));
      await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
      return {
        success: false,
        lockedOut: true,
        lockoutRemainingSeconds: COOLDOWN_SECONDS,
      };
    }

    await SecureStore.setItemAsync(FAILED_ATTEMPTS_KEY, String(attempts));
    return {
      success: false,
      lockedOut: false,
      remainingAttempts: MAX_FAILED_ATTEMPTS - attempts,
    };
  }

  static async authenticateWithBiometrics(prompt: string = 'Unlock Doc Scanner'): Promise<BiometricResult> {
    if (!(await this.isBiometricAvailable())) return 'unavailable';
    const result = await this.whileLeavingApp(() =>
      LocalAuthentication.authenticateAsync({
        promptMessage: prompt,
        cancelLabel: 'Use PIN',
        // The app's own PIN is the fallback, not the phone's screen lock
        disableDeviceFallback: true,
      })
    );
    return result.success ? 'success' : 'failed';
  }
}
