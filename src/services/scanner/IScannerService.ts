import { ScanResult } from '@/core/types';

export interface ScanOptions {
  maxNumDocuments?: number;
  mode?: 'document' | 'id_card';
}

export interface IScannerService {
  scanWithCamera(options?: ScanOptions): Promise<ScanResult | null>;
  importFromGallery(options?: { allowsMultiple?: boolean }): Promise<ScanResult | null>;
}
