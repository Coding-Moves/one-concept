/** Add scroll room only where the keyboard actually covers the profile form. */
export function profileKeyboardInset(viewBottom: number, keyboardTop: number): number {
  if (!Number.isFinite(viewBottom) || !Number.isFinite(keyboardTop)) return 0;
  return Math.max(0, viewBottom - keyboardTop);
}
