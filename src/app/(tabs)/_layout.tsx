import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { TranslationKey } from '@/i18n';
import { useUiStore } from '@/store/useUiStore';

const TAB_META: Record<string, { label: TranslationKey; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap }> = {
  index: { label: 'home', icon: 'home-outline', iconActive: 'home' },
  files: { label: 'files', icon: 'document-text-outline', iconActive: 'document-text' },
  tools: { label: 'tools', icon: 'grid-outline', iconActive: 'grid' },
  me: { label: 'me', icon: 'person-outline', iconActive: 'person' },
};

function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useSettingsStore();
  const hidden = useUiStore((s) => s.tabBarHidden);

  // A screen in selection mode shows its own action bar here instead
  if (hidden) return null;

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 6) },
      ]}
    >
      {state.routes.map((route, index) => {
        const meta = TAB_META[route.name];
        if (!meta) return null;
        const focused = state.index === index;
        const tint = focused ? colors.primary : colors.textMuted;
        return (
          <TouchableOpacity
            key={route.key}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => {
              if (!focused) navigateToTab(route.key);
            }}
          >
            <Ionicons name={focused ? meta.iconActive : meta.icon} size={24} color={tint} />
            <Text style={[styles.label, { color: tint, fontWeight: focused ? '700' : '500' }]}>{t(meta.label)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="files" />
      <Tabs.Screen name="tools" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  label: {
    fontSize: 11,
  },
});
