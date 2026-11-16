import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { PageFilter } from '@/core/types';
import { FILTER_ORDER } from '@/services/image/FilterUtils';
import { OptionItem, OptionSheet, SettingsGroup, SettingsRow, SettingsSwitch, settingsScreenStyles } from '@/ui/components/settings/SettingsUI';

/** Scan settings: automatic edge detection, crop review, default filter, gallery saving. */
export default function ScanSettingsScreen() {
  const colors = useThemeColors();
  const {
    t,
    auto_crop,
    crop_review,
    default_filter,
    auto_save_to_gallery,
    setAutoCrop,
    setCropReview,
    setDefaultFilter,
    setAutoSaveToGallery,
  } = useSettingsStore();
  const [filterSheet, setFilterSheet] = useState(false);

  const filterInfo: Record<PageFilter, { title: string; subtitle: string; badge?: string }> = {
    original: { title: t('filterOriginal'), subtitle: t('filterOriginalDesc') },
    lighten: { title: t('filterLighten'), subtitle: t('filterLightenDesc') },
    magic: { title: t('filterMagic'), subtitle: t('filterMagicDesc'), badge: t('recommended') },
    enhanced: { title: t('filterEnhanced'), subtitle: t('filterEnhancedDesc') },
    noshadow: { title: t('filterNoShadow'), subtitle: t('filterNoShadowDesc') },
    bw: { title: t('filterBw'), subtitle: t('filterBwDesc') },
    grayscale: { title: t('filterGrayscale'), subtitle: t('filterGrayscaleDesc') },
  };
  const filterOptions: OptionItem<PageFilter>[] = FILTER_ORDER.map((f) => ({ value: f, ...filterInfo[f] }));

  return (
    <ScrollView style={[settingsScreenStyles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={settingsScreenStyles.content}>
      <Stack.Screen options={{ title: t('scanSettings') }} />

      <SettingsGroup title={t('autoProcessing')} footer={t('autoProcessingFooter')}>
        <SettingsSwitch icon="scan-outline" label={t('autoCrop')} subtitle={t('autoCropDesc')} value={auto_crop} onValueChange={setAutoCrop} />
        <SettingsSwitch
          icon="crop-outline"
          label={t('cropReview')}
          subtitle={t('cropReviewDesc')}
          value={crop_review}
          onValueChange={setCropReview}
        />
      </SettingsGroup>

      <SettingsGroup title={t('filter')}>
        <SettingsRow
          icon="color-wand-outline"
          label={t('defaultFilter')}
          subtitle={t('defaultFilterDesc')}
          value={filterInfo[default_filter]?.title}
          onPress={() => setFilterSheet(true)}
        />
      </SettingsGroup>

      <SettingsGroup title={t('afterSaving')}>
        <SettingsSwitch
          icon="images-outline"
          label={t('autoSaveGallery')}
          subtitle={t('autoSaveGalleryDesc')}
          value={auto_save_to_gallery}
          onValueChange={setAutoSaveToGallery}
        />
      </SettingsGroup>

      <OptionSheet
        visible={filterSheet}
        title={t('defaultFilter')}
        options={filterOptions}
        value={default_filter}
        onSelect={setDefaultFilter}
        onClose={() => setFilterSheet(false)}
      />
    </ScrollView>
  );
}
