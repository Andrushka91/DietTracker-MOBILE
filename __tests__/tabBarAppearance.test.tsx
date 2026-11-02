// The bottom bar's ACTIVE-tab highlight (the review screenshot's tinted capsule
// behind the glyph plus the bolder caption).
//
// React Navigation draws no highlight of its own, so before this change the
// active tab was only a tinted glyph and a tinted word - easy to miss on a dark
// bar. These tests pin the three things that make the state visible without
// relying on colour alone: the capsule (fill + geometry), the bold caption, and
// the shell actually using both instead of the navigator's defaults.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TAB_GLYPH_PILL_HEIGHT,
  TAB_GLYPH_PILL_RADIUS,
  TAB_GLYPH_PILL_WIDTH,
  TAB_GLYPH_SIZE,
  TabBarGlyph,
  TabBarLabel,
  tabActivePillFill,
} from '../src/ui/components/TabBar';
import { darkColors, fonts, lightColors } from '../src/ui/theme';

type Renderer = TestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer === undefined) {
    throw new Error('the tab item did not render');
  }
  return renderer;
}

/** The capsule: the only View a tab glyph renders. */
function capsule(renderer: Renderer) {
  const found = renderer.root.findAllByType(View)[0];
  if (found === undefined) {
    throw new Error('the glyph capsule did not render');
  }
  return StyleSheet.flatten(found.props.style) as Record<string, unknown>;
}

describe('the active tab capsule', () => {
  test('is a wash of the accent, stronger in dark mode where a light tint vanishes', () => {
    // `tintAlpha` only replaces the alpha byte of an already-#RRGGBB(AA) colour,
    // so the hue is the theme accent itself - never a second, invented violet.
    const lightPill = tabActivePillFill(lightColors);
    const darkPill = tabActivePillFill(darkColors);
    expect(lightPill).toBe('#4655D61A');
    expect(darkPill).toBe('#8B95F62E');
    expect(lightPill.slice(0, 7)).toBe(lightColors.accent.slice(0, 7));
    expect(darkPill.slice(0, 7)).toBe(darkColors.accent.slice(0, 7));
    // The dark wash is the more opaque of the two.
    expect(parseInt(darkPill.slice(-2), 16)).toBeGreaterThan(parseInt(lightPill.slice(-2), 16));
  });

  test('is a capsule around the glyph, on the active tab only', () => {
    // Wider and taller than the glyph it holds, with fully rounded ends: a pill,
    // not a tight box around the icon.
    expect(TAB_GLYPH_PILL_WIDTH).toBeGreaterThan(TAB_GLYPH_SIZE);
    expect(TAB_GLYPH_PILL_HEIGHT).toBeGreaterThan(TAB_GLYPH_SIZE);
    expect(TAB_GLYPH_PILL_RADIUS).toBe(TAB_GLYPH_PILL_HEIGHT / 2);

    const pillFill = tabActivePillFill(darkColors);
    const focused = capsule(
      render(
        React.createElement(TabBarGlyph, {
          name: 'settings',
          color: darkColors.accent,
          focused: true,
          pillFill,
        }),
      ),
    );
    expect(focused.backgroundColor).toBe(pillFill);
    expect(focused.width).toBe(TAB_GLYPH_PILL_WIDTH);
    expect(focused.height).toBe(TAB_GLYPH_PILL_HEIGHT);
    expect(focused.borderRadius).toBe(TAB_GLYPH_PILL_RADIUS);

    // An inactive tab keeps the SAME box (so nothing moves when the selection
    // changes) but without a fill.
    const inactive = capsule(
      render(
        React.createElement(TabBarGlyph, {
          name: 'settings-outline',
          color: darkColors.textMuted,
          focused: false,
          pillFill,
        }),
      ),
    );
    expect(inactive.backgroundColor).toBeUndefined();
    expect(inactive.width).toBe(focused.width);
    expect(inactive.height).toBe(focused.height);
  });

  test('draws the glyph the navigator asked for', () => {
    const renderer = render(
      React.createElement(TabBarGlyph, {
        name: 'calendar-outline',
        color: lightColors.textMuted,
        focused: false,
        pillFill: tabActivePillFill(lightColors),
      }),
    );
    // jest.setup.js renders every Ionicons glyph as a Text carrying its name.
    const glyph = renderer.root.findAllByType(Text)[0];
    expect(glyph?.props.accessibilityLabel).toBe('icon:calendar-outline');
  });
});

describe('the tab caption', () => {
  function labelStyle(focused: boolean) {
    const renderer = render(
      React.createElement(TabBarLabel, { color: '#8B95F6', focused, children: 'Settings' }),
    );
    const text = renderer.root.findAllByType(Text)[0];
    if (text === undefined) {
      throw new Error('the caption did not render');
    }
    return {
      props: text.props as Record<string, unknown>,
      style: StyleSheet.flatten(text.props.style) as Record<string, unknown>,
    };
  }

  test('is bold while its tab is active and regular otherwise', () => {
    expect(labelStyle(true).style.fontFamily).toBe(fonts.bold);
    expect(labelStyle(false).style.fontFamily).toBe(fonts.regular);
  });

  test('keeps the navigator tint, one line and the capped scale', () => {
    for (const focused of [true, false]) {
      const { props, style } = labelStyle(focused);
      expect(props.children).toBe('Settings');
      expect(style.color).toBe('#8B95F6');
      // Five single-word captions have to stay whole on a 360 pt phone.
      expect(props.numberOfLines).toBe(1);
      expect(props.maxFontSizeMultiplier).toBe(1.15);
    }
  });
});

describe('the shell uses the highlighted items', () => {
  const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');

  test('the caption is the bold-aware component, not the navigator default', () => {
    expect(app).toContain('tabBarLabel: ({ color, focused, children }) => (');
    expect(app).toContain('<TabBarLabel color={color} focused={focused}>');
    expect(app).not.toContain('styles.tabLabel');
  });

  test('all five tabs draw the capsule and the filled / outline glyph pair', () => {
    const glyphs = app.match(/pillFill=\{pillFill\}/g) ?? [];
    expect(glyphs).toHaveLength(5);
    for (const [filled, outline] of [
      ['home', 'home-outline'],
      ['calendar', 'calendar-outline'],
      ['stats-chart', 'stats-chart-outline'],
      ['albums', 'albums-outline'],
      ['settings', 'settings-outline'],
    ]) {
      expect(app).toContain(`name={focused ? '${filled}' : '${outline}'}`);
    }
    // The capsule fill is read from the theme once, not per tab.
    expect(app).toContain('const pillFill = tabActivePillFill(colors);');
  });
});
