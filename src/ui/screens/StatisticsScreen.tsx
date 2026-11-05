// Statistics (spec 8.6) - one primary measure per period, with its evidence
// drawn directly underneath it on compact OUTLINE surfaces:
//
//   controls    ONE outlined group: the four Day / Week / Month / Year filters
//               first, then the bare previous arrow, the exact period and the
//               bare next arrow under one internal 1 dp rule. The selected
//               filter is a checkmark + a restrained accent tint + a 1 dp
//               outline inside a real 48/44 dp target - never a filled blue
//               action button.
//   main card   ONE 16 dp card: "Meal-slot completion" with its info action, the
//               36 pt percentage beside its (unboxed) fraction/caption, the three
//               real counts named inline, the accurate planned/upcoming sentence,
//               then the chart - and, once a column is chosen, that row's exact
//               counts plus its explicit day/calendar action in the SAME card.
//   chart       vertical stacked columns for EVERY period - five meals, seven
//               days, the month's clipped calendar weeks, twelve months - on ONE
//               absolute planned-slot scale. Narrow windows and large text scroll
//               sideways instead of falling back to horizontal rows
//               (see components/VerticalOutcomeChart.tsx).
//   details     ONE outlined surface holding the two optional disclosures -
//               "By meal type" and "How the numbers work" - split by one inset
//               line (the summary's info action opens the same explanation)
//
// Two rates are deliberately BOTH shown, and each is labelled:
//   * completion = Done / all planned slots (upcoming meals included),
//   * among recorded outcomes = Done / (Done + Missed) - the domain's
//     PeriodProgress.percentage, which excludes pending slots.
// Reporting only one of them is what made the old page easy to misread. The
// upcoming slots stay a disclosed SUBSET of Pending: they are never a fourth
// band and never leave the denominator.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { PeriodProgress, addDays, forRange, formatDate } from '../../domain/analytics';
import { MealEntry } from '../../domain/models';
import { getMealsInRange } from '../../data/repositories';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { dateHandoff } from '../dates';
import { createLatestRequestRunner } from '../latestRequest';
import { Icon, type IconName } from '../components/icons';
import { VerticalOutcomeChart, type OutcomeColumn } from '../components/VerticalOutcomeChart';
import { formatMonthShort, mealNameKey, t, tFmt } from '../strings';
import { fonts, themeColors, tintAlpha, type ThemeColors } from '../theme';
import { compactMonthBucketLabel } from '../statisticsMonthLayout';
import { STATISTICS_GUTTER, statisticsVerticalTokens as TPL } from '../statisticsVertical';

import { TAB_BAR_CONTENT_GAP } from '../tabBar';
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

/**
 * Real touch target: Android asks for 48 dp, iOS' convention is 44 dp. The
 * visible graphics stay compact inside it - no control here shrinks a target to
 * fit the design.
 */
const TOUCH = Platform.OS === 'android' ? 48 : 44;

/** The three state names, so a count can never be a bare colour or number. */
const STATUS_LABEL = {
  done: 'Dashboard_CountDone',
  missed: 'Dashboard_CountMissed',
  pending: 'Dashboard_CountPending',
} as const;

/**
 * Splits "All {0} planned slots in this {1}." around its number, so the total can
 * be drawn in the theme's ink without a second translated sentence. (The same
 * wording the slot-count tiles used; only the sentence moved into the card.)
 */
function plannedSentence(period: string): { before: string; after: string } {
  const [before = '', rest = ''] = t('Rn_StatAllPlanned').split('{0}');
  return { before, after: rest.replace('{1}', period) };
}


/**
 * One settled period: key, totals and rows travel together, so the heading can
 * never be paired with another period's numbers while a load is in flight.
 */
interface PeriodSnapshot {
  key: string;
  period: PeriodProgress;
  rows: BreakdownRow[];
}

