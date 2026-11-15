import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'scanner_user_pin'; // legacy key for migration
const PIN_HASH_KEY = 'scanner_user_pin_hash';
const PIN_SALT_KEY = 'scanner_user_pin_salt';
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

async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${pin}:${salt}`);

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    try {
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to JS hashing fallback if subtle crypto fails
    }
  }

  // Pure JS 64-bit deterministic hash fallback
  let h1 = 0xdeadbeef ^ data.length;
  let h2 = 0x41c64e6d ^ data.length;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export class SecurityService {
  static async isLockEnabled(): Promise<boolean> {
    const val = await SecureStore.getItemAsync(LOCK_ENABLED_KEY);
    return val === 'true';
  }

  static async setLockEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(LOCK_ENABLED_KEY, enabled ? 'true' : 'false');
  }

  static async hasPin(): Promise<boolean> {
    const hash = await SecureStore.getItemAsync(PIN_HASH_KEY);
    if (hash && hash.length > 0) return true;
    const legacyPin = await SecureStore.getItemAsync(PIN_KEY);
    return !!legacyPin && legacyPin.length > 0;
  }

  static async setPin(pin: string): Promise<void> {
    const salt = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const hash = await hashPinWithSalt(pin, salt);
    await SecureStore.setItemAsync(PIN_SALT_KEY, salt);
    await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
    await SecureStore.deleteItemAsync(PIN_KEY);
    await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
    await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
  }

  static async verifyPin(enteredPin: string): Promise<VerifyPinResult> {
    const now = Date.now();

    // Check if cooldown lockout is currently active
    const lockoutStr = await SecureStore.getItemAsync(LOCKOUT_UNTIL_KEY);
    const lockoutUntil = lockoutStr ? parseInt(lockoutStr, 10) : 0;
    if (lockoutUntil > now) {
      const remaining = Math.ceil((lockoutUntil - now) / 1000);
      return {
        success: false,
        lockedOut: true,
        lockoutRemainingSeconds: remaining,
      };
    }

    let storedHash = await SecureStore.getItemAsync(PIN_HASH_KEY);
    let salt = await SecureStore.getItemAsync(PIN_SALT_KEY);

    // Check legacy plain PIN migration
    if (!storedHash) {
      const legacyPin = await SecureStore.getItemAsync(PIN_KEY);
      if (legacyPin) {
        salt = Math.random().toString(36).substring(2) + Date.now().toString(36);
        storedHash = await hashPinWithSalt(legacyPin, salt);
        await SecureStore.setItemAsync(PIN_SALT_KEY, salt);
        await SecureStore.setItemAsync(PIN_HASH_KEY, storedHash);
        await SecureStore.deleteItemAsync(PIN_KEY);
      }
    }

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
