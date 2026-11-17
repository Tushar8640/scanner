import React, { useRef } from 'react';
import { Modal, View, Text, TextInput, StyleSheet } from 'react-native';
import { create } from 'zustand';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ActionButton } from '@/ui/components/ActionButton';

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  /** Hides the typed text (passwords, PINs). */
  secure?: boolean;
  keyboard?: 'default' | 'number-pad';
  maxLength?: number;
  confirmLabel?: string;
}

interface PromptState {
  current: (PromptOptions & { resolve: (v: string | null) => void }) | null;
  value: string;
}

const usePromptStore = create<PromptState>(() => ({ current: null, value: '' }));

/**
 * Asks the user for a line of text (Android has no built-in text prompt).
 * Resolves with the text, or null when cancelled. Needs <PromptHost /> mounted once.
 */
export function askText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    // A new prompt replaces an open one, which counts as cancelled
    usePromptStore.getState().current?.resolve(null);
    usePromptStore.setState({ current: { ...options, resolve }, value: options.initialValue ?? '' });
  });
}

export const PromptHost: React.FC = () => {
  const current = usePromptStore((s) => s.current);
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const value = usePromptStore((s) => s.value);
  const setValue = (v: string) => usePromptStore.setState({ value: v });
  const inputRef = useRef<any>(null);

  const close = (result: string | null) => {
    current?.resolve(result);
    usePromptStore.setState({ current: null });
  };

  return (
    <Modal
      visible={current !== null}
      transparent
      animationType="fade"
      onRequestClose={() => close(null)}
      onShow={() => {
        setTimeout(() => inputRef.current?.focus(), 150);
      }}
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.text }]}>{current?.title}</Text>
          {current?.message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{current.message}</Text> : null}
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceVariant }]}
            value={value}
            onChangeText={setValue}
            placeholder={current?.placeholder}
            placeholderTextColor={colors.textMuted}
            secureTextEntry={current?.secure}
            keyboardType={current?.keyboard ?? 'default'}
            maxLength={current?.maxLength}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => value.trim() && close(value)}
          />
          <View style={styles.actions}>
            <ActionButton title={t('cancel')} variant="outline" onPress={() => close(null)} style={styles.flex1} />
            <ActionButton
              title={current?.confirmLabel ?? t('confirm')}
              disabled={!value.trim()}
              onPress={() => close(value)}
              style={styles.flex1}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 16, padding: 20, gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 48, fontSize: 16 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex1: { flex: 1 },
});
