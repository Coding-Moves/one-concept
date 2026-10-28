import type { ImagePickerAsset } from 'expo-image-picker';

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

/** The API accepts JPEG bytes up to 5 MB, regardless of picker metadata. */
export async function prepareProfilePhoto(asset: ImagePickerAsset): Promise<Blob> {
  if (!asset.uri || !Number.isFinite(asset.width) || !Number.isFinite(asset.height)
      || asset.width <= 0 || asset.height <= 0) {
    throw new ProfilePhotoPreparationError('This photo could not be read. Choose another image.');
  }

  for (const { longestSide, quality } of ATTEMPTS) {
    try {
      // Load only when saving: installed binaries need the native module in
      // their next APK, but older builds should still open the profile screen.
      const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
      const context = ImageManipulator.manipulate(asset.uri);
      const longer = Math.max(asset.width, asset.height);
      if (longer > longestSide) {
        if (asset.width >= asset.height) context.resize({ width: longestSide });
        else context.resize({ height: longestSide });
      }
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
      const response = await fetch(saved.uri);
      const bytes = await response.blob();
      // Never claim JPEG if the native encoder returned something else.
      const signature = new Uint8Array(await bytes.slice(0, 3).arrayBuffer());
      if (signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) {
        throw new Error('native encoder did not return JPEG');
      }
      if (bytes.size > 0 && bytes.size <= MAX_UPLOAD_BYTES) return bytes;
    } catch {
      throw new ProfilePhotoPreparationError('This phone could not prepare that photo. Try a different JPEG or PNG image.');
    }
  }
  throw new ProfilePhotoPreparationError('This photo is still too large. Choose another image.');
}
