// The two pieces a bottom-tab item is made of: the glyph (with the capsule the
// ACTIVE tab wears behind it) and the caption.
//
// React Navigation's default tab item has no highlight of its own - it only
// tints the glyph and the label - so the active tab was impossible to tell
// apart from the other four at a glance, which is what the review screenshot
// shows: a tinted pill behind the active glyph and a bolder caption under it.
// The shell in App.tsx therefore hands these two components to the navigator
// (`tabBarIcon` / `tabBarLabel`) instead of the defaults.
//
// Nothing here decides a colour on its own: the navigator's tint carries the
// accent / muted ink, the capsule is a wash of the SAME accent (`tintAlpha`),
// and every value scales with the theme (light, dark) because it comes from
// `themeColors()`.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from './icons';
import { fonts, tintAlpha, type ThemeColors } from '../theme';

/** Height of the capsule drawn behind the active tab's glyph. */
export const TAB_GLYPH_PILL_HEIGHT = 26;
/** Width of that capsule - wider than the glyph, so it reads as a pill. */
export const TAB_GLYPH_PILL_WIDTH = 46;
/** Fully rounded ends, i.e. a capsule and not a rounded square. */
export const TAB_GLYPH_PILL_RADIUS = TAB_GLYPH_PILL_HEIGHT / 2;
/** Glyph size in the bar (a step down from the 23 pt glyphs used on a card). */
export const TAB_GLYPH_SIZE = 20;

/**
 * Fill of the capsule behind the active glyph: the accent as a wash of itself.
 * The alpha is a little stronger in dark mode because a 10 % tint disappears on
 * a near-black surface while the same 18 % would look heavy on white.
 */
export function tabActivePillFill(colors: ThemeColors): string {
  return tintAlpha(colors.accent, colors.dark ? '2E' : '1A');
}

/**
 * One tab glyph. The capsule is always laid out (so switching tabs never moves
 * the glyph) and only the ACTIVE tab gives it a fill.
 */
export function TabBarGlyph(props: {
  name: IconName;
  color: string;
  focused: boolean;
  /** Capsule fill read once by the shell - see `tabActivePillFill`. */
  pillFill: string;
}): React.JSX.Element {
  return (
    <View
      style={[styles.pill, props.focused ? { backgroundColor: props.pillFill } : null]}>
      <Icon name={props.name} size={TAB_GLYPH_SIZE} color={props.color} />
    </View>
  );
}

/**
 * One tab caption. The active caption is set in the bold weight, so the state
 * still reads without colour (and under a display tint / for a colour-blind
 * user); the scale stays capped at 1.15 so five single-word labels keep fitting
 * on a 360 pt phone with large system text.
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
  pill: {
    width: TAB_GLYPH_PILL_WIDTH,
    height: TAB_GLYPH_PILL_HEIGHT,
    borderRadius: TAB_GLYPH_PILL_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10.5,
    fontFamily: fonts.regular,
    letterSpacing: 0,
    marginTop: 1,
    textAlign: 'center',
  },
  labelActive: {
    fontFamily: fonts.bold,
  },
});
