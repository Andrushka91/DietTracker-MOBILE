// Port of DietTracker.Core.BusinessRules.PhotoRules (spec 5.6).

/** Maximum number of photographs attached to a single meal slot. */
export const MAX_PHOTOS_PER_MEAL = 3;

/** Maximum size of an original photograph: 10 MB. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Maximum width/height of a generated thumbnail. */
export const THUMBNAIL_SIZE = 256;

/** JPEG quality used when the thumbnail is encoded. */
export const THUMBNAIL_QUALITY = 80;

/** MIME types accepted by validation. */
export const ALLOWED_MIME_TYPES: string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** File extensions accepted from the picker. */
export const ALLOWED_EXTENSIONS: string[] = ['.jpg', '.jpeg', '.png', '.webp'];

/** Maps a file extension to the canonical MIME type, or null when unsupported. */
export function mimeTypeFromExtension(extension: string): string | null {
  switch (extension.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return null;
  }
}

/**
 * Sniffs the file signature. A file whose bytes do not match the declared
 * image format is rejected so a renamed executable can never reach the store.
 * Requires at least the first 12 header bytes.
 */
export function hasValidSignature(mimeType: string, header: Uint8Array): boolean {
  if (header.length < 12) {
    return false;
  }
  switch (mimeType) {
    case 'image/jpeg':
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case 'image/png':
      return (
        header[0] === 0x89 &&
        header[1] === 0x50 &&
        header[2] === 0x4e &&
        header[3] === 0x47 &&
        header[4] === 0x0d &&
        header[5] === 0x0a &&
        header[6] === 0x1a &&
        header[7] === 0x0a
      );
    case 'image/webp':
      return (
        header[0] === 0x52 && // R
        header[1] === 0x49 && // I
        header[2] === 0x46 && // F
        header[3] === 0x46 && // F
        header[8] === 0x57 && // W
        header[9] === 0x45 && // E
        header[10] === 0x42 && // B
        header[11] === 0x50 // P
      );
    default:
      return false;
  }
}

/** True when another photograph may be added to the meal. */
export function canAddPhoto(currentPhotoCount: number): boolean {
  return currentPhotoCount < MAX_PHOTOS_PER_MEAL;
}