import { View, StyleSheet } from 'react-native';
import type { AdPlacement } from '@/core/config/monetization';
import { AdsService } from '@/services/monetization/AdsService';

interface AdBannerProps {
  placement: AdPlacement;
}

/**
 * Reserved banner slot. Renders nothing until ads are switched on and an ads SDK is registered.
 * When adding an SDK, render its banner view inside this component, keyed by `placement`.
 */
export const AdBanner: React.FC<AdBannerProps> = ({ placement }) => {
  if (!AdsService.shouldShowAds()) return null;
  return <View style={styles.slot} accessibilityLabel={`ad-${placement}`} />;
};

const styles = StyleSheet.create({
  slot: {
    height: 60,
    marginHorizontal: 16,
    marginVertical: 8,
  },
});
