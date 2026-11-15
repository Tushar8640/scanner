import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '@/store/useSettingsStore';
import { SecurityService } from '@/services/security/SecurityService';
import { PageFilter, PdfPageSize, PdfQuality } from '@/core/types';
import { ActionButton } from '@/ui/components/ActionButton';
import { lightColors } from '@/core/theme/colors';

export default function SettingsScreen() {
  const {
    language,
    theme,
    default_filter,
    default_page_size,
    default_quality,
    app_lock_enabled,
    setLanguage,
    setTheme,
    setDefaultFilter,
    setDefaultPageSize,
    setDefaultQuality,
    setAppLockEnabled,
    t,
  } = useSettingsStore();

  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [newPin, setNewPin] = useState('');

  const handleToggleLock = async (value: boolean) => {
    if (value) {
      // Prompt user to set a 4-digit PIN first
      setPinModalVisible(true);
    } else {
      await setAppLockEnabled(false);
    }
  };

  const handleSavePin = async () => {
    if (newPin.length !== 4) {
      Alert.alert('Warning', 'PIN code must be 4 digits');
      return;
    }
    await SecurityService.setPin(newPin);
    await setAppLockEnabled(true);
    setPinModalVisible(false);
    setNewPin('');
    Alert.alert('Success', 'App lock has been enabled');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Language Section (FR-70) */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>{t('language')}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setLanguage('bn')}
          >
            <View style={styles.rowLeft}>
              <Text style={styles.flag}>🇧🇩</Text>
              <Text style={styles.rowLabel}>বাংলা (Bengali)</Text>
            </View>
            {language === 'bn' && (
              <Ionicons name="checkmark-circle" size={22} color={lightColors.primary} />
            )}
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setLanguage('en')}
          >
            <View style={styles.rowLeft}>
              <Text style={styles.flag}>🇺🇸</Text>
              <Text style={styles.rowLabel}>English</Text>
            </View>
            {language === 'en' && (
              <Ionicons name="checkmark-circle" size={22} color={lightColors.primary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Theme Section (FR-72) */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>{t('theme')}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setTheme('light')}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="sunny-outline" size={22} color={lightColors.primary} />
              <Text style={[styles.rowLabel, { marginLeft: 12 }]}>{t('themeLight')}</Text>
            </View>
            {theme === 'light' && (
              <Ionicons name="checkmark-circle" size={22} color={lightColors.primary} />
            )}
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setTheme('dark')}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="moon-outline" size={22} color={lightColors.primary} />
              <Text style={[styles.rowLabel, { marginLeft: 12 }]}>{t('themeDark')}</Text>
            </View>
            {theme === 'dark' && (
              <Ionicons name="checkmark-circle" size={22} color={lightColors.primary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Security & App Lock (FR-60, NFR-21) */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>{t('security')}</Text>
        <View style={styles.card}>
          <View style={styles.rowItem}>
            <View style={styles.rowLeft}>
              <Ionicons name="shield-checkmark-outline" size={22} color={lightColors.primary} />
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.rowLabel}>{t('appLock')}</Text>
                <Text style={styles.rowSubLabel}>Lock app with PIN or fingerprint</Text>
              </View>
            </View>
            <Switch
              value={app_lock_enabled}
              onValueChange={handleToggleLock}
              trackColor={{ false: lightColors.borderStrong, true: lightColors.primary }}
            />
          </View>

          {app_lock_enabled && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => setPinModalVisible(true)}
              >
                <View style={styles.rowLeft}>
                  <Ionicons name="key-outline" size={22} color={lightColors.text} />
                  <Text style={[styles.rowLabel, { marginLeft: 12 }]}>{t('changePin')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={lightColors.textSecondary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Default Presets (FR-71) */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>{t('defaultSettings')}</Text>
        <View style={styles.card}>
          {/* Default Filter */}
          <View style={styles.settingBlock}>
            <Text style={styles.subHeader}>{t('filter')}</Text>
            <View style={styles.pillRow}>
              {(['original', 'magic', 'enhanced', 'bw', 'grayscale'] as PageFilter[]).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.pill, default_filter === f && styles.activePill]}
                  onPress={() => setDefaultFilter(f)}
                >
                  <Text style={[styles.pillText, default_filter === f && styles.activePillText]}>
                    {f === 'magic' ? 'Magic' : f === 'enhanced' ? 'Enhanced' : f === 'original' ? 'Original' : f === 'bw' ? 'B&W' : 'Grayscale'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Default Page Size */}
          <View style={styles.settingBlock}>
            <Text style={styles.subHeader}>{t('pageSize')}</Text>
            <View style={styles.pillRow}>
              {(['A4', 'Letter', 'Fit'] as PdfPageSize[]).map((sz) => (
                <TouchableOpacity
                  key={sz}
                  style={[styles.pill, default_page_size === sz && styles.activePill]}
                  onPress={() => setDefaultPageSize(sz)}
                >
                  <Text style={[styles.pillText, default_page_size === sz && styles.activePillText]}>
                    {sz}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Default Quality */}
          <View style={styles.settingBlock}>
            <Text style={styles.subHeader}>{t('quality')}</Text>
            <View style={styles.pillRow}>
              {(['low', 'medium', 'high'] as PdfQuality[]).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.pill, default_quality === q && styles.activePill]}
                  onPress={() => setDefaultQuality(q)}
                >
                  <Text style={[styles.pillText, default_quality === q && styles.activePillText]}>
                    {q === 'low' ? 'Low' : q === 'medium' ? 'Medium' : 'High'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* About & Privacy (NFR-10, FR-82) */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>{t('about')}</Text>
        <View style={styles.card}>
          <View style={styles.aboutHeader}>
            <Ionicons name="scan-outline" size={32} color={lightColors.primary} />
            <Text style={styles.aboutTitle}>{t('appName')}</Text>
            <Text style={styles.aboutVersion}>{t('version')}</Text>
            <View style={styles.freeBadge}>
              <Text style={styles.freeBadgeText}>{t('freeAndNoWatermark')}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.privacyBox}>
            <Ionicons name="lock-closed" size={18} color={lightColors.success} />
            <Text style={styles.privacyText}>{t('privacyNote')}</Text>
          </View>
        </View>
      </View>

      {/* Set/Change PIN Modal */}
      <Modal visible={pinModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('setPin')}</Text>
            <Text style={styles.modalSub}>{t('enterPin')}</Text>

            <TextInput
              style={styles.pinInput}
              value={newPin}
              onChangeText={setNewPin}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              textAlign="center"
            />

            <View style={styles.modalActions}>
              <ActionButton
                title={t('cancel')}
                variant="outline"
                onPress={() => {
                  setPinModalVisible(false);
                  setNewPin('');
                }}
                style={{ flex: 1 }}
              />
              <ActionButton
                title={t('save')}
                onPress={handleSavePin}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: lightColors.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: lightColors.border,
    overflow: 'hidden',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flag: {
    fontSize: 20,
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: lightColors.text,
  },
  rowSubLabel: {
    fontSize: 13,
    color: lightColors.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: lightColors.border,
    marginHorizontal: 16,
  },
  settingBlock: {
    padding: 16,
  },
  subHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: lightColors.text,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePill: {
    backgroundColor: lightColors.primary,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: lightColors.text,
  },
  activePillText: {
    color: '#FFFFFF',
  },
  aboutHeader: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  aboutTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: lightColors.text,
    marginTop: 8,
  },
  aboutVersion: {
    fontSize: 13,
    color: lightColors.textSecondary,
    marginTop: 2,
  },
  freeBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: lightColors.primaryLight,
    borderRadius: 12,
  },
  freeBadgeText: {
    color: lightColors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    backgroundColor: lightColors.successLight,
  },
  privacyText: {
    flex: 1,
    fontSize: 13,
    color: lightColors.success,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: lightColors.text,
  },
  modalSub: {
    fontSize: 14,
    color: lightColors.textSecondary,
    marginTop: 4,
    marginBottom: 16,
  },
  pinInput: {
    width: '80%',
    height: 50,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: lightColors.primary,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 10,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
});
