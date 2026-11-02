// Statistics (spec 8.6) - one primary measure per period, then progressive
// detail, following the round-3 review design:
//
//   period      Day / Week / Month / Year with the exact range printed
//   primary     Done / ALL planned slots (percentage + "19 of 35")
//   composition one status bar plus the three aligned counts
//   breakdown   interactive rows (meals, days, partial weeks or months)
//   selection   counts of the chosen row and an explicit day/calendar action
//   disclosures "By meal type" and "How the numbers work"
//
// Two rates are deliberately BOTH shown, and each is labelled:
//   * completion = Done / all planned slots (upcoming meals included),
//   * among recorded outcomes = Done / (Done + Missed) - the domain's
//     PeriodProgress.percentage, which excludes pending slots.
// Reporting only one of them is what made the old page easy to misread.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { PeriodProgress, addDays, forRange, formatDate } from '../../domain/analytics';
import { MealEntry } from '../../domain/models';
import { getMealsInRange } from '../../data/repositories';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { IconButton, Segmented } from '../components/buttons';
import { Icon } from '../components/icons';
import {
  fonts,
  metrics,
  pageTitleStyle,
  themeColors,
  type ThemeColors,
} from '../theme';
import { useFloatingTabBarClearance } from '../tabBar';
import {
  buildRows,
  countSlots,
  emptyCounts,
  periodLabel,
  periodRange,
  periodWord,
  type BreakdownRow,
  type Mode,
} from '../statisticsBreakdown';

/** Order of the segmented control (index == selection). */
const MODES: Mode[] = ['daily', 'weekly', 'monthly', 'yearly'];
import { mealNameKey, t, tFmt } from '../strings';

