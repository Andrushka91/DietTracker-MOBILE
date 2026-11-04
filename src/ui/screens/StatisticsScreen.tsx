// Statistics (spec 8.6) - one primary measure per period, then progressive
// detail, drawn as OUTLINE cards on the page wash:
//
//   period      a compact outlined Day / Week / Month / Year selector (the
//               active period is an accent label plus a short underline, not a
//               heavy tray), then two white 44 dp arrows around the exact range
//   primary     one outlined card: "Meal-slot completion" with its info action,
//               the big percentage beside its fraction/caption, ONE 8 dp
//               composition bar and the three real slot counts (glyph + bold
//               number over the label, each in its own third of the row) -
//               see components/SlotCounts.tsx for that block's layout
//   breakdown   ONE outlined card of grouped compact rows (meals, days, partial
//               weeks or months) with inset separators and a selection cue
//   selection   counts of the chosen row and an explicit day/calendar action
//   disclosures two quiet outlined rows: "By meal type" and "How the numbers
//               work" (the summary's info action opens the same explanation)
//
// Two rates are deliberately BOTH shown, and each is labelled:
//   * completion = Done / all planned slots (upcoming meals included),
//   * among recorded outcomes = Done / (Done + Missed) - the domain's
//     PeriodProgress.percentage, which excludes pending slots.
// Reporting only one of them is what made the old page easy to misread.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
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
import { SlotCounts } from '../components/SlotCounts';
import { mealNameKey, t, tFmt } from '../strings';
import {
  fonts,
  metrics,
  pageTitleStyle,
  themeColors,
  type ThemeColors,
} from '../theme';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';
import {
  buildRows,
  countSlots,
  emptyCounts,
  periodLabel,
  periodRange,
  periodWord,
  type BreakdownRow,
  type Counts,
  type Mode,
} from '../statisticsBreakdown';

/** Order of the segmented control (index == selection). */
const MODES: Mode[] = ['daily', 'weekly', 'monthly', 'yearly'];

/**
 * Sizes of this page in dp/sp - the palette comes from the theme, so light and
 * dark mode stay in step. One card rhythm: 16 dp corners, 14 dp padding, 1 dp
 * outline, 44 dp controls and 44 dp minimum rows.
 */
