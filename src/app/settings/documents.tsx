import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { DocNameFormat, PdfPageSize, PdfQuality } from '@/core/types';
import { formatDocumentName } from '@/core/utils/docName';
import { PremiumService } from '@/services/monetization/PremiumService';
import { OptionItem, OptionSheet, SettingsGroup, SettingsRow, settingsScreenStyles } from '@/ui/components/settings/SettingsUI';

type Sheet = 'size' | 'quality' | 'name' | null;

/** Document & PDF settings: default page size, quality and how new documents are named. */
export default function DocumentSettingsScreen() {
  const colors = useThemeColors();
  const { t, default_page_size, default_quality, doc_name_format, setDefaultPageSize, setDefaultQuality, setDocNameFormat } =
    useSettingsStore();
  const [sheet, setSheet] = useState<Sheet>(null);

  const sizeOptions: OptionItem<PdfPageSize>[] = [
    { value: 'A4', title: 'A4', subtitle: t('sizeA4Desc'), badge: t('defaultBadge') },
    { value: 'Letter', title: 'US Letter', subtitle: t('sizeLetterDesc') },
    { value: 'Fit', title: t('sizeFit'), subtitle: t('sizeFitDesc') },
  ];
  const qualityOptions: OptionItem<PdfQuality>[] = [
    { value: 'high', title: t('qualityHigh'), subtitle: t('qualityHighDesc') },
    { value: 'medium', title: t('qualityMedium'), subtitle: t('qualityMediumDesc'), badge: t('recommended') },
    { value: 'low', title: t('qualityLow'), subtitle: t('qualityLowDesc') },
  ];
  const now = new Date();
  const nameOptions: OptionItem<DocNameFormat>[] = (['doc_datetime', 'scan_date', 'date_only'] as DocNameFormat[]).map((f) => ({
    value: f,
    title: formatDocumentName(f, now),
    subtitle: t(f === 'doc_datetime' ? 'nameDocDatetimeDesc' : f === 'scan_date' ? 'nameScanDateDesc' : 'nameDateOnlyDesc'),
  }));

  const sizeTitle = sizeOptions.find((o) => o.value === default_page_size)?.title;
  const qualityTitle = qualityOptions.find((o) => o.value === default_quality)?.title;

  return (
    <ScrollView style={[settingsScreenStyles.scroll, { backgroundColor: colors.background }]} contentContainerStyle={settingsScreenStyles.content}>
      <Stack.Screen options={{ title: t('documentSettings') }} />

      <SettingsGroup title={t('pdfExport')} footer={t('pdfExportFooter')}>
        <SettingsRow icon="resize-outline" label={t('pageSize')} value={sizeTitle} onPress={() => setSheet('size')} />
        <SettingsRow icon="sparkles-outline" label={t('quality')} value={qualityTitle} onPress={() => setSheet('quality')} />
      </SettingsGroup>

      <SettingsGroup title={t('naming')}>
        <SettingsRow
          icon="pricetag-outline"
          label={t('docNameFormat')}
          subtitle={formatDocumentName(doc_name_format, now)}
          onPress={() => setSheet('name')}
        />
      </SettingsGroup>

      <OptionSheet
        visible={sheet === 'size'}
        title={t('pageSize')}
        options={sizeOptions}
        value={default_page_size}
        onSelect={setDefaultPageSize}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'quality'}
        title={t('quality')}
        options={qualityOptions}
        value={default_quality}
        onSelect={(q) => {
          // High quality can become a Premium feature (see src/core/config/monetization.ts)
          if (q === 'high' && !PremiumService.require('pdf_high_quality')) return;
          setDefaultQuality(q);
        }}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'name'}
        title={t('docNameFormat')}
        options={nameOptions}
        value={doc_name_format}
        onSelect={setDocNameFormat}
        onClose={() => setSheet(null)}
      />
    </ScrollView>
  );
}
