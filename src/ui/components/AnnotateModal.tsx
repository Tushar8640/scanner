import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ANNOTATE_HTML, SIGNATURE_PAD_HTML } from '@/services/image/annotateHtml';
import { SignatureService } from '@/services/signature/SignatureService';
import { PremiumService } from '@/services/monetization/PremiumService';

export type AnnotateMode = 'markup' | 'sign' | 'watermark';

interface AnnotateModalProps {
  visible: boolean;
  mode: AnnotateMode;
  imageUri: string;
  onClose: () => void;
  /** Receives a new image file with the annotations flattened in. */
  onApply: (uri: string) => void;
}

const INK_COLORS = ['#111111', '#1F4FD8', '#D93025', '#188038', '#F9AB00'];
const WM_COLORS = ['#9AA0A6', '#111111', '#D93025', '#1F4FD8'];
const WIDTHS = [0.003, 0.006, 0.012];

export const AnnotateModal: React.FC<AnnotateModalProps> = ({ visible, ...rest }) => {
  if (!visible || !rest.imageUri) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={rest.onClose} statusBarTranslucent>
      <AnnotateEditor key={`${rest.mode}:${rest.imageUri}`} {...rest} />
    </Modal>
  );
};

const AnnotateEditor: React.FC<Omit<AnnotateModalProps, 'visible'>> = ({ mode, imageUri, onClose, onApply }) => {
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const insets = useSafeAreaInsets();
  const webRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [applying, setApplying] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [hasSig, setHasSig] = useState(false);
  const [tool, setTool] = useState<'pen' | 'highlighter'>('pen');
  const [inkColor, setInkColor] = useState(INK_COLORS[1]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [wmText, setWmText] = useState('');
  const [wmColor, setWmColor] = useState(WM_COLORS[0]);
  const [wmOpacity, setWmOpacity] = useState(0.25);
  const [padVisible, setPadVisible] = useState(false);
  const [savedSigs, setSavedSigs] = useState<string[]>([]);

  const cmd = useCallback((m: Record<string, unknown>) => {
    webRef.current?.injectJavaScript(`window.__cmd && window.__cmd(${JSON.stringify(m)}); true;`);
  }, []);

  const refreshSigs = useCallback(() => {
    SignatureService.list().then(setSavedSigs, () => setSavedSigs([]));
  }, []);

  useEffect(() => {
    if (mode !== 'sign') return;
    // Signing can become a Premium feature (see src/core/config/monetization.ts)
    if (!PremiumService.require('signature')) {
      onClose();
      return;
    }
    refreshSigs();
    // Runs when the editor opens; onClose identity changes on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, refreshSigs]);

  // Watermark preview follows the inputs live
  useEffect(() => {
    if (ready && mode === 'watermark') cmd({ type: 'watermark', wm: { text: wmText, color: wmColor, opacity: wmOpacity } });
  }, [ready, mode, wmText, wmColor, wmOpacity, cmd]);

  const onMessage = async (e: WebViewMessageEvent) => {
    let m: any;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'booted') {
      const b64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
      webRef.current?.injectJavaScript(`window.__load(${JSON.stringify(b64)}); true;`);
    } else if (m.type === 'ready') {
      setReady(true);
      cmd({ type: 'mode', mode });
      cmd({ type: 'color', color: inkColor });
      cmd({ type: 'width', width });
      // Open the pad straight away when there is no saved signature yet
      if (mode === 'sign' && savedSigs.length === 0) setPadVisible(true);
    } else if (m.type === 'state') {
      setStrokeCount(m.strokes ?? 0);
      setHasSig(!!m.hasSig);
    } else if (m.type === 'applied') {
      try {
        const dir = FileSystem.cacheDirectory;
        if (!dir) throw new Error('Cache directory is not accessible');
        const out = `${dir}annotated_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(out, m.b64, { encoding: FileSystem.EncodingType.Base64 });
        onApply(out);
        onClose();
      } catch (err: any) {
        Alert.alert(t('error'), err?.message || 'Could not save the page');
      } finally {
        setApplying(false);
      }
    } else if (m.type === 'error') {
      setApplying(false);
      Alert.alert(t('error'), m.message || 'Editing failed');
    }
  };

  const placeSignature = async (uri: string) => {
    try {
      cmd({ type: 'signature', src: await SignatureService.toDataUrl(uri) });
    } catch (e) {
      console.warn('Could not load signature:', e);
    }
  };

  const canApply =
    ready && !applying && (mode === 'markup' ? strokeCount > 0 : mode === 'sign' ? hasSig : wmText.trim().length > 0);

  const title = mode === 'markup' ? t('markup') : mode === 'sign' ? t('sign') : t('watermark');

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={onClose} accessibilityLabel={t('cancel')}>
          <Ionicons name="arrow-back" size={26} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity
          style={[styles.applyBtn, { backgroundColor: canApply ? colors.primary : '#3A3F47' }]}
          disabled={!canApply}
          onPress={() => {
            setApplying(true);
            cmd({ type: 'apply' });
          }}
          accessibilityLabel={t('save')}
        >
          {applying ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="checkmark" size={24} color="#FFFFFF" />}
        </TouchableOpacity>
      </View>

      <View style={styles.stage}>
        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={{ html: ANNOTATE_HTML }}
          onMessage={onMessage}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          style={styles.web}
        />
        {!ready && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}
      </View>

      {/* Tool panel per mode */}
      <View style={styles.panel}>
        {mode === 'markup' && (
          <>
            <View style={styles.row}>
              <ToolChip icon="pencil" label={t('pen')} active={tool === 'pen'} onPress={() => { setTool('pen'); cmd({ type: 'tool', tool: 'pen' }); }} />
              <ToolChip icon="color-fill" label={t('highlighter')} active={tool === 'highlighter'} onPress={() => { setTool('highlighter'); cmd({ type: 'tool', tool: 'highlighter' }); }} />
              <ToolChip icon="arrow-undo" label={t('undo')} disabled={strokeCount === 0} onPress={() => cmd({ type: 'undo' })} />
              <ToolChip icon="trash-outline" label={t('clearAll')} disabled={strokeCount === 0} onPress={() => cmd({ type: 'clear' })} />
            </View>
            <View style={styles.row}>
              {INK_COLORS.map((c) => (
                <Swatch key={c} color={c} active={inkColor === c} onPress={() => { setInkColor(c); cmd({ type: 'color', color: c }); }} />
              ))}
              <View style={styles.sep} />
              {WIDTHS.map((w, i) => (
                <TouchableOpacity
                  key={w}
                  style={[styles.widthBtn, width === w && styles.widthBtnActive]}
                  onPress={() => { setWidth(w); cmd({ type: 'width', width: w }); }}
                >
                  <View style={{ width: 6 + i * 6, height: 6 + i * 6, borderRadius: 10, backgroundColor: '#FFFFFF' }} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {mode === 'sign' && (
          <>
            <Text style={styles.hint}>{hasSig ? t('signHintPlaced') : t('signHint')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sigRow}>
              <TouchableOpacity style={styles.newSig} onPress={() => setPadVisible(true)}>
                <Ionicons name="add" size={26} color="#FFFFFF" />
                <Text style={styles.newSigText}>{t('newSignature')}</Text>
              </TouchableOpacity>
              {savedSigs.map((uri) => (
                <TouchableOpacity
                  key={uri}
                  style={styles.sigThumb}
                  onPress={() => placeSignature(uri)}
                  onLongPress={() =>
                    Alert.alert(t('delete'), t('deleteSignatureConfirm'), [
                      { text: t('cancel'), style: 'cancel' },
                      { text: t('delete'), style: 'destructive', onPress: () => SignatureService.remove(uri).then(refreshSigs) },
                    ])
                  }
                >
                  <Image source={{ uri }} style={styles.sigImg} resizeMode="contain" />
                </TouchableOpacity>
              ))}
              {hasSig && (
                <TouchableOpacity style={styles.removeSig} onPress={() => cmd({ type: 'removeSignature' })}>
                  <Ionicons name="close-circle-outline" size={22} color="#FF6B6B" />
                  <Text style={styles.removeSigText}>{t('remove')}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </>
        )}

        {mode === 'watermark' && (
          <>
            <TextInput
              style={styles.wmInput}
              value={wmText}
              onChangeText={setWmText}
              placeholder={t('watermarkPlaceholder')}
              placeholderTextColor="#8A8F98"
              maxLength={40}
            />
            <View style={styles.row}>
              {WM_COLORS.map((c) => (
                <Swatch key={c} color={c} active={wmColor === c} onPress={() => setWmColor(c)} />
              ))}
              <View style={styles.sep} />
              {[0.15, 0.25, 0.4].map((o, i) => (
                <TouchableOpacity key={o} style={[styles.opacityBtn, wmOpacity === o && styles.widthBtnActive]} onPress={() => setWmOpacity(o)}>
                  <Text style={styles.opacityText}>{[t('wmLight'), t('wmMedium'), t('wmStrong')][i]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </View>

      <SignaturePadModal
        visible={padVisible}
        onClose={() => setPadVisible(false)}
        onDone={async (dataUrl) => {
          setPadVisible(false);
          try {
            const uri = await SignatureService.save(dataUrl);
            refreshSigs();
            placeSignature(uri);
          } catch (e: any) {
            Alert.alert(t('error'), e?.message || 'Could not save signature');
          }
        }}
      />
    </View>
  );
};

const SignaturePadModal: React.FC<{ visible: boolean; onClose: () => void; onDone: (dataUrl: string) => void }> = ({
  visible,
  onClose,
  onDone,
}) => {
  const { t } = useSettingsStore();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const webRef = useRef<any>(null);
  const [strokes, setStrokes] = useState(0);
  const [color, setColor] = useState('#111111');

  if (!visible) return null;
  const cmd = (m: Record<string, unknown>) =>
    webRef.current?.injectJavaScript(`window.__cmd && window.__cmd(${JSON.stringify(m)}); true;`);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.padRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { backgroundColor: '#FFFFFF' }]}>
          <TouchableOpacity style={styles.iconBtn} onPress={onClose}>
            <Ionicons name="close" size={26} color="#111111" />
          </TouchableOpacity>
          <Text style={[styles.title, { color: '#111111' }]}>{t('drawSignature')}</Text>
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: strokes > 0 ? colors.primary : '#C9CDD2' }]}
            disabled={strokes === 0}
            onPress={() => cmd({ type: 'done' })}
          >
            <Ionicons name="checkmark" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={{ html: SIGNATURE_PAD_HTML }}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          style={styles.web}
          onMessage={(e) => {
            try {
              const m = JSON.parse(e.nativeEvent.data);
              if (m.type === 'state') setStrokes(m.strokes);
              if (m.type === 'signature') onDone(m.dataUrl);
            } catch {
              // ignore malformed messages
            }
          }}
        />
        <View style={styles.padBar}>
          {['#111111', '#1F4FD8', '#D93025'].map((c) => (
            <Swatch key={c} color={c} active={color === c} light onPress={() => { setColor(c); cmd({ type: 'color', color: c }); }} />
          ))}
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => cmd({ type: 'clear' })} disabled={strokes === 0}>
            <Text style={[styles.padClear, { color: strokes ? colors.primary : '#9AA0A6' }]}>{t('clearAll')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const ToolChip: React.FC<{ icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; disabled?: boolean; onPress: () => void }> = ({
  icon,
  label,
  active,
  disabled,
  onPress,
}) => (
  <TouchableOpacity style={[styles.chip, active && styles.chipActive, disabled && { opacity: 0.35 }]} onPress={onPress} disabled={disabled}>
    <Ionicons name={icon} size={20} color="#FFFFFF" />
    <Text style={styles.chipText}>{label}</Text>
  </TouchableOpacity>
);

const Swatch: React.FC<{ color: string; active: boolean; light?: boolean; onPress: () => void }> = ({ color, active, light, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.swatch, { borderColor: active ? (light ? '#111111' : '#FFFFFF') : 'transparent' }]}
  >
    <View style={[styles.swatchInner, { backgroundColor: color }]} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1013' },
  padRoot: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginLeft: 4 },
  applyBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  stage: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  panel: { backgroundColor: '#181B20', paddingVertical: 10, paddingHorizontal: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18, backgroundColor: '#262A31' },
  chipActive: { backgroundColor: '#0FA58E' },
  chipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatchInner: { width: 24, height: 24, borderRadius: 12 },
  sep: { width: 1, height: 26, backgroundColor: '#3A3F47', marginHorizontal: 4 },
  widthBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#262A31' },
  widthBtnActive: { backgroundColor: '#0FA58E' },
  hint: { color: '#A3A9B2', fontSize: 12 },
  sigRow: { gap: 10, alignItems: 'center' },
  newSig: { width: 92, height: 56, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#5A606A', alignItems: 'center', justifyContent: 'center' },
  newSigText: { color: '#FFFFFF', fontSize: 11 },
  sigThumb: { width: 110, height: 56, borderRadius: 8, backgroundColor: '#FFFFFF', padding: 4 },
  sigImg: { width: '100%', height: '100%' },
  removeSig: { alignItems: 'center', paddingHorizontal: 8 },
  removeSigText: { color: '#FF6B6B', fontSize: 11 },
  wmInput: { backgroundColor: '#262A31', color: '#FFFFFF', borderRadius: 8, paddingHorizontal: 12, height: 44, fontSize: 15 },
  opacityBtn: { paddingHorizontal: 10, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: '#262A31' },
  opacityText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  padBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E3E5E8' },
  padClear: { fontSize: 15, fontWeight: '600' },
});
