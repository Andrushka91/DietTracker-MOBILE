// The Week breakdown as seven REAL daily columns, presentation only.
//
// Each column is one day of the settled week and every column shares ONE
// absolute slot scale (see ../statisticsChart): the busiest day fills the plot,
// a quieter day is visibly shorter. Colours keep the app's meanings - green
// Done, red Missed, neutral Pending - and Pending stays ONE band: upcoming slots
// are disclosed in the sentence under the summary, never invented as a fourth
// segment and never subtracted from the denominator.
//
// The chart changes PRESENTATION, not action. Pressing a column calls the same
// row toggle the list uses: it selects the row (and the page's existing
// selection panel offers the explicit day/calendar action), it never navigates.
//
// Below the plot, labelled keys name the three states, so nothing depends on
// colour alone; the column's own number above the bar repeats the exact values.

import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { chartScaleMax, outcomeSegments } from '../statisticsChart';
import type { Counts } from '../statisticsBreakdown';
import { t } from '../strings';
import { fonts, tintAlpha, type ThemeColors } from '../theme';

/** One column: the settled row's own label, counts and accessible description. */
export interface WeeklyChartRow {
  key: string;
  label: string;
  /** The existing `done / total` label (or the localized "Later"). */
  valueLabel: string;
  accessibilityLabel: string;
  counts: Counts;
  /** A row made only of future slots reads quieter - its counts are unchanged. */
  allLater: boolean;
}

/**
 * Geometry of the plot in dp. The column width IS the touch target (Android 48,
 * iOS 44), so a column is never a shrunken mark; the screen checks the same
 * numbers before it decides the chart fits.
 */
export const CHART = {
  plotHeight: 96,
  axisWidth: 18,
  barWidth: 18,
  columnWidth: Platform.OS === 'android' ? 48 : 44,
  valueMinHeight: 24,
  labelMinHeight: 26,
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

export function WeeklyOutcomeChart(props: {
  rows: WeeklyChartRow[];
  selectedKey: string | null;
  onToggleRow: (key: string) => void;
  colors: ThemeColors;
}): React.JSX.Element {
  const { colors } = props;
  const { fontScale } = useWindowDimensions();
  /** The value line grows with the system text instead of clipping it. */
  const valueHeight = Math.max(CHART.valueMinHeight, Math.ceil(20 * fontScale));
  /** ONE scale for the whole week - the busiest column fills the plot. */
  const scaleMax = chartScaleMax(props.rows);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.plot}>
          {/* The axis repeats the scale's two ends: the busiest day and zero. */}
          <View accessible={false} style={[styles.axis, { marginTop: valueHeight + 1 }]}>
            <Text style={[styles.axisText, { color: colors.textMuted }]}>{scaleMax}</Text>
            <Text style={[styles.axisText, { color: colors.textMuted }]}>0</Text>
          </View>
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
                    backgroundColor: selected
                      ? tintAlpha(colors.accent, colors.dark ? '2E' : '1A')
                      : pressed
                        ? colors.surfaceVariant
                        : 'transparent',
                    borderColor: selected ? colors.accent : 'transparent',
                  },
                ]}>
                <View style={[styles.valueBox, { minHeight: valueHeight }]}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.value,
                      { color: selected ? colors.accent : colors.textMuted },
                    ]}>
                    {row.valueLabel}
                  </Text>
                </View>
                {/* Heights are DISPLAY only; the counts here and below are exact. */}
                <View accessible={false} style={styles.barSpace}>
                  <View style={[styles.gridLine, styles.gridTop, { backgroundColor: colors.border }]} />
                  <View
                    style={[styles.gridLine, styles.gridBottom, { backgroundColor: colors.border }]}
                  />
                  <View style={[styles.bar, row.allLater && styles.barQuiet]}>
                    {outcomeSegments(row.counts, scaleMax, CHART.plotHeight).map((segment) =>
                      segment.height <= 0 ? null : (
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
                      ),
                    )}
                  </View>
                </View>
                <View style={styles.labelBox}>
                  <Text
                    numberOfLines={2}
                    style={[styles.label, { color: selected ? colors.accent : colors.text }]}>
                    {row.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
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
    </>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: 'row', paddingTop: 4 },
  axis: { width: CHART.axisWidth, height: CHART.plotHeight, justifyContent: 'space-between' },
  axisText: { fontSize: 11, fontFamily: fonts.regular, fontVariant: ['tabular-nums'] },
  column: {
    minWidth: CHART.columnWidth,
    borderWidth: 1,
    borderRadius: CHART.radius,
    alignItems: 'center',
  },
  valueBox: { justifyContent: 'center', paddingHorizontal: 2 },
  value: { fontSize: 11, fontFamily: fonts.regular, fontVariant: ['tabular-nums'] },
  barSpace: { width: '100%', height: CHART.plotHeight, alignItems: 'center' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1 },
  /** The plot's two rules: the scale maximum above, zero on the baseline. */
  gridTop: { top: 0 },
  gridBottom: { bottom: 0 },
  /** The stack: a clipping box the three bands are positioned inside. */
  bar: {
    position: 'relative',
    height: CHART.plotHeight,
    width: CHART.barWidth,
    overflow: 'hidden',
    borderRadius: CHART.barRadius,
  },
  /** A day made only of future slots: quieter, never recoloured or re-counted. */
  barQuiet: { opacity: 0.4 },
  segment: { position: 'absolute', left: 0, right: 0 },
  labelBox: {
    minHeight: CHART.labelMinHeight,
    maxWidth: CHART.columnWidth + 8,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  label: { fontSize: 11, fontFamily: fonts.regular, textAlign: 'center' },
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
