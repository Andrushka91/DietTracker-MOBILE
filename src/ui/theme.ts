// Theme - single source of truth for both platforms.
//
// Visual language: calm neutral surfaces, a quiet elevation model and exactly
// ONE accent colour, so the page reads as a calm grouped list instead of a
// stack of grey boxes. Three rules drive the palette:
//
//   1. Cards are ALWAYS lighter than the page they sit on (light: white cards
//      on a cool #F4F6F8 wash; dark: #151B23 cards on a near-black #0B0F14
//      page) and are lifted by a soft shadow, never by a hard stroke.
//   2. The accent is indigo (#4655D6 light / #8B95F6 dark) - deliberately NOT
//      one of the three state hues, so "this is interactive" never competes
//      with done / missed / pending.
//   3. State colours are muted versions of green / red / slate: they carry the
//      frame of a meal card and the status pill, but the pill always repeats
//      the state in WORDS plus a glyph, so nothing depends on colour alone.
//
// Type: the bundled humanist sans (Open Sans) is kept for offline reliability.
// Titles are 700 with a touch of negative tracking, card titles and labels 600,
// body copy 400; sizes follow the iOS text styles (see `typeScale` below:
// largeTitle 34 / title 28 / headline 17 / subheadline 15 / footnote 13 /
// caption 12 / caption2 11).
//
//   regular  body text and captions
//   medium   card titles, counters, status pills and button labels
//   bold     page titles only (pageTitleStyle below)

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const fonts = {
  regular: 'OpenSans_400Regular',
  medium: 'OpenSans_600SemiBold',
  bold: 'OpenSans_700Bold',
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
  /**
   * Hairline between a card's content and its action row. One step lighter than
   * `border`, so a divider separates without drawing a second frame.
   */
  hairline: string;
  /** Fill of a disabled control (never a washed accent - see buttons.tsx). */
  disabledFill: string;
  /** Ink of a disabled control: muted, but still readable. */
  disabledText: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  onCardHeader: string;
  /**
   * Ink for text drawn ON a state fill (the status pills). Light mode puts white
   * on the deep state colour; dark mode puts near-black on the lighter one, so
   * "Done" / "Missed" / "Pending" never become white-on-light-green.
   */
  onState: string;
  done: string;
  missed: string;
  /** Card chrome + dashboard counter of an undecided meal (iOS systemGray). */
  pending: string;
  /** Calendar day cell of a day with nothing decided (iOS gray wash). */
  cellPending: string;
  /**
   * Quiet fill of the PENDING segment in a statistics bar. A solid mid-grey
   * pending fill dominated rows that were mostly empty; this is the neutral
   * "line" tone the review design uses, while the counts keep the exact values.
   */
  barPending: string;
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

/**
 * State colours - ONE definition shared by every card rail, pill, counter and
 * calendar day, so "done" looks identical on the dashboard, the calendar and
 * the statistics. Muted on purpose: a screen full of meals must not shout.
 * The light values are deep enough to keep white pill text above 4.5:1.
 */
export const DONE_COLOR = argb('#FF157A4C');
export const MISSED_COLOR = argb('#FFC43A3A');
export const PENDING_COLOR = argb('#FF8A93A3');
/** Calendar cells keep a quiet wash for a day with nothing decided. */
export const CELL_PENDING_COLOR = argb('#FFE9EEF5');

export const lightColors: ThemeColors = {
  dark: false,
  // Indigo - the only interactive colour in the app.
  accent: argb('#FF4655D6'),
  accentText: argb('#FFFFFFFF'),
  // Cool, low-chroma page wash: cards must read lighter than this.
  background: argb('#FFF4F6F8'),
  surface: argb('#FFFFFFFF'),
  /**
   * Card fill: pure white on the tinted page. Elevation (cardShadow) is what
   * separates a card from the page - never a grey fill, which used to make
   * every card look pressed into the background.
   */
  cardFill: argb('#FFFFFFFF'),
  // Controls, segments, inputs and icon-button chrome: a touch deeper than the
  // page tint so a chip reads as a chip on both the page and a white card.
  surfaceVariant: argb('#FFE9EEF5'),
  border: argb('#FFDCE3EC'),
  hairline: argb('#FFEDF1F6'),
  disabledFill: argb('#FFE9EEF5'),
  disabledText: argb('#FF7C8798'),
  // Ink: near-black with a blue cast, then two quiet steps for meta text.
  // Both secondary steps keep at least 4.5:1 on the page AND on a white card -
  // the previous muted grey (#98A2B3) was ~2.6:1 and failed for 11-12 pt text.
  text: argb('#FF101828'),
  textSecondary: argb('#FF3F4A5A'),
  textMuted: argb('#FF667085'),
  onCardHeader: argb('#FFFFFFFF'),
  onState: argb('#FFFFFFFF'),
  done: DONE_COLOR,
  missed: MISSED_COLOR,
  pending: PENDING_COLOR,
  cellPending: CELL_PENDING_COLOR,
  barPending: argb('#FFDCE3EC'),
  success: DONE_COLOR,
  warning: argb('#FFC77700'),
  error: MISSED_COLOR,
  // Modal scrim: ~40 % ink, enough to isolate the dialog in either theme.
  overlay: argb('#66000000'),
  // Filled (primary) buttons use the accent itself as the fill.
  accentFill: argb('#FF4655D6'),
  accentFillText: argb('#FFFFFFFF'),
  statusBarStyle: 'dark-content',
};

export const darkColors: ThemeColors = {
  dark: true,
  // The same indigo, lightened so it stays legible on near-black.
  accent: argb('#FF8B95F6'),
  accentText: argb('#FF0B0F14'),
  background: argb('#FF0B0F14'),
  surface: argb('#FF151B23'),
  // Cards keep the elevated surface tone - one step above the page.
  cardFill: argb('#FF151B23'),
  surfaceVariant: argb('#FF1F2833'),
  border: argb('#FF2A3542'),
  hairline: argb('#FF222B36'),
  disabledFill: argb('#FF1B222B'),
  disabledText: argb('#FF8B98A9'),
  text: argb('#FFF5F7FA'),
  // Opaque secondary inks: alpha-on-near-black drifted below 4.5:1 in the
  // small captions, so both steps are solid colours now.
  textSecondary: argb('#FFC6D0DC'),
  textMuted: argb('#FF9AA8BA'),
  onCardHeader: argb('#FFFFFFFF'),
  // Dark state colours are bright, so the pill ink flips to the page colour.
  onState: argb('#FF0B0F14'),
  // Dark-mode states are the light-mode hues, raised for contrast.
  done: argb('#FF34D399'),
  missed: argb('#FFF87171'),
  pending: argb('#FF94A3B8'),
  cellPending: argb('#FF1B222B'),
  barPending: argb('#FF333D4E'),
  success: argb('#FF34D399'),
  warning: argb('#FFF5A524'),
  error: argb('#FFF87171'),
  overlay: argb('#99000000'),
  accentFill: argb('#FF8B95F6'),
  accentFillText: argb('#FF0B0F14'),
  statusBarStyle: 'light-content',
};

export function themeColors(isDark: boolean): ThemeColors {
  return isDark ? darkColors : lightColors;
}

/** Shared radii/metrics - one spacing rhythm for every page. */
export const metrics = {
  /** Card corner radius. */
  radius: 16,
  /** Small controls: inputs, thumbnails, icon buttons. */
  radiusSmall: 10,
  /** Status pills and small kind chips. */
  radiusChip: 8,
  /** Capsule radius for status pills and the segmented track. */
  radiusPill: 999,
  /**
   * Width of the state rail on a meal card / calendar day row. The rail carries
   * the state in the same three colours everywhere; the card itself keeps a
   * neutral hairline, so five meals in a row no longer read as five glowing
   * boxes and the meal content stays the loudest thing on the card.
   */
  statusRail: 3,
  /** Neutral hairline around every card (the rail/pill carries the state). */
  cardBorder: 1,
  spacing: 16,
  spacingSmall: 10,
  /** Minimum square a finger needs - the tab bar and every icon button. */
  minTouch: 44,
  /**
   * Gap between two adjacent icon buttons. The Dashboard puts the ✓ / ✕ pair
   * on its action row and every meal card puts the same pair in its bottom
   * right corner, so both read them from here and keep the exact same distance.
   */
  controlGap: 4,
  /**
   * Distance between two cards in the dashboard grid (and the gap between
   * stacked cards on every other page), so the vertical breathing room matches
   * the horizontal page margin.
   */
  gridGap: 12,
  /** Page padding around a scrolling screen. */
  pagePadding: 16,
  /** Minimum height of a meal card (the card only grows with its content). */
  cardMinHeight: 104,
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
 * The page title every screen starts with ("Today" date line, "Statistics",
 * "Templates", "Settings", the calendar month): 700 with a little negative
 * tracking, which is what makes the hierarchy read at a glance.
 */
export const pageTitleStyle: TextStyle = {
  fontSize: typeScale.title,
  lineHeight: Math.round(typeScale.title * 1.15),
  fontFamily: fonts.bold,
  letterSpacing: -0.6,
};

/**
 * Card elevation: cards are lifted by a soft shadow instead of a stroke. iOS
 * draws the shadow directly; Android uses a matching elevation.
 */
export const cardShadow: ViewStyle = (Platform.select({
  ios: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 3 },
  default: {},
}) ?? {}) as ViewStyle;

/**
 * Raised elevation for the elements that float ABOVE the page - the tab bar and
 * modal cards - so the depth order stays obvious: page < card < floating bar.
 */
export const raisedShadow: ViewStyle = (Platform.select({
  ios: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  android: { elevation: 12 },
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

/**
 * Adds an alpha channel to a colour that is ALREADY in `#RRGGBB` / `#RRGGBBAA`
 * form - which is what every theme colour is, because `argb()` converted it on
 * the way in. Calling `withAlpha()` with a theme colour would convert twice and
 * turn green into purple, so this helper only replaces the alpha byte.
 */
export function tintAlpha(value: string, alpha: string): string {
  const rgb = /^#[0-9a-fA-F]{8}$/.test(value) ? value.slice(0, 7) : value;
  return /^#[0-9a-fA-F]{6}$/.test(rgb) ? `${rgb}${alpha}` : value;
}

/**
 * Fill + ink of a SOFT status pill: the state colour on a wash of itself, which
 * is the pill the round-3 review design draws on a meal card and in the calendar
 * agenda. It carries exactly the same information as `statusPillColors` (glyph,
 * word and colour), one tone quieter, so the meal text stays the loudest thing on
 * the card. Pending keeps the neutral control wash with secondary ink.
 */
export function softPillColors(
  theme: ThemeColors,
  status: number,
): { fill: string; ink: string; dot: string } {
  if (status === 1) {
    return {
      fill: tintAlpha(theme.done, theme.dark ? '2E' : '1A'),
      ink: theme.done,
      dot: theme.done,
    };
  }
  if (status === 2) {
    return {
      fill: tintAlpha(theme.missed, theme.dark ? '2E' : '1A'),
      ink: theme.missed,
      dot: theme.missed,
    };
  }
  return { fill: theme.surfaceVariant, ink: theme.textSecondary, dot: theme.pending };
}

/**
 * Fill + ink of a status pill.
 *
 * Done and missed keep their solid state colour with `onState` ink (white on the
 * deep light hues, near-black on the bright dark ones). Pending is an OUTLINE
 * pill: a pale control fill with secondary ink, because white text on mid-grey
 * never reached 4.5:1 and a solid grey pill looked like a disabled button. The
 * colour is still carried by the rail, the dot and the word.
 */
export function statusPillColors(
  theme: ThemeColors,
  status: number,
): { fill: string; ink: string; dot: string; solid: boolean } {
  if (status === 1) {
    return { fill: theme.done, ink: theme.onState, dot: theme.done, solid: true };
  }
  if (status === 2) {
    return { fill: theme.missed, ink: theme.onState, dot: theme.missed, solid: true };
  }
  return {
    fill: theme.surfaceVariant,
    ink: theme.textSecondary,
    dot: theme.pending,
    solid: false,
  };
}
