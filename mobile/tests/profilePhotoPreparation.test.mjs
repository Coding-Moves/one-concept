import assert from 'node:assert/strict';
import { test } from 'node:test';
import './helpers/resolve-ts.mjs';

const { hasJpegSignature } = await import('../src/services/profilePhotoPreparation.ts');

function nativeStyleBlob(bytes) {
  return {
    size: bytes.length,
    // React Native 0.86 Blob exposes slice(), but not arrayBuffer().
    slice(start, end) { return { bytes: bytes.slice(start, end) }; },
  };
}

test('JPEG signature is read through FileReader from a native-style Blob', async () => {
  const original = globalThis.FileReader;
  let bytesRead = 0;
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      bytesRead = blob.bytes.length;
      this.result = blob.bytes.buffer;
      queueMicrotask(() => this.onload());
    }
  };
  try {
    assert.equal(await hasJpegSignature(nativeStyleBlob(Uint8Array.of(0xff, 0xd8, 0xff, 0x00))), true);
    assert.equal(bytesRead, 3, 'only the header should cross the JS/native boundary');
    assert.equal(await hasJpegSignature(nativeStyleBlob(Uint8Array.of(0x89, 0x50, 0x4e, 0x47))), false);
    assert.equal(await hasJpegSignature(nativeStyleBlob(Uint8Array.of())), false);
  } finally {
    globalThis.FileReader = original;
  }
});

test('an unreadable native photo header rejects instead of uploading unchecked bytes', async () => {
  const original = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsArrayBuffer() {
      this.error = new Error('native read failed');
      queueMicrotask(() => this.onerror());
    }
  };
  try {
    await assert.rejects(hasJpegSignature(nativeStyleBlob(Uint8Array.of(0xff, 0xd8, 0xff))), /native read failed/);
  } finally {
    globalThis.FileReader = original;
  }
});
