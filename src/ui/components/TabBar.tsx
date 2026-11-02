// The two pieces a bottom-tab item is made of: the glyph (with the chip the
// ACTIVE tab wears behind it) and the caption.
//
// React Navigation's default tab item has no highlight of its own - it only
// tints the glyph and the label - so the active tab is impossible to tell apart
// from the other four at a glance. The r3 mockups (`.ds-nav` /
// `.ds-nav-icon` in diettracker-r3-review-today.html) draw a soft accent-tinted
// chip behind the active glyph plus a heavier caption, and the shell in App.tsx
// hands these two components to the navigator (`tabBarIcon` / `tabBarLabel`)
// instead of the defaults.
//
// All geometry comes from src/ui/tabBar.ts, so the chip, the caption line and
// the bar's height can never drift apart. Nothing here picks a colour on its
// own: the navigator's tint carries the accent / muted ink, the chip is a wash of
// the SAME accent (`tabActiveChipFill`), and every value follows the theme.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  FeatherIcon,
  Icon,
  MaterialIcon,
  type FeatherName,
  type IconName,
  type MaterialName,
} from './icons';
import {
  TAB_GLYPH_CHIP_HEIGHT,
  TAB_GLYPH_CHIP_RADIUS,
  TAB_GLYPH_CHIP_WIDTH,
  TAB_GLYPH_SIZE,
  TAB_LABEL_GAP,
  TAB_LABEL_LINE_HEIGHT,
} from '../tabBar';
import { fonts, tintAlpha, type ThemeColors } from '../theme';

/** Caption type size (the mockups' 11 pt caption). */
export const TAB_LABEL_FONT_SIZE = 11;

/**
 * Fill of the chip behind the active glyph: the accent as a wash of itself. The
 * alpha is a little stronger in dark mode because a 10 % tint disappears on a
 * near-black surface while the same 18 % would look heavy on white.
 */
export function tabActiveChipFill(colors: ThemeColors): string {
  return tintAlpha(colors.accent, colors.dark ? '2E' : '1A');
}

/**
 * The glyph a tab draws, and the face it comes from. The shell draws Ionicons by
 * default; the mockup's house, calendar and stats bars have no Ionicons twin of
 * the same shape, so those three come from Feather and MaterialCommunityIcons
 * (see `FeatherIcon` / `MaterialIcon` in components/icons.tsx).
 */
export type TabGlyph =
  | { name: IconName }
  | { feather: FeatherName }
  | { material: MaterialName };

/**
 * One tab glyph. The chip is always laid out (so switching tabs never moves the
 * glyph) and only the ACTIVE tab gives it a fill.
 */
export function TabBarGlyph(
  props: TabGlyph & {
    color: string;
    focused: boolean;
    /** Chip fill read once by the shell - see `tabActiveChipFill`. */
    chipFill: string;
  },
): React.JSX.Element {
  return (
    <View
      style={[styles.chip, props.focused ? { backgroundColor: props.chipFill } : null]}>
      {glyph(props)}
    </View>
  );
}

/** The one glyph the tab draws - exactly one face per tab, by construction. */
function glyph(props: TabGlyph & { color: string }): React.JSX.Element {
  if ('feather' in props) {
    return <FeatherIcon name={props.feather} size={TAB_GLYPH_SIZE} color={props.color} />;
  }
  if ('material' in props) {
    return <MaterialIcon name={props.material} size={TAB_GLYPH_SIZE} color={props.color} />;
  }
  return <Icon name={props.name} size={TAB_GLYPH_SIZE} color={props.color} />;
}

/**
 * One tab caption. The active caption is set in the semibold weight (the
 * mockups' 650), so the state still reads without colour - under a display tint
 * or for a colour-blind user; the scale stays capped at 1.15 so five
 * single-word labels keep fitting on a 360 pt phone with large system text.
 */
export function TabBarLabel(props: {
  color: string;
  focused: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={1.15}
      style={[styles.label, props.focused ? styles.labelActive : null, { color: props.color }]}>
      {props.children}
    </Text>
  );
}

const styles = StyleSheet.create({
  chip: {
    width: TAB_GLYPH_CHIP_WIDTH,
    height: TAB_GLYPH_CHIP_HEIGHT,
    borderRadius: TAB_GLYPH_CHIP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: TAB_LABEL_FONT_SIZE,
    lineHeight: TAB_LABEL_LINE_HEIGHT,
    fontFamily: fonts.regular,
    letterSpacing: 0,
    marginTop: TAB_LABEL_GAP,
    textAlign: 'center',
  },
  labelActive: {
    fontFamily: fonts.medium,
  },
});

