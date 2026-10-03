/** Match the API's NFC, Unicode-code-point length and control-character rules. */
export function normalizeProfileName(value: string): string {
  const name = value.normalize('NFC').trim();
  if (!name) throw new Error('Enter a preferred name.');
  if (Array.from(name).length > 60) throw new Error('Use 60 characters or fewer.');
  if (/\p{C}/u.test(name)) throw new Error('Remove unsupported characters from your name.');
  return name;
}
