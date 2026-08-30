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
  background: '#F4F5FB',
  surface: '#FFFFFF',
  text: '#171923',
  textSecondary: '#565D6D',
  textMuted: '#8A91A0',
  primary: '#6366F1',
  primaryPressed: '#4F46E5',
  onPrimary: '#FFFFFF',
  success: '#16A34A',
  successSurface: '#E9F8EF',
  streak: '#F97316',
  border: '#E9EBF4',
  categoryChip: '#EEF0FF',
  categoryChipText: '#4F46E5',
  skeleton: '#E9EBF4',
};

export const darkColors: ThemeColors = {
  background: '#0A0C14',
  surface: '#141828',
  text: '#F1F3F9',
  textSecondary: '#A6ADC0',
  textMuted: '#6E7688',
  primary: '#818CF8',
  primaryPressed: '#6366F1',
  onPrimary: '#FFFFFF',
  success: '#34D399',
  successSurface: '#10291F',
  streak: '#FB923C',
  border: '#20263D',
  categoryChip: '#1D2242',
  categoryChipText: '#A5B4FC',
  skeleton: '#20263D',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
};

/** Soft elevation for borderless cards. Invisible on dark backgrounds, where
 *  the hairline border carries the separation instead. */
export const shadows = {
  card: {
    shadowColor: '#101433',
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
};

export const typography = {
  /** Display font for screen titles; loaded in App via expo-font.
   *  No fontWeight here — Android would apply faux bold on top of the 700 font file. */
  title: { fontSize: 28, fontFamily: 'SpaceGrotesk_700Bold' },
  heading: { fontSize: 22, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24 },
  caption: { fontSize: 13 },
};
