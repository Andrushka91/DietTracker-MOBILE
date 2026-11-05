// The template card's ACTION FOOTER tokens (the approved design).
//
// Scoped to the two halves of ONE card footer. Nothing here is a global theme
// change: no other page, popup or button reads these numbers, and the colours
// come from the live theme (`ThemeColors`) plus the shared `accentActionColors`
// helper, so light/dark follow the app automatically. dp for layout, sp for
// text.

import { fonts } from './theme';

export const templateCardActions = {
  /** The one rule above the footer, and the 1 dp centre separator. */
  rule: 1,
  /** Height of the short line between the two halves. */
  dividerHeight: 20,
  /** Real targets: Android asks for 48 dp, iOS' convention is 44 dp. */
  targetAndroid: 48,
  targetIOS: 44,
  /** The halves' own air - never a gutter around the footer. */
  paddingX: 12,
  paddingY: 10,
  /** The list glyph and the arrow-right, then the smaller chevron. */
  icon: 16,
  chevron: 14,
  /** Air between a label and its glyph. */
  contentGap: 6,
  labelSize: 13,
  labelLine: 20,
  regular: fonts.regular,
  medium: fonts.medium,
  /**
   * Two halves narrower than this each (140 dp), or a font scale above 1.3,
   * stack the halves so a long or translated label wraps instead of clipping.
   */
  minInlineColumn: 140,
  stackFontScale: 1.3,
  /**
   * The focus ring's reserved width: the border is always drawn this thick so a
   * half never shifts, and it is transparent except while keyboard-focused.
   */
  focusWidth: 2,
  disabledOpacity: 0.5,
} as const;

export type TemplateCardActionsTokens = typeof templateCardActions;
