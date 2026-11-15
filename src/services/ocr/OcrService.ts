export class OcrService {
  /**
   * Performs on-device Optical Character Recognition (OCR) on an image.
   * If a native ML Kit or text-recognition module is installed and linked,
   * it uses it. Otherwise, gracefully returns empty text.
   */
  static async recognizeText(imageUri: string): Promise<string> {
    try {
      let TextRecognition: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        TextRecognition = require('@react-native-ml-kit/text-recognition').default;
      } catch {
        // Native module not linked in current JS/Expo Go environment
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
