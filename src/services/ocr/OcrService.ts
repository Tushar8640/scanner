import Constants, { ExecutionEnvironment } from 'expo-constants';

export interface OcrLine {
  text: string;
  /** Position in image pixels. */
  frame: { left: number; top: number; width: number; height: number };
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

function nativeRecognizer(): any {
  // Expo Go does not bundle the ML Kit native module
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-ml-kit/text-recognition').default;
    return mod && typeof mod.recognize === 'function' ? mod : null;
  } catch {
    return null;
  }
}

export class OcrService {
  /**
   * Performs on-device Optical Character Recognition (OCR) on an image.
   * If running in Expo Go or native module is not present, gracefully returns empty text.
   */
  static async recognizeText(imageUri: string): Promise<string> {
    return (await this.recognize(imageUri)).text;
  }

  /** Text plus each line's position, for a searchable text layer in PDFs. */
  static async recognize(imageUri: string): Promise<OcrResult> {
    const rec = nativeRecognizer();
    if (!rec) return { text: '', lines: [] };
    try {
      const result = await rec.recognize(imageUri);
      const lines: OcrLine[] = [];
      for (const block of result?.blocks ?? []) {
        for (const line of block?.lines ?? []) {
          const f = line?.frame;
          if (line?.text && f && f.width > 0 && f.height > 0) {
            lines.push({ text: line.text, frame: { left: f.left, top: f.top, width: f.width, height: f.height } });
          }
        }
      }
      return { text: result?.text?.trim() || '', lines };
    } catch (e) {
      console.warn('OCR recognition warning:', e);
      return { text: '', lines: [] };
    }
  }
}
