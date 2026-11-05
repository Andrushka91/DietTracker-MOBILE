// The day header's progress block, drawn the way the v3 reference draws it:
//
//    ╭──────╮    ✓ 1  │ ✕ 1  │ ◷ 3
//    │  1/5 │    Done │Missed│ Pending
//    │ Done │
//    ╰──────╯
//
// A 64 pt three-colour ring - done green, missed red, pending grey, 6 pt thick -
// with the day's fraction INSIDE it, then the three counts as three EQUAL
// COLUMNS: the state glyph and its bold number on top, the label beneath, with a
// short 24 pt rule between the columns. The metrics are deliberately UNFRAMED:
// no panel, no inner border, no shadow - they sit on the header's own surface, so
// the header reads as ONE card instead of a card holding another one.
//
// Narrow width / large text (below 340 dp or above a 1.2 font scale): the ring is
// replaced by the same information in TEXT - the day's fraction over its "Done"
// caption - and the three counts become full-width rows split by horizontal
// rules. Nothing shrinks below a readable size, and a 64 pt circle can never clip
// the text it is meant to hold.
//
// Only the CHART text (the fraction and its caption) is capped at 1.4x; the
// counters beside it always scale fully.

import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { t, tFmt } from '../strings';
import { fonts, type ThemeColors } from '../theme';
import { homeCompact } from '../homeCompact';
import { Icon, type IconName } from './icons';
import { ProgressRing } from './ProgressRing';

/** Ring geometry, from the Home tokens: a 64 pt circle, 6 pt thick. */
export const DAY_RING_SIZE = homeCompact.ringSize;
export const DAY_RING_THICKNESS = homeCompact.ringStroke;

/** The state marks in the metrics: 16 pt, the app's three state glyphs. */
const METRIC_GLYPH_SIZE = homeCompact.metricIcon;

/** Chart text stops growing at 1.4x so it stays inside the ring. */
export const DAY_CHART_FONT_MAX_SCALE = 1.4;

/** Below this width - or above this font scale - the block stacks (text, not a ring). */
export const DAY_PROGRESS_STACK_WIDTH = 340;
export const DAY_PROGRESS_STACK_FONT_SCALE = homeCompact.stackFontScale;

