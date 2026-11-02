// Calendar (spec 8.5) - Microsoft-calendar-style month view: a "October 2026"
// month header with ‹ / › arrows pinned to the panel edges, Today / Open day
// buttons with the selected date riding beside them (bottom-aligned, right-
// aligned) instead of on a line of its own, the 7-column weekday header
// (Monday first) and the grid of day cells.
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
// wearing the SAME frame as the dashboard meal cards (status-coloured border,
// grouped fill, radius, shadow) - only the height stays compact, because the
// calendar needs the space. On a phone a day cell is about
// 44 pt wide, which cannot hold the miniature meal cards of the Windows panel
// legibly, so that detail lives in the list under the grid instead.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { DayProgress, addDays, formatDate, forDay, parseDate } from '../../domain/analytics';
import { MealStatus } from '../../domain/enums';
import { MealCategory } from '../../domain/models';
import { getMealsInRange, getPhotoCounts } from '../../data/repositories';
import { ensureCategories } from '../../services/mealTracking';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { BarButton, IconButton } from '../components/buttons';
import { Icon } from '../components/icons';
import { fonts, metrics, pageTitleStyle, softPillColors, themeColors } from '../theme';
import { useFloatingTabBarClearance } from '../tabBar';
import {
  formatLongDate,
  formatMonthLabel,
  formatTime,
  mealNameKey,
  t,
  tFmt,
} from '../strings';

