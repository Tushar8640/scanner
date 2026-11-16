import { create } from 'zustand';
import { AppSettings, AppTheme, DocNameFormat, PageFilter, PdfPageSize, PdfQuality } from '@/core/types';
import { translations, TranslationKey } from '@/i18n';
import { SecurityService } from '@/services/security/SecurityService';
import { DatabaseService } from '@/services/database/DatabaseService';

interface SettingsState extends AppSettings {
  isAuthenticated: boolean;
  setTheme: (theme: AppTheme) => void;
  setDefaultFilter: (filter: PageFilter) => void;
  setDefaultPageSize: (size: PdfPageSize) => void;
  setDefaultQuality: (quality: PdfQuality) => void;
  setAutoSaveToGallery: (enabled: boolean) => void;
  setAutoCrop: (enabled: boolean) => void;
  setCropReview: (enabled: boolean) => void;
  setDocNameFormat: (format: DocNameFormat) => void;
  setAppLockEnabled: (enabled: boolean) => Promise<void>;
  setIsAuthenticated: (auth: boolean) => void;
  t: (key: TranslationKey) => string;
  initSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'light',
  default_filter: 'magic',
  default_page_size: 'A4',
  default_quality: 'medium',
  app_lock_enabled: false,
  pin_code: null,
  auto_save_to_gallery: false,
  auto_crop: true,
  crop_review: true,
  doc_name_format: 'doc_datetime',
  isAuthenticated: true, // Will be checked on startup if lock is enabled

  setTheme: (theme) => {
    set({ theme });
    DatabaseService.setSetting('theme', theme).catch(console.warn);
  },
  setDefaultFilter: (default_filter) => {
    set({ default_filter });
    DatabaseService.setSetting('default_filter', default_filter).catch(console.warn);
  },
  setDefaultPageSize: (default_page_size) => {
    set({ default_page_size });
    DatabaseService.setSetting('default_page_size', default_page_size).catch(console.warn);
  },
  setDefaultQuality: (default_quality) => {
    set({ default_quality });
    DatabaseService.setSetting('default_quality', default_quality).catch(console.warn);
  },
  setAutoSaveToGallery: (auto_save_to_gallery) => {
    set({ auto_save_to_gallery });
    DatabaseService.setSetting('auto_save_to_gallery', auto_save_to_gallery ? 'true' : 'false').catch(console.warn);
  },
  setAutoCrop: (auto_crop) => {
    set({ auto_crop });
    DatabaseService.setSetting('auto_crop', auto_crop ? 'true' : 'false').catch(console.warn);
  },
  setCropReview: (crop_review) => {
    set({ crop_review });
    DatabaseService.setSetting('crop_review', crop_review ? 'true' : 'false').catch(console.warn);
  },
  setDocNameFormat: (doc_name_format) => {
    set({ doc_name_format });
    DatabaseService.setSetting('doc_name_format', doc_name_format).catch(console.warn);
  },

  setAppLockEnabled: async (enabled) => {
    await SecurityService.setLockEnabled(enabled);
    set({ app_lock_enabled: enabled });
  },

  setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  t: (key: TranslationKey) => {
    // The app is English only
    return translations.en[key] || String(key);
  },

  initSettings: async () => {
    try {
      const lockEnabled = await SecurityService.isLockEnabled();
      const settings = await DatabaseService.getAllSettings();

      set({
        app_lock_enabled: lockEnabled,
        isAuthenticated: !lockEnabled,
        theme: (settings.theme as AppTheme) || 'light',
        default_filter: (settings.default_filter as PageFilter) || 'magic',
        default_page_size: (settings.default_page_size as PdfPageSize) || 'A4',
        default_quality: (settings.default_quality as PdfQuality) || 'medium',
        auto_save_to_gallery: settings.auto_save_to_gallery === 'true',
        // Defaults to on when never set
        auto_crop: settings.auto_crop !== 'false',
        crop_review: settings.crop_review !== 'false',
        doc_name_format: (settings.doc_name_format as DocNameFormat) || 'doc_datetime',
      });
    } catch (e) {
      console.warn('Failed to initialize settings:', e);
    }
  },
}));
