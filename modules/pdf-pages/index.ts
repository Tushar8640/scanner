import { requireOptionalNativeModule } from 'expo-modules-core';

interface PdfPagesNative {
  getPageCount(uri: string): Promise<number>;
  renderPages(uri: string, maxSide: number, quality: number, password: string): Promise<string[]>;
  protectPdf(uri: string, password: string): Promise<string>;
  pinShortcut(id: string, label: string, imageUri: string, url: string): Promise<boolean>;
}

// Optional: missing in Expo Go and in app builds made before this module was added
const native = requireOptionalNativeModule<PdfPagesNative>('PdfPages');

export const isPdfSupported = native != null;

function need(): PdfPagesNative {
  if (!native) throw new Error('This needs the latest app build');
  return native;
}

export async function getPageCount(uri: string): Promise<number> {
  return need().getPageCount(uri);
}

/**
 * Renders every page to a JPEG file and returns the file URIs in page order.
 * Rejects with code PDF_PASSWORD (needs a password) or PDF_WRONG_PASSWORD.
 */
export async function renderPages(uri: string, maxSide = 2000, quality = 90, password = ''): Promise<string[]> {
  return need().renderPages(uri, maxSide, quality, password);
}

/** Writes a copy of the PDF that needs `password` to open; returns its file URI. */
export async function protectPdf(uri: string, password: string): Promise<string> {
  return need().protectPdf(uri, password);
}

/** Asks the launcher to pin a home-screen shortcut (Android 8+). Returns false where not supported. */
export async function pinShortcut(id: string, label: string, imageUri: string, url: string): Promise<boolean> {
  if (!native) return false;
  return native.pinShortcut(id, label, imageUri, url);
}
