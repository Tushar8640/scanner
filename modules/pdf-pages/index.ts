import { requireOptionalNativeModule } from 'expo-modules-core';

interface PdfPagesNative {
  getPageCount(uri: string): Promise<number>;
  renderPages(uri: string, maxSide: number, quality: number): Promise<string[]>;
}

// Optional: missing in Expo Go and in app builds made before this module was added
const native = requireOptionalNativeModule<PdfPagesNative>('PdfPages');

export const isPdfSupported = native != null;

export async function getPageCount(uri: string): Promise<number> {
  if (!native) throw new Error('PDF import needs a new app build');
  return native.getPageCount(uri);
}

/** Renders every page to a JPEG file and returns the file URIs in page order. */
export async function renderPages(uri: string, maxSide = 2000, quality = 90): Promise<string[]> {
  if (!native) throw new Error('PDF import needs a new app build');
  return native.renderPages(uri, maxSide, quality);
}
