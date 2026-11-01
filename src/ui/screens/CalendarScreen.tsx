// Calendar (spec 8.5) - Microsoft-calendar-style month view: a "October 2026"
// month header with ‹ / › arrows, Today / Open day buttons, selected-day
// summary, 7-column weekday header (Monday first) and the grid of day cells.
//
// Day cell colors: gray = untouched/pending, green = every meal eaten,
// red = at least one missed; today paints its whole cell with the accent
// colour (a blue square, no circle around the number); tapping a cell selects
// it, long press / "Open day" opens
// the Dashboard for that date. A decided day shows its confirmed share of the five
// slots ("1/5") and, when it holds pictures, the photo marker - an untouched day
// shows its number and nothing else, because a pending meal never produces a
// figure.
//
// The five meals of the selected day are listed under the grid as compact rows
// (state bar, icon, title, time, status pill). On a phone a day cell is about
// 44 pt wide, which cannot hold the miniature meal cards of the Windows panel
// legibly, so that detail lives in the list under the grid instead.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayProgress, addDays, formatDate, forDay, parseDate } from '../../domain/analytics';
import { MealStatus } from '../../domain/enums';
import { MealCategory } from '../../domain/models';
import { getMealsInRange, getPhotoCounts } from '../../data/repositories';
import { ensureCategories } from '../../services/mealTracking';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { BarButton, IconButton } from '../components/buttons';
import {
  fonts,
  argb,
  metrics,
  statusColors,
  themeColors,
  cardShadow,
} from '../theme';
import { formatLongDate, formatMonthLabel, formatTime, mealNameKey, t, tFmt } from '../strings';

