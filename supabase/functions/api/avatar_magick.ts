/** ImageMagick WASM is loaded only for an authenticated, bounded photo upload. */
// @ts-ignore Deno resolves npm: imports when bundling this Edge Function.
import { AlphaAction, ImageMagick, MagickColors, MagickFormat, MagickGeometry, initializeImageMagick } from 'npm:@imagemagick/magick-wasm@0.0.44';
import { AvatarInputError } from './avatar_image.ts';

declare const Deno: { readFile(path: URL): Promise<Uint8Array> };

type AvatarMagickImage = {
  width: number; height: number; quality: number; backgroundColor: unknown;
  autoOrient(): void; alpha(value: unknown): void; crop(geometry: unknown): void;
  resize(width: number, height: number): void; strip(): void;
  write(format: unknown, callback: (output: Uint8Array) => void): void;
};

let initialized: Promise<void> | undefined;

export async function normalizeWithMagick(bytes: Uint8Array): Promise<Uint8Array> {
  initialized ??= Deno.readFile(new URL('./magick.wasm', import.meta.url))
    .then(wasm => initializeImageMagick(wasm))
    .catch(error => { initialized = undefined; throw error; });
  await initialized;
  let normalized: Uint8Array | undefined;
  ImageMagick.read(bytes, (image: AvatarMagickImage) => {
    image.autoOrient();
    image.backgroundColor = MagickColors.White;
    image.alpha(AlphaAction.Remove);
    const side = Math.min(image.width, image.height);
    image.crop(new MagickGeometry(Math.floor((image.width - side) / 2),
      Math.floor((image.height - side) / 2), side, side));
    image.resize(512, 512);
    image.strip();
    for (const quality of [85, 78, 70, 62, 54]) {
      image.quality = quality;
      image.write(MagickFormat.Jpeg, (output: Uint8Array) => { normalized = Uint8Array.from(output); });
      if (normalized && normalized.length <= 262_144) return;
    }
  });
  if (!normalized || normalized.length > 262_144) {
    throw new AvatarInputError(422, 'That photo cannot be reduced enough. Choose a simpler image.');
  }
  return normalized;
}
