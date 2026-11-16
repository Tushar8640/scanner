/**
 * Saves page images to the phone's photo gallery.
 * expo-media-library is loaded lazily: importing it at startup crashed Expo Go before.
 */
export class GalleryService {
  /** Returns how many images were saved. Throws if permission is refused. */
  static async saveImages(uris: string[]): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const MediaLibrary = require('expo-media-library');
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm?.granted) throw new Error('Gallery permission is required to save images');
    let saved = 0;
    for (const uri of uris) {
      await MediaLibrary.Asset.create(uri);
      saved++;
    }
    return saved;
  }
}
