// One icon family for the whole app.
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
//   focused / unfocused tab pairs  home / home-outline, calendar / calendar-outline ...
//   actions                        camera-outline, create-outline, trash-outline,
//                                  close, checkmark
//   chrome                         chevron-back, chevron-forward, settings-outline

import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

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
