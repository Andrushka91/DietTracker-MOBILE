// Theme - single source of truth for both platforms.
//
// Visual language: Apple Human Interface Guidelines (iOS system colors and
// materials). The palette below uses the exact iOS system colors for light and
// dark mode - systemBlue as the interactive tint, systemGreen / systemRed for
// the Done / Missed states, systemGray for pending, systemGroupedBackground for
// the page and secondarySystemGroupedBackground for cards, so pages read as
// grouped lists (light: #F2F2F7 page + white cards, dark: black page +
// #1C1C1E cards). Labels use the iOS secondary/tertiary alpha stacks, and
// separations are the opaque separators (#C6C6C8 / #38383A).
//
// Type: the bundled humanist sans (Open Sans) is kept for offline reliability,
// while sizes and weights follow the iOS text styles (see `typeScale` below:
// largeTitle 34 / title 28 / headline 17 / subheadline 15 / footnote 13 /
// caption 12 / caption2 11).
//
//   regular  body text, captions and every button label
//   medium   headings, card titles, counters and the status pills only

import { Platform, type ViewStyle } from 'react-native';

export const fonts = {
  regular: 'OpenSans_400Regular',
  medium: 'OpenSans_600SemiBold',
};

/**
 * Converts an 8-digit hex colour in `#AARRGGBB` order (alpha first - the format
 * the Windows resources and the persisted `MealCategory.Color` column use)
 * into the `#RRGGBBAA` form React Native understands. Short forms and plain
 * `#RRGGBB` values pass through untouched, so the helper is safe to use on
 * values coming from SQLite as well as on the literals below.
 */
export function argb(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    return `#${trimmed.slice(3)}${trimmed.slice(1, 3)}`;
  }
  return trimmed;
}

/**
 * Replaces the alpha channel of an 8-digit `#AARRGGBB` colour, e.g.
 * `withAlpha(done, '1A')` is the 10 % tint a finished calendar day wears.
 */
export function withAlpha(value: string, alpha: string): string {
  const converted = argb(value);
  if (!/^#[0-9a-fA-F]{6,8}$/.test(converted)) {
    return converted;
  }
  return `#${converted.slice(1, 7)}${alpha}`;
}

export interface ThemeColors {
  dark: boolean;
  accent: string;
  accentText: string;
  background: string;
  surface: string;
  /** Greyish card fill for content cards (dashboard cards, statistics panel). */
  cardFill: string;
  surfaceVariant: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  onCardHeader: string;
  done: string;
  missed: string;
  /** Card chrome + dashboard counter of an undecided meal (iOS systemGray). */
  pending: string;
  /** Calendar day cell of a day with nothing decided (iOS gray wash). */
  cellPending: string;
  success: string;
  warning: string;
  error: string;
  overlay: string;
  /** Fill of the primary (accent) buttons - the systemBlue tint itself. */
  accentFill: string;
  /** Text colour on an accent fill. */
  accentFillText: string;
  statusBarStyle: 'light-content' | 'dark-content';
}

/** Dashboard counter chips + meal card chrome (iOS systemGreen / systemRed / systemGray). */
export const DONE_COLOR = argb('#FF34C759');
export const MISSED_COLOR = argb('#FFFF3B30');
export const PENDING_COLOR = argb('#FF8E8E93');
/** Calendar cells keep the quiet gray of an untouched day. */
export const CELL_PENDING_COLOR = argb('#FFE5E5EA');

