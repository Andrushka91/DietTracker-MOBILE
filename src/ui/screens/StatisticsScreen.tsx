// Statistics (spec 8.6) - period bars: daily (today), weekly (Monday start),
// monthly; yearly trend (one bar per month). Every bar rises to its
// percentage with label + percentage printed as TEXT (never tooltips);
// days with no decided meals print "–". Neutral disclaimer caption below.

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import {
  PeriodProgress,
  addDays,
  endOfMonth,
  forMonth,
  forRange,
  forWeek,
  formatDate,
  startOfMonth,
  startOfWeek,
} from '../../domain/analytics';
import { getMealsInRange } from '../../data/repositories';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { BarButton, Segmented } from '../components/buttons';
import { fonts, cardShadow, themeColors, typeScale, type ThemeColors } from '../theme';
import { t, tFmt } from '../strings';

type Mode = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Ordered period list of the segmented control (index == selection). */
const MODES: Mode[] = ['daily', 'weekly', 'monthly', 'yearly'];

export function StatisticsScreen(): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const today = formatDate(new Date());
  const [mode, setMode] = useState<Mode>('weekly');
  const [anchor, setAnchor] = useState(today);
  const [period, setPeriod] = useState<PeriodProgress | null>(null);
  const [yearBars, setYearBars] = useState<
    Array<{ label: string; done: number; missed: number; pending: number; total: number }>
  >([]);

  const load = useCallback(async () => {
    if (app.profile === null) {
      return;
    }
    const year = anchor.slice(0, 4);
    const rangeFrom =
      mode === 'yearly'
        ? `${year}-01-01`
        : mode === 'monthly'
          ? startOfMonth(anchor)
          : mode === 'daily'
            ? anchor
            : startOfWeek(anchor);
    const rangeTo =
      mode === 'yearly'
        ? `${year}-12-31`
        : mode === 'monthly'
          ? endOfMonth(anchor)
          : mode === 'daily'
            ? anchor
            : addDays(rangeFrom, 6);
    const entries = await getMealsInRange(app.profile.id, rangeFrom, rangeTo);
    const byDate = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = byDate.get(entry.date) ?? [];
      list.push(entry);
      byDate.set(entry.date, list);
    }
    if (mode === 'yearly') {
      const bars: Array<{ label: string; done: number; missed: number; pending: number; total: number }> = [];
      for (let month = 1; month <= 12; month += 1) {
        const monthAnchor = `${year}-${String(month).padStart(2, '0')}-15`;
        const progress = forMonth(monthAnchor, byDate);
        bars.push({
          label: String(month).padStart(2, '0'),
          done: progress.completed,
          missed: progress.missed,
          pending: progress.pending,
          total: progress.totalSlots,
        });
      }
      setYearBars(bars);
      setPeriod(null);
      return;
    }
    const progress =
      mode === 'weekly'
        ? forWeek(anchor, byDate)
        : mode === 'monthly'
          ? forMonth(anchor, byDate)
          : forRange(anchor, anchor, byDate);
    setPeriod(progress);
    setYearBars([]);
  }, [app.profile, anchor, mode]);

  // Reloaded whenever the tab comes to the front (and on mount, mode or period
  // change), so the bars follow the background cycles without a gesture.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // A background cycle that imported another device's records recomputes the
  // period, so the bars never lag behind the dashboard.
  useEffect(() => subscribeDataChange(() => void load()), [load]);

  const shift = (delta: number): void => {
    if (mode === 'daily') {
      setAnchor(addDays(anchor, delta));
    } else if (mode === 'weekly') {
      setAnchor(addDays(anchor, delta * 7));
    } else if (mode === 'monthly') {
      const next = new Date(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1 + delta, 15);
      setAnchor(formatDate(next));
    } else {
      setAnchor(`${Number(anchor.slice(0, 4)) + delta}-06-15`);
    }
  };

  const label =
    mode === 'daily'
      ? t('Statistics_Daily')
      : mode === 'weekly'
        ? t('Statistics_Weekly')
        : mode === 'monthly'
          ? t('Statistics_Monthly')
          : t('Statistics_YearlyTrend');

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Statistics')}</Text>
      <View style={[styles.panel, cardShadow, { backgroundColor: colors.cardFill }]}>
        {/* iOS segmented control for the four periods (same mode switching). */}
        <Segmented
          options={MODES.map((item) => item.toUpperCase().slice(0, 1))}
          index={MODES.indexOf(mode)}
          onChange={(index) => setMode(MODES[index])}
          colors={colors}
        />
        <View style={styles.navRow}>
          <BarButton label="‹" onPress={() => shift(-1)} colors={colors} />
          <Text style={[styles.periodLabel, { color: colors.text }]}>{label}</Text>
          <BarButton label="›" onPress={() => shift(1)} colors={colors} />
        </View>

        {period !== null && (
          <>
            <VerticalBars
              groups={[
                {
                  label: '',
                  done: period.completed,
                  missed: period.missed,
                  pending: period.pending,
                  total: period.totalSlots,
                },
              ]}
              barWidth={34}
              height={140}
              showValues
              colors={colors}
            />
            <Text style={[styles.breakdown, { color: colors.textSecondary }]}>
              {tFmt(
                'Statistics_Breakdown',
                period.percentage,
                Math.round((period.missed * 100) / Math.max(period.decided, 1)),
                Math.round((period.pending * 100) / Math.max(period.totalSlots, 1)),
              )}
            </Text>
            <Text style={[styles.caption, { color: colors.textMuted }]}>
              {tFmt('Statistics_DaysSummary', period.days.length, period.completed, period.missed)}
            </Text>
          </>
        )}

        {yearBars.length > 0 && (
          <VerticalBars groups={yearBars} barWidth={8} height={110} showValues={false} colors={colors} />
        )}

        <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
          {t('Statistics_Disclaimer')}
        </Text>
      </View>
    </ScrollView>
  );
}

