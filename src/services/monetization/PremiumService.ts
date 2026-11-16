import { router } from 'expo-router';
import { PREMIUM_ENABLED, PREMIUM_FEATURES, PremiumFeature } from '@/core/config/monetization';
import { usePremiumStore } from '@/store/usePremiumStore';

/** What a billing integration must provide. Nothing is registered yet, so purchases are unavailable. */
export interface PurchaseProvider {
  /** Starts the store purchase flow; resolves true when the user now owns Premium. */
  purchase(productId: string): Promise<boolean>;
  /** Re-checks the user's purchases with the store; resolves true when Premium is owned. */
  restore(): Promise<boolean>;
}

let provider: PurchaseProvider | null = null;

export const PremiumService = {
  setProvider(p: PurchaseProvider | null) {
    provider = p;
  },

  isAvailable(): boolean {
    return PREMIUM_ENABLED && provider !== null;
  },

  /** True when the user may use this feature right now. Always true while Premium is switched off. */
  canUse(feature: PremiumFeature): boolean {
    if (!PREMIUM_ENABLED) return true;
    if (!PREMIUM_FEATURES[feature]) return true;
    return usePremiumStore.getState().isPremium;
  },

  /**
   * Use at the entry point of a premium feature:
   *   if (!PremiumService.require('merge')) return;
   * Opens the Premium screen and returns false when the feature is locked.
   */
  require(feature: PremiumFeature): boolean {
    if (this.canUse(feature)) return true;
    router.push({ pathname: '/premium', params: { feature } });
    return false;
  },

  async purchase(productId: string): Promise<boolean> {
    if (!provider) throw new Error('Purchases are not available yet');
    const owned = await provider.purchase(productId);
    if (owned) await usePremiumStore.getState().setPremium(true);
    return owned;
  },

  async restore(): Promise<boolean> {
    if (!provider) throw new Error('Purchases are not available yet');
    const owned = await provider.restore();
    await usePremiumStore.getState().setPremium(owned);
    return owned;
  },
};
