import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDocumentStore } from '@/store/useDocumentStore';
import { AuthGate } from '@/ui/components/AuthGate';
import { useThemeColors } from '@/core/theme/colors';

export default function RootLayout() {
  const { initSettings, t } = useSettingsStore();
  const { loadAll } = useDocumentStore();
  const colors = useThemeColors();
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    initSettings().catch((e) => {
      console.warn('initSettings warning:', e);
      setStartupError(`Settings: ${e?.message || String(e)}`);
    });
    loadAll().catch((e) => {
      console.warn('loadAll warning:', e);
      setStartupError(`Database: ${e?.message || String(e)}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDark = colors.background === '#121212';

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AuthGate />
      {startupError ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.dangerLight, borderColor: colors.danger }]}>
          <Text style={[styles.errorText, { color: colors.danger }]}>
            Startup Warning: {startupError}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setStartupError(null);
              initSettings().catch(console.warn);
              loadAll().catch(console.warn);
            }}
            style={[styles.retryBtn, { backgroundColor: colors.danger }]}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 12 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.surface,
          },
          headerTintColor: colors.text,
          headerTitleStyle: {
            fontWeight: '600',
            fontSize: 18,
          },
          headerShadowVisible: false,
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="scan-review"
          options={{
            headerShown: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="document/[id]"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen name="id-card" options={{ title: t('idCard') }} />
        <Stack.Screen name="qr-scan" options={{ title: t('scanQr'), headerStyle: { backgroundColor: '#000000' }, headerTintColor: '#FFFFFF' }} />
        <Stack.Screen
          name="extract-text"
          options={{
            title: t('extractText'),
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: t('settings'),
          }}
        />
        <Stack.Screen
          name="trash"
          options={{
            title: t('trash'),
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
});