/**
 * Vertical bar chart: one group per period, three bars per group - Done in the
 * accent blue, Missed in red, Pending in gray - each bar rising to its share
 * of the period's five-per-day slots (the three always sum to the total). The
 * yearly mode passes twelve groups (one per month, three thin bars each); the
 * other modes pass a single group with the count printed under every bar.
 * Pure presentation - every number comes from the domain aggregates.
 */
function VerticalBars(props: {
  groups: Array<{ label: string; done: number; missed: number; pending: number; total: number }>;
  barWidth: number;
  height: number;
  showValues: boolean;
  colors: ThemeColors;
}): React.JSX.Element {
  const series = [
    { key: 'done', value: (group: { done: number }) => group.done, name: t('Dashboard_CountDone'), color: props.colors.accent },
    { key: 'missed', value: (group: { missed: number }) => group.missed, name: t('Dashboard_CountMissed'), color: props.colors.missed },
    { key: 'pending', value: (group: { pending: number }) => group.pending, name: t('Dashboard_CountPending'), color: props.colors.pending },
  ];
  const wide = props.barWidth > 12;
  const gap = wide ? 10 : 2;
  return (
    <View style={styles.chart}>
      <View style={[styles.chartGroups, { columnGap: wide ? 24 : 3 }]}>
        {props.groups.map((group) => (
          <View key={group.label} style={styles.chartGroup}>
            <View style={[styles.chartBars, { height: props.height, columnGap: gap }]}>
              {series.map((item) => {
                const value = item.value(group);
                const ratio = group.total > 0 ? Math.min(value / group.total, 1) : 0;
                return (
                  <View
                    key={item.key}
                    style={[
                      styles.barVertical,
                      {
                        width: props.barWidth,
                        backgroundColor: item.color,
                        height: `${Math.round(ratio * 100)}%`,
                      },
                    ]}
                  />
                );
              })}
            </View>
            {props.showValues && (
              <View style={[styles.chartValues, { columnGap: gap }]}>
                {series.map((item) => {
                  const value = item.value(group);
                  return (
                    <Text
                      key={item.key}
                      style={[styles.barValue, { color: props.colors.textSecondary, width: props.barWidth }]}>
                      {group.total > 0 ? String(value) : '\u2013'}
                    </Text>
                  );
                })}
              </View>
            )}
            {group.label !== '' && (
              <Text style={[styles.chartGroupLabel, { color: props.colors.textMuted }]} numberOfLines={1}>
                {group.label}
              </Text>
            )}
          </View>
        ))}
      </View>
      <View style={styles.chartLegend}>
        {series.map((item) => (
          <View key={item.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={[styles.legendText, { color: props.colors.textMuted }]}>{item.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, paddingBottom: 104 },
  pageTitle: { fontSize: typeScale.title, fontFamily: fonts.medium, marginBottom: 8 },
  panel: { borderRadius: 16, padding: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  periodLabel: { fontSize: 15, fontFamily: fonts.medium },
  /** Vertical chart: bar groups, values and the shared colour legend. */
  chart: { marginTop: 14, rowGap: 10 },
  chartGroups: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  chartGroup: { alignItems: 'center' },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end' },
  barVertical: { borderRadius: 999 },
  chartValues: { flexDirection: 'row', marginTop: 6 },
  barValue: { fontSize: 11, textAlign: 'center' },
  chartGroupLabel: { fontSize: 11, marginTop: 2 },
  chartLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    columnGap: 14,
    rowGap: 6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', columnGap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11 },
  breakdown: { marginTop: 12, fontSize: 13 },
  caption: { marginTop: 6, fontSize: 12 },
  disclaimer: { marginTop: 16, fontSize: 11, fontStyle: 'italic' },
});