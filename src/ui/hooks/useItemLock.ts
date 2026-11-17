import { Alert } from 'react-native';
import { router } from 'expo-router';
import { ItemLock } from '@/services/security/SecurityService';
import { askText } from '@/ui/components/PromptHost';
import { useSettingsStore } from '@/store/useSettingsStore';

/** Opening locked documents and folders: fingerprint/face or the app PIN. */
export function useItemLock() {
  const { t } = useSettingsStore();

  /** Resolves true when the item may be opened (or was never locked). */
  const unlock = async (id: string): Promise<boolean> => {
    const result = await ItemLock.unlock(
      id,
      (message) =>
        askText({ title: t('enterAppPin'), message, secure: true, keyboard: 'number-pad', maxLength: 4, placeholder: '••••' }),
      t('unlockPrompt')
    );
    if (result === 'nopin') {
      Alert.alert(t('lockDoc'), t('needPinFirst'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('goToSecurity'), onPress: () => router.push('/settings/security') },
      ]);
      return false;
    }
    return result === 'ok';
  };

  return { unlock };
}
