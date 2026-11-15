import Constants, { ExecutionEnvironment } from 'expo-constants';

export class OcrService {
  /**
   * Performs on-device Optical Character Recognition (OCR) on an image.
   * If running in Expo Go or native module is not present, gracefully returns empty text.
   */
  static async recognizeText(imageUri: string): Promise<string> {
    // Expo Go does not bundle ML Kit native module
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      return '';
    }

    try {
      let TextRecognition: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        TextRecognition = require('@react-native-ml-kit/text-recognition').default;
      } catch {
        // Native module not linked in current JS environment
        return '';
      }

      if (TextRecognition && typeof TextRecognition.recognize === 'function') {
        const result = await TextRecognition.recognize(imageUri);
        return result?.text?.trim() || '';
      }
      return '';
    } catch (e) {
      console.warn('OCR recognition warning:', e);
      return '';
    }
  }
}