export const lightColors: ThemeColors = {
  dark: false,
  // iOS systemBlue.
  accent: argb('#FF007AFF'),
  accentText: argb('#FFFFFFFF'),
  // iOS systemGroupedBackground: the page behind grouped cards.
  background: argb('#FFF2F2F7'),
  // iOS secondarySystemGroupedBackground: the grouped card itself.
  surface: argb('#FFFFFFFF'),
  /**
   * Universal card fill: the grey of the calendar's untouched day squares -
   * iOS systemGray5 (#E5E5EA) - shared by every card on every page. The
   * calendar keeps a white panel behind its squares and day rows, which is
   * exactly where this grey reads best.
   */
  cardFill: argb('#FFE5E5EA'),
  // iOS fill (quaternary system fill) - button fills, wells, thumbnails.
  surfaceVariant: argb('#29787680'),
  // iOS separator (opaque light variant).
  border: argb('#FFC6C6C8'),
  // Label / secondaryLabel (60 %) / tertiaryLabel (30 %).
  text: argb('#FF000000'),
  textSecondary: argb('#993C3C43'),
  textMuted: argb('#4D3C3C43'),
  onCardHeader: argb('#FFFFFFFF'),
  // iOS systemGreen / systemRed / systemGray.
  done: DONE_COLOR,
  missed: MISSED_COLOR,
  pending: PENDING_COLOR,
  cellPending: CELL_PENDING_COLOR,
  success: DONE_COLOR,
  // iOS systemOrange.
  warning: argb('#FFFF9500'),
  error: MISSED_COLOR,
  // iOS modal scrim: ~25 % black over the dimmed page.
  overlay: argb('#66000000'),
  // Filled (primary) buttons use the tint itself as the fill.
  accentFill: argb('#FF007AFF'),
  accentFillText: argb('#FFFFFFFF'),
  statusBarStyle: 'dark-content',
};

export const darkColors: ThemeColors = {
  dark: true,
  accent: argb('#FF0A84FF'),
  accentText: argb('#FFFFFFFF'),
  // iOS dark grouped background: pure black page, elevated cards.
  background: argb('#FF000000'),
  surface: argb('#FF1C1C1E'),
  // Dark cards keep the standard #1C1C1E elevated grouped-card tone.
  cardFill: argb('#FF1C1C1E'),
  surfaceVariant: argb('#3D767680'),
  border: argb('#FF38383A'),
  text: argb('#FFFFFFFF'),
  textSecondary: argb('#99EBEBF5'),
  textMuted: argb('#4DEBEBF5'),
  onCardHeader: argb('#FFFFFFFF'),
  // Dark-mode systemGreen / systemRed / systemGray.
  done: argb('#FF30D158'),
  missed: argb('#FFFF453A'),
  pending: argb('#FF98989F'),
  cellPending: argb('#FF48484A'),
  success: argb('#FF30D158'),
  warning: argb('#FFFF9F0A'),
  error: argb('#FFFF453A'),
  overlay: argb('#66000000'),
  accentFill: argb('#FF0A84FF'),
  accentFillText: argb('#FFFFFFFF'),
  statusBarStyle: 'light-content',
};

export function themeColors(isDark: boolean): ThemeColors {
  return isDark ? darkColors : lightColors;
}

/** Shared radii/metrics. */
export const metrics = {
  /** Grouped card corner radius (iOS inset groups sit at 10-12). */
  radius: 12,
  /** Small controls: inputs, thumbnails, tinted chips. */
  radiusSmall: 8,
  /** The 2 px state frame drawn around every meal card (Windows parity). */
  cardBorder: 2,
  spacing: 12,
  spacingSmall: 8,
  /**
   * Gap between two adjacent icon buttons. The Dashboard puts the ✓ / ✕ pair
   * on its action row and every meal card puts the same pair in its bottom
   * right corner, so both read them from here and keep the exact same distance.
   */
  controlGap: 6,
  /**
   * Distance between two cards in the dashboard grid - the same 8 px the page
   * keeps to its left and right edges, so the vertical breathing room between
   * stacked cards matches the horizontal margins.
   */
  gridGap: 8,
  /** Page padding around a scrolling screen. */
  pagePadding: 8,
  /** Minimum height of a meal card (the card only grows with its content). */
  cardMinHeight: 112,
  tabBarHeight: 56,
};

/**
 * iOS text styles (HIG typography): the sizes every screen draws its headings
 * and copy with, so the whole app scales like a native iOS page.
 */
export const typeScale = {
  largeTitle: 34,
  title: 28,
  title2: 22,
  headline: 17,
  body: 16,
  subheadline: 15,
  footnote: 13,
  caption: 12,
  caption2: 11,
} as const;

/**
 * iOS card material: grouped cards float on the grouped background with a
 * soft shadow instead of a hard 1 px stroke. iOS draws the shadow directly;
 * Android uses a matching elevation.
 */
export const cardShadow: ViewStyle = (Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 2 },
  default: {},
}) ?? {}) as ViewStyle;

/** Status pill colors by meal state (spec 8.3 header status pill). */
export function statusColors(theme: ThemeColors): Record<number, string> {
  return {
    0: theme.pending,
    1: theme.done,
    2: theme.missed,
  };
}
