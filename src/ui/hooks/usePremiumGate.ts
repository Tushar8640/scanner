import { useEffect } from 'react';
import { router } from 'expo-router';
import type { PremiumFeature } from '@/core/config/monetization';
import { PremiumService } from '@/services/monetization/PremiumService';

/**
 * Put at the top of a screen that is a premium feature. When the feature is locked,
 * the screen is replaced by the Premium screen. Does nothing while Premium is switched off.
 */
export function usePremiumGate(feature: PremiumFeature) {
  useEffect(() => {
    if (!PremiumService.canUse(feature)) {
      router.replace({ pathname: '/premium', params: { feature } });
    }
  }, [feature]);
}
