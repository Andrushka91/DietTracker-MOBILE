// The Statistics breakdown as REAL vertical columns - presentation only, for ALL
// FOUR periods: five meals (Day), seven days (Week), the clipped calendar weeks
// of a month (Month) and twelve months (Year).
//
// Every column shares ONE absolute planned-slot scale (see ../statisticsChart):
// the busiest column fills the plot and a quieter one is visibly shorter. The
// chart therefore never normalises each bar to itself - equal green heights mean
// equal counts - and a partial month week is genuinely shorter than a full one.
//
// Colours keep the app's meanings - green Done at the baseline, red Missed above
// it, neutral Pending on top - and Pending stays ONE band. Upcoming slots are
// disclosed in the summary sentence and in each column's label; they are never a
// fourth band, never a faded bar and never subtracted from the denominator, so a
// future-only column still shows its real total height and its real `0 / 5`.
//
// The chart changes PRESENTATION, not action: pressing a column calls the same
// row toggle the page owns. It selects (and pressing it again deselects) - it
// NEVER navigates; the explicit action stays in the card's selection footer.
//
// Width is handled by scrolling, never by falling back to horizontal rows: the
// column width IS the touch target (48 dp for days/months, 56 dp for meals,
// 76 dp for month ranges, all growing with the system text), the y-axis sits
// OUTSIDE the horizontal viewport so it stays visible while panning, and a
// visible scrollbar plus one hint line appear only when the columns overflow.

import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { chartScaleMax, outcomeSegments } from '../statisticsChart';
import { monthColumnLayout, yearColumnLayout } from '../statisticsMonthLayout';
import { statisticsVerticalTokens as TPL } from '../statisticsVertical';
import type { Counts, Mode } from '../statisticsBreakdown';
import { t } from '../strings';
import { fonts, tintAlpha, type ThemeColors } from '../theme';

/** One column: the settled row's own label, counts and accessible description. */
export interface OutcomeColumn {
  key: string;
  label: string;
  /**
   * Month only: the compact two-line bucket label ("2–8\nNov"). The FULL row
   * label, its year and every count stay in `accessibilityLabel` and in the
   * selection detail, so nothing is lost by printing this one.
   */
  displayLabel?: string;
  /** The existing `done / total` value - printed for EVERY column, also future ones. */
  valueLabel: string;
  /** Full context + done, missed, pending, total and upcoming - never colour alone. */
  accessibilityLabel: string;
  counts: Counts;
  /** The whole row lies in the future. Extra metadata, never a replacement value. */
  allLater: boolean;
}

/**
 * Plot geometry in dp. A column's WIDTH is its touch target, so the chart never
 * shrinks a mark below the 48 dp platform floor; the visible bar stays 18 dp.
 */
export const CHART = {
  plotHeight: 160,
  axisWidth: 20,
  barWidth: 18,
  columnWidth: 48,
  mealColumnWidth: 56,
  rangeColumnWidth: 76,
  valueMinHeight: 24,
  labelMinHeight: 40,
  radius: 8,
  barRadius: 3,
  keySize: 8,
} as const;

/** Wording of the legend keys - the app's existing state names. */
const LEGEND_KEY = {
  done: 'Dashboard_CountDone',
  missed: 'Dashboard_CountMissed',
  pending: 'Dashboard_CountPending',
} as const;

const STATUSES = ['done', 'missed', 'pending'] as const;

