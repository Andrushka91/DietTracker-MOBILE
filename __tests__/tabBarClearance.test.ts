// Regression test for the DOCKED bottom bar geometry (src/ui/tabBar.ts) and for
// the room every page leaves above it.
//
// The bar used to FLOAT: absolutely positioned, 14 pt in from both edges, 66 pt
// tall, with rounded outer corners and a raised shadow - and every page had to
// reserve bottom inset + bar height + 32 pt of padding for it. The r3 mockups
// dock the bar (`.ds-nav` in diettracker-r3-review-today.html / -settings.html):
// full width, a normal sibling BELOW the pages, one hairline divider, its
// surface covering the bottom safe area.
//
// Because the navigator then reserves the bar's whole height itself, a page that
// still reserved it would leave a hole above the bar - so the page gap is the
// mockups' 18 pt of air and nothing else.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TAB_BAR_CONTENT_GAP,
  TAB_BAR_CONTENT_HEIGHT,
  TAB_BAR_EDGE_PADDING,
  TAB_BAR_ITEM_HEIGHT,
  TAB_BAR_ITEM_PADDING,
  TAB_BAR_PADDING_TOP,
  TAB_GLYPH_CHIP_HEIGHT,
  TAB_LABEL_GAP,
  TAB_LABEL_LINE_HEIGHT,
  safeBottomInset,
  tabBarHeight,
} from '../src/ui/tabBar';

/** Bottom insets real devices report: 0 (3-button bar) up to 48 (thick bar). */
const INSETS = [0, 5, 10, 24, 34, 48];

describe('Docked tab bar geometry (r3 `.ds-nav`)', () => {
  test('one tab is the glyph chip, the gap and the caption - the mockups 52 pt row', () => {
    expect(TAB_GLYPH_CHIP_HEIGHT).toBe(31);
    expect(TAB_LABEL_GAP).toBe(5);
    expect(TAB_LABEL_LINE_HEIGHT).toBe(16);
    expect(TAB_BAR_ITEM_HEIGHT).toBe(
      TAB_GLYPH_CHIP_HEIGHT + TAB_LABEL_GAP + TAB_LABEL_LINE_HEIGHT,
    );
    expect(TAB_BAR_ITEM_HEIGHT).toBe(52);
  });

  test('the bar is one tab row plus its air, and the device inset is added on top', () => {
    expect(TAB_BAR_PADDING_TOP).toBe(6);
    // react-navigation pads every tab by 5 pt (tabVerticalUiKit) - the constant
    // the content height is built on must stay in step with it.
    expect(TAB_BAR_ITEM_PADDING).toBe(5);
    expect(TAB_BAR_CONTENT_HEIGHT).toBe(
      TAB_BAR_PADDING_TOP + TAB_BAR_ITEM_PADDING * 2 + TAB_BAR_ITEM_HEIGHT,
    );
    expect(TAB_BAR_EDGE_PADDING).toBe(4);

    // The bar's own surface stops at its content; the bottom safe area is part
    // of the bar's height, which is what lets its background cover the gesture
    // indicator instead of letting the page show through.
    expect(tabBarHeight(0)).toBe(TAB_BAR_CONTENT_HEIGHT);
    for (const bottomInset of INSETS) {
      expect(tabBarHeight(bottomInset)).toBe(TAB_BAR_CONTENT_HEIGHT + bottomInset);
      expect(tabBarHeight(bottomInset)).toBeGreaterThanOrEqual(TAB_BAR_CONTENT_HEIGHT);
    }
  });

  test('unmeasured or impossible insets add nothing', () => {
    expect(safeBottomInset(Number.NaN)).toBe(0);
    // Landscape gesture areas can report negative insets.
    expect(safeBottomInset(-12)).toBe(0);
    expect(safeBottomInset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(tabBarHeight(Number.NaN)).toBe(TAB_BAR_CONTENT_HEIGHT);
    expect(tabBarHeight(-12)).toBe(TAB_BAR_CONTENT_HEIGHT);
  });

  test('a page clears 18 pt of air, NOT the bar height (that would double-reserve)', () => {
    expect(TAB_BAR_CONTENT_GAP).toBe(18);
    expect(TAB_BAR_CONTENT_GAP).toBeLessThan(TAB_BAR_CONTENT_HEIGHT);
    // Half of the old floating reserve is already more than a docked page needs.
    expect(TAB_BAR_CONTENT_GAP * 2).toBeLessThan(TAB_BAR_CONTENT_HEIGHT);
  });

  test('the navigator and the pages read the SAME geometry', () => {
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toContain('const barHeight = tabBarHeight(insets.bottom);');
    expect(app).toContain('height: barHeight,');
    expect(app).toContain('paddingTop: TAB_BAR_PADDING_TOP,');
    expect(app).toContain('paddingHorizontal: TAB_BAR_EDGE_PADDING,');
    // One hairline divider, opaque surface, no floating shadow and no floating
    // geometry may come back.
    expect(app).toContain('borderTopWidth: StyleSheet.hairlineWidth,');
    expect(app).toContain('borderTopColor: colors.border,');
    expect(app).toContain('elevation: 0,');
    expect(app).not.toContain("position: 'absolute'");
    expect(app).not.toContain('borderRadius');
    expect(app).not.toContain('raisedShadow');
    expect(app).not.toContain('tabBarBottomOffset');

    // No page may reserve the bar's height again: every scrolling screen only
    // adds the air above the divider.
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
      expect(source).toContain("import { TAB_BAR_CONTENT_GAP } from '../tabBar';");
      expect(source).toContain('{ paddingBottom: TAB_BAR_CONTENT_GAP },');
      expect(source).not.toContain('useFloatingTabBarClearance');
      expect(source).not.toContain('floatingTabBarClearance');
    }
  });
});
