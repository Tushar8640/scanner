import TextRecognition from '@react-native-ml-kit/text-recognition';

export class OcrService {
  /**
   * Performs on-device Optical Character Recognition (OCR) on an image.
   * Uses native ML Kit text recognition module.
   */
  static async recognizeText(imageUri: string): Promise<string> {
    try {
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
