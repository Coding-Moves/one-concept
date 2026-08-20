export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  success: string;
  successSurface: string;
  streak: string;
  border: string;
  categoryChip: string;
  categoryChipText: string;
  skeleton: string;
}

export const lightColors: ThemeColors = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  text: '#1A1D21',
  textSecondary: '#5C6470',
  textMuted: '#8A919C',
  primary: '#2F6BFF',
  primaryPressed: '#2456D6',
  onPrimary: '#FFFFFF',
  success: '#1F9D55',
  successSurface: '#E7F6EE',
  streak: '#E8590C',
  border: '#E4E7EC',
  categoryChip: '#EEF2FF',
  categoryChipText: '#3B4CCA',
  skeleton: '#E4E7EC',
};

export const darkColors: ThemeColors = {
  background: '#0F1115',
  surface: '#181C23',
  text: '#F2F4F7',
  textSecondary: '#A8B0BB',
  textMuted: '#6F7885',
  primary: '#5B8CFF',
  primaryPressed: '#3E6FE8',
  onPrimary: '#FFFFFF',
  success: '#3DD68C',
  successSurface: '#122A1E',
  streak: '#FF8A3D',
  border: '#262C36',
  categoryChip: '#1E2438',
  categoryChipText: '#9DAFF7',
  skeleton: '#262C36',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
};

export const typography = {
  /** Display font for screen titles; loaded in App via expo-font.
   *  No fontWeight here — Android would apply faux bold on top of the 700 font file. */
  title: { fontSize: 28, fontFamily: 'SpaceGrotesk_700Bold' },
  heading: { fontSize: 22, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24 },
  caption: { fontSize: 13 },
};
