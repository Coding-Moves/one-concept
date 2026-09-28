import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lightColors, darkColors } from '../src/theme/index.ts';
const luminance = hex => {
  const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255)
    .map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
};
for (const [name, colors] of Object.entries({light:lightColors,dark:darkColors})) {
  test(`${name} offline status meets normal-text contrast`, () => {
    const a=luminance(colors.offlineBackground), b=luminance(colors.offlineText);
    assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5);
  });
}

const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
for (const [name, colors] of Object.entries({light:lightColors,dark:darkColors})) {
  test(`${name} reading, success and selected-control colors remain readable`, () => {
    for (const foreground of ['text', 'textSecondary', 'textMuted', 'primary']) {
      for (const background of ['background', 'surface']) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 4.5,
          `${foreground} on ${background}`);
      }
    }
    assert.ok(contrast(colors.success, colors.successSurface) >= 4.5);
    for (const background of ['primary', 'primaryPressed']) {
      assert.ok(contrast(colors.onPrimary, colors[background]) >= 4.5, background);
    }
    assert.ok(contrast(colors.categoryChipText, colors.categoryChip) >= 4.5);
    assert.ok(contrast(colors.successBorder, colors.successSurface) >= 3);
    assert.ok(contrast(colors.successBorder, colors.background) >= 3);
  });
}