export function DayProgress(props: {
  /** Slots marked done today. */
  completed: number;
  missed: number;
  /** Slots with no outcome yet (upcoming ones included - they are still open). */
  pending: number;
  /** Every planned slot of the day: the fraction's denominator. */
  totalSlots: number;
  colors: ThemeColors;
}): React.JSX.Element {
  const { colors } = props;
  const { width, fontScale } = useWindowDimensions();
  /**
   * Narrow screen or large text: the block stacks, and the ring gives way to the
   * same numbers as TEXT (so the circle never clips them).
   */
  const stacked =
    width < DAY_PROGRESS_STACK_WIDTH || fontScale > DAY_PROGRESS_STACK_FONT_SCALE;
  /** The day's own fraction - drawn inside the ring, or as the stacked summary. */
  const fraction = tFmt('Rn_DayDoneOfTotal', props.completed, props.totalSlots);

  const metric = (icon: IconName, value: number, label: string, color: string): React.JSX.Element => (
    <View style={[styles.metric, stacked && styles.metricStacked]}>
      <View style={styles.metricTop}>
        <Icon name={icon} size={METRIC_GLYPH_SIZE} color={color} />
        <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      </View>
      <Text
        style={[
          styles.metricLabel,
          stacked && styles.metricLabelStacked,
          { color: colors.textMuted },
        ]}>
        {label}
      </Text>
    </View>
  );

  /** The 1 pt rule between two columns (a horizontal rule in the stacked rows). */
  const divider = (): React.JSX.Element => (
    <View
      accessible={false}
      style={[
        styles.divider,
        stacked && styles.dividerStacked,
        { backgroundColor: colors.border },
      ]}
    />
  );

  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      {stacked ? (
        /* The textual stand-in for the ring: the same fraction, the same caption,
           free to wrap - nothing is capped and nothing can be clipped. */
        <View style={styles.summary}>
          <Text style={[styles.summaryValue, { color: colors.text }]}>{fraction}</Text>
          <Text style={[styles.summaryCaption, { color: colors.textMuted }]}>
            {t('Dashboard_CountDone')}
          </Text>
        </View>
      ) : (
        <ProgressRing
          size={DAY_RING_SIZE}
          thickness={DAY_RING_THICKNESS}
          segments={[
            { value: props.completed, color: colors.done },
            { value: props.missed, color: colors.missed },
            // Pending is the quiet neutral arc, the same tone as the statistics
            // page's pending segment: what is still open must not shout.
            { value: props.pending, color: colors.barPending },
          ]}>
          <Text
            style={[styles.fraction, { color: colors.text }]}
            // Chart labels: they have to stay INSIDE the ring, so a very large
            // system text size grows them only to the point the circle can hold.
            maxFontSizeMultiplier={DAY_CHART_FONT_MAX_SCALE}>
            {fraction}
          </Text>
          <Text
            style={[styles.fractionLabel, { color: colors.textMuted }]}
            maxFontSizeMultiplier={DAY_CHART_FONT_MAX_SCALE}>
            {t('Dashboard_CountDone')}
          </Text>
        </ProgressRing>
      )}
      <View style={[styles.metrics, stacked && styles.metricsStacked]}>
        {metric('checkmark', props.completed, t('Dashboard_CountDone'), colors.done)}
        {divider()}
        {metric('close', props.missed, t('Dashboard_CountMissed'), colors.missed)}
        {divider()}
        {metric('time-outline', props.pending, t('Dashboard_CountPending'), colors.pending)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Ring at the LEFT, the three-column metrics filling the rest, 8 dp apart. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: homeCompact.ringLegendGap,
    marginTop: homeCompact.progressGapTop,
  },
  /** Stacked: the textual fraction over one full-width column of rows. */
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    rowGap: homeCompact.ringLegendGap,
  },
  /** The stack's textual stand-in for the ring, on the card's left edge. */
  summary: { alignItems: 'flex-start' },
  summaryValue: {
    fontFamily: fonts.medium,
    fontSize: homeCompact.metricSize,
    lineHeight: homeCompact.metricLine,
    fontVariant: ['tabular-nums'],
  },
  summaryCaption: {
    fontFamily: fonts.regular,
    fontSize: homeCompact.metricLabelSize,
    lineHeight: homeCompact.metricLabelLine,
  },
  /** The fraction inside the ring: the loudest number of the header. */
  fraction: {
    fontSize: homeCompact.fractionSize,
    lineHeight: homeCompact.fractionLine,
    fontFamily: fonts.bold,
    fontVariant: ['tabular-nums'],
  },
  fractionLabel: {
    fontSize: homeCompact.ringCaptionSize,
    lineHeight: homeCompact.ringCaptionLine,
  },
  /**
   * The metrics: NO frame, NO fill, NO corner radius - they sit straight on the
   * header's own surface, 56 pt minimum, around three equal columns.
   */
  metrics: {
    flex: 1,
    minWidth: 0,
    minHeight: homeCompact.metricMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** The metrics become the rows: full width, one row per state. */
  metricsStacked: { flex: 0, flexDirection: 'column', alignItems: 'stretch' },
  /** One state: icon + bold value on top, its label beneath, centred. */
  metric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: homeCompact.metricPaddingX,
  },
  /** Stacked: glyph + value + label become ONE row that may wrap. */
  metricStacked: {
    flex: 0,
    minHeight: homeCompact.stackedMetricMinHeight,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: homeCompact.ringLegendGap,
  },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: homeCompact.metricGap,
  },
  /** The number is the state's answer: bold ink, tabular so columns line up. */
  metricValue: {
    fontFamily: fonts.bold,
    fontSize: homeCompact.metricSize,
    lineHeight: homeCompact.metricLine,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: homeCompact.metricLabelSize,
    lineHeight: homeCompact.metricLabelLine,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  metricLabelStacked: { flexShrink: 1, textAlign: 'left', alignSelf: 'center' },
  /** The rule between two columns: 1 pt wide, 24 pt tall, centred. */
  divider: {
    width: homeCompact.border,
    height: homeCompact.dividerHeight,
    alignSelf: 'center',
  },
  /** ...and between two rows: 1 pt tall, the block's full width. */
  dividerStacked: { width: '100%', height: homeCompact.border, alignSelf: 'stretch' },
});
