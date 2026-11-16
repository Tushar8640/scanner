import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ActionButton } from '@/ui/components/ActionButton';
import { usePremiumGate } from '@/ui/hooks/usePremiumGate';

/** QR code scanner (on-device, via expo-camera). */
export default function QrScanScreen() {
  usePremiumGate('qr_scan');
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [result, setResult] = useState<string | null>(null);

  const isLink = !!result && /^https?:\/\//i.test(result.trim());

  if (!permission) return <View style={styles.black} />;

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: t('scanQr') }} />
        <Ionicons name="qr-code-outline" size={56} color={colors.primary} />
        <Text style={[styles.permText, { color: colors.text }]}>{t('cameraPermissionNeeded')}</Text>
        <ActionButton title={t('allowCamera')} onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={styles.black}>
      <Stack.Screen options={{ title: t('scanQr') }} />
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={result ? undefined : (e) => setResult(e.data)}
      />
      {/* Viewfinder */}
      <View pointerEvents="none" style={styles.frameWrap}>
        <View style={[styles.frame, { borderColor: colors.primary }]} />
        <Text style={styles.frameHint}>{t('qrHint')}</Text>
      </View>

      {result && (
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={[styles.sheetTitle, { color: colors.textSecondary }]}>{t('qrResult')}</Text>
          <Text style={[styles.sheetText, { color: colors.text }]} selectable>
            {result}
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.action, { backgroundColor: colors.surfaceVariant }]}
              onPress={async () => {
                await Clipboard.setStringAsync(result);
                Alert.alert(t('success'), t('textCopied'));
              }}
            >
              <Ionicons name="copy-outline" size={20} color={colors.text} />
              <Text style={[styles.actionText, { color: colors.text }]}>{t('copyText')}</Text>
            </TouchableOpacity>
            {isLink && (
              <TouchableOpacity
                style={[styles.action, { backgroundColor: colors.surfaceVariant }]}
                onPress={() => Linking.openURL(result.trim()).catch(() => Alert.alert(t('error'), t('cannotOpenLink')))}
              >
                <Ionicons name="open-outline" size={20} color={colors.text} />
                <Text style={[styles.actionText, { color: colors.text }]}>{t('openLink')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.action, { backgroundColor: colors.primary }]} onPress={() => setResult(null)}>
              <Ionicons name="scan" size={20} color="#FFFFFF" />
              <Text style={[styles.actionText, { color: '#FFFFFF' }]}>{t('scanAgain')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  permText: { fontSize: 15, textAlign: 'center' },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 18 },
  frame: { width: 240, height: 240, borderWidth: 3, borderRadius: 18 },
  frameHint: { color: '#FFFFFF', fontSize: 14, textShadowColor: '#000', textShadowRadius: 4 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, gap: 10 },
  sheetTitle: { fontSize: 13, fontWeight: '600' },
  sheetText: { fontSize: 16, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 10 },
  actionText: { fontSize: 14, fontWeight: '600' },
});
