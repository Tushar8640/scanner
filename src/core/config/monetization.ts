/**
 * Monetisation switches. Everything is free and ad-free while these are false.
 *
 * To launch Premium:
 *   1. Set PREMIUM_ENABLED = true and pick which features are premium in PREMIUM_FEATURES.
 *   2. Implement PurchaseProvider in src/services/monetization/PremiumService.ts
 *      (for example with a store billing SDK) and register it with PremiumService.setProvider().
 *
 * To launch ads:
 *   1. Set ADS_ENABLED = true.
 *   2. Implement AdProvider in src/services/monetization/AdsService.ts and register it.
 *   Ads SDKs send device data to third parties: add a consent prompt and update the privacy
 *   policy before enabling them.
 */

export const PREMIUM_ENABLED = false;
export const ADS_ENABLED = false;

/** Every feature that could be put behind Premium. */
export type PremiumFeature =
  | 'id_card'
  | 'merge'
  | 'signature'
  | 'watermark_remove'
  | 'ocr'
  | 'pdf_high_quality'
  | 'qr_scan'
  | 'unlimited_folders'
  | 'no_ads';

/** Which features need Premium once PREMIUM_ENABLED is true. Edit this list to change the plan. */
export const PREMIUM_FEATURES: Record<PremiumFeature, boolean> = {
  id_card: true,
  merge: true,
  signature: false,
  watermark_remove: true,
  ocr: true,
  pdf_high_quality: true,
  qr_scan: false,
  unlimited_folders: false,
  no_ads: true,
};

export interface PremiumPlan {
  id: string; // store product id
  title: string;
  priceLabel: string; // shown until the store returns a localised price
  period: 'month' | 'year' | 'lifetime';
  highlight?: string;
}

/** Placeholder plans shown on the Premium screen. Prices come from the store once billing is added. */
export const PREMIUM_PLANS: PremiumPlan[] = [
  { id: 'docscanner_premium_monthly', title: 'Monthly', priceLabel: '—', period: 'month' },
  { id: 'docscanner_premium_yearly', title: 'Yearly', priceLabel: '—', period: 'year', highlight: 'Best value' },
  { id: 'docscanner_premium_lifetime', title: 'Lifetime', priceLabel: '—', period: 'lifetime' },
];

/** Ad placements. Each screen asks for its own placement, so frequency and position can be tuned here. */
export type AdPlacement = 'home_banner' | 'files_banner' | 'after_save' | 'after_export';

/** Minimum time between two full-screen ads. */
export const INTERSTITIAL_MIN_INTERVAL_MS = 3 * 60 * 1000;
