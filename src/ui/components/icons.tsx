// One icon family for the whole app - Ionicons - plus THREE deliberate tab-bar
// exceptions (the house, the calendar and the stats bars, see `TabGlyph` in
// components/TabBar.tsx).
//
// The UI used to draw emoji as chrome (tab bar, meal actions, status pills,
// avatar, photo viewer): emoji render differently on every Android skin, ignore
// the theme palette and cannot be sized or aligned like a glyph. Ionicons ships
// with Expo - the SDK pins its version - so one consistent, themeable family
// comes for free, with no design-system dependency and no native rebuild.
//
// Category emoji (MealCategory.Icon in SQLite) are DATA: they are the user's
// meal icons and are never replaced by this module.
//
//   tab glyphs                     home (Feather), calendar-month-outline (material),
//                                  bar-chart (Feather), layers-outline,
//                                  settings-outline (Ionicons)
//   actions                        camera-outline, create-outline, trash-outline,
//                                  close, checkmark
//   chrome                         chevron-back, chevron-forward, settings-outline

import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export type FeatherName = React.ComponentProps<typeof Feather>['name'];
export type MaterialName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * A themed glyph. `color` always comes from the theme (never a literal), so the
 * icons follow light/dark and the accent automatically.
 */
export function Icon(props: {
  name: IconName;
  color: string;
  size?: number;
}): React.JSX.Element {
  return <Ionicons name={props.name} size={props.size ?? 18} color={props.color} />;
}

/**
 * The tab glyphs Ionicons cannot draw, each borrowed from the one font whose
 * shape is the mockup's shape. They are tab-bar exceptions only; every action,
 * pill and chrome glyph stays Ionicons.
 *
 *   house     Feather `home` - Ionicons' house has an eaved roof running past
 *             both walls plus a chimney stub; the mockup's is a plain pentagon.
 *   calendar  MaterialCommunityIcons `calendar-month-outline` - the mockup has
 *             thin hangers, a thin header line and six small dots; Ionicons'
 *             calendar is heavier, with a thick header band and larger dots.
 *   stats     Feather `bar-chart` - the mockup draws three plain ascending bars;
 *             Ionicons' bar charts carry a left/bottom axis and hollow bars.
 */
export function FeatherIcon(props: {
  name: FeatherName;
  color: string;
  size?: number;
}): React.JSX.Element {
  return <Feather name={props.name} size={props.size ?? 18} color={props.color} />;
}

/** See `FeatherIcon` - the same idea, drawn by MaterialCommunityIcons. */
export function MaterialIcon(props: {
  name: MaterialName;
  color: string;
  size?: number;
}): React.JSX.Element {
  return (
    <MaterialCommunityIcons name={props.name} size={props.size ?? 18} color={props.color} />
  );
}
