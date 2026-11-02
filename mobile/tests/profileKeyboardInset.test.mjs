import assert from 'node:assert/strict';
import { test } from 'node:test';
import './helpers/resolve-ts.mjs';

const { profileKeyboardInset } = await import('../src/services/profileKeyboardInset.ts');

test('profile form adds scroll room for an overlay keyboard without doubling resize', () => {
  assert.equal(profileKeyboardInset(1200, 760), 440, 'overlay keyboard covers lower form');
  assert.equal(profileKeyboardInset(760, 760), 0, 'resized form already ends above keyboard');
  assert.equal(profileKeyboardInset(700, 760), 0, 'keyboard below the form needs no inset');
  assert.equal(profileKeyboardInset(1200, 760), 440, 'repeated keyboard events must not accumulate padding');
  assert.equal(profileKeyboardInset(Number.NaN, 760), 0, 'invalid geometry must not affect layout');
});
