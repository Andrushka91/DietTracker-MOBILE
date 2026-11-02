// The bottom bar's ACTIVE-tab highlight and caption, as drawn by the r3 mockups
// (`.ds-nav`, `.ds-nav-icon`, `button[aria-current=page]`).
//
// React Navigation draws no highlight of its own, so the shell hands it two
// components: the glyph in a soft accent-tinted chip (only on the active tab)
// and a caption that gains the semibold weight. These tests pin the chip (fill +
// geometry), the caption (type + weight) and the fact that the shell uses both
// for all five tabs.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  TAB_LABEL_FONT_SIZE,
  TabBarGlyph,
  TabBarLabel,
  tabActiveChipFill,
} from '../src/ui/components/TabBar';
import {
  TAB_GLYPH_CHIP_HEIGHT,
  TAB_GLYPH_CHIP_RADIUS,
  TAB_GLYPH_CHIP_WIDTH,
  TAB_GLYPH_SIZE,
  TAB_LABEL_GAP,
  TAB_LABEL_LINE_HEIGHT,
} from '../src/ui/tabBar';
import { darkColors, fonts, lightColors } from '../src/ui/theme';
import { t } from '../src/ui/strings';

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

/** The chip: the only View a tab glyph renders. */
function chip(renderer: Renderer) {
  const found = renderer.root.findAllByType(View)[0];
  if (found === undefined) {
    throw new Error('the glyph chip did not render');
  }
  return StyleSheet.flatten(found.props.style) as Record<string, unknown>;
}