const STAT = {
  cardRadius: 16,
  cardPadding: 14,
  borderWidth: 1,
  controlHeight: 44,
  controlRadius: 10,
  segmentRadius: 12,
  barHeight: 8,
  rowMinHeight: 44,
  rowPadding: 12,
  rowGap: 8,
  rowLabelWidth: 64,
  rowValueWidth: 58,
  rowBarHeight: 7,
  dividerWidth: 1,
} as const;

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
  const { width, fontScale } = useWindowDimensions();
  /** Large text or a narrow window: dense rows stack instead of squeezing. */
  const stacked = fontScale > 1.3 || width < 350;
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
  const valueWidth = STAT.rowValueWidth * Math.max(1, fontScale);

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
      <Text accessibilityRole="header" style={[styles.pageTitle, { color: colors.text }]}>
        {t('Nav_Statistics')}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t('Rn_StatSubtitle')}</Text>

      {/* Period: the four modes, then the exact range between two 44 dp arrows. */}
      <PeriodSelector
        labels={modeLabels}
        index={MODES.indexOf(mode)}
        onChange={(index) => setMode(MODES[index])}
        colors={colors}
      />

      <View style={styles.periodRow}>
        <PeriodArrow
          direction="back"
          label={t('Dashboard_PreviousDay')}
          onPress={() => shift(-1)}
          colors={colors}
        />
        <Text style={[styles.periodLabel, { color: colors.text }]}>
          {periodLabel(mode, range.from, range.to)}
        </Text>
        <PeriodArrow
          direction="forward"
          label={t('Dashboard_NextDay')}
          onPress={() => shift(1)}
          colors={colors}
        />
      </View>

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
      {/* Primary card: one measure, its fraction, the composition and the counts. */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
            hitSlop={6}
            style={styles.infoButton}>
            <Icon name="information-circle-outline" size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={[styles.hero, stacked && styles.heroStacked]}>
          <Text style={[styles.heroPercent, { color: colors.text }]}>
            {counts.done > 0 && completion === 0 ? '<1%' : `${completion}%`}
          </Text>
          {!stacked && <View style={[styles.heroDivider, { backgroundColor: colors.border }]} />}
          <View style={[styles.heroCopy, stacked && styles.heroCopyStacked]}>
            <Text style={[styles.heroFraction, { color: colors.text }]}>
              {tFmt('Rn_StatDoneOfTotal', counts.done, counts.total)}
            </Text>
            <Text style={[styles.heroCaption, { color: colors.textMuted }]}>
              {t('Rn_StatPlannedCompleted')}
            </Text>
          </View>
        </View>

        <CompositionBar counts={counts} colors={colors} style={styles.composition} />

        <SlotCounts counts={counts} period={periodWord(mode)} colors={colors} />
      </View>

      {/* Breakdown: one card of grouped rows; the selection is the answer. */}
      <View style={[styles.breakdownHeading, stacked && styles.breakdownHeadingStacked]}>
        <Text accessibilityRole="header" style={[styles.breakdownTitle, { color: colors.text }]}>
          {breakdownTitle}
        </Text>
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
        <View
          style={[styles.breakdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {rows.map((row, index) => {
            const isSelected = row.key === selectedKey;
            const allLater = row.counts.upcoming === row.counts.total;
            const valueLabel = allLater
              ? t('Rn_StatLater')
              : tFmt('Rn_StatDoneOfTotal', row.counts.done, row.counts.total);
            return (
              <React.Fragment key={row.key}>
                {/* Inset 1 dp line: the rows read as one group, not nine cards. */}
                {index > 0 && (
                  <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />
                )}
                <Pressable
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
                    stacked && styles.rowStacked,
                    pressed && { backgroundColor: colors.surfaceVariant },
                  ]}>
                  {isSelected && (
                    <View
                      accessible={false}
                      style={[styles.selectionRail, { backgroundColor: colors.accent }]}
                    />
                  )}
                  {stacked ? (
                    <>
                      <View style={styles.stackedRowHead}>
                        <Text
                          style={[
                            styles.rowLabelStacked,
                            { color: isSelected ? colors.accent : colors.text },
                          ]}
                          numberOfLines={2}>
                          {row.label}
                        </Text>
                        <Text
                          style={[styles.rowValue, { color: colors.textMuted, width: valueWidth }]}
                          numberOfLines={1}>
                          {valueLabel}
                        </Text>
                      </View>
                      <CompositionBar
                        counts={row.counts}
                        colors={colors}
                        row
                        allLater={allLater}
                        style={styles.rowBarStacked}
                      />
                    </>
                  ) : (
                    <>
                      {/* Month rows print a full compact range ("26 Oct – 1 Nov"),
                          which wraps rather than being cut off. */}
                      <Text
                        style={[
                          styles.rowLabel,
                          { color: isSelected ? colors.accent : colors.text },
                        ]}
                        numberOfLines={2}>
                        {row.label}
                      </Text>
                      <CompositionBar counts={row.counts} colors={colors} row allLater={allLater} />
                      <Text
                        style={[styles.rowValue, { color: colors.textMuted, width: valueWidth }]}
                        numberOfLines={1}>
                        {valueLabel}
                      </Text>
                    </>
                  )}
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
      )}

      {selectedRow !== null && (
        <View
          style={[styles.selection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
        </>
      )}
    </ScrollView>
  );
}

/**
 * One row of the composition bar: sized by the ACTUAL done / missed / pending
 * counts, so the bar and the numbers it sits above can never disagree. The
 * row variant is 7 dp tall; an all-upcoming row is drawn quieter, never
 * recoloured or re-labelled.
 */
function CompositionBar(props: {
  counts: Counts;
  colors: ThemeColors;
  /** The breakdown rows use the thinner bar of the mockup. */
  row?: boolean;
  /** A row made only of future slots reads quieter - its counts are unchanged. */
  allLater?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { counts, colors } = props;
  const segments = [
    ['done', counts.done, colors.done],
    ['missed', counts.missed, colors.missed],
    // Pending is the quiet neutral segment: the exact counts live in the three
    // numbers of the summary, so it must not shout.
    ['pending', counts.pending, colors.barPending],
  ] as const;
  return (
    <View
      accessible={false}
      style={[
        props.row === true ? styles.rowBar : styles.composition,
        { backgroundColor: colors.surfaceVariant },
        props.allLater === true && styles.barQuiet,
        props.style,
      ]}>
      {segments.map(([key, value, color]) =>
        value <= 0 ? null : <View key={key} style={{ flex: value, backgroundColor: color }} />,
      )}
    </View>
  );
}

/**
 * The period selector of THIS page: one white outline, four equal parts, the
 * active period in accent ink above a short underline. The shared `Segmented`
 * control keeps its own tray and raised chip (settings still draws that one).
 */
function PeriodSelector(props: {
  labels: string[];
  index: number;
  onChange: (index: number) => void;
  colors: ThemeColors;
}): React.JSX.Element {
  const { colors } = props;
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.segments, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {props.labels.map((label, index) => {
        const selected = index === props.index;
        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => props.onChange(index)}
            hitSlop={2}
            style={({ pressed }) => [
              styles.segment,
              index > 0 && { borderLeftWidth: STAT.borderWidth, borderLeftColor: colors.border },
              pressed && { backgroundColor: colors.surfaceVariant },
            ]}>
            <Text
              style={[
                styles.segmentText,
                { color: selected ? colors.accent : colors.textSecondary },
                selected && styles.segmentTextSelected,
              ]}>
              {label}
            </Text>
            {selected && (
              <View
                accessible={false}
                style={[styles.segmentUnderline, { backgroundColor: colors.accent }]}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** One white outlined 44 dp arrow - the page's only two period controls. */
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
        {
          backgroundColor: pressed ? props.colors.surfaceVariant : props.colors.surface,
          borderColor: props.colors.border,
        },
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
 * A quiet outlined disclosure row: leading outline glyph, label, caret, and its
 * content opened in place (the caller keeps owning the open state).
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
    <View
      style={[styles.disclosure, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
  content: { paddingHorizontal: metrics.pagePadding, paddingTop: 6 },
  pageTitle: { ...pageTitleStyle },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2, fontFamily: fonts.regular },

  /** Period selector: a white outline, four equal parts, one accent underline. */
  segments: {
    marginTop: 14,
    flexDirection: 'row',
    borderWidth: STAT.borderWidth,
    borderRadius: STAT.segmentRadius,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: STAT.controlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  segmentText: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
  segmentTextSelected: { fontFamily: fonts.medium },
  /** The active period is marked by a short line, not by a heavy grey tray. */
  segmentUnderline: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    width: 24,
    height: 2,
    borderRadius: 1,
  },

  /** The exact range, between the page's two arrows. */
  periodRow: {
    marginTop: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
  },
  periodArrow: {
    width: STAT.controlHeight,
    height: STAT.controlHeight,
    borderWidth: STAT.borderWidth,
    borderRadius: STAT.controlRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },

  /** Placeholder while a period settles; the summary's own card frame. */
  loadingPanel: {
    minHeight: 180,
    borderRadius: STAT.cardRadius,
    borderWidth: STAT.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 10,
  },
  loadingText: { fontSize: 12, fontFamily: fonts.regular },

  /** The summary card: the one measure the page is about. */
  card: {
    borderWidth: STAT.borderWidth,
    borderRadius: STAT.cardRadius,
    padding: STAT.cardPadding,
  },
  summaryHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  summaryTitle: { flex: 1, fontSize: 14, fontFamily: fonts.medium },
  infoButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', columnGap: 12, marginTop: 4 },
  heroStacked: { flexDirection: 'column', alignItems: 'flex-start', rowGap: 6 },
  /** The percentage is the loudest number on the page. */
  heroPercent: {
    fontSize: 38,
    lineHeight: 44,
    fontFamily: fonts.bold,
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  heroDivider: { width: 1, height: 36 },
  heroCopy: { flex: 1, minWidth: 0 },
  heroCopyStacked: { flex: 0, width: '100%' },
  heroFraction: { fontSize: 16, fontFamily: fonts.medium, fontVariant: ['tabular-nums'] },
  heroCaption: { fontSize: 12, marginTop: 1, fontFamily: fonts.regular },
  /** Composition: three flex segments, never a fixed width. */
  composition: {
    flexDirection: 'row',
    height: STAT.barHeight,
    borderRadius: STAT.barHeight / 2,
    overflow: 'hidden',
    marginTop: 12,
  },
  /** A row made only of future slots: de-emphasised, never recoloured. */
  barQuiet: { opacity: 0.55 },

  breakdownHeading: {
    marginTop: 18,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 10,
  },
  breakdownHeadingStacked: { flexDirection: 'column', alignItems: 'flex-start', rowGap: 4 },
  breakdownTitle: { flexShrink: 1, fontSize: 16, fontFamily: fonts.medium },
  breakdownCaption: { fontSize: 12, fontFamily: fonts.regular },
  /** ONE card holds every row; its separators are inset lines, not gaps. */
  breakdown: {
    borderWidth: STAT.borderWidth,
    borderRadius: STAT.cardRadius,
    overflow: 'hidden',
  },
  row: {
    minHeight: STAT.rowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: STAT.rowGap,
    paddingHorizontal: STAT.rowPadding,
    paddingVertical: 10,
  },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  /** The selection cue: a 3 dp accent rail on the row's leading edge. */
  selectionRail: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2 },
  rowLabel: {
    width: STAT.rowLabelWidth,
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fonts.regular,
  },
  rowLabelStacked: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fonts.regular,
  },
  rowBar: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    height: STAT.rowBarHeight,
    borderRadius: STAT.rowBarHeight / 2,
    overflow: 'hidden',
  },
  rowBarStacked: { flex: 0, width: '100%' },
  rowValue: {
    flexShrink: 0,
    textAlign: 'right',
    fontSize: 12,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  stackedRowHead: { flexDirection: 'row', alignItems: 'center', columnGap: STAT.rowGap },
  rowDivider: { height: STAT.dividerWidth, marginHorizontal: STAT.rowPadding },

  empty: {
    borderRadius: STAT.cardRadius,
    borderWidth: STAT.borderWidth,
    padding: 20,
    alignItems: 'center',
    rowGap: 6,
  },
  emptyTitle: { fontSize: 14, fontFamily: fonts.medium, marginTop: 4 },
  emptyBody: { fontSize: 12, textAlign: 'center', lineHeight: 17, fontFamily: fonts.regular },

  /** Selection: what the chosen row holds and where to go with it. */
  selection: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    borderRadius: STAT.cardRadius,
    borderWidth: STAT.borderWidth,
    padding: STAT.cardPadding,
    marginTop: 12,
  },
  copyColumn: { flex: 1, minWidth: 0 },
  selectionTitle: { fontSize: 13, fontFamily: fonts.medium, lineHeight: 18 },
  selectionDetail: { fontSize: 11, marginTop: 2, fontFamily: fonts.regular },
  selectionAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  selectionActionText: { fontSize: 12, fontFamily: fonts.medium },

  /** Disclosures: quiet outlined rows that open in place. */
  disclosure: {
    marginTop: 12,
    borderWidth: STAT.borderWidth,
    borderRadius: STAT.cardRadius,
    overflow: 'hidden',
  },
  disclosureButton: {
    minHeight: STAT.controlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    paddingHorizontal: STAT.cardPadding,
    paddingVertical: 10,
  },
  disclosureLabel: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.medium },
  disclosureContent: {
    borderTopWidth: STAT.borderWidth,
    padding: STAT.cardPadding,
    rowGap: 8,
  },
  disclosureBodyText: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  /** "By meal type" rows: label left, done / total right, hairline between. */
  mealTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: STAT.controlHeight,
    columnGap: 10,
  },
  mealTypeLabel: { fontSize: 12, flexShrink: 1, fontFamily: fonts.medium },
  mealTypeValue: { fontSize: 12, fontVariant: ['tabular-nums'], fontFamily: fonts.medium },
  /** The separately labelled recorded-outcome rate. */
  outcomeRow: { flexDirection: 'row', alignItems: 'center', columnGap: 12 },
  outcomeLabel: { fontSize: 13, fontFamily: fonts.medium },
  outcomeValue: { fontSize: 22, fontFamily: fonts.bold, letterSpacing: -0.4 },
});
