import type { ImagePickerAsset } from 'expo-image-picker';
import { byteLength, toByteArray } from 'base64-js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ATTEMPTS = [
  { longestSide: 1600, quality: 0.82 },
  { longestSide: 1024, quality: 0.68 },
  { longestSide: 768, quality: 0.55 },
] as const;

export class ProfilePhotoPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfilePhotoPreparationError';
  }
}

export function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Decode only bounded JPEG output; never trust the picker or encoder's MIME label. */
export function jpegBytesFromBase64(base64: string): Uint8Array<ArrayBuffer> | null {
  if (!base64 || byteLength(base64) > MAX_UPLOAD_BYTES) return null;
  const bytes = new Uint8Array(toByteArray(base64));
  if (!hasJpegSignature(bytes)) throw new Error('native encoder did not return JPEG');
  return bytes;
}

/** The API accepts JPEG bytes up to 5 MB, regardless of picker metadata. */
export async function prepareProfilePhoto(asset: ImagePickerAsset): Promise<Uint8Array<ArrayBuffer>> {
  if (!asset.uri || !Number.isFinite(asset.width) || !Number.isFinite(asset.height)
      || asset.width <= 0 || asset.height <= 0) {
    throw new ProfilePhotoPreparationError('This photo could not be read. Choose another image.');
  }

  // The picker can already provide JPEG bytes for gallery and camera images.
  // Use them when bounded so saving still works if native resizing fails.
  if (asset.base64) {
    try {
      const picked = jpegBytesFromBase64(asset.base64);
      if (picked) return picked;
    } catch { /* Try the converter for a non-JPEG picker result. */ }
  }

  for (const { longestSide, quality } of ATTEMPTS) {
    try {
      // Load the converter only when the picker output needs resizing or
      // normalization; a valid bounded JPEG needs no further native work.
      const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
      const context = ImageManipulator.manipulate(asset.uri);
      const longer = Math.max(asset.width, asset.height);
      if (longer > longestSide) {
        if (asset.width >= asset.height) context.resize({ width: longestSide });
        else context.resize({ height: longestSide });
      }
      const image = await context.renderAsync();
      // Expo supplies the encoded JPEG directly. Avoid fetch(file://) and the
      // React Native Blob/FileReader bridge, which can fail on Android devices.
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      const bytes = jpegBytesFromBase64(saved.base64 ?? '');
      if (bytes) return bytes;
    } catch {
      throw new ProfilePhotoPreparationError('This phone could not prepare that photo. Try a different JPEG or PNG image.');
    }
  }
  throw new ProfilePhotoPreparationError('This photo is still too large. Choose another image.');
}
