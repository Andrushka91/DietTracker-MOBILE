// Floating tab bar geometry - ONE source of truth for the bar itself (App.tsx)
// and for the room every scrolling page leaves below its last card.
//
// The bar is absolutely positioned (position: 'absolute' in App.tsx): it floats
// TAB_BAR_SIDE_INSET from the left and right edges, TAB_BAR_HEIGHT tall, and
// tabBarBottomOffset(bottomInset) above the bottom edge of the screen. The strip
// it covers is therefore
//
//     [bottom edge ... tabBarBottomOffset + TAB_BAR_HEIGHT]
//
// and that strip is what a page has to clear - on ANY device, because both
// device-dependent halves are READ instead of guessed:
//
//   * the bottom offset is the real safe-area inset of the device (home
//     indicator 34, gesture bar 24, on-screen navigation buttons 48, an old
//     phone 0 - which keeps TAB_BAR_MIN_BOTTOM_OFFSET as the minimum float),
//   * the height is what the navigator actually rendered
//     (BottomTabBarHeightContext feeds the same number BottomTabBar computed for
//     this frame), with TAB_BAR_HEIGHT as its floor and as the fallback for a
//     page shown without a bar.
//
// On top of that strip every page keeps TAB_BAR_CLEARANCE_GAP of air, so the
// last card of the dashboard, calendar, statistics, templates and settings
// pages ends the SAME visible distance above the bar on every phone. The old
// fixed "110 pt + inset" constant was a guess; it left 34 pt of air on one
// device and none on another, which is why the calendar's day rows and legend
// ended flush against the bar.
//
// Nothing in here is a per-screen value: a page calls
// `useFloatingTabBarClearance()` and pads its scroll content with the number it
// returns. Change the bar's height or float in App.tsx and every page follows.

import { useContext } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Height of the floating (iOS style) tab bar, labels included. */
export const TAB_BAR_HEIGHT = 66;
/** Distance the floating bar keeps from the left and right screen edges. */
export const TAB_BAR_SIDE_INSET = 14;
/** Minimum distance between the bar and the bottom edge (no gesture area). */
export const TAB_BAR_MIN_BOTTOM_OFFSET = 10;
/** Air a page keeps between its last card and the top edge of the bar. */
export const TAB_BAR_CLEARANCE_GAP = 32;

/**
 * Distance between the floating bar and the bottom edge of the screen: the
 * device's bottom safe-area inset, but never less than the design minimum.
 * Unusable values (NaN / negative / infinite, e.g. before the insets are
 * measured) fall back to the minimum instead of poisoning the layout.
 */
export function tabBarBottomOffset(bottomInset: number): number {
  const inset = Number.isFinite(bottomInset) && bottomInset > 0 ? bottomInset : 0;
  return Math.max(inset, TAB_BAR_MIN_BOTTOM_OFFSET);
}

/**
 * Room a scrolling page must leave below its last card: the whole strip the bar
 * covers (bottom offset + height) plus the clearance gap. `barHeight` is the
 * height the navigator reported; anything smaller than TAB_BAR_HEIGHT (or
 * nothing at all) is clamped to the constant, so a page can never end up under
 * the bar because a measurement was missing or stale.
 */
export function floatingTabBarClearance(input: {
  bottomInset: number;
  barHeight?: number | null;
}): number {
  const barHeight =
    typeof input.barHeight === 'number' && Number.isFinite(input.barHeight)
      ? Math.max(input.barHeight, TAB_BAR_HEIGHT)
      : TAB_BAR_HEIGHT;
  return tabBarBottomOffset(input.bottomInset) + barHeight + TAB_BAR_CLEARANCE_GAP;
}

/**
 * The clearance for the device the app is running on right now: the measured
 * safe-area inset plus the bar height the bottom-tab navigator published for
 * this frame (undefined outside a tab navigator - the constant is used then).
 */
export function useFloatingTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  const barHeight = useContext(BottomTabBarHeightContext);
  return floatingTabBarClearance({ bottomInset: insets.bottom, barHeight });
}
