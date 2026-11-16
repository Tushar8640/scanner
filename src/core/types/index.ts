export type PageFilter = 'original' | 'lighten' | 'magic' | 'enhanced' | 'noshadow' | 'bw' | 'grayscale';
export type PageRotation = 0 | 90 | 180 | 270;
export type PdfPageSize = 'A4' | 'Letter' | 'Fit';
export type PdfQuality = 'low' | 'medium' | 'high';
/** How new documents are named. */
export type DocNameFormat = 'doc_datetime' | 'scan_date' | 'date_only';
export type AppTheme = 'system' | 'light' | 'dark';

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  is_locked: number; // 0 or 1
  created_at: number; // timestamp in ms
}

export interface Document {
  id: string;
  folder_id: string | null;
  title: string;
  page_count: number;
  pdf_path: string | null;
  thumbnail_path: string;
  ocr_text: string | null;
  deleted_at: number | null; // for trash support (FR-36)
  created_at: number; // timestamp in ms
  updated_at: number; // timestamp in ms
}

export interface Page {
  id: string;
  document_id: string;
  position: number;
  original_path: string;
  processed_path: string;
  filter: PageFilter;
  intensity?: number; // 0.1 to 1.0 (default 0.6)
  rotation: PageRotation;
  ocr_text: string | null;
}

export interface AppSettings {
  theme: AppTheme;
  default_filter: PageFilter;
  default_page_size: PdfPageSize;
  default_quality: PdfQuality;
  app_lock_enabled: boolean;
  pin_code: string | null;
  auto_save_to_gallery: boolean;
  /** Detect edges and straighten pages automatically after scanning or importing. */
  auto_crop: boolean;
  /** Show the crop screen for each new page before the editor. */
  crop_review: boolean;
  doc_name_format: DocNameFormat;
}

export interface ScanResult {
  pages: {
    uri: string;
    width?: number;
    height?: number;
    /** True when edges were already detected and corrected (native document scanner). */
    cropped?: boolean;
  }[];
}
