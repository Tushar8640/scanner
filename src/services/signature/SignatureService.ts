import * as FileSystem from 'expo-file-system/legacy';

const MAX_SAVED = 6;

/** Saved hand-drawn signatures, kept as PNG files in the app's private storage. */
export class SignatureService {
  private static get dir(): string {
    const base = FileSystem.documentDirectory;
    if (!base) throw new Error('Document directory is not accessible');
    return `${base}signatures/`;
  }

  private static async ensureDir(): Promise<void> {
    const info = await FileSystem.getInfoAsync(this.dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(this.dir, { intermediates: true });
  }

  /** Newest first. */
  static async list(): Promise<string[]> {
    await this.ensureDir();
    const names = (await FileSystem.readDirectoryAsync(this.dir)).filter((n) => n.endsWith('.png'));
    return names.sort().reverse().map((n) => this.dir + n);
  }

  /** Saves a `data:image/png;base64,...` URL and returns its file URI. Keeps at most MAX_SAVED. */
  static async save(dataUrl: string): Promise<string> {
    await this.ensureDir();
    const b64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
    const uri = `${this.dir}sig_${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
    const all = await this.list();
    for (const old of all.slice(MAX_SAVED)) await FileSystem.deleteAsync(old, { idempotent: true });
    return uri;
  }

  static async remove(uri: string): Promise<void> {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }

  static async toDataUrl(uri: string): Promise<string> {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:image/png;base64,${b64}`;
  }
}