export function CalendarScreen(props: {
  onOpenDay: (date: string) => void;
  /** Date the page should show on arrival (Statistics sends a period start). */
  initialDate?: string;
}): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  // Room the floating tab bar needs below the last day row - measured from the
  // device's own safe-area inset and the bar height (see src/ui/tabBar.ts).
  const bottomClearance = useFloatingTabBarClearance();
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

  // Arriving from Statistics with a date selects it and opens its month; both
  // halves matter, or the grid would stay on the month the user just left.
  useEffect(() => {
    const target = props.initialDate;
    if (target === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(target)) {
      return;
    }
    setMonth(target.slice(0, 7));
    setSelected(target);
  }, [props.initialDate]);

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
  // Weekday captions come from the resource file ("Mo Tu We ..."), Monday first.
  const weekdays = t('Calendar_Weekdays').split(/\s+/).filter((name) => name !== '');


  /** The colour of one meal-slot mark: done, missed, or "nothing recorded". */
  const markColor = (status: MealStatus): string =>
    status === MealStatus.Done
      ? colors.done
      : status === MealStatus.Missed
        ? colors.missed
        : colors.cellPending;

  /** Counts and photo total of the day the agenda is previewing. */
  const selectedProgress = progressByDate[selected];
  const selectedPhotos =
    selectedProgress?.slots.reduce((total, slot) => total + slot.photoCount, 0) ?? 0;
  const selectedSummary =
    selectedProgress === undefined
      ? tFmt('Rn_CalendarDaySummary', 0, 0, 0)
      : `${tFmt(
          'Rn_CalendarDaySummary',
          selectedProgress.completed,
          selectedProgress.missed,
          selectedProgress.pending,
        )}${selectedPhotos > 0 ? ` · ${tFmt('Rn_CalendarPhotoCount', selectedPhotos)}` : ''}`;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // The floating tab bar sits on top of the page: the agenda stays readable
        // above it on every device (no per-screen magic number).
        { paddingBottom: bottomClearance },
      ]}>
      <View style={styles.pageHead}>
        <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Calendar')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Calendar_Today')}
          onPress={goToToday}
          hitSlop={10}
          style={({ pressed }) => [styles.todayLink, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.todayLinkText, { color: colors.accent }]}>
            {t('Calendar_Today')}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        {t('Rn_CalendarSubtitle')}
      </Text>

      {/* Month navigation, weekday grid and the mark key read as ONE surface, so
          the month is a single object instead of three stacked cards. */}
      <View style={[styles.board, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.monthRow}>
          <Text style={[styles.monthLabel, { color: colors.text }]} numberOfLines={1}>
            {formatMonthLabel(month)}
          </Text>
          <View style={styles.monthActions}>
            <IconButton
              label={t('Calendar_PreviousMonth')}
              icon="chevron-back"
              onPress={() => shiftMonth(-1)}
              size={20}
              touch={44}
              colors={colors}
            />
            <IconButton
              label={t('Calendar_NextMonth')}
              icon="chevron-forward"
              onPress={() => shiftMonth(1)}
              size={20}
              touch={44}
              colors={colors}
            />
          </View>
        </View>

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
                /** Recorded days show their five slot marks; untouched days stay quiet. */
                const recorded = progress !== undefined && progress.decided > 0;
                const summary =
                  progress === undefined
                    ? ''
                    : tFmt(
                        'Calendar_DaySummary',
                        progress.completed,
                        progress.missed,
                        progress.pending,
                      );
                return (
                  <Pressable
                    key={cell.date}
                    accessibilityRole="button"
                    accessibilityLabel={
                      summary === '' ? formatLongDate(cell.date) : `${formatLongDate(cell.date)}, ${summary}`
                    }
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      // A day of a neighbouring month also moves the grid there.
                      if (!cell.inMonth) {
                        setMonth(cell.date.slice(0, 7));
                      }
                      setSelected(cell.date);
                    }}
                    onLongPress={() => props.onOpenDay(cell.date)}
                    style={[styles.cell, { opacity: cell.inMonth ? 1 : 0.38 }]}>
                    {/* Selected = filled circle, today = outline, everything else
                        is just the number. */}
                    <View
                      style={[
                        styles.dayCircle,
                        isSelected && { backgroundColor: colors.accent },
                        !isSelected && isToday && {
                          borderWidth: 1.5,
                          borderColor: colors.accent,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.dayNumber,
                          {
                            color: isSelected
                              ? colors.accentFillText
                              : isToday
                                ? colors.accent
                                : colors.text,
                          },
                        ]}
                        maxFontSizeMultiplier={1.3}>
                        {Number(cell.date.slice(8))}
                      </Text>
                    </View>
                    <View style={styles.marks}>
                      {recorded &&
                        progress.slots.map((slot) => (
                          <View
                            key={slot.mealCategoryKey}
                            style={[
                              styles.mark,
                              { backgroundColor: markColor(slot.status) },
                            ]}
                          />
                        ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <View style={[styles.keyRow, { borderTopColor: colors.hairline }]}>
          <KeyItem icon="checkmark" color={colors.done} label={t('Status_Done')} colors={colors} />
          <KeyItem icon="close" color={colors.missed} label={t('Status_Missed')} colors={colors} />
          <KeyItem
            icon="time-outline"
            color={colors.pending}
            label={t('Status_Pending')}
            colors={colors}
          />
        </View>
        <View style={styles.boardFoot}>
          <Text style={[styles.footText, { color: colors.textMuted }]}>
            {t('Rn_CalendarMarks')}
          </Text>
          <View style={styles.footToday}>
            <View style={[styles.footRing, { borderColor: colors.accent }]} />
            <Text style={[styles.footText, { color: colors.textMuted }]}>
              {t('Calendar_Today')}
            </Text>
          </View>
        </View>
      </View>


      {/* Selected day: one clear date, a concise count line and an explicit
          "Open day" - selecting a date only PREVIEWS its agenda. */}
      <View style={styles.selectedRow}>
        <View style={styles.copy}>
          <Text style={[styles.selectedTitle, { color: colors.text }]} numberOfLines={1}>
            {formatLongDate(selected)}
          </Text>
          <Text style={[styles.selectedDetail, { color: colors.textMuted }]}>
            {selectedSummary}
          </Text>
        </View>
        <BarButton
          compact
          label={t('Calendar_OpenDay')}
          onPress={() => props.onOpenDay(selected)}
          colors={colors}
        />
      </View>

      {/* Grouped agenda of the selected date: time, meal, category + photo count,
          explicit status. */}
      <View style={[styles.agenda, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {(selectedProgress?.slots ?? []).map((slot, index) => {
          const category = categories.find((c) => c.fixedCategoryKey === slot.mealCategoryKey);
          const pill = softPillColors(colors, slot.status);
          const name =
            category !== undefined && category.name !== ''
              ? category.name
              : t(mealNameKey(slot.mealCategoryKey));
          const time = formatTime(
            slot.plannedTime ?? (category !== undefined ? category.defaultTime : null),
            app.use12HourClock,
          );
          return (
            <View
              key={slot.mealCategoryKey}
              style={[
                styles.agendaRow,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.hairline,
                },
              ]}>
              <Text style={[styles.agendaTime, { color: colors.textMuted }]} numberOfLines={1}>
                {time}
              </Text>
              <View style={styles.copy}>
                <Text
                  style={[
                    styles.agendaTitle,
                    { color: slot.title !== '' ? colors.text : colors.textMuted },
                  ]}
                  numberOfLines={1}>
                  {slot.title !== '' ? slot.title : t('Rn_NoMealRecorded')}
                </Text>
                <View style={styles.agendaMeta}>
                  <Text style={[styles.agendaDetail, { color: colors.textMuted }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {slot.photoCount > 0 && (
                    <>
                      <Icon name="camera-outline" size={12} color={colors.textMuted} />
                      <Text style={[styles.agendaDetail, { color: colors.textMuted }]}>
                        {slot.photoCount}
                      </Text>
                    </>
                  )}
                </View>
              </View>
              <View style={[styles.agendaPill, { backgroundColor: pill.fill }]}>
                <Text style={[styles.agendaPillText, { color: pill.ink }]}>
                  {statusLabel(slot.status)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** One entry of the mark key: glyph in the state colour plus its word. */
function KeyItem(props: {
  icon: React.ComponentProps<typeof Icon>['name'];
  color: string;
  label: string;
  colors: ReturnType<typeof themeColors>;
}): React.JSX.Element {
  return (
    <View style={styles.keyItem}>
      <Icon name={props.icon} size={13} color={props.color} />
      <Text style={[styles.keyText, { color: props.colors.textSecondary }]}>{props.label}</Text>
    </View>
  );
}

/** Localized status label used by the agenda pill (spec 8.3). */
function statusLabel(status: MealStatus): string {
  if (status === MealStatus.Done) {
    return t('Status_Done');
  }
  if (status === MealStatus.Missed) {
    return t('Status_Missed');
  }
  return t('Status_Pending');
}


const styles = StyleSheet.create({
  /** Page frame; the bottom padding is computed at render time (tab bar). */
  content: { paddingHorizontal: metrics.pagePadding, paddingTop: 6 },
  pageHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  pageTitle: { ...pageTitleStyle },
  /** "Today" is a quiet accent link, not a filled button. */
  todayLink: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 6, marginTop: 2 },
  todayLinkText: { fontSize: 13, fontFamily: fonts.medium },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  /** Month navigation + weekday grid + key form one coherent surface. */
  board: {
    marginTop: 12,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
    minHeight: 44,
  },
  monthLabel: { fontSize: 18, fontFamily: fonts.medium, letterSpacing: -0.3 },
  monthActions: { flexDirection: 'row', alignItems: 'center' },
  weekHeader: { flexDirection: 'row', marginTop: 2 },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, paddingVertical: 6 },
  /** Whole weeks of seven equal cells (no percentage drift). */
  grid: { rowGap: 2 },
  gridRow: { flexDirection: 'row' },
  /** Cell = the day circle plus its five marks; 48 pt tall so it stays tappable. */
  cell: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', rowGap: 3 },
  dayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumber: { fontSize: 13, fontFamily: fonts.medium, fontVariant: ['tabular-nums'] },
  /** Five slot marks in meal order: 4 x 3 pt, 2 pt apart. */
  marks: { flexDirection: 'row', alignItems: 'center', columnGap: 2, height: 3 },
  mark: { width: 4, height: 3, borderRadius: 2 },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    paddingTop: 10,
  },
  keyItem: { flexDirection: 'row', alignItems: 'center', columnGap: 4 },
  keyText: { fontSize: 11 },
  boardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  footText: { fontSize: 11 },
  footToday: { flexDirection: 'row', alignItems: 'center', columnGap: 5 },
  footRing: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  /** Selected date + its counts, with the explicit Open day action. */
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    marginTop: 16,
    marginBottom: 8,
  },
  copy: { flex: 1, minWidth: 0 },
  selectedTitle: { fontSize: 14, fontFamily: fonts.medium, lineHeight: 19 },
  selectedDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  /** Grouped agenda: time | meal | status, one row per slot. */
  agenda: { borderRadius: 15, borderWidth: 1, overflow: 'hidden' },
  agendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    minHeight: 62,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  agendaTime: { fontSize: 12, width: 44, fontVariant: ['tabular-nums'] },
  agendaTitle: { fontSize: 13, fontFamily: fonts.medium, lineHeight: 18 },
  agendaMeta: { flexDirection: 'row', alignItems: 'center', columnGap: 4, marginTop: 2 },
  agendaDetail: { fontSize: 11, flexShrink: 1 },
  /** Soft pill: the state colour on a wash of itself. */
  agendaPill: {
    borderRadius: metrics.radiusPill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexShrink: 0,
  },
  agendaPillText: { fontSize: 11, fontFamily: fonts.medium },
});

