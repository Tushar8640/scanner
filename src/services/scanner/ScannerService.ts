import * as ImagePicker from 'expo-image-picker';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { IScannerService, ScanOptions } from './IScannerService';
import { ScanResult } from '@/core/types';

export class ScannerService implements IScannerService {
  /**
   * Scans document pages with the device camera.
   * Utilizes native document scanner module when present, with camera fallback.
   */
  async scanWithCamera(options?: ScanOptions): Promise<ScanResult | null> {
    try {
      // 1. Try native edge-detection scanner if not in Expo Go
      if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const DocumentScanner = require('react-native-document-scanner-plugin').default;
          if (DocumentScanner && typeof DocumentScanner.scanDocument === 'function') {
            const result = await DocumentScanner.scanDocument({
              maxNumDocuments: options?.maxNumDocuments || 50,
              responseType: 'imageFilePath',
            });

            if (result?.status === 'success' && result.scannedImages && result.scannedImages.length > 0) {
              return {
                pages: result.scannedImages.map((uri: string) => ({ uri })),
              };
            }
            if (result?.status === 'cancel') {
              return null;
            }
          }
        } catch (nativeErr) {
          console.warn('Native DocumentScanner unavailable or failed, falling back to camera picker:', nativeErr);
        }
      }

      // 2. Camera fallback via expo-image-picker (FR-07)
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        throw new Error('Camera permission is required to scan documents');
      }

      const captureResult = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (captureResult.canceled || !captureResult.assets || captureResult.assets.length === 0) {
        return null;
      }

      return {
        pages: captureResult.assets.map((asset) => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        })),
      };
    } catch (error) {
      console.warn('Error during document scanning:', error);
      throw error;
    }
  }

  /**
   * Imports one or multiple images from device gallery (FR-04)
   */
  async importFromGallery(options?: { allowsMultiple?: boolean }): Promise<ScanResult | null> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Storage permission is required to import from gallery');
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: options?.allowsMultiple ?? true,
      quality: 1,
    });

    if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
      return null;
    }

    return {
      pages: pickerResult.assets.map((asset) => ({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      })),
    };
  }
}

export const scannerService = new ScannerService();
