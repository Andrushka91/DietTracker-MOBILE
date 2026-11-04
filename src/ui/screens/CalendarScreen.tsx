  // Calendar (spec 8.5) - one compact month card: a left-aligned month label, a
  // pale-indigo "Today" button with a calendar icon, the seven equal columns
  // Monday-first, the day cells, then the Done / Missed / Pending key in a single
  // compact row with "5 dots = 5 meals", the selected-day row (a bold compact date,
  // its counts and "Open day") and the grouped agenda of that date.
  //
  // Day markers: the SELECTED day is the filled indigo circle with white text, and
  // TODAY is a thin outline drawn in EVERY state - when another date is selected the
  // outline is the accent, and when today IS the selection the outline is drawn in
  // the fill's own ink so the two markers never cancel each other out. Both marks
  // are child Views; a background/border on a re-used cell loses its corner radius
  // on Android (see the cell comment). Tapping a cell selects it; long press /
  // "Open day" opens the Dashboard for that date. "Today" is never a constant: it is
  // read from the clock on every focus, so the outline moves by itself after
  // midnight.
  //
  // A day with any decision shows its FIVE meal-slot marks (green done, red missed,
  // gray pending - the same three inks as the key) in meal-category order, below the
  // date, small enough that seven columns never collide; an untouched day shows no
  // marks at all, because a pending meal never produced a figure. The neighbouring
  // months' days that fill the first and last week carry their marks too, so a month
  // boundary never looks like a gap in the diary.
  //
  // The agenda lists the five slots of the selected date with the SAME line icon the
  // meal card wears, an aligned time, the meal's title over its category (or the
  // CATEGORY alone when the slot has no title - never five "No meal recorded"
  // lines), its photograph count and a small status pill. Photos and navigation are
  // untouched: this page still only reads.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { DayProgress, addDays, formatDate, forDay } from '../../domain/analytics';
import { MealStatus } from '../../domain/enums';
import { MealCategory } from '../../domain/models';
import { getMealsInRange, getPhotoCounts } from '../../data/repositories';
import { ensureCategories } from '../../services/mealTracking';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { monthGrid } from '../calendarGrid';
import { isCalendarDate } from '../dates';
import { BarButton, IconButton } from '../components/buttons';
import { Icon, MaterialIcon } from '../components/icons';
import { mealCategoryGlyph } from '../mealGlyphs';
import { fonts, metrics, pageTitleStyle, softPillColors, themeColors } from '../theme';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';
import {
  formatCompactDayMonth,
  formatLongDate,
  formatMonthLabel,
  formatTime,
  mealNameKey,
  t,
  tFmt,
} from '../strings';

/** The agenda row's category glyph: the same line icon the meal card wears. */
const AGENDA_GLYPH_SIZE = 18;

