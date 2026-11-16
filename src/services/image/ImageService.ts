import * as ImageManipulator from 'expo-image-manipulator';
import { PageFilter, PageRotation } from '@/core/types';

export class ImageService {
  /**
   * Applies fast native rotation, resizing and quality compression to a document page
   */
  static async transformPage(
    sourceUri: string,
    rotation: PageRotation = 0,
    filter: PageFilter = 'original',
    qualityLevel: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<string> {
    const actions: ImageManipulator.Action[] = [];

    // Apply rotation
    if (rotation !== 0) {
      actions.push({ rotate: rotation });
    }

    // Determine dimensions based on quality level (NFR-04: <= 400KB per page)
    let maxDimension = 1400;
    let compressVal = 0.8;

    if (qualityLevel === 'low') {
      maxDimension = 1000;
      compressVal = 0.6;
    } else if (qualityLevel === 'high') {
      maxDimension = 1800;
      compressVal = 0.9;
    }

    actions.push({ resize: { width: maxDimension } });

    try {
      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        actions,
        {
          compress: compressVal,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      return result.uri;
    } catch (e) {
      console.warn('ImageManipulator transformPage fallback to source:', e);
      return sourceUri;
    }
  }

  /**
   * Creates a compact thumbnail for lists and grid previews
   */
  static async generateThumbnail(sourceUri: string, rotation: PageRotation = 0): Promise<string> {
    try {
      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        rotation ? [{ rotate: rotation }, { resize: { width: 320 } }] : [{ resize: { width: 320 } }],
        {
          compress: 0.6,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      return result.uri;
    } catch (e) {
      console.warn('ImageManipulator generateThumbnail fallback to source:', e);
      return sourceUri;
    }
  }
}