/** Stable empty list while a period loads (keeps the selection effect quiet). */
const NO_ROWS: BreakdownRow[] = [];

export function StatisticsScreen(): React.JSX.Element {
  const app = useApp();
  const navigation = useNavigation();
  const colors = themeColors(app.isDark);
  /**
   * Nothing on this page decides its own layout from the WINDOW any more: the
   * controls wrap, the card wraps and the chart scrolls sideways, so a narrow
   * window or enlarged text can never turn the columns back into rows.
   */
  const today = formatDate(new Date());
  const [mode, setMode] = useState<Mode>('weekly');
  const [anchor, setAnchor] = useState(today);
  /**
   * ONE settled snapshot per request. Heading, totals and rows are all derived
   * from it, so they can never disagree with each other mid-load; the key says
   * which period (and which "today") the numbers belong to.
   */
  const [snapshot, setSnapshot] = useState<PeriodSnapshot | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Disclosures: the meal-type table and the calculation notes. */
  const [openByMeal, setOpenByMeal] = useState(false);
  const [openCalc, setOpenCalc] = useState(false);
  /** Only the newest load may publish; older answers are dropped. */
  const [runner] = useState(createLatestRequestRunner);

  const range = periodRange(mode, anchor);
  const requestKey = `${mode}|${anchor}|${today}`;

  const load = useCallback(async () => {
    const profile = app.profile;
    if (profile === null) {
      return;
    }
    const requestedMode = mode;
    const requestedAnchor = anchor;
    const key = `${requestedMode}|${requestedAnchor}|${today}`;
    try {
      await runner.run(
        async (): Promise<PeriodSnapshot> => {
          const bounds = periodRange(requestedMode, requestedAnchor);
          const entries = await getMealsInRange(profile.id, bounds.from, bounds.to);
          const byDate = new Map<string, MealEntry[]>();
          for (const entry of entries) {
            const list = byDate.get(entry.date) ?? [];
            list.push(entry);
            byDate.set(entry.date, list);
          }
          // Sparse map: days without entries are still days (five pending slots
          // each), which is exactly what the completion denominator counts.
          const progress = forRange(bounds.from, bounds.to, byDate);
          return {
            key,
            period: progress,
            rows: buildRows(requestedMode, bounds.from, bounds.to, progress.days, today),
          };
        },
        setSnapshot,
      );
    } catch (error) {
      // A read that fails leaves the previous snapshot alone; the page keeps the
      // loading state instead of showing a half-updated period.
      console.warn('[statistics] the period could not be read', error);
    }
  }, [anchor, app.profile, mode, runner, today]);

  // Reloaded whenever the tab comes to the front (and on mount, period or anchor
  // change), so the numbers follow background cycles without a gesture.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => subscribeDataChange(() => void load()), [load]);

  const ready = snapshot !== null && snapshot.key === requestKey;
  /** The snapshot that may be drawn right now - never the previous period's. */
  const view = ready && snapshot !== null ? snapshot : null;
  const rows = view === null ? NO_ROWS : view.rows;

  /** A selection only survives while its row exists in the settled period. */
  useEffect(() => {
    if (view === null) {
      return;
    }
    if (selectedKey !== null && !rows.some((row) => row.key === selectedKey)) {
      setSelectedKey(null);
    }
  }, [rows, selectedKey, view]);

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

  const counts = view === null ? emptyCounts() : countSlots(view.period.days, today);
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
  /** The exact period names of the selector, in MODES order. */
  const modeLabels = [
    t('Rn_PeriodDay'),
    t('Rn_PeriodWeek'),
    t('Rn_PeriodMonth'),
    t('Rn_PeriodYear'),
  ];
  /** The value column keeps its width while the system text grows. */
  /**
   * The chart's ONE toggle: pressing a column selects that exact row, and
   * pressing it again clears it. Selecting is all it does - opening a day or a
   * range still needs the selection footer's explicit action.
   */
  const toggleRow = (key: string): void => {
    setSelectedKey((current) => (current === key ? null : key));
  };
  /**
   * The Today shortcut: TODAY'S DAY VIEW inside Statistics - never the Home
   * diary and never a navigation call. The local date is computed AT PRESS TIME,
   * so a page left open overnight cannot jump to yesterday; the existing
   * requestKey/latest-request gate reloads the period and keeps any stale answer
   * from appearing under the new day's label. Pressing it while already on today
   * simply stays there and clears the selection.
   */
  const jumpToToday = (): void => {
    const localToday = formatDate(new Date());
    setMode('daily');
    setAnchor(localToday);
    setSelectedKey(null);
  };
  /**
   * The settled rows, as columns. The value above every column is the REAL
   * `done / total` - even for a row that is entirely in the future, which keeps
   * its real total and only adds "Later" as extra metadata. The accessible label
   * names the row, all three counts, the total and the upcoming slots, so
   * nothing here depends on colour or on the done fraction alone.
   */
  const chartRows: OutcomeColumn[] = rows.map((row) => {
    const allLater = row.counts.upcoming === row.counts.total;
    const upcoming =
      row.counts.upcoming > 0 ? ` ${tFmt('Rn_StatIncludesUpcoming', row.counts.upcoming)}` : '';
    return {
      key: row.key,
      label: row.label,
      /**
       * Month columns get the compact two-line bucket ("2–8\nNov"), built from
       * the row's own from/to and the app's short-month name - never parsed out
       * of the label text, and never a change to the ranges themselves.
       */
      displayLabel:
        mode === 'monthly'
          ? compactMonthBucketLabel(
              row.from,
              row.to,
              formatMonthShort(Number(row.from.slice(5, 7))),
              row.label,
            )
          : undefined,
      valueLabel: tFmt('Rn_StatDoneOfTotal', row.counts.done, row.counts.total),
      accessibilityLabel: `${row.context}. ${tFmt(
        'Rn_StatDoneSuffix',
        row.counts.done,
        row.counts.total,
      )}. ${tFmt(
        'Rn_CalendarDaySummary',
        row.counts.done,
        row.counts.missed,
        row.counts.pending,
      )}.${upcoming}`,
      counts: row.counts,
      allLater,
    };
  });
  /** The planned-slot sentence of the settled period ("All 35 planned ..."). */
  const planned = plannedSentence(periodWord(mode));
  /**
   * One named count of the summary: glyph + number + word on one line, exposed
   * as a single accessible metric. Three boxed tiles are deliberately gone from
   * this card - the counts read as one line of facts.
   */
  const metric = (
    status: 'done' | 'missed' | 'pending',
    icon: IconName,
    value: number,
  ): React.JSX.Element => (
    <View
      accessible
      accessibilityLabel={`${t(STATUS_LABEL[status])}: ${value}`}
      style={styles.metric}>
      <Icon
        name={icon}
        size={TPL.segmentCheck}
        color={status === 'pending' ? colors.textMuted : colors[status]}
      />
      <Text style={[styles.metricText, { color: colors.text }]}>
        {value} {t(STATUS_LABEL[status])}
      </Text>
    </View>
  );

  /** The tab navigator is untyped here, so the two destinations are named once. */
  const openRow = (row: BreakdownRow): void => {
    const nav = navigation as unknown as {
      navigate: (name: string, params?: object) => void;
    };
    if (row.from === row.to) {
      // A hand-off, not just a date: the diary must land on this day even when
      // it was already asked for it earlier in the session.
      nav.navigate('DashboardTab', dateHandoff(row.from));
      return;
    }
    nav.navigate('CalendarTab', dateHandoff(row.from));
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // Same air above the docked bar as the other pages.
        { paddingBottom: TAB_BAR_CONTENT_GAP },
      ]}>
      {/* Title and the Today shortcut share ONE flexible row; the subtitle stays
          below it, and the button is aligned with the cards' right edge. */}
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[styles.pageTitle, { color: colors.text }]}>
          {t('Nav_Statistics')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Common_Today')}
          accessibilityHint={t('Rn_StatTodayHint')}
          onPress={jumpToToday}
          style={[styles.todayTarget, { minHeight: TOUCH }]}>
          {({ pressed }) => (
            <View
              style={[
                styles.todayVisible,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
                },
              ]}>
              <Text style={[styles.todayText, { color: colors.text }]}>{t('Common_Today')}</Text>
            </View>
          )}
        </Pressable>
      </View>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t('Rn_StatSubtitle')}</Text>

      {/* Controls: ONE outlined group. Top row = the four filters (they decide
          what the period means), then the arrows around the exact period under
          one shared internal rule. */}
      <PeriodControls
        labels={modeLabels}
        index={MODES.indexOf(mode)}
        onChange={(index) => setMode(MODES[index])}
        period={periodLabel(mode, range.from, range.to)}
        onPrevious={() => shift(-1)}
        onNext={() => shift(1)}
        colors={colors}
      />

      {view === null ? (
        /* The range above already names the requested period, so the body must
           not show the previous period's totals and rows underneath it. */
        <View
          style={[
            styles.loadingPanel,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            {t('Rn_StatLoading')}
          </Text>
        </View>
      ) : (
        <>
      {/* ONE main card: the measure, its counts, the planned-slot sentence and
          the chart that is the evidence for them. The selected column's counts
          and its explicit action close the SAME card. */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.summary}>
          <View style={styles.summaryHeading}>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>
              {t('Rn_StatCompletion')}
            </Text>
            {/* The same explanation the "How the numbers work" row opens. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Rn_StatHowItWorks')}
              accessibilityState={{ expanded: openCalc }}
              onPress={() => setOpenCalc((open) => !open)}
              style={styles.infoTarget}>
              <Icon
                name="information-circle-outline"
                size={TPL.infoSize}
                color={colors.textMuted}
              />
            </Pressable>
          </View>

          {/* The percentage is the loudest number; its fraction is loose text
              beside it - no second outlined block and no divider. */}
          <View style={styles.hero}>
            <Text style={[styles.heroPercent, { color: colors.text }]}>
              {counts.done > 0 && completion === 0 ? '<1%' : `${completion}%`}
            </Text>
            <View style={styles.heroCopy}>
              <Text style={[styles.heroFraction, { color: colors.text }]}>
                {tFmt('Rn_StatDoneOfTotal', counts.done, counts.total)}
              </Text>
              <Text style={[styles.heroCaption, { color: colors.textMuted }]}>
                {t('Rn_StatPlannedCompleted')}
              </Text>
            </View>
          </View>

          {/* The three real counts, each a glyph + number + name on one line. */}
          <View style={styles.metrics}>
            {metric('done', 'checkmark', counts.done)}
            {metric('missed', 'close', counts.missed)}
            {metric('pending', 'time-outline', counts.pending)}
          </View>

          {/* Every planned slot of the period, with the upcoming subset stated -
              pending stays in the denominator and is never a fourth band. */}
          <Text style={[styles.caption, { color: colors.textMuted }]}>
            {planned.before}
            <Text style={[styles.captionStrong, { color: colors.text }]}>{counts.total}</Text>
            {planned.after}
            {counts.upcoming > 0 ? ` ${tFmt('Rn_StatIncludesUpcoming', counts.upcoming)}` : ''}
          </Text>

          <Text accessibilityRole="header" style={[styles.chartTitle, { color: colors.text }]}>
            {breakdownTitle}
          </Text>
        </View>

        {recorded === 0 ? (
          /* Nothing recorded yet: an honest empty block, never invented bars. */
          <View style={styles.empty}>
            <Icon name="stats-chart-outline" size={26} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('Rn_StatEmptyTitle')}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
              {t('Rn_StatEmptyBody')}
            </Text>
          </View>
        ) : (
          <VerticalOutcomeChart
            rows={chartRows}
            mode={mode}
            selectedKey={selectedKey}
            onToggleRow={toggleRow}
            colors={colors}
          />
        )}

        {selectedRow !== null && (
          <View style={[styles.selection, { borderTopColor: colors.border }]}>
            <View style={styles.copyColumn}>
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
                selectedRow.from === selectedRow.to
                  ? t('Rn_StatViewDay')
                  : t('Rn_StatOpenCalendar')
              }
              onPress={() => openRow(selectedRow)}
              style={({ pressed }) => [styles.selectionAction, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[styles.selectionActionText, { color: colors.accent }]}>
                {selectedRow.from === selectedRow.to
                  ? t('Rn_StatViewDay')
                  : t('Rn_StatOpenCalendar')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Details: ONE calm outlined surface holds both optional disclosures - the
          meal-type table (meaningless for a single day) and the calculation
          notes, including the separately labelled recorded-outcome rate - split
          by one inset line. */}
      <View
        style={[
          styles.detailsGroup,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}>
        {mode !== 'daily' && recorded > 0 && (
          <>
            <Disclosure
              label={t('Rn_StatByMealType')}
              icon="restaurant-outline"
              open={openByMeal}
              onToggle={() => setOpenByMeal((open) => !open)}
              colors={colors}>
              {(view.period.days[0]?.slots ?? []).map((slot, index) => {
                const mealCounts = countSlots(view.period.days, today, slot.mealCategoryKey);
                return (
                  <View
                    key={slot.mealCategoryKey}
                    style={[
                      styles.mealTypeRow,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.hairline,
                      },
                    ]}>
                    <Text style={[styles.mealTypeLabel, { color: colors.text }]}>
                      {t(mealNameKey(slot.mealCategoryKey))}
                    </Text>
                    <Text style={[styles.mealTypeValue, { color: colors.textMuted }]}>
                      {tFmt('Rn_StatDoneSuffix', mealCounts.done, mealCounts.total)}
                    </Text>
                  </View>
                );
              })}
            </Disclosure>
            {/* One inset line between the two disclosures - not a second frame. */}
            <View style={[styles.detailsDivider, { backgroundColor: colors.border }]} />
          </>
        )}


      <Disclosure
          label={t('Rn_StatHowItWorks')}
          icon="information-circle-outline"
          open={openCalc}
          onToggle={() => setOpenCalc((open) => !open)}
          colors={colors}>
          <Text style={[styles.disclosureBodyText, { color: colors.textSecondary }]}>
            {t('Rn_StatHowItWorksBody')}
          </Text>
          <View style={styles.outcomeRow}>
            <View style={styles.copyColumn}>
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
        </Disclosure>
      </View>
        </>
      )}
    </ScrollView>
  );
}

/**
 * The page's ONE control group: the four Day / Week / Month / Year filters on the
 * TOP row, then the period arrows around the exact range under a single internal
 * 1 dp line. The GROUP carries the outline - neither row draws a frame of its
 * own - and nothing here is filled blue.
 *
 * A selected filter is a SELECTION, not a primary action: a checkmark, a
 * restrained lavender wash, a 1 dp accent outline and a semibold label inside a
 * real 48/44 dp target (the visible surface stays 36 dp).
 */
function PeriodControls(props: {
  labels: string[];
  index: number;
  onChange: (index: number) => void;
  period: string;
  onPrevious: () => void;
  onNext: () => void;
  colors: ThemeColors;
}): React.JSX.Element {
  const { colors } = props;
  /** The selected-chip wash the app already uses (see TabBar and settings). */
  const selectedFill = tintAlpha(colors.accent, colors.dark ? '2E' : '1A');
  return (
    <View
      style={[styles.controls, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Modes FIRST: the filter decides what the period underneath means. */}
      <View accessibilityRole="tablist" style={styles.modes}>
        {props.labels.map((label, index) => {
          const selected = props.index === index;
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => props.onChange(index)}
              style={styles.modeTarget}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.modeSurface,
                    {
                      // Transparent borders when unselected keep the geometry
                      // stable: selecting a filter moves nothing.
                      borderColor: selected ? colors.accent : 'transparent',
                      backgroundColor: selected
                        ? selectedFill
                        : pressed
                          ? colors.surfaceVariant
                          : 'transparent',
                    },
                  ]}>
                  {selected && (
                    <Icon name="checkmark" size={TPL.segmentCheck} color={colors.accent} />
                  )}
                  <Text
                    style={[
                      styles.modeText,
                      { color: selected ? colors.accent : colors.textSecondary },
                      selected && styles.modeTextSelected,
                    ]}>
                    {label}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      {/* ONE shared internal line: the two rows read as a single control group. */}
      <View style={[styles.controlDivider, { backgroundColor: colors.border }]} />
      <View style={styles.periodRow}>
        <PeriodArrow
          direction="back"
          label={t('Dashboard_PreviousDay')}
          onPress={props.onPrevious}
          colors={colors}
        />
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={[styles.periodLabel, { color: colors.text }]}>
          {props.period}
        </Text>
        <PeriodArrow
          direction="forward"
          label={t('Dashboard_NextDay')}
          onPress={props.onNext}
          colors={colors}
        />
      </View>
    </View>
  );
}


/** One BARE 48/44 dp period arrow - the group owns the only frame. */
function PeriodArrow(props: {
  direction: 'back' | 'forward';
  label: string;
  onPress: () => void;
  colors: ThemeColors;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.periodArrow,
        pressed && { backgroundColor: props.colors.surfaceVariant },
      ]}>
      <Icon
        name={props.direction === 'back' ? 'chevron-back' : 'chevron-forward'}
        size={21}
        color={props.colors.textSecondary}
      />
    </Pressable>
  );
}


