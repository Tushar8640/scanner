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
import { useThemeColors } from '@/core/theme/colors';

export default function SettingsScreen() {
  const colors = useThemeColors();
  const {
    language,
    theme,
    default_filter,
    default_page_size,
    default_quality,
    app_lock_enabled,
    auto_save_to_gallery,
    setLanguage,
    setTheme,
    setDefaultFilter,
    setDefaultPageSize,
    setDefaultQuality,
    setAppLockEnabled,
    setAutoSaveToGallery,
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
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Language Section (FR-70) */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('language')}</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setLanguage('bn')}
          >
            <View style={styles.rowLeft}>
              <Text style={styles.flag}>🇧🇩</Text>
              <Text style={[styles.rowLabel, { color: colors.text }]}>বাংলা (Bengali)</Text>
            </View>
            {language === 'bn' && (
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            )}
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setLanguage('en')}
          >
            <View style={styles.rowLeft}>
              <Text style={styles.flag}>🇺🇸</Text>
              <Text style={[styles.rowLabel, { color: colors.text }]}>English</Text>
            </View>
            {language === 'en' && (
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Theme Section (FR-72) */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('theme')}</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setTheme('light')}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="sunny-outline" size={22} color={colors.primary} />
              <Text style={[styles.rowLabel, { color: colors.text, marginLeft: 12 }]}>{t('themeLight')}</Text>
            </View>
            {theme === 'light' && (
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            )}
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setTheme('dark')}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="moon-outline" size={22} color={colors.primary} />
              <Text style={[styles.rowLabel, { color: colors.text, marginLeft: 12 }]}>{t('themeDark')}</Text>
            </View>
            {theme === 'dark' && (
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            )}
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <TouchableOpacity
            style={styles.rowItem}
            onPress={() => setTheme('system')}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="phone-portrait-outline" size={22} color={colors.primary} />
              <Text style={[styles.rowLabel, { color: colors.text, marginLeft: 12 }]}>{t('themeSystem')}</Text>
            </View>
            {theme === 'system' && (
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Security & App Lock (FR-60, NFR-21) */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('security')}</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.rowItem}>
            <View style={styles.rowLeft}>
              <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
              <View style={{ marginLeft: 12 }}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('appLock')}</Text>
                <Text style={[styles.rowSubLabel, { color: colors.textSecondary }]}>Lock app with PIN or fingerprint</Text>
              </View>
            </View>
            <Switch
              value={app_lock_enabled}
              onValueChange={handleToggleLock}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
            />
          </View>

          {app_lock_enabled && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => setPinModalVisible(true)}
              >
                <View style={styles.rowLeft}>
                  <Ionicons name="key-outline" size={22} color={colors.text} />
                  <Text style={[styles.rowLabel, { color: colors.text, marginLeft: 12 }]}>{t('changePin')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Default Presets (FR-71) */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('defaultSettings')}</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* Default Filter */}
          <View style={styles.settingBlock}>
            <Text style={[styles.subHeader, { color: colors.text }]}>{t('filter')}</Text>
            <View style={styles.pillRow}>
              {(['original', 'magic', 'enhanced', 'bw', 'grayscale'] as PageFilter[]).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.pill,
                    { backgroundColor: default_filter === f ? colors.primary : colors.surfaceVariant },
                  ]}
                  onPress={() => setDefaultFilter(f)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: default_filter === f ? '#FFFFFF' : colors.text },
                    ]}
                  >
                    {f === 'magic' ? 'Magic' : f === 'enhanced' ? 'Enhanced' : f === 'original' ? 'Original' : f === 'bw' ? 'B&W' : 'Grayscale'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Default Page Size */}
          <View style={styles.settingBlock}>
            <Text style={[styles.subHeader, { color: colors.text }]}>{t('pageSize')}</Text>
            <View style={styles.pillRow}>
              {(['A4', 'Letter', 'Fit'] as PdfPageSize[]).map((sz) => (
                <TouchableOpacity
                  key={sz}
                  style={[
                    styles.pill,
                    { backgroundColor: default_page_size === sz ? colors.primary : colors.surfaceVariant },
                  ]}
                  onPress={() => setDefaultPageSize(sz)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: default_page_size === sz ? '#FFFFFF' : colors.text },
                    ]}
                  >
                    {sz}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Default Quality */}
          <View style={styles.settingBlock}>
            <Text style={[styles.subHeader, { color: colors.text }]}>{t('quality')}</Text>
            <View style={styles.pillRow}>
              {(['low', 'medium', 'high'] as PdfQuality[]).map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[
                    styles.pill,
                    { backgroundColor: default_quality === q ? colors.primary : colors.surfaceVariant },
                  ]}
                  onPress={() => setDefaultQuality(q)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: default_quality === q ? '#FFFFFF' : colors.text },
                    ]}
                  >
                    {q === 'low' ? 'Low' : q === 'medium' ? 'Medium' : 'High'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Auto-save to Gallery Option */}
          <View style={styles.rowItem}>
            <View style={styles.rowLeft}>
              <Ionicons name="images-outline" size={22} color={colors.primary} />
              <View style={{ marginLeft: 12 }}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>Auto-save to Gallery</Text>
                <Text style={[styles.rowSubLabel, { color: colors.textSecondary }]}>Save scanned images to photo gallery</Text>
              </View>
            </View>
            <Switch
              value={auto_save_to_gallery}
              onValueChange={setAutoSaveToGallery}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
            />
          </View>
        </View>
      </View>

      {/* About & Privacy (NFR-10, FR-82) */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{t('about')}</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.aboutHeader}>
            <Ionicons name="scan-outline" size={32} color={colors.primary} />
            <Text style={[styles.aboutTitle, { color: colors.text }]}>{t('appName')}</Text>
            <Text style={[styles.aboutVersion, { color: colors.textSecondary }]}>{t('version')}</Text>
            <View style={[styles.freeBadge, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.freeBadgeText, { color: colors.primary }]}>{t('freeAndNoWatermark')}</Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={[styles.privacyBox, { backgroundColor: colors.successLight }]}>
            <Ionicons name="lock-closed" size={18} color={colors.success} />
            <Text style={[styles.privacyText, { color: colors.success }]}>{t('privacyNote')}</Text>
          </View>
        </View>
      </View>

      {/* Set/Change PIN Modal */}
      <Modal visible={pinModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('setPin')}</Text>
            <Text style={[styles.modalSub, { color: colors.textSecondary }]}>{t('enterPin')}</Text>

            <TextInput
              style={[
                styles.pinInput,
                { color: colors.text, borderColor: colors.primary, backgroundColor: colors.surfaceVariant },
              ]}
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
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
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
  },
  rowSubLabel: {
    fontSize: 13,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginHorizontal: 16,
  },
  settingBlock: {
    padding: 16,
  },
  subHeader: {
    fontSize: 14,
    fontWeight: '600',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  aboutHeader: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  aboutTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  aboutVersion: {
    fontSize: 13,
    marginTop: 2,
  },
  freeBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  freeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
  },
  privacyText: {
    flex: 1,
    fontSize: 13,
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
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSub: {
    fontSize: 14,
    marginTop: 4,
    marginBottom: 16,
  },
  pinInput: {
    width: '80%',
    height: 50,
    borderRadius: 10,
    borderWidth: 1.5,
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
