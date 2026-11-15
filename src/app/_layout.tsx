import React, { useEffect } from 'react';
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

  useEffect(() => {
    initSettings();
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDark = colors.background === '#121212';

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AuthGate />
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
          name="index"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="scan-review"
          options={{
            title: t('review'),
            headerBackTitle: t('cancel'),
          }}
        />
        <Stack.Screen
          name="document/[id]"
          options={{
            title: t('documentDetail'),
            headerBackTitle: t('home'),
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