export function VerticalOutcomeChart(props: {
  rows: OutcomeColumn[];
  /** Which grouping the columns are: it decides their width only. */
  mode: Mode;
  selectedKey: string | null;
  onToggleRow: (key: string) => void;
  colors: ThemeColors;
}): React.JSX.Element {
  const { colors } = props;
  const { fontScale } = useWindowDimensions();
  /** Measured, so the hint follows the real container instead of a guessed width. */
  const [viewportWidth, setViewportWidth] = useState(0);
  /**
   * Month columns are DISTRIBUTED across the measured viewport (a month has four,
   * five or six clipped weeks), so all of them can fit instead of the last group
   * hiding behind the edge. The other periods keep their own fixed widths.
   */
  const monthLayout =
    props.mode === 'monthly'
      ? monthColumnLayout(viewportWidth, props.rows.length, fontScale)
      : props.mode === 'yearly'
        ? // Year: twelve months, but an INTEGER number of COMPLETE columns fills
          // the measured viewport at rest (after the fixed y-axis), so no month
          // is clipped at the right edge; the remaining months scroll.
          yearColumnLayout(viewportWidth, props.rows.length, fontScale)
        : null;
  const baseWidth = props.mode === 'daily' ? CHART.mealColumnWidth : CHART.columnWidth;
  const columnWidth =
    monthLayout?.columnWidth ?? Math.ceil(baseWidth * Math.max(1, fontScale));
  const axisWidth = Math.ceil(CHART.axisWidth * Math.max(1, fontScale));
  /** The value line grows with the system text instead of clipping it. */
  const valueHeight = Math.max(CHART.valueMinHeight, Math.ceil(20 * fontScale));
  /** ONE scale for every column in the chart - never per-column normalising. */
  const scaleMax = chartScaleMax(props.rows);
  /** The month layout counts its own end gutters; the others are contiguous. */
  const contentWidth = monthLayout?.contentWidth ?? columnWidth * props.rows.length;
  const overflowing =
    monthLayout !== null ? monthLayout.overflowing : viewportWidth > 0 && contentWidth > viewportWidth;
  return (
    <View style={styles.outer}>
      <Text style={[styles.axisLabel, { color: colors.textMuted }]}>
        {t('Rn_StatAxisLabel')}
      </Text>
      <View style={styles.plotRow}>
        {/* The axis lives OUTSIDE the horizontal viewport: panning the columns
            never hides the scale's two ends. */}
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.axis,
            { width: axisWidth, marginTop: valueHeight, height: CHART.plotHeight },
          ]}>
          <Text style={[styles.axisText, { color: colors.textMuted }]}>{scaleMax}</Text>
          <Text style={[styles.axisText, { color: colors.textMuted }]}>0</Text>
        </View>
        <ScrollView
          horizontal
          style={styles.viewport}
          showsHorizontalScrollIndicator={overflowing}
          keyboardShouldPersistTaps="handled"
          // A REAL gutter on the scroll content (never on the viewport), so the
          // first and last columns' value, label and selection border sit clear
          // of the viewport edges - including December at maximum scroll, which
          // keeps an 8 dp trailing gutter. The same gutters are counted in the
          // layout's contentWidth used for the overflow hint.
          contentContainerStyle={
            (monthLayout?.edgePadding ?? 0) > 0
              ? styles.monthEdges
              : undefined
          }
          accessibilityHint={t('Rn_StatChartScrollHint')}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}>
          <View style={[styles.columns, monthLayout !== null && styles.columnsMonth]}>
            {props.rows.map((row) => {
              const selected = props.selectedKey === row.key;
              return (
                <Pressable
                  key={row.key}
                  accessibilityRole="button"
                  accessibilityLabel={row.accessibilityLabel}
                  accessibilityState={{ selected }}
                  onPress={() => props.onToggleRow(row.key)}
                  style={({ pressed }) => [
                    styles.column,
                    {
                      width: columnWidth,
                      // No frame and no fill on an unselected column: the tint
                      // and the outline mark the SELECTION, not the column.
                      borderColor: selected ? colors.accent : 'transparent',
                      backgroundColor: selected
                        ? tintAlpha(colors.accent, colors.dark ? '2E' : '1A')
                        : pressed
                          ? colors.surfaceVariant
                          : 'transparent',
                    },
                  ]}>
                  <View style={[styles.valueBox, { minHeight: valueHeight }]}>
                    <Text
                      style={[
                        styles.value,
                        { color: selected ? colors.accent : colors.textMuted },
                      ]}>
                      {row.valueLabel}
                    </Text>
                  </View>
                  <View
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    style={styles.barSpace}>
                    {/* The plot's two rules: the scale maximum and zero. */}
                    <View style={[styles.gridTop, { backgroundColor: colors.border }]} />
                    <View style={[styles.gridBottom, { backgroundColor: colors.border }]} />
                    <View style={styles.bar}>
                      {outcomeSegments(row.counts, scaleMax, CHART.plotHeight)
                        .filter((segment) => segment.height > 0)
                        .map((segment) => (
                          <View
                            key={segment.status}
                            style={[
                              styles.segment,
                              {
                                bottom: segment.bottom,
                                height: segment.height,
                                backgroundColor:
                                  segment.status === 'pending'
                                    ? colors.barPending
                                    : colors[segment.status],
                              },
                            ]}
                          />
                        ))}
                    </View>
                  </View>
                  <View style={styles.labelBox}>
                    <Text
                      style={[styles.label, { color: selected ? colors.accent : colors.text }]}>
                      {/* The compact month bucket, or the row's own full label. */}
                      {row.displayLabel ?? row.label}
                    </Text>
                    {/* "Later" is EXTRA metadata beside the real value above. */}
                    {row.allLater && (
                      <Text style={[styles.later, { color: colors.textMuted }]}>
                        {t('Rn_StatLater')}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
      {overflowing && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {t('Rn_StatChartScrollHint')}
        </Text>
      )}
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        {t('Rn_StatChartSelectHint')}
      </Text>
      {/* Labelled keys: the states are named, not left to colour alone. */}
      <View style={[styles.legend, { borderTopColor: colors.border }]}>
        {STATUSES.map((status) => (
          <View key={status} style={styles.legendItem}>
            <View
              accessible={false}
              style={[
                styles.key,
                {
                  backgroundColor: status === 'pending' ? colors.barPending : colors[status],
                },
              ]}
            />
            <Text style={[styles.legendText, { color: colors.textMuted }]}>
              {t(LEGEND_KEY[status])}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: 8 },
  /** The axis caption: what the column heights are measured in. */
  axisLabel: { fontSize: 12, lineHeight: 18, fontFamily: fonts.regular, marginBottom: 4 },
  plotRow: { flexDirection: 'row' },
  /** The fixed scale: two ticks, no frame, never inside the scrolling viewport. */
  axis: { justifyContent: 'space-between' },
  axisText: { fontSize: 11, lineHeight: 16, fontFamily: fonts.regular, fontVariant: ['tabular-nums'] },
  viewport: { flex: 1 },
  columns: { flexDirection: 'row' },
  /** Month columns sit one small gap apart instead of shoulder to shoulder. */
  columnsMonth: { columnGap: TPL.monthColumnGap },
  /** The overflow gutters live on the SCROLL CONTENT, so they really scroll. */
  monthEdges: { paddingHorizontal: TPL.monthEdgePadding },
  /** One column = one touch target; only the selection draws a frame. */
  column: {
    borderWidth: 1,
    borderRadius: CHART.radius,
    alignItems: 'center',
  },
  valueBox: { paddingHorizontal: 2, justifyContent: 'center' },
  value: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fonts.regular,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  barSpace: { width: '100%', height: CHART.plotHeight, alignItems: 'center' },
  gridTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 },
  gridBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1 },
  /** The stack: a clipping box the three bands are positioned inside. */
  bar: {
    position: 'relative',
    height: CHART.plotHeight,
    width: CHART.barWidth,
    overflow: 'hidden',
    borderRadius: CHART.barRadius,
  },
  segment: { position: 'absolute', left: 0, right: 0 },
  /** Constrained to the column, so a two-line month label stays inside it. */
  labelBox: {
    width: '100%',
    minHeight: CHART.labelMinHeight,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  /** Labels wrap freely: a long month range or meal name is never cut. */
  label: { fontSize: 11, lineHeight: 16, fontFamily: fonts.regular, textAlign: 'center' },
  later: { fontSize: 11, lineHeight: 16, fontFamily: fonts.regular, textAlign: 'center' },
  hint: { fontSize: 11, lineHeight: 16, fontFamily: fonts.regular, marginTop: 4 },
  legend: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', columnGap: 5 },
  key: { width: CHART.keySize, height: CHART.keySize, borderRadius: 2 },
  legendText: { fontSize: 11, fontFamily: fonts.regular },
});
