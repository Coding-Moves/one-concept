import assert from 'node:assert/strict';
import { test } from 'node:test';
import './helpers/resolve-ts.mjs';

const { hasJpegSignature, jpegBytesFromBase64, prepareProfilePhoto } = await import('../src/services/profilePhotoPreparation.ts');

test('Expo base64 JPEG output becomes the exact binary upload body', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x81, 0xfe]);
  const bytes = jpegBytesFromBase64(jpeg.toString('base64'));
  assert.deepEqual(Buffer.from(bytes), jpeg);
  assert.equal(hasJpegSignature(bytes), true);
});

test('a bounded gallery or camera JPEG saves without opening the native converter', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x81, 0xfe]);
  const asset = { uri: 'file:///chosen.jpg', width: 100, height: 100, base64: jpeg.toString('base64') };
  assert.deepEqual(Buffer.from(await prepareProfilePhoto(asset)), jpeg);
});

test('empty, non-JPEG and oversized encoder output cannot be uploaded as JPEG', () => {
  assert.equal(jpegBytesFromBase64(''), null);
  assert.equal(hasJpegSignature(Uint8Array.of(0xff, 0xd8)), false);
  assert.throws(() => jpegBytesFromBase64(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')), /JPEG/);
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  assert.equal(jpegBytesFromBase64(oversized.toString('base64')), null);
});
