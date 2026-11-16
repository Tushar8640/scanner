import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { usePremiumStore } from '@/store/usePremiumStore';
import { PremiumService } from '@/services/monetization/PremiumService';
import { PREMIUM_FEATURES, PREMIUM_PLANS, PremiumFeature } from '@/core/config/monetization';
import type { TranslationKey } from '@/i18n';

const FEATURE_INFO: Record<PremiumFeature, { label: TranslationKey; icon: keyof typeof Ionicons.glyphMap }> = {
  no_ads: { label: 'premiumNoAds', icon: 'ban-outline' },
  ocr: { label: 'premiumOcr', icon: 'text-outline' },
  id_card: { label: 'premiumIdCard', icon: 'card-outline' },
  merge: { label: 'premiumMerge', icon: 'git-merge-outline' },
  pdf_high_quality: { label: 'premiumHq', icon: 'sparkles-outline' },
  watermark_remove: { label: 'premiumWatermark', icon: 'water-outline' },
  signature: { label: 'premiumSignature', icon: 'create-outline' },
  qr_scan: { label: 'premiumQr', icon: 'qr-code-outline' },
  unlimited_folders: { label: 'premiumFolders', icon: 'folder-open-outline' },
};

/** Premium (paywall) screen. Purchases stay unavailable until a billing provider is registered. */
export default function PremiumScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useSettingsStore();
  const isPremium = usePremiumStore((s) => s.isPremium);
  const params = useLocalSearchParams<{ feature?: PremiumFeature }>();
  const [planId, setPlanId] = useState(PREMIUM_PLANS.find((p) => p.highlight)?.id ?? PREMIUM_PLANS[0].id);
  const [busy, setBusy] = useState(false);

  const benefits = (Object.keys(PREMIUM_FEATURES) as PremiumFeature[]).filter((f) => PREMIUM_FEATURES[f]);

  const run = async (fn: () => Promise<boolean>) => {
    if (!PremiumService.isAvailable()) {
      Alert.alert(t('premiumTitle'), t('premiumComingSoon'));
      return;
    }
    try {
      setBusy(true);
      if (await fn()) {
        Alert.alert(t('success'), t('premiumActivated'));
        router.back();
      }
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Purchase failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120 }]}>
        <TouchableOpacity style={styles.close} onPress={() => router.back()} accessibilityLabel={t('cancel')}>
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>

        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <Ionicons name="diamond" size={44} color="#FFFFFF" />
          <Text style={styles.heroTitle}>{t('premiumTitle')}</Text>
          <Text style={styles.heroSub}>{isPremium ? t('premiumOwned') : t('premiumSubtitle')}</Text>
        </View>

        {params.feature && FEATURE_INFO[params.feature] && (
          <Text style={[styles.lockedHint, { color: colors.textSecondary }]}>
            {t('premiumLockedHint').replace('{feature}', t(FEATURE_INFO[params.feature].label))}
          </Text>
        )}

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {benefits.map((f) => (
            <View key={f} style={styles.benefit}>
              <Ionicons name={FEATURE_INFO[f].icon} size={22} color={colors.primary} />
              <Text style={[styles.benefitText, { color: colors.text }]}>{t(FEATURE_INFO[f].label)}</Text>
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            </View>
          ))}
        </View>

        {!isPremium &&
          PREMIUM_PLANS.map((p) => {
            const selected = p.id === planId;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.plan, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}
                onPress={() => setPlanId(p.id)}
              >
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textMuted} />
                <View style={styles.planInfo}>
                  <Text style={[styles.planTitle, { color: colors.text }]}>{p.title}</Text>
                  {p.highlight ? <Text style={[styles.planHighlight, { color: colors.primary }]}>{p.highlight}</Text> : null}
                </View>
                <Text style={[styles.planPrice, { color: colors.text }]}>{p.priceLabel}</Text>
              </TouchableOpacity>
            );
          })}
      </ScrollView>

      {!isPremium && (
        <View style={[styles.footer, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: colors.primary }]}
            disabled={busy}
            onPress={() => run(() => PremiumService.purchase(planId))}
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.ctaText}>{t('premiumContinue')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => run(() => PremiumService.restore())} disabled={busy}>
            <Text style={[styles.restore, { color: colors.textSecondary }]}>{t('premiumRestore')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  close: { alignSelf: 'flex-end', padding: 6 },
  hero: { borderRadius: 18, padding: 24, alignItems: 'center', gap: 8 },
  heroTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
  heroSub: { color: '#E6FFFA', fontSize: 14, textAlign: 'center' },
  lockedHint: { fontSize: 14, textAlign: 'center' },
  card: { borderRadius: 14, paddingVertical: 6 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  benefitText: { flex: 1, fontSize: 15 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 2 },
  planInfo: { flex: 1 },
  planTitle: { fontSize: 16, fontWeight: '700' },
  planHighlight: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  planPrice: { fontSize: 16, fontWeight: '700' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, gap: 10, alignItems: 'center' },
  cta: { alignSelf: 'stretch', height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  restore: { fontSize: 14, fontWeight: '600', paddingVertical: 4 },
});
