// Regression test for the room every page leaves below its last card, i.e. for
// the floating tab bar's geometry (src/ui/tabBar.ts).
//
// The old layout added a FIXED 110 pt to the device's bottom inset, so the air
// between the last card and the bar depended on the phone: too little on a
// device with an on-screen navigation bar, a huge hole on a phone without a
// gesture area - and the calendar's day rows plus legend ended up flush against
// the bar. The clearance is now derived from the bar's own geometry:
//
//   bottom offset (the device's safe-area inset, floor 10 pt)
// + bar height   (what the navigator actually rendered, floor 66 pt)
// + clearance gap (32 pt of air, a design constant)
//
// so the VISIBLE gap is identical on every device and every screen just asks
// `useFloatingTabBarClearance()` for the number.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  BottomTabBarHeightContext: {},
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TAB_BAR_CLEARANCE_GAP,
  TAB_BAR_HEIGHT,
  TAB_BAR_MIN_BOTTOM_OFFSET,
  floatingTabBarClearance,
  tabBarBottomOffset,
} from '../src/ui/tabBar';

/** Bottom insets real devices report: 0 (3-button bar) up to 48 (thick bar). */
const INSETS = [0, 5, 10, 24, 34, 48];

describe('Floating tab bar geometry (8.5 - one clearance for every device)', () => {
  test('the bar keeps at least its minimum float above the bottom edge', () => {
    expect(TAB_BAR_MIN_BOTTOM_OFFSET).toBe(10);
    expect(TAB_BAR_HEIGHT).toBe(66);
    expect(tabBarBottomOffset(0)).toBe(10);
    expect(tabBarBottomOffset(5)).toBe(10);
    expect(tabBarBottomOffset(10)).toBe(10);
    // A real inset is used as it stands: the home indicator / gesture bar is not
    // something the layout may ignore.
    expect(tabBarBottomOffset(24)).toBe(24);
    expect(tabBarBottomOffset(34)).toBe(34);
    expect(tabBarBottomOffset(48)).toBe(48);
  });

  test('unmeasured or impossible insets fall back to the minimum float', () => {
    expect(tabBarBottomOffset(Number.NaN)).toBe(TAB_BAR_MIN_BOTTOM_OFFSET);
    // Landscape gesture areas can report negative insets.
    expect(tabBarBottomOffset(-12)).toBe(TAB_BAR_MIN_BOTTOM_OFFSET);
    expect(tabBarBottomOffset(Number.POSITIVE_INFINITY)).toBe(TAB_BAR_MIN_BOTTOM_OFFSET);
  });

  test('the clearance is float + bar + gap on every device', () => {
    for (const bottomInset of INSETS) {
      const clearance = floatingTabBarClearance({ bottomInset, barHeight: TAB_BAR_HEIGHT });
      expect(clearance).toBe(
        tabBarBottomOffset(bottomInset) + TAB_BAR_HEIGHT + TAB_BAR_CLEARANCE_GAP,
      );
      // The whole strip the bar covers is cleared...
      expect(clearance).toBeGreaterThanOrEqual(tabBarBottomOffset(bottomInset) + TAB_BAR_HEIGHT);
      // ...and the air above the bar is the SAME on every device.
      expect(clearance - tabBarBottomOffset(bottomInset) - TAB_BAR_HEIGHT).toBe(
        TAB_BAR_CLEARANCE_GAP,
      );
    }
  });

  test('a bigger inset only ever adds room, never takes it away', () => {
    let previous = 0;
    for (const bottomInset of INSETS) {
      const clearance = floatingTabBarClearance({ bottomInset });
      expect(clearance).toBeGreaterThanOrEqual(previous);
      previous = clearance;
    }
  });

  test('a missing or too small bar height is clamped to the constant', () => {
    const floor = tabBarBottomOffset(24) + TAB_BAR_HEIGHT + TAB_BAR_CLEARANCE_GAP;
    expect(floatingTabBarClearance({ bottomInset: 24, barHeight: null })).toBe(floor);
    expect(floatingTabBarClearance({ bottomInset: 24 })).toBe(floor);
    expect(floatingTabBarClearance({ bottomInset: 24, barHeight: Number.NaN })).toBe(floor);
    expect(floatingTabBarClearance({ bottomInset: 24, barHeight: 40 })).toBe(floor);
    // A bar that really is taller (a future second label line) wins.
    expect(floatingTabBarClearance({ bottomInset: 24, barHeight: 92 })).toBe(
      tabBarBottomOffset(24) + 92 + TAB_BAR_CLEARANCE_GAP,
    );
  });

  test('the navigator and the pages read the SAME geometry', () => {
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toContain('const barBottom = tabBarBottomOffset(insets.bottom);');
    expect(app).toContain('left: TAB_BAR_SIDE_INSET,');
    expect(app).toContain('right: TAB_BAR_SIDE_INSET,');
    expect(app).toContain('height: TAB_BAR_HEIGHT,');

    // No page may guess the number again: every scrolling screen asks the hook.
    const screens = [
      'DashboardScreen',
      'CalendarScreen',
      'StatisticsScreen',
      'TemplatesScreen',
      'SettingsScreen',
    ];
    for (const screen of screens) {
      const source = readFileSync(
        join(__dirname, '..', 'src', 'ui', 'screens', `${screen}.tsx`),
        'utf8',
      );
      expect(source).toContain('const bottomClearance = useFloatingTabBarClearance();');
      expect(source).toContain('paddingBottom: bottomClearance');
      expect(source).not.toContain('floatingTabBarClearance +');
    }
  });
});
