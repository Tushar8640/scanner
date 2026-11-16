import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, Alert, TextInput } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { scannerService } from '@/services/scanner/ScannerService';
import { OcrService } from '@/services/ocr/OcrService';
import { usePremiumGate } from '@/ui/hooks/usePremiumGate';

/** Extract Text tool: pick or scan an image and run on-device text recognition. */
export default function ExtractTextScreen() {
  usePremiumGate('ocr');
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  // Opened from the editor with a page image: recognise it straight away
  const params = useLocalSearchParams<{ uri?: string }>();
  const [imageUri, setImageUri] = useState<string | null>(params.uri ?? null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(!!params.uri);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!params.uri) return;
    OcrService.recognizeText(params.uri)
      .then((result) => {
        setText(result);
        setDone(true);
      })
      .catch((e) => Alert.alert(t('error'), e?.message || 'Text recognition failed'))
      .finally(() => setBusy(false));
    // Runs once for the page passed in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.uri]);
  const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

  const run = async (source: 'camera' | 'gallery') => {
    try {
      const res =
        source === 'camera'
          ? await scannerService.scanWithCamera({ maxNumDocuments: 1 })
          : await scannerService.importFromGallery({ allowsMultiple: false });
      const uri = res?.pages[0]?.uri;
      if (!uri) return;
      setImageUri(uri);
      setDone(false);
      setBusy(true);
      setText(await OcrService.recognizeText(uri));
      setDone(true);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || 'Text recognition failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await Clipboard.setStringAsync(text);
    Alert.alert(t('success'), t('textCopied'));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('extractText') }} />
      <ScrollView contentContainerStyle={styles.content}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={[styles.preview, { backgroundColor: colors.surfaceVariant }]} resizeMode="contain" />
        ) : (
          <View style={[styles.placeholder, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
            <Ionicons name="text" size={44} color={colors.primary} />
            <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>{t('extractTextHint')}</Text>
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.action, { backgroundColor: colors.primary }]} onPress={() => run('camera')} disabled={busy}>
            <Ionicons name="camera" size={20} color="#FFFFFF" />
            <Text style={styles.actionText}>{t('scan')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.action, { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1.5 }]}
            onPress={() => run('gallery')}
            disabled={busy}
          >
            <Ionicons name="image" size={20} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>{t('importImages')}</Text>
          </TouchableOpacity>
        </View>

        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.textSecondary }}>{t('processing')}</Text>
          </View>
        )}

        {done && (
          <View style={[styles.result, { backgroundColor: colors.surface }]}>
            <View style={styles.resultHeader}>
              <Text style={[styles.resultTitle, { color: colors.text }]}>{t('recognizedText')}</Text>
              {text.length > 0 && (
                <TouchableOpacity style={styles.copyBtn} onPress={copy}>
                  <Ionicons name="copy-outline" size={18} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>{t('copyText')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {text.length > 0 ? (
              <TextInput
                style={[styles.resultText, { color: colors.text }]}
                value={text}
                onChangeText={setText}
                multiline
                textAlignVertical="top"
              />
            ) : (
              <Text style={{ color: colors.textMuted }}>{inExpoGo ? t('ocrNeedsBuild') : t('noTextFound')}</Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  preview: {
    width: '100%',
    height: 280,
    borderRadius: 12,
  },
  placeholder: {
    height: 200,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 20,
  },
  placeholderText: {
    fontSize: 14,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 10,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  busy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
  },
  result: {
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  resultText: {
    minHeight: 160,
    fontSize: 15,
    lineHeight: 22,
  },
});
