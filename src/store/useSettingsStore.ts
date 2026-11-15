import { create } from 'zustand';
import { AppLanguage, AppSettings, AppTheme, PageFilter, PdfPageSize, PdfQuality } from '@/core/types';
import { translations, TranslationKey } from '@/i18n';
import { SecurityService } from '@/services/security/SecurityService';

interface SettingsState extends AppSettings {
  isAuthenticated: boolean;
  setLanguage: (lang: AppLanguage) => void;
  setTheme: (theme: AppTheme) => void;
  setDefaultFilter: (filter: PageFilter) => void;
  setDefaultPageSize: (size: PdfPageSize) => void;
  setDefaultQuality: (quality: PdfQuality) => void;
  setAppLockEnabled: (enabled: boolean) => Promise<void>;
  setIsAuthenticated: (auth: boolean) => void;
  t: (key: TranslationKey) => string;
  initSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  language: 'en', // English by default
  theme: 'light',
  default_filter: 'magic',
  default_page_size: 'A4',
  default_quality: 'medium',
  app_lock_enabled: false,
  pin_code: null,
  auto_save_to_gallery: false,
  isAuthenticated: true, // Will be checked on startup if lock is enabled

  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  setDefaultFilter: (default_filter) => set({ default_filter }),
  setDefaultPageSize: (default_page_size) => set({ default_page_size }),
  setDefaultQuality: (default_quality) => set({ default_quality }),
  
  setAppLockEnabled: async (enabled) => {
    await SecurityService.setLockEnabled(enabled);
    set({ app_lock_enabled: enabled });
  },

  setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  t: (key: TranslationKey) => {
    const lang = get().language;
    const dict = translations[lang] || translations.bn;
    return dict[key] || translations.en[key] || String(key);
  },

  initSettings: async () => {
    try {
      const lockEnabled = await SecurityService.isLockEnabled();
      set({
        app_lock_enabled: lockEnabled,
        isAuthenticated: !lockEnabled,
      });
    } catch (e) {
      console.warn('Failed to initialize settings security:', e);
    }
  },
}));
