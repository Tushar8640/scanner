import { ADS_ENABLED, AdPlacement, INTERSTITIAL_MIN_INTERVAL_MS, PREMIUM_ENABLED } from '@/core/config/monetization';
import { usePremiumStore } from '@/store/usePremiumStore';

/** What an ads integration must provide. Nothing is registered yet, so no ads are shown. */
export interface AdProvider {
  /** Shows a full-screen ad if one is loaded; resolves when it is closed (or immediately if none). */
  showInterstitial(placement: AdPlacement): Promise<void>;
}

let provider: AdProvider | null = null;
let lastInterstitialAt = 0;

export const AdsService = {
  setProvider(p: AdProvider | null) {
    provider = p;
  },

  /** Ads show only when switched on, an SDK is registered, and the user does not own Premium. */
  shouldShowAds(): boolean {
    if (!ADS_ENABLED || !provider) return false;
    const premiumOwned = PREMIUM_ENABLED && usePremiumStore.getState().isPremium;
    return !premiumOwned;
  },

  /** Call after natural breaks (document saved, PDF exported). Rate-limited; never throws. */
  async maybeShowInterstitial(placement: AdPlacement): Promise<void> {
    if (!this.shouldShowAds() || !provider) return;
    const now = Date.now();
    if (now - lastInterstitialAt < INTERSTITIAL_MIN_INTERVAL_MS) return;
    lastInterstitialAt = now;
    try {
      await provider.showInterstitial(placement);
    } catch (e) {
      console.warn('Interstitial failed:', e);
    }
  },
};
