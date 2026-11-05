// Shared color adapter for accent actions and matching red Cancel.
//
// Production derives its accent from the EXISTING theme (`colors.accent`),
// never the reference fixture palette. This uses the app's existing `tintAlpha`
// (which handles already-converted normalized RGBA) rather than duplicating an
// alpha helper — feeding normalized hex through the app's `argb()` conversion
// would corrupt the values.
//
// The tab indicator (`tabActiveChipFill`) and all three positive action buttons
// (Save, card Apply, popup final Apply) share the same resting fill recipe via
// `selectedAccentFill`, so there is one definition of the tinted wash and no
// effective navigator appearance change.

import { tintAlpha, type ThemeColors } from './theme';
import { templateActionInk } from './templatesCalendar';

const fillAlpha = { light: '1A', dark: '2E' } as const;
const pressedAlpha = { light: '2E', dark: '32' } as const;

export function selectedAccentFill(colors: ThemeColors): string {
  return tintAlpha(colors.accent, fillAlpha[colors.dark ? 'dark' : 'light']);
}

export function accentActionColors(colors: ThemeColors, pressed = false) {
  return {
    foreground: colors.accent,
    border: colors.accent,
    fill: pressed
      ? tintAlpha(colors.accent, pressedAlpha[colors.dark ? 'dark' : 'light'])
      : selectedAccentFill(colors),
  };
}

export function cancelActionColors(colors: ThemeColors, pressed = false) {
  const ink = templateActionInk[colors.dark ? 'dark' : 'light'];
  return {
    foreground: ink.cancel,
    border: ink.cancelBorder,
    fill: pressed ? ink.cancelPressed : ink.cancelFill,
  };
}