export function CalendarScreen(props: {
  onOpenDay: (date: string) => void;
  /** Date the page should show on arrival (Statistics sends a period start). */
  initialDate?: string;
  /**
   * Id of the hand-off that carried `initialDate`. It only has to change for the
   * arrival to be applied again - the same date may legitimately be requested
   * twice (diary -> calendar, browse to another month, diary -> same date).
   */
  initialDateRequestId?: number;
}): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  /**
   * The current date is STATE, not a constant read once at mount: the calendar
   * tab stays alive while the app sits in the background, so a fixed value would
   * keep the today ring (and the "Today" jump) on yesterday after midnight. The
   * focus effect below refreshes it every time the tab comes to the front.
   */
  const [today, setToday] = useState(() => formatDate(new Date()));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [progressByDate, setProgressByDate] = useState<Record<string, DayProgress>>({});
  const [categories, setCategories] = useState<MealCategory[]>([]);

  const reload = useCallback(async () => {
    if (app.profile === null) {
      return;
    }
    setCategories(await ensureCategories());
    // The query covers the WHOLE visible grid, not just the month: the first and
    // last weeks belong to the neighbouring months, and those cells draw the same
    // five marks as the rest of the board.
    const { from, to } = monthGrid(month);
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
      // The clock may have passed midnight while the tab sat in the background:
      // re-reading the real date here is what keeps the today ring (and the
      // "Today" jump) on the right day instead of freezing it at mount time.
      setToday(formatDate(new Date()));
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

  // Arriving with a date selects it and opens its month; both halves matter, or
  // the grid would stay on the month the user just left. The request id is a
  // dependency too, so a REPEATED request for the same date re-applies after the
  // grid was browsed elsewhere, while an ordinary tab tap (no new parameters)
  // leaves the calendar exactly where the user parked it.
  useEffect(() => {
    const target = props.initialDate;
    if (target === undefined || !isCalendarDate(target)) {
      return;
    }
    setMonth(target.slice(0, 7));
    setSelected(target);
  }, [props.initialDate, props.initialDateRequestId]);

  // The grid always shows whole weeks starting on Monday, so the neighbouring
  // months' days fill the first and last row. They keep their real day numbers
  // (in the quiet ink) and their five marks, exactly like the days of the month -
  // the SAME `monthGrid` the query used, so a cell can never ask for a date the
  // reload did not load.
  const grid = monthGrid(month);
  const cells: Array<{ date: string; inMonth: boolean; progress?: DayProgress }> =
    grid.dates.map((date) => ({
      date,
      inMonth: date.slice(0, 7) === month,
      progress: progressByDate[date],
    }));
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
   * The colour of one meal-slot mark: the exact three inks of the key under the
   * grid. A pending slot used to borrow `cellPending` - a near-black wash on the
   * dark board, i.e. an invisible dot - so the marks only ever told half the
   * story; the pending ink is the key's gray now.
   */
  const markColor = (status: MealStatus): string =>
    status === MealStatus.Done
      ? colors.done
      : status === MealStatus.Missed
        ? colors.missed
        : colors.pending;

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
        // Air above the docked bar's divider (see src/ui/tabBar.ts): the agenda
        // never ends flush against it.
        { paddingBottom: TAB_BAR_CONTENT_GAP },
      ]}>
      <View style={styles.pageHead}>
        <Text style={[styles.pageTitle, { color: colors.text }]} numberOfLines={1}>
          {t('Nav_Calendar')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Calendar_Today')}
          onPress={goToToday}
          hitSlop={10}
          style={styles.todayButton}
        >
          <MaterialIcon name="calendar-month-outline" size={16} color={colors.accentFillText} />
          <Text style={styles.todayButtonText}>{t('Calendar_Today')}</Text>
        </Pressable>
      </View>

      {/* Month navigation, weekday grid and the mark key read as ONE compact
          surface: the arrows sit on the card's edges so the month label is exactly
          centred, whatever its length. */}
      <View style={[styles.board, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Month navigation: label on the left, grouped arrows on the right. */}
        <View style={styles.monthRow}>
          <Text style={[styles.monthLabel, { color: colors.text }]} numberOfLines={1}>
            {formatMonthLabel(month)}
          </Text>
          <View style={styles.monthNav}>
            <IconButton
              label={t('Calendar_PreviousMonth')}
              icon="chevron-back"
              onPress={() => shiftMonth(-1)}
              size={20}
              colors={colors}
            />
            <IconButton
              label={t('Calendar_NextMonth')}
              icon="chevron-forward"
              onPress={() => shiftMonth(1)}
              size={20}
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
                    style={styles.cell}>
                    {/* SELECTED = the filled indigo circle, white number.
                        TODAY = the thin outline, drawn in EVERY state - including
                        when another date is selected, and inside the filled circle
                        (in the fill's own ink) when today IS the selection, so the
                        two markers never cancel each other out.

                        BOTH marks are child Views that only exist in that state -
                        NOT a background/border on the badge itself. Android drops a
                        View's corner radius when a background or border is added to
                        a view that is already on screen, and browsing months
                        re-uses the same cell views, so the filled day turned into a
                        SQUARE and the outlined day into a SQUARE ring the moment the
                        month changed. A freshly mounted child always draws round
                        (see `dayBadgeFill` / `dayBadgeRing`). */}
                    <View style={styles.dayBadge}>
                      {isSelected && (
                        <View
                          pointerEvents="none"
                          style={[styles.dayBadgeFill, { backgroundColor: colors.accent }]}
                        />
                      )}
                      {isToday && (
                        <View
                          pointerEvents="none"
                          style={[
                            styles.dayBadgeRing,
                            { borderColor: isSelected ? colors.accentFillText : colors.accent },
                          ]}
                        />
                      )}
                      <Text
                        style={[
                          styles.dayNumber,
                          {
                            // White on the fill; the ordinary ink everywhere else,
                            // so today's outline stays legible on the card and a
                            // neighbour month's day is the only quietened one.
                            color: isSelected
                              ? colors.accentFillText
                              : cell.inMonth || isToday
                                ? colors.text
                                : colors.textMuted,
                          },
                        ]}
                        maxFontSizeMultiplier={1.3}>
                        {Number(cell.date.slice(8))}
                      </Text>
                    </View>
                    {/* Exactly five marks per recorded day, in meal order, in one
                        row under the date - small enough that seven columns never
                        collide, and never wrapping onto a second line. */}
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

        {/* A single compact key row: done / missed / pending with their dots,
            a separator, then "5 dots = 5 meals". */}
        <View style={styles.keyRow}>
          <KeyItem icon="checkmark" color={colors.done} label={t('Status_Done')} colors={colors} />
          <KeyItem icon="close" color={colors.missed} label={t('Status_Missed')} colors={colors} />
          <KeyItem
            icon="time-outline"
            color={colors.pending}
            label={t('Status_Pending')}
            colors={colors}
          />
          <View style={[styles.keySeparator, { backgroundColor: colors.cardDivider }]} />
          <Text style={[styles.footText, { color: colors.textMuted }]} numberOfLines={1}>
            {t('Rn_CalendarDots')}
          </Text>
        </View>
      </View>


      {/* Selected day: a bold compact date, its counts and an "Open day" action. */}
      <View style={styles.selectedRow}>
        <View style={styles.copy}>
          <Text style={[styles.selectedTitle, { color: colors.text }]} numberOfLines={1}>
            {formatCompactDayMonth(selected)}
          </Text>
          <Text style={[styles.selectedDetail, { color: colors.textMuted }]} numberOfLines={1}>
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

      {/* Grouped agenda of the selected date: category icon, aligned time, the
          meal's title over its category, its photographs and a small status pill. */}
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
          /**
           * Hierarchy: a meal WITH a title leads with it and names its meal slot
           * underneath; an untouched slot leads with the CATEGORY itself and shows
           * whatever description it does hold - it never prints "No meal recorded"
           * five times, which said nothing about which meal the row is.
           */
          const hasTitle = slot.title !== '';
          const primary = hasTitle ? slot.title : name;
          const secondary = hasTitle ? name : slot.ingredients;
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
              {/* Time: aligned column on the left. */}
              <Text style={[styles.agendaTime, { color: colors.textMuted }]} numberOfLines={1}>
                {time}
              </Text>
              {/* Icon tile: the same line icon the meal card wears, in a pale rounded tile. */}
              <View style={[styles.agendaIcon, { backgroundColor: colors.surfaceVariant }]}>
                <MaterialIcon
                  name={mealCategoryGlyph(slot.mealCategoryKey)}
                  size={AGENDA_GLYPH_SIZE}
                  color={colors.textSecondary}
                />
              </View>
              {/* Text: title over category + photo count (or category alone). */}
              <View style={styles.copy}>
                <Text style={[styles.agendaTitle, { color: colors.text }]} numberOfLines={1}>
                  {primary}
                </Text>
                {secondary !== '' && (
                  <View style={styles.agendaDetailRow}>
                    <Text
                      style={[styles.agendaDetail, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {secondary}
                    </Text>
                    {slot.photoCount > 0 && (
                      <View style={styles.agendaPhotos}>
                        <Icon name="camera-outline" size={11} color={colors.textMuted} />
                        <Text style={[styles.agendaDetail, { color: colors.textMuted }]}>
                          {slot.photoCount}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
              {/* Status badge: a soft pill on the right. */}
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

/** One entry of the mark key: a coloured dot plus its word. */
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
  /** "Today" is a pale-indigo button with a calendar icon. */
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: metrics.radiusPill,
    backgroundColor: themeColors.accentFill,
  },
  todayButtonText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: themeColors.accentFillText,
  },
  /** Month navigation + weekday grid + key form one compact surface. */
  board: {
    marginTop: 10,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 6,
  },
  /** Month navigation: label on the left, arrows grouped on the right. */
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  monthLabel: {
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    fontSize: 18,
    fontFamily: fonts.bold,
    letterSpacing: -0.4,
  },
  monthNav: {
    flexDirection: 'row',
    gap: 6,
  },
  weekHeader: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, paddingVertical: 4 },
  /** Whole weeks of seven equal cells (no percentage drift). */
  grid: { rowGap: 1 },
  gridRow: { flexDirection: 'row' },
  /** Cell = the day badge plus its five marks. 46 pt keeps a 44 pt+ target. */
  cell: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', rowGap: 2 },
  /**
   * The day badge is a CIRCLE: a 32 pt round chip. Today RINGS it in the accent
   * (the ordinary day ink inside), the selected day FILLS it - the same
   * silhouette either way, and it stays round on every selection. Only the badge
   * rounds; the cells keep their square grid so the columns stay aligned.
   */
  dayBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The selected day's fill: one absolutely filled circle INSIDE the badge, so it
   * is mounted fresh when the day appears. A background painted on an already
   * mounted badge loses its corner radius on Android and the day showed as a
   * square after a month change; this child cannot, because it never survives a
   * re-used cell (see the cell comment). The radius matches `dayBadge`.
   */
  dayBadgeFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 16,
  },
  /**
   * Today's ring: the same trick, one mounted outline instead of a `borderWidth`
   * that appears on a re-used cell (that is what used to square the outline off).
   */
  dayBadgeRing: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  dayNumber: { fontSize: 14, fontFamily: fonts.medium, fontVariant: ['tabular-nums'] },
  /** Five slot marks in meal order: 5 x 4 pt dots, 2 pt apart (28 pt wide). */
  marks: { flexDirection: 'row', alignItems: 'center', columnGap: 2, height: 4, maxWidth: '100%' },
  mark: { width: 4, height: 4, borderRadius: 2 },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: themeColors.cardDivider,
    marginTop: 8,
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  /** One key entry: an equal third of the row, centred, so the three spread. */
  keyItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 4,
  },
  keyText: { fontSize: 11 },
  /** Thin vertical separator between the key items and the dots caption. */
  keySeparator: { width: 1, height: 12, marginHorizontal: 6, flexShrink: 0 },
  /** "5 dots = 5 meals" caption on the right. */
  footText: { fontSize: 11 },
  /** Selected date + its counts, with the explicit Open day action. */
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    marginTop: 12,
    marginBottom: 6,
  },
  copy: { flex: 1, minWidth: 0 },
  selectedTitle: { fontSize: 16, fontFamily: fonts.bold, lineHeight: 21 },
  selectedDetail: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  /** Grouped agenda: time | icon | text | status badge. */
  agenda: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  agendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  /** The meal slot's own icon, in the same 30 pt tile shape as a meal card. */
  agendaIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agendaTime: { fontSize: 12, width: 40, fontVariant: ['tabular-nums'] },
  agendaTitle: { fontSize: 13, fontFamily: fonts.medium, lineHeight: 18 },
  /** Detail line: category text + optional photo count, on one row. */
  agendaDetailRow: { flexDirection: 'row', alignItems: 'center', columnGap: 4 },
  agendaDetail: { fontSize: 11, flexShrink: 1 },
  /** Camera glyph plus the photograph count, inline with the category. */
  agendaPhotos: { flexDirection: 'row', alignItems: 'center', columnGap: 3, flexShrink: 0 },
  /** Status badge: a soft pill on the right. */
  agendaPill: {
    borderRadius: metrics.radiusPill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexShrink: 0,
  },
  agendaPillText: { fontSize: 11, fontFamily: fonts.medium },
});

