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
import {
  fonts,
  metrics,
  statusPillColors,
  themeColors,
  cardShadow,
  typeScale,
} from '../theme';
import { useFloatingTabBarClearance } from '../tabBar';
import { formatLongDate, formatMediumDate, formatMonthLabel, formatTime, mealNameKey, t } from '../strings';

export function CalendarScreen(props: { onOpenDay: (date: string) => void }): React.JSX.Element {
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


  /**
   * Calendar day state. A decided day keeps a quiet dot in its state colour (a
   * full-cell green/red wash on all 42 cells turned the grid into a wall of
   * tiles); today paints the whole cell with the accent, and a selected day gets
   * the accent outline. Nothing is decided => no fill at all.
   */
  const dayState = (progress?: DayProgress): { dot: string | null } => {
    if (progress !== undefined && progress.isFullyCompleted) {
      return { dot: colors.done };
    }
    if (progress !== undefined && progress.missed > 0) {
      return { dot: colors.missed };
    }
    return { dot: null };
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // The floating tab bar sits on top of the page: the last day row and the
        // legend stay readable above it, on every device (no per-screen magic
        // number - the value comes from the bar's own geometry).
        { paddingBottom: bottomClearance },
      ]}>
      <View style={[styles.panel, cardShadow, { backgroundColor: colors.surface }]}>
        {/* Month header: the arrows are pinned to the panel's two edges, so the
            left one lines up with the left edge of the day grid below and the
            right one with the right edge of the action row - a symmetrical
            pair framing the centred month label. */}
        <View style={styles.monthRow}>
          <IconButton
            label={t('Calendar_PreviousMonth')}
            icon="chevron-back"
            onPress={() => shiftMonth(-1)}
            colors={colors}
          />
          <Text style={[styles.monthLabel, { color: colors.text }]} numberOfLines={1}>
            {formatMonthLabel(month)}
          </Text>
          <IconButton
            label={t('Calendar_NextMonth')}
            icon="chevron-forward"
            onPress={() => shiftMonth(1)}
            colors={colors}
          />
        </View>
        {/* Today / Open day keep the left side of the row; the selected date
            rides to their right, bottom-aligned with the buttons, so it costs
            no line of its own and the calendar card stays compact. The
            confirmed/missed/pending counters are deliberately gone: the day
            cells already colour-code the state. */}
        <View style={styles.actionRow}>
          <View style={styles.buttonRow}>
            <BarButton label={t('Calendar_Today')} accent onPress={goToToday} colors={colors} />
            <BarButton
              label={t('Calendar_OpenDay')}
              onPress={() => props.onOpenDay(selected)}
              colors={colors}
            />
          </View>
          <Text
            style={[styles.selectedDate, { color: colors.textSecondary }]}
            numberOfLines={2}>
            {formatMediumDate(selected)}
          </Text>
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
                const hasPhoto = progress !== undefined && progress.slots.some((s) => s.photoCount > 0);
                const hasFigure = progress !== undefined && progress.decided > 0;
                const state = dayState(progress);
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
                          backgroundColor: isToday ? colors.accent : 'transparent',
                          borderWidth: isSelected && !isToday ? 1.5 : 0,
                          borderColor: colors.accent,
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
                            ]}
                            maxFontSizeMultiplier={1.2}>
                            {cell.date.slice(8)}
                          </Text>
                        </View>
                        {/* Photo marker of the day: one glyph, right-aligned. */}
                        {hasPhoto && (
                          <Icon
                            name="camera-outline"
                            size={11}
                            color={onToday ?? colors.textMuted}
                          />
                        )}
                      </View>
                      {/*
                       * The day's state: a 6 pt dot in the state colour plus the
                       * confirmed share of the five slots ("3/5"). Untouched days
                       * show nothing - a pending meal never produces a figure.
                       */}
                      <View style={styles.cellBottomRow}>
                        {state.dot !== null && (
                          <View style={[styles.cellDot, { backgroundColor: onToday ?? state.dot }]} />
                        )}
                        <Text
                          style={[styles.cellCount, { color: onToday ?? colors.textMuted }]}
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.2}>
                          {hasFigure && progress !== undefined
                            ? `${progress.completed}/${progress.totalSlots}`
                            : ''}
                        </Text>
                      </View>
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
            const pillColors = statusPillColors(colors, slot.status);
            const name = category !== undefined && category.name !== ''
              ? category.name
              : t(mealNameKey(slot.mealCategoryKey));
            const time = formatTime(
              slot.plannedTime ?? (category !== undefined ? category.defaultTime : null),
              app.use12HourClock,
            );
            return (
              <Pressable
                key={slot.mealCategoryKey}
                accessibilityRole="button"
                accessibilityLabel={`${name} - ${t('Calendar_OpenDay')}`}
                onPress={() => props.onOpenDay(selected)}
                // The SAME frame the dashboard meal cards wear (status-coloured
                // border, grouped-card fill, radius and shadow); only the compact
                // height stays, because the day list needs the space.
                style={[
                  styles.dayRow,
                  { backgroundColor: colors.cardFill, borderColor: colors.border },
                ]}>
                {/* Same state rail as the dashboard cards, compact height. A
                    pending row has no rail, exactly like a pending meal card. */}
                {slot.status !== MealStatus.Pending && (
                  <View style={[styles.dayRowRail, { backgroundColor: pillColors.dot }]} />
                )}
                <Text style={styles.dayRowIcon}>{category?.icon !== '' ? category?.icon : '🍽️'}</Text>
                <View style={styles.dayRowText}>
                  <Text style={[styles.dayRowTitle, { color: colors.text }]} numberOfLines={1}>
                    {slot.title !== '' ? slot.title : name}
                  </Text>
                  <View style={styles.dayRowMetaRow}>
                    <Text style={[styles.dayRowMeta, { color: colors.textMuted }]} numberOfLines={1}>
                      {name}
                      {time !== '' ? ` · ${time}` : ''}
                    </Text>
                    {slot.photoCount > 0 && (
                      <View style={styles.photoMarker}>
                        <Icon name="camera-outline" size={12} color={colors.textMuted} />
                        <Text style={[styles.dayRowMeta, { color: colors.textMuted }]}>
                          {slot.photoCount}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <View
                  style={[
                    styles.dayRowPill,
                    {
                      backgroundColor: pillColors.fill,
                      borderWidth: pillColors.solid ? 0 : 1,
                      borderColor: colors.border,
                    },
                  ]}>
                  <Text style={[styles.dayRowPillText, { color: pillColors.ink }]}>
                    {statusLabel(slot.status)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legend}>
          {/* The dot uses the STATE colour, not the pale cell wash, so all three
              dots stay equally legible on the white panel. */}
          <Legend color={colors.pending} label={t('Calendar_LegendPending')} textColor={colors.textSecondary} />
          <Legend color={colors.done} label={t('Calendar_LegendGreen')} textColor={colors.textSecondary} />
          <Legend color={colors.missed} label={t('Calendar_LegendRed')} textColor={colors.textSecondary} />
        </View>
      </View>
    </ScrollView>
  );
}

/** One legend entry: the state dot plus its description (the dot carries the colour). */
function Legend(props: {
  color: string;
  label: string;
  textColor: string;
}): React.JSX.Element {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendChip, { backgroundColor: props.color }]} />
      <Text style={[styles.legendText, { color: props.textColor }]} numberOfLines={1}>
        {props.label}
      </Text>
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
  content: { paddingHorizontal: 12, paddingTop: 8 },
  panel: { borderRadius: 16, padding: 10 },
  /**
   * The arrows sit on the two edges of the panel (space-between) with the month
   * label filling what is left: both arrows have the same chrome, so the label
   * stays optically centred and the pair is symmetrical - the left arrow above
   * the left edge of the grid, the right arrow above the right edge of the
   * action row.
   */
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: metrics.controlGap,
  },
  monthLabel: { flex: 1, textAlign: 'center', fontSize: typeScale.title2, fontFamily: fonts.bold, letterSpacing: -0.4 },
  /** Today / Open day on the left, the selected date bottom-aligned on the right. */
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    columnGap: metrics.controlGap,
    marginTop: 10,
  },
  /** The two buttons never shrink: the date takes the remaining width instead. */
  buttonRow: { flexDirection: 'row', flexShrink: 0, gap: metrics.controlGap },
  /** Long date of the selected day ("Sunday, 1 November 2026"). */
  selectedDate: { flex: 1, textAlign: 'right', fontSize: 12, paddingBottom: 3 },
  weekHeader: { flexDirection: 'row', marginTop: 12 },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12, fontFamily: fonts.medium },
  /** Day grid: whole weeks of seven equal flex cells (no percentage drift). */
  grid: { marginTop: 4, rowGap: 2 },
  gridRow: { flexDirection: 'row' },
  cellHost: { flex: 1, aspectRatio: 1 },
  /**
   * A day cell is mostly AIR: plain number, a state dot and the confirmed count.
   * Only today (accent fill) and the selected day (accent outline) draw chrome -
   * 42 grey tiles made the month look like a keyboard.
   */
  cell: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
    justifyContent: 'space-between',
  },
  cellTopRow: { flexDirection: 'row', alignItems: 'flex-start', columnGap: 2 },
  /** Plain host of the day number: no badge, no circle (today paints the cell). */
  dayBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumber: { fontSize: 14, fontFamily: fonts.medium },
  cellBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    minHeight: 14,
  },
  /** State dot of a decided day (green = all eaten, red = something missed). */
  cellDot: { width: 6, height: 6, borderRadius: 3 },
  /** "3/5" - the confirmed share of the day's five slots. */
  cellCount: { fontSize: 10, fontFamily: fonts.medium, marginLeft: 'auto' },
  /** The five meal rows of the selected day. */
  dayList: { marginTop: 12, rowGap: 6 },
  /**
   * A compact dashboard card: the frame is exactly the meal card's (same
   * metrics.radius / metrics.cardBorder and the state colour as the border, and
   * the same 9 pt inset from the border), so both screens read as one family -
   * only the height stays compact. Without that inset the emoji sat on the
   * stroke, which looked crowded.
   */
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: metrics.radius,
    borderWidth: metrics.cardBorder,
    paddingLeft: 13,
    paddingRight: 10,
    columnGap: 8,
  },
  /** Compact state rail: the three state colours mean the same here. */
  dayRowRail: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: metrics.statusRail,
    borderTopRightRadius: metrics.statusRail,
    borderBottomRightRadius: metrics.statusRail,
  },
  dayRowIcon: { fontSize: 18, paddingVertical: 9 },
  dayRowText: { flex: 1, paddingVertical: 7 },
  dayRowTitle: { fontSize: 14, fontFamily: fonts.medium },
  dayRowMeta: { fontSize: 12, marginTop: 1 },
  /** Meta line plus the photo marker, so the camera glyph lines up with the text. */
  dayRowMetaRow: { flexDirection: 'row', alignItems: 'center', columnGap: 4 },
  photoMarker: { flexDirection: 'row', alignItems: 'center', columnGap: 2 },
  dayRowPill: {
    borderRadius: metrics.radiusPill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  dayRowPillText: { fontSize: 10, fontFamily: fonts.medium },
  legend: {
    flexDirection: 'row',
    // One row for all three states - the dot already carries the colour, so the
    // label is only the description and fits beside the others.
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 10,
    marginTop: 12,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', columnGap: 5, flexShrink: 1 },
  /** Small solid state dot, like the iOS calendar legend. */
  legendChip: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, flexShrink: 1 },
});