/** Strict upload bounds before loading the image decoder. */
export class AvatarInputError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_INPUT = 5 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const MAX_LOSSLESS_PIXELS = 8_000_000;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function dimensions(bytes: Uint8Array): { mime: string; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50
    && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d
    && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    return { mime: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = u16be(bytes, offset);
      if (size < 2 || offset + size > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 7) return null;
        return { mime: 'image/jpeg', height: u16be(bytes, offset + 3),
          width: u16be(bytes, offset + 5) };
      }
      offset += size;
    }
  }
  if (bytes.length >= 30
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const format = String.fromCharCode(...bytes.subarray(12, 16));
    if (format === 'VP8X') {
      return { mime: 'image/webp',
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    }
    if (format === 'VP8L' && bytes[20] === 0x2f) {
      return { mime: 'image/webp',
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10) };
    }
    if (format === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01
      && bytes[25] === 0x2a) {
      return { mime: 'image/webp',
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    }
  }
  return null;
}

export function inspectAvatar(bytes: Uint8Array, contentType: string): void {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (!ACCEPTED.has(mime)) {
    throw new AvatarInputError(415, 'Choose a JPEG, PNG, or WebP photo');
  }
  if (bytes.length > MAX_INPUT) {
    throw new AvatarInputError(413, 'Choose an image smaller than 5 MB');
  }
  const found = dimensions(bytes);
  if (!found || found.mime !== mime || found.width === 0 || found.height === 0) {
    throw new AvatarInputError(422, 'Choose a valid photo in JPEG, PNG, or WebP format');
  }
  if (found.width * found.height > MAX_PIXELS) {
    throw new AvatarInputError(422, 'Choose a photo with fewer than 25 million pixels');
  }
  if (found.mime !== 'image/jpeg' && found.width * found.height > MAX_LOSSLESS_PIXELS) {
    throw new AvatarInputError(422, 'Choose a PNG or WebP photo with fewer than 8 million pixels');
  }
}

export async function normalizeAvatar(bytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  inspectAvatar(bytes, contentType);
  const { normalizeWithMagick } = await import('./avatar_magick.ts');
  return normalizeWithMagick(bytes);
}
