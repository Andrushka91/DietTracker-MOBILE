// The three slot counts of the statistics page's primary panel, drawn as three
// compact metric tiles:
//
//      ┌──────────┐ ┌──────────┐ ┌──────────┐
//      │ ✓ 19     │ │ ✕ 7      │ │ ◷ 9      │
//      │ Done     │ │ Missed   │ │ Pending  │
//      └──────────┘ └──────────┘ └──────────┘
//
//      All 35 planned slots in this week.
//
// TWO lines per count: the state glyph and the BOLD number share the first line,
// and the state's name sits under it. Each tile is one third of the row, wears
// the same 1 dp outline / 8 dp corners as every small control in the app and
// exposes the state as one accessible label ("Done: 19"), so a screen reader
// reads a metric instead of three loose words.
//
// The closing sentence is untouched copy: it still names the period's planned
// slots and discloses the upcoming ones, which are a SUBSET of Pending and never
// a fourth band.

import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { Counts } from '../statisticsBreakdown';
import { t, tFmt } from '../strings';
import { fonts, type ThemeColors } from '../theme';
import { Icon, type IconName } from './icons';

/**
 * Sizes of the tiles in dp/sp. The number stays the loudest text of the block;
 * below this width (or above this text scale) the tiles stack, which is the only
 * case where the three of them do not share one row.
 */
const TILE = {
  radius: 8,
  borderWidth: 1,
  minHeight: 56,
  gap: 6,
  glyphSize: 15,
  countSize: 22,
  labelSize: 11,
  stackWidth: 330,
  stackFontScale: 1.4,
} as const;


/**
 * Splits "All {0} planned slots in this {1}." around its number, so the total can
 * be drawn in the theme's ink without a second translated sentence.
 */
function plannedSentence(period: string): { before: string; after: string } {
  const [before = '', rest = ''] = t('Rn_StatAllPlanned').split('{0}');
  return { before, after: rest.replace('{1}', period) };
}

export function SlotCounts(props: {
  counts: Counts;
  /** The period word inside the closing sentence: day / week / month / year. */
  period: string;
  colors: ThemeColors;
}): React.JSX.Element {
  const { counts, colors } = props;
  const { before, after } = plannedSentence(props.period);
  /** Enlarged text or a narrow window: the tiles stack instead of squeezing. */
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale > TILE.stackFontScale || width < TILE.stackWidth;
  return (
    <>
      <View style={[styles.metrics, stacked && styles.metricsStacked]}>
        <SlotCount
          icon="checkmark"
          label={t('Dashboard_CountDone')}
          value={counts.done}
          color={colors.done}
          colors={colors}
          stacked={stacked}
        />
        <SlotCount
          icon="close"
          label={t('Dashboard_CountMissed')}
          value={counts.missed}
          color={colors.missed}
          colors={colors}
          stacked={stacked}
        />
        <SlotCount
          icon="time-outline"
          label={t('Dashboard_CountPending')}
          value={counts.pending}
          color={colors.pending}
          colors={colors}
          stacked={stacked}
        />
      </View>
      <Text style={[styles.sentence, { color: colors.textMuted }]}>
        {before}
        <Text style={[styles.sentenceNumber, { color: colors.text }]}>{counts.total}</Text>
        {after}
        {counts.upcoming > 0 ? ` ${tFmt('Rn_StatIncludesUpcoming', counts.upcoming)}` : ''}
      </Text>
    </>
  );
}

/** One tile: the state glyph beside its number, the state's name underneath. */
function SlotCount(props: {
  icon: IconName;
  label: string;
  value: number;
  color: string;
  colors: ThemeColors;
  stacked: boolean;
}): React.JSX.Element {
  return (
    <View
      accessible
      accessibilityLabel={`${props.label}: ${props.value}`}
      style={[
        styles.cell,
        props.stacked && styles.cellStacked,
        { borderColor: props.colors.border, backgroundColor: props.colors.surface },
      ]}>
      <View style={styles.head}>
        <Icon name={props.icon} size={TILE.glyphSize} color={props.color} />
        <Text style={[styles.value, { color: props.colors.text }]}>{props.value}</Text>
      </View>
      <Text style={[styles.label, { color: props.colors.textSecondary }]}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Three equal tiles; the stack is the large-text fallback, not the default. */
  metrics: { flexDirection: 'row', columnGap: TILE.gap, marginTop: 10 },
  metricsStacked: { flexDirection: 'column', rowGap: TILE.gap },
  cell: {
    flex: 1,
    minWidth: 0,
    rowGap: 2,
    borderWidth: TILE.borderWidth,
    borderRadius: TILE.radius,
    minHeight: TILE.minHeight,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  /** Stacked tile: glyph + number on the left, the name beside them. */
  cellStacked: { flex: 0, flexDirection: 'row', alignItems: 'center', columnGap: 8 },
  /** First line: the state glyph and the number it counts. */
  head: { flexDirection: 'row', alignItems: 'center', columnGap: 5 },
  /** The number is what the block exists for, so it is the largest text in it. */
  value: {
    fontSize: TILE.countSize,
    lineHeight: 26,
    fontFamily: fonts.bold,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  /** Second line: the state's name, quiet and smaller than its number. */
  label: { fontSize: TILE.labelSize, lineHeight: 15, fontFamily: fonts.regular, flexShrink: 1 },
  /** The closing sentence: muted, with the period total set apart. */
  sentence: { marginTop: 8, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  sentenceNumber: { fontFamily: fonts.bold },
});