/**
 * One disclosure INSIDE the shared details surface: leading outline glyph, label,
 * caret, and its content opened in place (the caller keeps owning the open
 * state). The row itself draws no frame and no margin - the group owns the
 * outline, and `detailsDivider` puts the single line between the two rows.
 */
function Disclosure(props: {
  label: string;
  icon: IconName;
  open: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  children: React.ReactNode;
}): React.JSX.Element {
  const { colors } = props;
  return (
    <View style={styles.disclosure}>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.label}
        accessibilityState={{ expanded: props.open }}
        onPress={props.onToggle}
        style={({ pressed }) => [
          styles.disclosureButton,
          pressed && { backgroundColor: colors.surfaceVariant },
        ]}>
        <Icon name={props.icon} size={18} color={colors.textMuted} />
        <Text style={[styles.disclosureLabel, { color: colors.text }]}>{props.label}</Text>
        <Icon
          name={props.open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </Pressable>
      {props.open && (
        <View style={[styles.disclosureContent, { borderTopColor: colors.border }]}>
          {props.children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * Page frame: ONE STATISTICS_GUTTER for the left edge, the right edge and the
   * top (after the navigator's safe area) - the same 8 dp the approved Home and
   * Templates pages use. The bottom padding is computed at render time (tab bar).
   */
  content: { paddingHorizontal: STATISTICS_GUTTER, paddingTop: STATISTICS_GUTTER },
  /** Title + Today on one row: the title may wrap, the button keeps its size. */
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: TPL.gutter,
  },
  pageTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: TPL.titleSize,
    lineHeight: TPL.titleLine,
    fontFamily: fonts.bold,
    letterSpacing: -0.4,
  },
  /** A real 48/44 dp target around the small neutral outlined control. */
  todayTarget: {
    minWidth: TPL.todayMinWidth,
    justifyContent: 'center',
    paddingVertical: TPL.todayPaddingY,
  },
  todayVisible: {
    minHeight: TPL.visibleControl,
    borderWidth: TPL.border,
    borderRadius: TPL.controlRadius,
    paddingHorizontal: TPL.todayPaddingX,
    paddingVertical: TPL.todayPaddingY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayText: {
    fontFamily: fonts.regular,
    fontSize: TPL.todaySize,
    lineHeight: TPL.todayLine,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: TPL.bodySize,
    lineHeight: TPL.bodyLine,
    marginTop: 2,
    fontFamily: fonts.regular,
  },

  /** The ONE control group: outline, 8 dp corners, both rows inside it. */
  controls: {
    marginTop: STATISTICS_GUTTER,
    borderWidth: TPL.border,
    borderRadius: TPL.controlRadius,
    overflow: 'hidden',
  },
  /** Top row: the four filters, wrapping at large text instead of squeezing. */
  modes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: TPL.modeGap,
    rowGap: TPL.modeGap,
    paddingHorizontal: TPL.modeInset,
    paddingTop: TPL.modeInset,
  },
  /** A real 48/44 dp target; the visible surface stays 36 dp inside it. */
  modeTarget: {
    flexGrow: 1,
    flexBasis: 64,
    minWidth: 0,
    minHeight: TOUCH,
    justifyContent: 'center',
    paddingVertical: TPL.modeInset,
  },
  modeSurface: {
    minHeight: TPL.visibleControl,
    borderWidth: TPL.border,
    borderRadius: TPL.controlRadius,
    paddingHorizontal: TPL.modeInset,
    paddingVertical: TPL.modeInset,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TPL.iconGap,
  },
  modeText: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: TPL.modeLabelSize,
    lineHeight: TPL.modeLine,
    textAlign: 'center',
  },
  /** A selected filter is semibold with a checkmark; never a filled action. */
  modeTextSelected: { fontFamily: fonts.bold },
  /** ONE shared 1 dp line between the filters and the period row. */
  controlDivider: { height: TPL.border, marginTop: TPL.modeInset },
  /** Bottom row: bare arrow, the exact period, bare arrow. */
  periodRow: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: TPL.modeGap,
    paddingHorizontal: TPL.modeInset,
  },
  /** The only frame an arrow wears is its pressed feedback. */
  periodArrow: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TPL.controlRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.medium,
    fontSize: TPL.periodSize,
    lineHeight: TPL.periodLine,
    textAlign: 'center',
  },

  /** Placeholder while a period settles; the main card's own frame. */
  loadingPanel: {
    marginTop: STATISTICS_GUTTER,
    minHeight: 180,
    borderRadius: TPL.cardRadius,
    borderWidth: TPL.border,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 10,
  },
  loadingText: { fontSize: TPL.bodySize, fontFamily: fonts.regular },

  /**
   * ONE main card: the summary, the chart and the selected row's details. The
   * padding lives on those three children, so the chart can use its tighter
   * 8 dp inset and still sit inside the same 16 dp frame.
   */
  card: {
    marginTop: STATISTICS_GUTTER,
    borderWidth: TPL.border,
    borderRadius: TPL.cardRadius,
    paddingBottom: TPL.cardPadding,
    overflow: 'hidden',
  },
  summary: { paddingHorizontal: TPL.cardPadding },
  summaryHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: TPL.gutter,
  },
  summaryTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.medium,
    fontSize: TPL.headingSize,
    lineHeight: TPL.headingLine,
  },
  /** The info action keeps a real 48/44 dp target around its 18 pt glyph. */
  infoTarget: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  /** Percentage and its fraction: loose text that wraps instead of shrinking. */
  hero: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: TPL.gutter },
  heroPercent: {
    fontFamily: fonts.bold,
    fontSize: TPL.percentSize,
    lineHeight: TPL.percentLine,
    fontVariant: ['tabular-nums'],
  },
  heroCopy: { flexGrow: 1, flexShrink: 1, minWidth: 100 },
  heroFraction: {
    fontFamily: fonts.medium,
    fontSize: TPL.fractionSize,
    lineHeight: TPL.fractionLine,
    fontVariant: ['tabular-nums'],
  },
  heroCaption: { fontFamily: fonts.regular, fontSize: TPL.bodySize, lineHeight: TPL.bodyLine },
  /** Three named counts on one line: glyph + number + word, no boxes. */
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: TPL.countGap,
    rowGap: TPL.modeGap,
    marginVertical: TPL.gutter,
  },
  metric: { flexDirection: 'row', alignItems: 'center', gap: TPL.iconGap },
  metricText: {
    fontFamily: fonts.medium,
    fontSize: TPL.metricSize,
    lineHeight: TPL.metricLine,
  },
  /** The planned/upcoming sentence: one quiet line under the counts. */
  caption: { fontFamily: fonts.regular, fontSize: TPL.bodySize, lineHeight: TPL.bodyLine },
  captionStrong: { fontFamily: fonts.bold },
  chartTitle: {
    fontFamily: fonts.medium,
    fontSize: TPL.sectionSize,
    lineHeight: TPL.sectionLine,
    marginTop: TPL.gutter,
  },

  /** Nothing recorded: an honest block inside the card, never invented bars. */
  empty: { alignItems: 'center', paddingHorizontal: TPL.cardPadding, paddingTop: 20, rowGap: 6 },
  emptyTitle: { fontFamily: fonts.medium, fontSize: TPL.metricSize, marginTop: 4 },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: TPL.bodySize,
    lineHeight: TPL.bodyLine,
    textAlign: 'center',
  },

  /** The selected row's counts + its explicit action, inside the same card. */
  selection: {
    borderTopWidth: TPL.border,
    marginTop: TPL.gutter,
    paddingHorizontal: TPL.selectionPadding,
    paddingTop: TPL.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
  },
  copyColumn: { flex: 1, minWidth: 0 },
  selectionTitle: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  selectionDetail: { fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  /** A real 44 dp target for the one explicit action. */
  selectionAction: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: 4 },
  selectionActionText: { fontFamily: fonts.medium, fontSize: 12 },

  /** Details: ONE outlined surface for both optional disclosures. */
  detailsGroup: {
    marginTop: STATISTICS_GUTTER,
    borderWidth: TPL.border,
    borderRadius: TPL.cardRadius,
    overflow: 'hidden',
  },
  /** The single inset line between the two disclosures - never a second frame. */
  detailsDivider: { height: TPL.border, marginHorizontal: TPL.cardPadding },
  /** A disclosure row inside that surface: no frame, no margin of its own. */
  disclosure: { overflow: 'hidden' },
  disclosureButton: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    paddingHorizontal: TPL.cardPadding,
    paddingVertical: 10,
  },
  disclosureLabel: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: TPL.sectionSize },
  disclosureContent: { borderTopWidth: TPL.border, padding: TPL.cardPadding, rowGap: 8 },
  disclosureBodyText: {
    fontFamily: fonts.regular,
    fontSize: TPL.bodySize,
    lineHeight: TPL.bodyLine,
  },
  /** "By meal type" rows: label left, done / total right, hairline between. */
  mealTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOUCH,
    columnGap: 10,
  },
  mealTypeLabel: { fontFamily: fonts.medium, fontSize: TPL.bodySize, flexShrink: 1 },
  mealTypeValue: {
    fontFamily: fonts.medium,
    fontSize: TPL.bodySize,
    fontVariant: ['tabular-nums'],
  },
  /** The separately labelled recorded-outcome rate. */
  outcomeRow: { flexDirection: 'row', alignItems: 'center', columnGap: 12 },
  outcomeLabel: { fontFamily: fonts.medium, fontSize: 13 },
  outcomeValue: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.4 },
});
