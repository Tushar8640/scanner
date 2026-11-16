import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDocumentStore } from '@/store/useDocumentStore';
import { scannerService } from '@/services/scanner/ScannerService';
import { isFullQuad } from '@/services/scanner/quad';
import { ScanEngineProvider, useScanEngine } from '@/ui/components/ScanEngine';
import { ActionSheet } from '@/ui/components/ActionSheet';
import { ActionButton } from '@/ui/components/ActionButton';
import { usePremiumGate } from '@/ui/hooks/usePremiumGate';

type Side = 'front' | 'back';

export default function IdCardScreen() {
  return (
    <ScanEngineProvider>
      <IdCardContent />
    </ScanEngineProvider>
  );
}

/** ID card mode: front and back are auto-cropped and placed together on one A4 page. */
function IdCardContent() {
  usePremiumGate('id_card');
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const { createDocument, activeFolderId } = useDocumentStore();
  const engine = useScanEngine();
  const [images, setImages] = useState<Record<Side, string | null>>({ front: null, back: null });
  const [busySide, setBusySide] = useState<Side | null>(null);
  const [picking, setPicking] = useState<Side | null>(null);
  const [creating, setCreating] = useState(false);

  const capture = async (side: Side, source: 'camera' | 'gallery') => {
    try {
      const res =
        source === 'camera'
          ? await scannerService.scanWithCamera({ maxNumDocuments: 1 })
          : await scannerService.importFromGallery({ allowsMultiple: false });
      const page = res?.pages[0];
      if (!page) return;
      setBusySide(side);
      let uri = page.uri;
      if (!page.cropped) {
        // Same auto-crop as normal scans
        const prepared = await engine.prepare(uri);
        uri = prepared.corners && !isFullQuad(prepared.corners) ? await engine.warp(prepared.uri, prepared.corners) : prepared.uri;
      }
      setImages((prev) => ({ ...prev, [side]: uri }));
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Scan failed');
    } finally {
      setBusySide(null);
    }
  };

  const create = async () => {
    if (!images.front) return;
    try {
      setCreating(true);
      const composed = await engine.composeIdCard([images.front, images.back].filter(Boolean) as string[]);
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const doc = await createDocument(
        `${t('idCard')} ${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`,
        [{ originalUri: composed, previewUri: composed, filter: 'original', rotation: 0 }],
        activeFolderId,
        'original'
      );
      router.replace(`/document/${doc.id}`);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Could not create the document');
    } finally {
      setCreating(false);
    }
  };

  const slot = (side: Side) => {
    const uri = images[side];
    return (
      <TouchableOpacity
        key={side}
        style={[styles.slot, { borderColor: uri ? colors.primary : colors.borderStrong, backgroundColor: colors.surface }]}
        onPress={() => setPicking(side)}
        disabled={busySide !== null || creating}
      >
        {busySide === side ? (
          <ActivityIndicator color={colors.primary} />
        ) : uri ? (
          <>
            <Image source={{ uri }} style={styles.slotImg} resizeMode="contain" />
            <View style={[styles.retake, { backgroundColor: colors.primary }]}>
              <Ionicons name="refresh" size={14} color="#FFFFFF" />
              <Text style={styles.retakeText}>{t('retake')}</Text>
            </View>
          </>
        ) : (
          <>
            <Ionicons name={side === 'front' ? 'card-outline' : 'card'} size={40} color={colors.primary} />
            <Text style={[styles.slotTitle, { color: colors.text }]}>{side === 'front' ? t('idFront') : t('idBack')}</Text>
            <Text style={[styles.slotSub, { color: colors.textSecondary }]}>{t('tapToScan')}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('idCard') }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('idCardHint')}</Text>
        {slot('front')}
        {slot('back')}
        <ActionButton
          title={t('createDocument')}
          onPress={create}
          loading={creating}
          disabled={!images.front || busySide !== null}
          icon={<Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />}
        />
      </ScrollView>
      <ActionSheet
        visible={picking !== null}
        title={picking === 'back' ? t('idBack') : t('idFront')}
        onClose={() => setPicking(null)}
        items={[
          { key: 'cam', label: t('scanDocument'), icon: 'camera-outline', onPress: () => picking && capture(picking, 'camera') },
          { key: 'gal', label: t('importImages'), icon: 'images-outline', onPress: () => picking && capture(picking, 'gallery') },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  hint: { fontSize: 14, lineHeight: 20 },
  slot: {
    height: 200,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  slotImg: { width: '100%', height: '100%' },
  slotTitle: { fontSize: 16, fontWeight: '700' },
  slotSub: { fontSize: 13 },
  retake: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  retakeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