export function StatisticsScreen(): React.JSX.Element {
  const app = useApp();
  const navigation = useNavigation();
  const colors = themeColors(app.isDark);
  const bottomClearance = useFloatingTabBarClearance();
  const today = formatDate(new Date());
  const [mode, setMode] = useState<Mode>('weekly');
  const [anchor, setAnchor] = useState(today);
  const [period, setPeriod] = useState<PeriodProgress | null>(null);
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Disclosures: the meal-type table and the calculation notes. */
  const [openByMeal, setOpenByMeal] = useState(false);
  const [openCalc, setOpenCalc] = useState(false);

  const load = useCallback(async () => {
    if (app.profile === null) {
      return;
    }
    const range = periodRange(mode, anchor);
    const entries = await getMealsInRange(app.profile.id, range.from, range.to);
    const byDate = new Map<string, MealEntry[]>();
    for (const entry of entries) {
      const list = byDate.get(entry.date) ?? [];
      list.push(entry);
      byDate.set(entry.date, list);
    }
    // Sparse map: days without entries are still days (five pending slots each),
    // which is exactly what the completion denominator has to count.
    const progress = forRange(range.from, range.to, byDate);
    setPeriod(progress);
    setRows(buildRows(mode, range.from, range.to, progress.days, today));
  }, [app.profile, anchor, mode, today]);

  // Reloaded whenever the tab comes to the front (and on mount, period or anchor
  // change), so the numbers follow background cycles without a gesture.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => subscribeDataChange(() => void load()), [load]);

  /** A selection only survives while its row exists in the current period. */
  useEffect(() => {
    if (selectedKey !== null && !rows.some((row) => row.key === selectedKey)) {
      setSelectedKey(null);
    }
  }, [rows, selectedKey]);

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

  const range = periodRange(mode, anchor);
  const counts = period === null ? emptyCounts() : countSlots(period.days, today);
  const recorded = counts.done + counts.missed;
  /** Primary measure: done / every planned slot in the period. */
  const completion = counts.total === 0 ? 0 : Math.round((counts.done * 100) / counts.total);
  /** Secondary, separately labelled: done / (done + missed). */
  const recordedRate = recorded === 0 ? null : Math.round((counts.done * 100) / recorded);
  const selectedRow = rows.find((row) => row.key === selectedKey) ?? null;
  const breakdownTitle =
    mode === 'daily'
      ? t('Rn_StatByMeal')
      : mode === 'weekly'
        ? t('Rn_StatDailyBreakdown')
        : mode === 'monthly'
          ? t('Rn_StatWeeklyBreakdown')
          : t('Rn_StatMonthlyBreakdown');

  /** The tab navigator is untyped here, so the two destinations are named once. */
  const openRow = (row: BreakdownRow): void => {
    const nav = navigation as unknown as {
      navigate: (name: string, params?: Record<string, unknown>) => void;
    };
    if (row.from === row.to) {
      nav.navigate('DashboardTab', { date: row.from });
      return;
    }
    nav.navigate('CalendarTab', { date: row.from });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // Same bottom room as the other pages: the floating tab bar never
        // covers the last disclosure.
        { paddingBottom: bottomClearance },
      ]}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Statistics')}</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t('Rn_StatSubtitle')}</Text>

      <View style={styles.segmentWrap}>
        <Segmented
          options={[
            t('Rn_PeriodDay'),
            t('Rn_PeriodWeek'),
            t('Rn_PeriodMonth'),
            t('Rn_PeriodYear'),
          ]}
          index={MODES.indexOf(mode)}
          onChange={(index) => setMode(MODES[index])}
          colors={colors}
        />
      </View>

      <View style={styles.periodRow}>
        <IconButton
          label={t('Dashboard_PreviousDay')}
          icon="chevron-back"
          onPress={() => shift(-1)}
          size={20}
          touch={44}
          colors={colors}
        />
        <Text style={[styles.periodLabel, { color: colors.text }]} numberOfLines={1}>
          {periodLabel(mode, range.from, range.to)}
        </Text>
        <IconButton
          label={t('Dashboard_NextDay')}
          icon="chevron-forward"
          onPress={() => shift(1)}
          size={20}
          touch={44}
          colors={colors}
        />
      </View>


      {/* Primary panel: one measure, its fraction, the composition and the counts. */}
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.panelHeading}>
          <Text style={[styles.panelLabel, { color: colors.textSecondary }]}>
            {t('Rn_StatCompletion')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Rn_StatHowItWorks')}
            accessibilityState={{ expanded: openCalc }}
            onPress={() => setOpenCalc((open) => !open)}
            hitSlop={8}
            style={styles.infoButton}>
            <Icon name="information-circle-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.heroRow}>
          <Text style={[styles.heroPercent, { color: colors.text }]}>
            {counts.done > 0 && completion === 0 ? '<1%' : `${completion}%`}
          </Text>
          <View style={styles.heroText}>
            <Text style={[styles.heroFraction, { color: colors.text }]}>
              {tFmt('Rn_StatDoneOfTotal', counts.done, counts.total)}
            </Text>
            <Text style={[styles.heroCaption, { color: colors.textMuted }]}>
              {t('Rn_StatPlannedCompleted')}
            </Text>
          </View>
        </View>

        {/* Composition: one bar, the three states in their state colours. */}
        <View style={[styles.composition, { backgroundColor: colors.surfaceVariant }]}>
          {(
            [
              ['done', counts.done, colors.done],
              ['missed', counts.missed, colors.missed],
              ['pending', counts.pending, colors.pending],
            ] as const
          ).map(([key, value, color]) =>
            value === 0 ? null : <View key={key} style={{ flex: value, backgroundColor: color }} />,
          )}
        </View>

        <View style={styles.statCounts}>
          <StatCount icon="checkmark" label={t('Dashboard_CountDone')} value={counts.done} color={colors.done} colors={colors} />
          <StatCount icon="close" label={t('Dashboard_CountMissed')} value={counts.missed} color={colors.missed} colors={colors} />
          <StatCount icon="time-outline" label={t('Dashboard_CountPending')} value={counts.pending} color={colors.pending} colors={colors} />
        </View>

        <Text style={[styles.contextLine, { color: colors.textMuted }]}>
          {tFmt('Rn_StatAllPlanned', counts.total, periodWord(mode))}
          {counts.upcoming > 0 ? ` ${tFmt('Rn_StatIncludesUpcoming', counts.upcoming)}` : ''}
        </Text>
      </View>


      {/* Breakdown: the rows are the interaction, the selection is the answer. */}
      <View style={styles.breakdownHeading}>
        <Text style={[styles.breakdownTitle, { color: colors.text }]}>{breakdownTitle}</Text>
        <Text style={[styles.breakdownCaption, { color: colors.textMuted }]}>
          {t('Rn_StatDoneOfPlanned')}
        </Text>
      </View>

      {recorded === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Icon name="stats-chart-outline" size={26} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('Rn_StatEmptyTitle')}</Text>
          <Text style={[styles.emptyBody, { color: colors.textMuted }]}>{t('Rn_StatEmptyBody')}</Text>
        </View>
      ) : (
        <View style={styles.rows}>
          {rows.map((row) => {
            const isSelected = row.key === selectedKey;
            const allLater = row.counts.upcoming === row.counts.total;
            return (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={`${row.context}: ${tFmt(
                  'Rn_StatDoneSuffix',
                  row.counts.done,
                  row.counts.total,
                )}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelectedKey(isSelected ? null : row.key)}
                style={({ pressed }) => [
                  styles.row,
                  isSelected && { backgroundColor: colors.surfaceVariant },
                  pressed && !isSelected && { backgroundColor: colors.hairline },
                ]}>
                <Text
                  style={[styles.rowLabel, { color: isSelected ? colors.accent : colors.text }]}
                  numberOfLines={1}>
                  {row.label}
                </Text>
                <View style={[styles.rowBar, { backgroundColor: colors.surfaceVariant }]}>
                  {(
                    [
                      ['done', row.counts.done, colors.done],
                      ['missed', row.counts.missed, colors.missed],
                      ['pending', row.counts.pending, colors.pending],
                    ] as const
                  ).map(([key, value, color]) =>
                    value === 0 ? null : (
                      <View key={key} style={{ flex: value, backgroundColor: color }} />
                    ),
                  )}
                </View>
                <Text style={[styles.rowValue, { color: colors.textMuted }]} numberOfLines={1}>
                  {allLater
                    ? t('Rn_StatLater')
                    : tFmt('Rn_StatDoneOfTotal', row.counts.done, row.counts.total)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {selectedRow !== null && (
        <View
          style={[styles.selection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.selectionCopy}>
            <Text style={[styles.selectionTitle, { color: colors.text }]} numberOfLines={2}>
              {selectedRow.context}
            </Text>
            <Text style={[styles.selectionDetail, { color: colors.textMuted }]}>
              {tFmt(
                'Rn_CalendarDaySummary',
                selectedRow.counts.done,
                selectedRow.counts.missed,
                selectedRow.counts.pending,
              )}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              selectedRow.from === selectedRow.to ? t('Rn_StatViewDay') : t('Rn_StatOpenCalendar')
            }
            onPress={() => openRow(selectedRow)}
            hitSlop={8}
            style={({ pressed }) => [styles.selectionAction, { opacity: pressed ? 0.6 : 1 }]}>
            <Text style={[styles.selectionActionText, { color: colors.accent }]}>
              {selectedRow.from === selectedRow.to ? t('Rn_StatViewDay') : t('Rn_StatOpenCalendar')}
            </Text>
          </Pressable>
        </View>
      )}


      {/* Disclosures: the meal-type table (meaningless for a single day) and the
          calculation notes, including the separately labelled recorded-outcome
          rate. */}
      {mode !== 'daily' && recorded > 0 && (
        <View style={styles.disclosure}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Rn_StatByMealType')}
            accessibilityState={{ expanded: openByMeal }}
            onPress={() => setOpenByMeal((open) => !open)}
            style={styles.disclosureSummary}>
            <Text style={[styles.disclosureTitle, { color: colors.text }]}>
              {t('Rn_StatByMealType')}
            </Text>
            <Icon
              name={openByMeal ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
          {openByMeal &&
            (period?.days[0]?.slots ?? []).map((slot) => {
              const mealCounts = countSlots(period?.days ?? [], today, slot.mealCategoryKey);
              return (
                <View
                  key={slot.mealCategoryKey}
                  style={[styles.mealTypeRow, { borderTopColor: colors.hairline }]}>
                  <Text style={[styles.mealTypeLabel, { color: colors.textSecondary }]}>
                    {t(mealNameKey(slot.mealCategoryKey))}
                  </Text>
                  <Text style={[styles.mealTypeValue, { color: colors.textMuted }]}>
                    {tFmt('Rn_StatDoneSuffix', mealCounts.done, mealCounts.total)}
                  </Text>
                </View>
              );
            })}
        </View>
      )}

      <View style={styles.disclosure}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Rn_StatHowItWorks')}
          accessibilityState={{ expanded: openCalc }}
          onPress={() => setOpenCalc((open) => !open)}
          style={styles.disclosureSummary}>
          <Text style={[styles.disclosureTitle, { color: colors.text }]}>
            {t('Rn_StatHowItWorks')}
          </Text>
          <Icon
            name={openCalc ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </Pressable>
        {openCalc && (
          <View style={styles.disclosureBody}>
            <Text style={[styles.disclosureBodyText, { color: colors.textSecondary }]}>
              {t('Rn_StatHowItWorksBody')}
            </Text>
            <View style={styles.outcomeRow}>
              <View style={styles.selectionCopy}>
                <Text style={[styles.outcomeLabel, { color: colors.text }]}>
                  {t('Rn_StatAmongRecorded')}
                </Text>
                <Text style={[styles.disclosureBodyText, { color: colors.textMuted }]}>
                  {recorded === 0
                    ? t('Rn_StatNoRecorded')
                    : `${t('Dashboard_CountDone')} ${counts.done} · ${t(
                        'Dashboard_CountMissed',
                      )} ${counts.missed}`}
                </Text>
              </View>
              <Text style={[styles.outcomeValue, { color: colors.text }]}>
                {recordedRate === null ? '—' : `${recordedRate}%`}
              </Text>
            </View>
            <Text style={[styles.disclosureBodyText, { color: colors.textSecondary }]}>
              {t('Rn_StatAmongRecordedBody')}
            </Text>
            <Text style={[styles.disclosureBodyText, { color: colors.textMuted }]}>
              {t('Statistics_Disclaimer')}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/** One status count of the primary panel: glyph, number and label. */
function StatCount(props: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  value: number;
  color: string;
  colors: ThemeColors;
}): React.JSX.Element {
  return (
    <View style={styles.statCount}>
      <Icon name={props.icon} size={14} color={props.color} />
      <Text style={[styles.statCountValue, { color: props.colors.text }]}>{props.value}</Text>
      <Text style={[styles.statCountLabel, { color: props.colors.textMuted }]}>{props.label}</Text>
    </View>
  );
}


const styles = StyleSheet.create({
  content: { paddingHorizontal: metrics.pagePadding, paddingTop: 6 },
  pageTitle: { ...pageTitleStyle },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  segmentWrap: { marginTop: 12 },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    columnGap: 8,
  },
  periodLabel: { fontSize: 14, fontFamily: fonts.medium, textAlign: 'center', flexShrink: 1 },
  /** Primary panel: the one measure the page is about. */
  panel: {
    marginTop: 10,
    borderRadius: 15,
    borderWidth: 1,
    padding: 14,
  },
  panelHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelLabel: { fontSize: 12, fontFamily: fonts.medium },
  infoButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'center', columnGap: 14, marginTop: 4 },
  /** The percentage is the loudest number on the page. */
  heroPercent: { fontSize: 38, lineHeight: 44, fontFamily: fonts.bold, letterSpacing: -1.2 },
  heroText: { flex: 1, minWidth: 0 },
  heroFraction: { fontSize: 15, fontFamily: fonts.medium },
  heroCaption: { fontSize: 11, marginTop: 1 },
  /** Composition bar: three flex segments, never a fixed width. */
  composition: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 12,
  },
  statCounts: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  statCount: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 5,
  },
  statCountValue: { fontSize: 14, fontFamily: fonts.medium, fontVariant: ['tabular-nums'] },
  statCountLabel: { fontSize: 11 },
  contextLine: { fontSize: 11, lineHeight: 16, marginTop: 10 },
  breakdownHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 6,
  },
  breakdownTitle: { fontSize: 15, fontFamily: fonts.medium },
  breakdownCaption: { fontSize: 11 },
  rows: { marginTop: 2 },
  /** One breakdown row: label, stacked bar, "done / planned". */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  rowLabel: { width: 92, fontSize: 13, fontFamily: fonts.medium },
  rowBar: {
    flex: 1,
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  rowValue: {
    width: 52,
    textAlign: 'right',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    borderRadius: 15,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    rowGap: 6,
  },
  emptyTitle: { fontSize: 14, fontFamily: fonts.medium, marginTop: 4 },
  emptyBody: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  /** Selection: what the chosen row holds and where to go with it. */
  selection: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    borderRadius: 15,
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
  },
  selectionCopy: { flex: 1, minWidth: 0 },
  selectionTitle: { fontSize: 13, fontFamily: fonts.medium, lineHeight: 18 },
  selectionDetail: { fontSize: 11, marginTop: 2 },
  selectionAction: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 },
  selectionActionText: { fontSize: 12, fontFamily: fonts.medium },
  disclosure: { marginTop: 14 },
  disclosureSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  disclosureTitle: { fontSize: 13, fontFamily: fonts.medium },
  disclosureBody: { paddingBottom: 8, rowGap: 8 },
  disclosureBodyText: { fontSize: 12, lineHeight: 17 },
  /** "By meal type" rows: label left, done / total right, hairline between. */
  mealTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: 10,
  },
  mealTypeLabel: { fontSize: 12, flexShrink: 1 },
  mealTypeValue: { fontSize: 12, fontVariant: ['tabular-nums'] },
  /** The separately labelled recorded-outcome rate. */
  outcomeRow: { flexDirection: 'row', alignItems: 'center', columnGap: 12 },
  outcomeLabel: { fontSize: 13, fontFamily: fonts.medium },
  outcomeValue: { fontSize: 22, fontFamily: fonts.bold, letterSpacing: -0.4 },
});

