import { create } from 'zustand';
import { DatabaseService } from '@/services/database/DatabaseService';

interface PremiumState {
  /**
   * Cached entitlement so the app works offline. The store purchase (once billing exists)
   * is the source of truth and refreshes this via PremiumService.restore().
   */
  isPremium: boolean;
  setPremium: (value: boolean) => Promise<void>;
  initPremium: () => Promise<void>;
}

export const usePremiumStore = create<PremiumState>((set) => ({
  isPremium: false,
  setPremium: async (isPremium) => {
    set({ isPremium });
    await DatabaseService.setSetting('is_premium', isPremium ? 'true' : 'false');
  },
  initPremium: async () => {
    try {
      const v = await DatabaseService.getSetting('is_premium');
      set({ isPremium: v === 'true' });
    } catch (e) {
      console.warn('Failed to load premium state:', e);
    }
  },
}));