export function CalendarScreen(props: { onOpenDay: (date: string) => void }): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const insets = useSafeAreaInsets();
  const today = formatDate(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [progressByDate, setProgressByDate] = useState<Record<string, DayProgress>>({});
  const [categories, setCategories] = useState<MealCategory[]>([]);

  const reload = useCallback(async () => {
    if (app.profile === null) {
      return;
    }
    setCategories(await ensureCategories());
    const from = `${month}-01`;
    const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
    const to = formatDate(lastDay);
    const entries = await getMealsInRange(app.profile.id, from, to);
    const counts = await getPhotoCounts();
    const byDate = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = byDate.get(entry.date) ?? [];
      list.push(entry);
      byDate.set(entry.date, list);
    }
    const progress: Record<string, DayProgress> = {};
    let cursor = from;
    while (cursor <= to) {
      progress[cursor] = forDay(cursor, byDate.get(cursor) ?? [], counts);
      // Day-by-day stepping must go through the calendar date, not "now + 24 h":
      // on a DST change day a 24-hour millisecond step lands on the same date
      // again and the loop would never terminate (see addDays).
      const next = addDays(cursor, 1);
      if (next <= cursor) {
        break;
      }
      cursor = next;
    }
    setProgressByDate(progress);
  }, [app.profile, month]);

  // The month is reloaded whenever the tab comes to the front (and on mount),
  // so a background cycle's imports are on screen without a pull gesture.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // A background cycle that imported another device's records redraws the
  // month too, so a tab left open never shows a stale colour.
  useEffect(() => subscribeDataChange(() => void reload()), [reload]);

  const shiftMonth = (delta: number): void => {
    const year = Number(month.slice(0, 4));
    const next = new Date(year, Number(month.slice(5, 7)) - 1 + delta, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  /**
   * "Today" moves the selection *and* the grid back to the current month -
   * without the second half the selected date was today while the grid stayed
   * on the month the user had navigated to.
   */
  const goToToday = (): void => {
    setMonth(today.slice(0, 7));
    setSelected(today);
  };

  // The Windows grid starts on the Monday before the 1st and always shows whole
  // weeks, so the neighbouring months' days fill the first and last row. They
  // keep their real day numbers, dimmed to 35 % (CalendarDayViewModel.CellOpacity).
  const first = parseDate(`${month}-01`);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Monday first
  const gridStart = addDays(`${month}-01`, -leading);
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
  const cells: Array<{ date: string; inMonth: boolean; progress?: DayProgress }> = [];
  for (let index = 0; index < totalCells; index += 1) {
    const date = addDays(gridStart, index);
    const inMonth = date.slice(0, 7) === month;
    cells.push({ date, inMonth, progress: inMonth ? progressByDate[date] : undefined });
  }
  // Chunked into whole weeks: seven equal flex cells per row can never drift
  // off the row the way seven percentage widths can when they round up (the
  // last column used to slip to its own line and looked empty).
  const rows: Array<typeof cells> = [];
  for (let index = 0; index < cells.length; index += 7) {
    rows.push(cells.slice(index, index + 7));
  }
  const selectedProgress = progressByDate[selected];
  // Weekday captions come from the resource file ("Mo Tu We ..."), Monday first.
  const weekdays = t('Calendar_Weekdays').split(/\s+/).filter((name) => name !== '');


  /** Palette colours are #RRGGBBAA - swap the alpha channel for a cell wash. */
  const tint = (color: string, alpha: string): string => color.slice(0, 7) + alpha;

  /**
   * iOS calendar day state: a soft wash of the state colour behind the cell
   * (green = every meal eaten, red = at least one missed, quiet gray =
   * nothing decided yet) - no stroke, the tint itself carries the state.
   */
  const dayState = (progress?: DayProgress): { fill: string } => {
    if (progress !== undefined && progress.isFullyCompleted) {
      return { fill: tint(colors.done, '24') };
    }
    if (progress !== undefined && progress.missed > 0) {
      return { fill: tint(colors.missed, '24') };
    }
    return { fill: tint(colors.cellPending, '55') };
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // The floating tab bar sits on top of the page: the last row of the
        // selected day must stay readable above it.
        { paddingBottom: metrics.floatingTabBarClearance + Math.max(insets.bottom, 10) },
      ]}>
      <View style={[styles.panel, cardShadow, { backgroundColor: colors.surface }]}>
        {/* Month header: the arrows hug both edges and the month sits centered
            between them, iOS-calendar style. */}
        <View style={styles.monthRow}>
          <IconButton
            label={t('Calendar_PreviousMonth')}
            glyph={'\u2039'}
            onPress={() => shiftMonth(-1)}
            colors={colors}
          />
          <Text style={[styles.monthLabel, { color: colors.text }]} numberOfLines={1}>
            {formatMonthLabel(month)}
          </Text>
          <IconButton
            label={t('Calendar_NextMonth')}
            glyph={'\u203A'}
            onPress={() => shiftMonth(1)}
            colors={colors}
          />
        </View>
        <View style={styles.buttonRow}>
          <BarButton label={t('Calendar_Today')} accent onPress={goToToday} colors={colors} />
          <BarButton
            label={t('Calendar_OpenDay')}
            onPress={() => props.onOpenDay(selected)}
            colors={colors}
          />
        </View>
        <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={2}>
          {formatLongDate(selected)}
          {selectedProgress !== undefined
            ? ` - ${tFmt('Calendar_DaySummary', selectedProgress.completed, selectedProgress.missed, selectedProgress.pending)}`
            : ''}
        </Text>

        <View style={styles.weekHeader}>
          {weekdays.map((weekday) => (
            <Text key={weekday} style={[styles.weekday, { color: colors.textMuted }]}>
              {weekday}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {rows.map((row) => (
            <View key={row[0]?.date ?? ''} style={styles.gridRow}>
              {row.map((cell) => {
                const isToday = cell.date === today;
                const isSelected = cell.date === selected;
                const progress = cell.progress;
                const hasPhoto = progress !== undefined && progress.slots.some((s) => s.photoCount > 0);
                const hasFigure = progress !== undefined && progress.decided > 0;
                const state = dayState(progress);
                // Today is a solid accent SQUARE (the whole day cell, not a
                // circle around the number); a selected day keeps its
                // translucent accent wash, anything else its state tint.
                const background = isToday
                  ? colors.accent
                  : isSelected
                    ? tint(colors.accent, '2E')
                    : state.fill;
                /** White ink on the solid accent fill of today. */
                const onToday = isToday ? colors.accentFillText : null;
                return (
                  <View key={cell.date} style={styles.cellHost}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={formatLongDate(cell.date)}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => {
                        // A day of the neighbouring month also moves the grid there.
                        if (!cell.inMonth) {
                          setMonth(cell.date.slice(0, 7));
                        }
                        setSelected(cell.date);
                      }}
                      onLongPress={() => props.onOpenDay(cell.date)}
                      style={[
                        styles.cell,
                        {
                          backgroundColor: background,
                          opacity: cell.inMonth ? 1 : 0.35,
                        },
                      ]}>
                      <View style={styles.cellTopRow}>
                        {/* The day number sits plainly in the cell - no badge,
                            no circle; today is marked by the accent square. */}
                        <View style={styles.dayBadge}>
                          <Text
                            style={[
                              styles.dayNumber,
                              { color: onToday ?? colors.text },
                            ]}>
                            {cell.date.slice(8)}
                          </Text>
                        </View>
                        {/* Photo marker of the day, right above the count. */}
                        <Text
                          style={[styles.cellFigure, { color: onToday ?? colors.textMuted }]}
                          numberOfLines={1}>
                          {hasPhoto ? '\u{1F4F7}' : ''}
                        </Text>
                      </View>
                      {/*
                       * Confirmed share of the five slots ("1/5"), empty while
                       * nothing was decided - a pending meal never produces a
                       * figure. The percentage of the day lives in the summary
                       * line above the grid, where it fits next to the counts.
                       */}
                      <Text
                        style={[styles.cellCount, { color: onToday ?? colors.textMuted }]}
                        numberOfLines={1}>
                        {hasFigure && progress !== undefined
                          ? `${progress.completed}/${progress.totalSlots}`
                          : ''}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {/* The five cards of the selected day (spec 8.5): the Windows calendar
            lists the meals of the day, so tapping a day shows what it holds and
            a tap on a row opens that day on the dashboard. */}
        <View style={styles.dayList}>
          {(progressByDate[selected]?.slots ?? []).map((slot) => {
            const category = categories.find((c) => c.fixedCategoryKey === slot.mealCategoryKey);
            const pill = statusColors(colors)[slot.status];
            const name = category !== undefined && category.name !== ''
              ? category.name
              : t(mealNameKey(slot.mealCategoryKey));
            const time = formatTime(
              slot.plannedTime ?? (category !== undefined ? category.defaultTime : null),
              app.use12HourClock,
            );
            // The exact same grey wash the untouched day squares wear, so the
            // list matches the grid pixel for pixel in both themes.
            const rowFill = tint(colors.cellPending, '55');
            return (
              <Pressable
                key={slot.mealCategoryKey}
                accessibilityRole="button"
                accessibilityLabel={`${name} - ${t('Calendar_OpenDay')}`}
                onPress={() => props.onOpenDay(selected)}
                style={[styles.dayRow, { backgroundColor: rowFill }]}>
                <View style={[styles.dayRowBar, { backgroundColor: pill }]} />
                <Text style={styles.dayRowIcon}>{category?.icon !== '' ? category?.icon : '🍽️'}</Text>
                <View style={styles.dayRowText}>
                  <Text style={[styles.dayRowTitle, { color: colors.text }]} numberOfLines={1}>
                    {slot.title !== '' ? slot.title : name}
                  </Text>
                  <Text style={[styles.dayRowMeta, { color: colors.textMuted }]} numberOfLines={1}>
                    {name}
                    {time !== '' ? ` · ${time}` : ''}
                    {slot.photoCount > 0 ? ` · 📷 ${slot.photoCount}` : ''}
                  </Text>
                </View>
                <View style={[styles.dayRowPill, { backgroundColor: pill }]}>
                  <Text style={styles.dayRowPillText}>{statusLabel(slot.status)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legend}>
          <Legend color={colors.cellPending} label={t('Calendar_LegendPending')} textColor={colors.textMuted} />
          <Legend color={colors.done} label={t('Calendar_LegendGreen')} textColor={colors.textMuted} />
          <Legend color={colors.missed} label={t('Calendar_LegendRed')} textColor={colors.textMuted} />
        </View>
      </View>
    </ScrollView>
  );
}

function Legend(props: {
  color: string;
  label: string;
  textColor: string;
}): React.JSX.Element {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendChip, { backgroundColor: props.color }]} />
      <Text style={[styles.legendText, { color: props.textColor }]}>{props.label}</Text>
    </View>
  );
}

/** Localized status label used by the selected-day rows (spec 8.3 pill). */
function statusLabel(status: MealStatus): string {
  if (status === MealStatus.Done) {
    return t('Status_Done');
  }
  return status === MealStatus.Missed ? t('Status_Missed') : t('Status_Pending');
}

const styles = StyleSheet.create({
  content: { padding: metrics.pagePadding },
  panel: { borderRadius: 16, padding: 14 },
  /** The arrows sit next to the centered month label, as one group. */
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: metrics.controlGap,
  },
  monthLabel: { fontSize: 22, fontFamily: fonts.medium, marginHorizontal: 2 },
  buttonRow: { flexDirection: 'row', gap: metrics.controlGap, marginTop: 10 },
  summary: { marginTop: 10, fontSize: 13 },
  weekHeader: { flexDirection: 'row', marginTop: 12 },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12, fontFamily: fonts.medium },
  /** Day grid: whole weeks of seven equal flex cells (no percentage drift). */
  grid: { marginTop: 6, rowGap: 2 },
  gridRow: { flexDirection: 'row' },
  cellHost: { flex: 1, aspectRatio: 1, padding: 2 },
  /** Soft state wash instead of a frame - the iOS calendar look. */
  cell: {
    flex: 1,
    borderRadius: 12,
    padding: 4,
    justifyContent: 'space-between',
  },
  cellTopRow: { flexDirection: 'row', alignItems: 'flex-start', columnGap: 2 },
  /** Plain host of the day number: no badge, no circle (today paints the cell). */
  dayBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumber: { fontSize: 14, fontFamily: fonts.medium },
  cellFigure: { marginLeft: 'auto', fontSize: 10, marginTop: 1 },
  /** "1/5" - the confirmed share of the day's five slots. */
  cellCount: { fontSize: 10, fontFamily: fonts.medium },
  /** The five meal rows of the selected day. */
  dayList: { marginTop: 12, rowGap: 6 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingRight: 8,
    columnGap: 8,
    overflow: 'hidden',
  },
  dayRowBar: { width: 4, alignSelf: 'stretch' },
  dayRowIcon: { fontSize: 18, paddingVertical: 8 },
  dayRowText: { flex: 1, paddingVertical: 6 },
  dayRowTitle: { fontSize: 13, fontFamily: fonts.medium },
  dayRowMeta: { fontSize: 11, marginTop: 1 },
  dayRowPill: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 2 },
  dayRowPillText: { color: argb('#FFFFFFFF'), fontSize: 10, fontFamily: fonts.medium },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  /** Small solid state dot, like the iOS calendar legend. */
  legendChip: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11 },
});