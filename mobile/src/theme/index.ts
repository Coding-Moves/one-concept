/**
 * Global type scale. Every font size and line height in the app is wrapped
 * in scaleFont(), so the whole app's text scales from this one multiplier.
 * Rounded to the nearest half-point to stay crisp on screen.
 */
export const FONT_SCALE = 0.9;
export const scaleFont = (n: number): number => Math.round(n * FONT_SCALE * 2) / 2;
/** Same scale for icon glyphs, rounded to whole pixels so they stay crisp. */
export const scaleIcon = (n: number): number => Math.round(n * FONT_SCALE);

export interface ThemeColors {
  background: string;
  surface: string;
  /** A quiet inset surface for examples, selected metadata and inline states. */
  surfaceSubtle: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  offlineBackground: string;
  offlineText: string;
  success: string;
  successSurface: string;
  successBorder: string;
  danger: string;
  dangerSurface: string;
  streak: string;
  /** The Like heart — deliberately rose, not the streak's orange flame (#114). */
  like: string;
  border: string;
  categoryChip: string;
  categoryChipText: string;
  skeleton: string;
  primaryAccent: string;
  primaryAccentSurface: string;
  connectionAccent: string;
  connectionAccentSurface: string;
  quizAccent: string;
  quizAccentSurface: string;
  achievementAccent: string;
  achievementAccentSurface: string;
  savedAccent: string;
  savedAccentSurface: string;
  streakAccent: string;
  streakAccentSurface: string;
}

export const lightColors: ThemeColors = {
  background: '#F4F5FB',
  surface: '#FFFFFF',
  surfaceSubtle: '#EEF0FF',
  text: '#171923',
  textSecondary: '#565D6D',
  textMuted: '#626B7D',
  primary: '#5558DB',
  primaryPressed: '#4F46E5',
  onPrimary: '#FFFFFF',
  offlineBackground: '#3730A3',
  offlineText: '#FFFFFF',
  success: '#137A3A',
  successSurface: '#E9F8EF',
  successBorder: '#137A3A',
  danger: '#C81E3A',
  dangerSurface: '#FFF0F2',
  streak: '#F97316',
  like: '#E11D48',
  border: '#E9EBF4',
  categoryChip: '#EEF0FF',
  categoryChipText: '#4F46E5',
  skeleton: '#E9EBF4',
  primaryAccent: '#5558DB',
  primaryAccentSurface: '#EEF0FF',
  connectionAccent: '#0F766E',
  connectionAccentSurface: '#E2F7F3',
  quizAccent: '#B45309',
  quizAccentSurface: '#FFF4DE',
  achievementAccent: '#7C3AED',
  achievementAccentSurface: '#F3E8FF',
  savedAccent: '#2563EB',
  savedAccentSurface: '#E8F0FF',
  streakAccent: '#EA580C',
  streakAccentSurface: '#FFF0E4',
};

export const darkColors: ThemeColors = {
  background: '#0A0C14',
  surface: '#141828',
  surfaceSubtle: '#1D2242',
  text: '#F1F3F9',
  textSecondary: '#A6ADC0',
  textMuted: '#A0A9BC',
  primary: '#818CF8',
  primaryPressed: '#A5B4FC',
  onPrimary: '#0A0C14',
  offlineBackground: '#C7D2FE',
  offlineText: '#1E1B4B',
  success: '#34D399',
  successSurface: '#10291F',
  successBorder: '#34D399',
  danger: '#FB7185',
  dangerSurface: '#3A1520',
  streak: '#FB923C',
  like: '#FB7185',
  border: '#20263D',
  categoryChip: '#1D2242',
  categoryChipText: '#A5B4FC',
  skeleton: '#20263D',
  primaryAccent: '#A5B4FC',
  primaryAccentSurface: '#282F62',
  connectionAccent: '#5EEAD4',
  connectionAccentSurface: '#103A39',
  quizAccent: '#FCD34D',
  quizAccentSurface: '#493712',
  achievementAccent: '#D8B4FE',
  achievementAccentSurface: '#3B205A',
  savedAccent: '#93C5FD',
  savedAccentSurface: '#193765',
  streakAccent: '#FDBA74',
  streakAccentSurface: '#4D2916',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

/** Minimum target size recommended by platform accessibility guidance. */
export const touchTarget = 44;

/** Short feedback timings keep actions responsive without becoming decoration. */
export const motion = {
  quick: 160,
  standard: 220,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
};

/** Soft elevation for borderless cards; theme surface colors provide separation. */
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
  title: { fontSize: scaleFont(28), fontFamily: 'SpaceGrotesk_700Bold' },
  heading: { fontSize: scaleFont(22), fontWeight: '700' as const },
  body: { fontSize: scaleFont(16), lineHeight: scaleFont(24) },
  caption: { fontSize: scaleFont(13) },
};
