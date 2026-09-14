import { Platform, type ViewStyle } from 'react-native';

// Google Maps-familiar palette. Blue is reserved for the single active/CTA
// state — everything else stays neutral grey/white, the way Maps does it.
export const colors = {
  primary: '#1A73E8',
  primaryPressed: '#1558B0',
  onPrimary: '#FFFFFF',

  surface: '#FFFFFF',
  surfaceVariant: '#F1F3F4', // Maps' chip/row fill grey
  background: '#FFFFFF',

  outline: '#DADCE0', // hairline dividers only, not card borders
  onSurface: '#202124', // Maps' near-black text
  onSurfaceVariant: '#5F6368', // Maps' secondary/meta text

  success: '#188038',
  warning: '#B06000',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const type = {
  // Cap the whole app at 3 weights. Nothing should be '800' — Maps rarely
  // goes past 600 even for titles.
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
};

// Shadow, not border, for anything that floats above the map or the
// background. This single helper replaces every borderWidth/borderColor
// pair used for "card-ness" in the old styles.
export function elevation(level: 1 | 2 | 3): ViewStyle {
  return Platform.select<ViewStyle>({
    android: { elevation: level * 2 },
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: level },
      shadowOpacity: 0.08 + level * 0.02,
      shadowRadius: level * 3,
    },
  })!;
}
