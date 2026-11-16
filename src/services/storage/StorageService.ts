import * as FileSystem from 'expo-file-system/legacy';

export class StorageService {
  private static get baseDir(): string {
    const dir = FileSystem.documentDirectory;
    if (!dir) {
      throw new Error('Document directory is not accessible');
    }
    return `${dir}documents/`;
  }

  static async init(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(this.baseDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(this.baseDir, { intermediates: true });
    }
  }

  static getDocumentDir(documentId: string): string {
    return `${this.baseDir}${documentId}/`;
  }

  static async ensureDocumentDir(documentId: string): Promise<{
    docDir: string;
    origDir: string;
    procDir: string;
  }> {
    await this.init();
    const docDir = this.getDocumentDir(documentId);
    const origDir = `${docDir}original/`;
    const procDir = `${docDir}processed/`;

    const origInfo = await FileSystem.getInfoAsync(origDir);
    if (!origInfo.exists) {
      await FileSystem.makeDirectoryAsync(origDir, { intermediates: true });
    }

    const procInfo = await FileSystem.getInfoAsync(procDir);
    if (!procInfo.exists) {
      await FileSystem.makeDirectoryAsync(procDir, { intermediates: true });
    }

    return { docDir, origDir, procDir };
  }

  static async saveOriginalImage(documentId: string, pageId: string, sourceUri: string): Promise<string> {
    const { origDir } = await this.ensureDocumentDir(documentId);
    const targetUri = `${origDir}${pageId}.jpg`;
    await this.safeCopyFile(sourceUri, targetUri);
    return targetUri;
  }

  static async saveProcessedImage(documentId: string, pageId: string, sourceUri: string): Promise<string> {
    const { procDir } = await this.ensureDocumentDir(documentId);
    const targetUri = `${procDir}${pageId}.jpg`;
    await this.safeCopyFile(sourceUri, targetUri);
    return targetUri;
  }

  static async saveThumbnail(documentId: string, sourceUri: string): Promise<string> {
    const { docDir } = await this.ensureDocumentDir(documentId);
    // A new name every time, so image caches never show an outdated cover
    const targetUri = `${docDir}thumb_${Date.now()}.jpg`;
    await this.safeCopyFile(sourceUri, targetUri);
    const names = await FileSystem.readDirectoryAsync(docDir);
    for (const n of names) {
      if (/^thumb(_\d+)?\.jpg$/.test(n) && `${docDir}${n}` !== targetUri) {
        await FileSystem.deleteAsync(`${docDir}${n}`, { idempotent: true });
      }
    }
    return targetUri;
  }

  private static async safeCopyFile(fromUri: string, toUri: string): Promise<void> {
    try {
      const info = await FileSystem.getInfoAsync(toUri);
      if (info.exists) {
        await FileSystem.deleteAsync(toUri, { idempotent: true });
      }
      await FileSystem.copyAsync({ from: fromUri, to: toUri });
    } catch {
      // Fallback: direct Base64 read-and-write for stubborn Android content URIs
      const data = await FileSystem.readAsStringAsync(fromUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await FileSystem.writeAsStringAsync(toUri, data, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  }

  static getExportPdfPath(documentId: string): string {
    return `${this.getDocumentDir(documentId)}export.pdf`;
  }

  static async deleteDocumentDir(documentId: string): Promise<void> {
    const docDir = this.getDocumentDir(documentId);
    const info = await FileSystem.getInfoAsync(docDir);
    if (info.exists) {
      await FileSystem.deleteAsync(docDir, { idempotent: true });
    }
  }

  static async getBase64(fileUri: string): Promise<string> {
    return await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
}
