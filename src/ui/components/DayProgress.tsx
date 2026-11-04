// The day header's progress block, drawn the way the r3 reference draws it:
//
//    ╭────────╮   ┌───────────────────────────────────────┐
//    │  1/5   │   │ ✓ 1  │ ✕ 1  │ ◷ 3                  │
//    │  Done  │   │ Done  │Missed│ Pending              │
//    ╰────────╯   └───────────────────────────────────────┘
//
// An 80 pt three-colour ring - done green, missed red, pending grey - with the
// day's fraction INSIDE it, then ONE OUTLINED strip holding the three counts as
// three EQUAL COLUMNS: the state glyph and its bold number on top, the label
// beneath, with a 1 pt rule between the columns. The strip shares the card's own
// surface and wears the same thin neutral frame as the day's bulk buttons, so it
// reads as part of the header instead of a grey panel inside it. It replaces the
// three stacked rows: side by side the three states are read in one glance instead
// of as a list to scan, and the header gets shorter while saying the same thing.
//
// Small widths / large text: below 340 dp or above a 1.4 font scale the strip
// becomes full-width rows (glyph + value + label on one line) under a centred
// ring, separated by horizontal rules - nothing shrinks below a readable size.
//
// Only the CHART text (the fraction and its caption) is capped at 1.4x, because
// it has to stay inside the circle; the counters beside it always scale fully.

import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { t, tFmt } from '../strings';
import { fonts, typeScale, type ThemeColors } from '../theme';
import { Icon, type IconName } from './icons';
import { ProgressRing } from './ProgressRing';

/** Ring geometry, measured off the reference: an 80 pt circle, 8 pt thick. */
export const DAY_RING_SIZE = 80;
export const DAY_RING_THICKNESS = 8;

/** The state marks in the metrics strip: 16 pt, the app's three state glyphs. */
const METRIC_GLYPH_SIZE = 16;

/** Chart text stops growing at 1.4x so it stays inside the ring. */
export const DAY_CHART_FONT_MAX_SCALE = 1.4;

/** Below this width - or above this font scale - the strip stacks under the ring. */
export const DAY_PROGRESS_STACK_WIDTH = 340;
export const DAY_PROGRESS_STACK_FONT_SCALE = 1.4;

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
  /** Narrow screen or very large text: the strip moves UNDER the ring. */
  const stacked =
    width < DAY_PROGRESS_STACK_WIDTH || fontScale > DAY_PROGRESS_STACK_FONT_SCALE;

  const metric = (icon: IconName, value: number, label: string, color: string): React.JSX.Element => (
    <View
      style={[
        styles.metric,
        stacked ? styles.metricStacked : styles.metricWide,
      ]}>
      <View style={[styles.metricTop, stacked && styles.metricTopStacked]}>
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
      <View style={stacked ? styles.ringCentred : undefined}>
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
            {tFmt('Rn_DayDoneOfTotal', props.completed, props.totalSlots)}
          </Text>
          <Text
            style={[styles.fractionLabel, { color: colors.textMuted }]}
            maxFontSizeMultiplier={DAY_CHART_FONT_MAX_SCALE}>
            {t('Dashboard_CountDone')}
          </Text>
        </ProgressRing>
      </View>
      <View
        style={[
          styles.metrics,
          stacked ? styles.metricsStacked : styles.metricsWide,
          { backgroundColor: colors.cardFill, borderColor: colors.cardDivider },
        ]}>
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
  /** Ring at the LEFT, the three-column strip filling the rest. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    marginTop: 8,
  },
  /** Stacked: a centred ring over one full-width strip. */
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', rowGap: 12 },
  ringCentred: { alignSelf: 'center' },
  /** The fraction inside the ring: the loudest number of the header. */
  fraction: {
    fontSize: typeScale.title2,
    lineHeight: 27,
    fontFamily: fonts.bold,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  fractionLabel: { fontSize: typeScale.caption2, lineHeight: 14, marginTop: 1 },
  /**
   * The metrics strip: the SAME surface as the card it sits on, 1 pt of the
   * neutral frame the bulk buttons wear (never a grey/blue fill or an inner
   * shadow), 64 pt minimum, 12 pt corners and 10 pt of vertical air around three
   * equal columns.
   */
  metrics: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricsWide: { flex: 1, minWidth: 0 },
  /** The strip becomes the rows: full width, one row per state. */
  metricsStacked: { flexDirection: 'column', alignItems: 'stretch' },
  /** One state: icon + bold value on top, its label beneath, centred. */
  metric: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  metricWide: { flex: 1, minWidth: 0 },
  metricStacked: {
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    columnGap: 10,
    paddingHorizontal: 12,
  },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 4,
  },
  metricTopStacked: { minWidth: 60, justifyContent: 'flex-start' },
  /** The number is the state's answer: bold ink, tabular so columns line up. */
  metricValue: {
    fontFamily: fonts.bold,
    fontSize: typeScale.title2,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: typeScale.caption,
    textAlign: 'center',
    marginTop: 3,
    alignSelf: 'stretch',
  },
  metricLabelStacked: {
    flex: 1,
    fontSize: 14,
    textAlign: 'left',
    marginTop: 0,
    alignSelf: 'center',
  },
  /** The rule between two columns: 1 pt wide, 32 pt tall, centred. */
  divider: { width: 1, height: 32, alignSelf: 'center' },
  /** ...and between two rows: 1 pt tall, the strip's full width minus 12 pt. */
  dividerStacked: { width: 'auto', height: 1, alignSelf: 'stretch', marginHorizontal: 12 },
});