describe('the active tab chip', () => {
  test('is a wash of the accent, stronger in dark mode where a light tint vanishes', () => {
    // `tintAlpha` only replaces the alpha byte of an already-#RRGGBB(AA) colour,
    // so the hue is the theme accent itself - never a second, invented violet.
    const lightChip = tabActiveChipFill(lightColors);
    const darkChip = tabActiveChipFill(darkColors);
    expect(lightChip).toBe('#4655D61A');
    expect(darkChip).toBe('#8B95F62E');
    expect(lightChip.slice(0, 7)).toBe(lightColors.accent.slice(0, 7));
    expect(darkChip.slice(0, 7)).toBe(darkColors.accent.slice(0, 7));
    // The dark wash is the more opaque of the two.
    expect(parseInt(darkChip.slice(-2), 16)).toBeGreaterThan(parseInt(lightChip.slice(-2), 16));
  });

  test('is the mockups rounded rect around the glyph, on the active tab only', () => {
    // The reference pads the 21 pt glyph by 5 x 14 and rounds it by 12:
    // 49 x 31 with soft corners, not a full capsule.
    expect(TAB_GLYPH_CHIP_WIDTH).toBe(TAB_GLYPH_SIZE + 14 * 2);
    expect(TAB_GLYPH_CHIP_HEIGHT).toBe(TAB_GLYPH_SIZE + 5 * 2);
    expect(TAB_GLYPH_CHIP_RADIUS).toBe(12);
    expect(TAB_GLYPH_CHIP_RADIUS).toBeLessThan(TAB_GLYPH_CHIP_HEIGHT / 2);

    const chipFill = tabActiveChipFill(darkColors);
    const focused = chip(
      render(
        React.createElement(TabBarGlyph, {
          name: 'settings',
          color: darkColors.accent,
          focused: true,
          chipFill,
        }),
      ),
    );
    expect(focused.backgroundColor).toBe(chipFill);
    expect(focused.width).toBe(TAB_GLYPH_CHIP_WIDTH);
    expect(focused.height).toBe(TAB_GLYPH_CHIP_HEIGHT);
    expect(focused.borderRadius).toBe(TAB_GLYPH_CHIP_RADIUS);

    // An inactive tab keeps the SAME box (so nothing moves when the selection
    // changes) but without a fill.
    const inactive = chip(
      render(
        React.createElement(TabBarGlyph, {
          name: 'settings-outline',
          color: darkColors.textMuted,
          focused: false,
          chipFill,
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
        name: 'layers-outline',
        color: lightColors.textMuted,
        focused: false,
        chipFill: tabActiveChipFill(lightColors),
      }),
    );
    // jest.setup.js renders every Ionicons glyph as a Text carrying its name.
    const glyphText = renderer.root.findAllByType(Text)[0];
    expect(glyphText?.props.accessibilityLabel).toBe('icon:layers-outline');
  });

  test('can draw the mockup house from Feather, still inside the chip', () => {
    const chipFill = tabActiveChipFill(darkColors);
    const renderer = render(
      React.createElement(TabBarGlyph, {
        feather: 'home',
        color: darkColors.accent,
        focused: true,
        chipFill,
      }),
    );
    const glyphText = renderer.root.findAllByType(Text)[0];
    // The prefix proves it came from the Feather face, not Ionicons.
    expect(glyphText?.props.accessibilityLabel).toBe('feather:home');
    // ...and it still wears the same chip as the Ionicons tabs.
    expect(chip(renderer).backgroundColor).toBe(chipFill);
    expect(chip(renderer).width).toBe(TAB_GLYPH_CHIP_WIDTH);
    expect(chip(renderer).height).toBe(TAB_GLYPH_CHIP_HEIGHT);
  });

  test('can draw the mockup calendar from MaterialCommunityIcons', () => {
    const renderer = render(
      React.createElement(TabBarGlyph, {
        material: 'calendar-month-outline',
        color: darkColors.accent,
        focused: true,
        chipFill: tabActiveChipFill(darkColors),
      }),
    );
    const glyphText = renderer.root.findAllByType(Text)[0];
    expect(glyphText?.props.accessibilityLabel).toBe('material:calendar-month-outline');
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

  test('is 11 pt on a 16 pt line, one mockup gap under the chip', () => {
    const { style } = labelStyle(false);
    expect(TAB_LABEL_FONT_SIZE).toBe(11);
    expect(style.fontSize).toBe(11);
    expect(style.lineHeight).toBe(TAB_LABEL_LINE_HEIGHT);
    expect(style.marginTop).toBe(TAB_LABEL_GAP);
  });

  test('is semibold while its tab is active and regular otherwise', () => {
    expect(labelStyle(true).style.fontFamily).toBe(fonts.medium);
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

  test('the caption is the semibold-aware component, not the navigator default', () => {
    expect(app).toContain('tabBarLabel: ({ color, focused, children }) => (');
    expect(app).toContain('<TabBarLabel color={color} focused={focused}>');
  });

  test('all five tabs draw the chip and the mockup outline glyph, never a filled twin', () => {
    const glyphs = app.match(/chipFill=\{chipFill\}/g) ?? [];
    expect(glyphs).toHaveLength(5);
    // The mockup draws the SAME outline glyph whether the tab is active or not -
    // the chip and the semibold accent caption carry the state. Layers and gear
    // are Ionicons; house and stats bars are Feather's plain strokes; the
    // calendar is MaterialCommunityIcons' thin-hangered, six-dot calendar, because
    // those three shapes have no Ionicons twin.
    expect(app).toContain('feather="home"');
    expect(app).toContain('feather="bar-chart"');
    expect(app).toContain('material="calendar-month-outline"');
    for (const glyph of ['layers-outline', 'settings-outline']) {
      expect(app).toContain(`name="${glyph}"`);
    }
    // One glyph per tab, five tabs: no tab may carry two glyph sources at once.
    expect(app.match(/<TabBarGlyph/g) ?? []).toHaveLength(5);
    expect(app.match(/feather="/g) ?? []).toHaveLength(2);
    expect(app.match(/material="/g) ?? []).toHaveLength(1);
    // No glyph may depend on `focused` again: that swap is what the mockup does
    // not do, and it would make an active tab a different shape under the chip.
    expect(app).not.toMatch(/name=\{focused \?/);
    // The chip fill is read from the theme once, not per tab.
    expect(app).toContain('const chipFill = tabActiveChipFill(colors);');
    // The tab's glyph box is the chip's height, so the caption sits on the same
    // baseline in every tab.
    expect(app).toContain('tabBarIconSize: TAB_GLYPH_CHIP_HEIGHT,');
  });

  test('the five captions are the mockup names - Stats short, the page title untouched', () => {
    // "Today / Calendar / Stats / Templates / Settings", in this order.
    const captions = ['Nav_Dashboard', 'Nav_Calendar', 'Rn_NavStats', 'Nav_Templates', 'Nav_Settings'];
    const positions = captions.map((key) => app.indexOf(`title: t('${key}'),`));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    expect(t('Rn_NavStats')).toBe('Stats');
    // The statistics PAGE keeps the generated, unabbreviated title.
    expect(t('Nav_Statistics')).toBe('Statistics');
    const statisticsScreen = readFileSync(
      join(__dirname, '..', 'src', 'ui', 'screens', 'StatisticsScreen.tsx'),
      'utf8',
    );
    expect(statisticsScreen).toContain("{t('Nav_Statistics')}");
  });
});
