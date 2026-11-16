import { useColorScheme } from 'react-native';
import { useSettingsStore } from '@/store/useSettingsStore';

export const lightColors = {
  background: '#F3F5F7',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F3F5',
  card: '#FFFFFF',
  text: '#1A1D20',
  textSecondary: '#6C757D',
  textMuted: '#ADB5BD',
  border: '#E9ECEF',
  borderStrong: '#CED4DA',
  primary: '#0FA58E',
  primaryDark: '#0B8572',
  primaryLight: '#E2F5F1',
  primaryContrast: '#FFFFFF',
  accent: '#20C997',
  danger: '#DC3545',
  dangerLight: '#FFEAEA',
  warning: '#FFC107',
  warningLight: '#FFF9DB',
  success: '#198754',
  successLight: '#E8F5E9',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export const darkColors = {
  background: '#121212',
  surface: '#1E1E1E',
  surfaceVariant: '#2A2A2A',
  card: '#1E1E1E',
  text: '#F8F9FA',
  textSecondary: '#A0AAB2',
  textMuted: '#6C757D',
  border: '#2D3238',
  borderStrong: '#495057',
  primary: '#2CC4AA',
  primaryDark: '#0FA58E',
  primaryLight: '#10302B',
  primaryContrast: '#FFFFFF',
  accent: '#20C997',
  danger: '#EA4335',
  dangerLight: '#3C1618',
  warning: '#FBBF24',
  warningLight: '#3D2F0E',
  success: '#34A853',
  successLight: '#13351C',
  overlay: 'rgba(0, 0, 0, 0.75)',
};

export type ThemeColors = typeof lightColors;

export function useThemeColors(): ThemeColors {
  const systemScheme = useColorScheme();
  const theme = useSettingsStore((state) => state.theme);

  if (theme === 'dark') {
    return darkColors;
  }
  if (theme === 'light') {
    return lightColors;
  }
  return systemScheme === 'dark' ? darkColors : lightColors;
}

