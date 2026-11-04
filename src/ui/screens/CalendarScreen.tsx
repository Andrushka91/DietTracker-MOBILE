  // Calendar (spec 8.5) - one FLAT month board: a left-aligned month label with
  // two white, hairline-outlined arrow controls, the seven equal columns
  // Monday-first, the day cells, then the Done / Missed / Pending key in a single
  // compact row with "5 dots = 5 meals", the selected-day heading with an
  // outlined "Open day" action, its status/photo summary on a FULL-WIDTH row of
  // its own, and the grouped agenda of that date.
  //
  // The presentation is deliberately quiet (see calendar.tokens): the month card
  // and the agenda are 16 dp surfaces with a 1 dp neutral frame and NO elevation,
  // and every control on the page - "Today", the month arrows, "Open day" - is a
  // white outlined chip instead of a filled block, so the only saturated things
  // left are the selected day and the real status marks.
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
  // lines), its photograph count and a small status pill. Its FOUR 1 dp rules are
  // inset to the row gutters, so they never touch the card's frame. Photos and
  // navigation are untouched: this page still only reads.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
import { Icon, MaterialIcon, type IconName } from '../components/icons';
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

/**
 * Geometry of the page (dp / sp) - the calendar reference tokens, scoped to this
 * screen. Nothing here changes date arithmetic, data or navigation.
 */
const CAL = {
  cardRadius: 16,
  cardPadding: 10,
  monthSize: 20,
  controlGap: 8,
  weekdaySize: 11,
  cellMinHeight: 44,
  dayBadgeSize: 32,
  dotSize: 5,
  dotGap: 2,
  legendSize: 11,
  selectedTopGap: 14,
  selectedTitleSize: 19,
  summarySize: 12,
  summaryGap: 12,
  agendaTopGap: 10,
  agendaRowMinHeight: 56,
  agendaInset: 14,
  agendaRowGap: 10,
  timeColumn: 44,
  timeSize: 12,
  categoryTile: 30,
  categoryRadius: 8,
  primarySize: 15,
  secondarySize: 11,
  statusSize: 11,
} as const;


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
  /** The system text scale: the only thing that may grow this board. */
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
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
   * Day-mark geometry. The badge keeps its 32 dp circles at the default scale and
   * grows with the system text (capped at 1.4, the same cap the day number wears),
   * and the cell keeps at least the 44 dp touch target - so a larger font makes the
   * board taller instead of clipping a date. No date arithmetic is involved.
   */
  const badgeSize = Math.max(
    CAL.dayBadgeSize,
    Math.ceil(CAL.dayBadgeSize * Math.min(fontScale, 1.4)),
  );
  const cellHeight = Math.max(CAL.cellMinHeight, badgeSize + CAL.dotSize + 6);


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
  /**
   * The selected-day summary is THREE real counts in a fixed order (done, missed,
   * pending) that keep their zeros visible, plus the actual photograph total when
   * the day holds photos - the same facts the old one-line sentence carried, now
   * as items that wrap instead of truncating. Localized with the existing status
   * words and photo-count string; nothing here is computed for the design.
   */
  const summaryItems: Array<{
    id: string;
    icon: IconName;
    text: string;
    tone: 'done' | 'missed' | 'pending' | 'neutral';
  }> = [
    {
      id: 'done',
      icon: 'checkmark-circle-outline',
      text: `${selectedProgress?.completed ?? 0} ${t('Status_Done')}`,
      tone: 'done',
    },
    {
      id: 'missed',
      icon: 'close-circle-outline',
      text: `${selectedProgress?.missed ?? 0} ${t('Status_Missed')}`,
      tone: 'missed',
    },
    {
      id: 'pending',
      icon: 'time-outline',
      text: `${selectedProgress?.pending ?? 0} ${t('Status_Pending')}`,
      tone: 'pending',
    },
  ];
  if (selectedPhotos > 0) {
    summaryItems.push({
      id: 'photos',
      icon: 'camera-outline',
      text: tFmt('Rn_CalendarPhotoCount', selectedPhotos),
      tone: 'neutral',
    });
  }
  /**
   * The spoken version of that row: the SAME sentence the page has always read out
   * ("1 done · 1 missed · 3 pending · 2 photos"), so the change is visual only for
   * a screen reader.
   */
  const selectedSummary = `${tFmt(
    'Rn_CalendarDaySummary',
    selectedProgress?.completed ?? 0,
    selectedProgress?.missed ?? 0,
    selectedProgress?.pending ?? 0,
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
      <View style={[styles.pageHead, largeText && styles.headStacked]}>
        <Text style={[styles.pageTitle, { color: colors.text }]} numberOfLines={1}>
          {t('Nav_Calendar')}
        </Text>
        {/* A WHITE outlined control instead of the filled accent wash: on this
            calmer board the only saturated things left are the selected day and
            the real status marks. 44 pt tall, so it needs no hit slop. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Calendar_Today')}
          onPress={goToToday}
          style={({ pressed }) => [
            styles.outlineAction,
            {
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
            },
          ]}>
          <MaterialIcon name="calendar-month-outline" size={17} color={colors.accent} />
          <Text style={[styles.actionText, { color: colors.accent }]} numberOfLines={1}>
            {t('Calendar_Today')}
          </Text>
        </Pressable>
      </View>

      {/* The month board: one FLAT 16 dp surface - a single hairline frame, no
          elevation - holding the month row, the seven weekday columns, the whole
          weeks of the real grid and the mark key. */}
      <View style={[styles.board, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Month navigation: the label on the left, two outlined arrows right. */}
        <View style={[styles.monthRow, largeText && styles.headStacked]}>
          <Text
            style={[styles.monthLabel, { color: colors.text }]}
            numberOfLines={largeText ? undefined : 1}>
            {formatMonthLabel(month)}
          </Text>
          <View style={styles.monthNav}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Calendar_PreviousMonth')}
              onPress={() => shiftMonth(-1)}
              style={({ pressed }) => [
                styles.monthArrow,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
                },
              ]}>
              <Icon name="chevron-back" size={21} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Calendar_NextMonth')}
              onPress={() => shiftMonth(1)}
              style={({ pressed }) => [
                styles.monthArrow,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
                },
              ]}>
              <Icon name="chevron-forward" size={21} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        <View style={styles.weekHeader}>
          {weekdays.map((weekday) => (
            <Text key={weekday} style={[styles.weekday, { color: colors.textSecondary }]}>
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
                    style={[styles.cell, { minHeight: cellHeight }]}>
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
                    <View
                      style={[styles.dayBadge, { width: badgeSize, height: badgeSize }]}>
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

        {/* One matching rule above the key, inset from BOTH card edges (10 dp of
            card padding + a 4 dp margin + the 1 dp frame), with ~10 dp of air
            before the legend. */}
        <View style={[styles.boardDivider, { backgroundColor: colors.cardDivider }]} />
        {/* A single compact key row: done / missed / pending with their dots,
            a separator, then "5 dots = 5 meals". It wraps at large text. */}
        <View style={styles.keyRow}>
          <View style={styles.keyItem}>
            <View style={[styles.keyDot, { backgroundColor: colors.done }]} />
            <Text style={[styles.keyText, { color: colors.textSecondary }]} numberOfLines={1}>
              {t('Status_Done')}
            </Text>
          </View>
          <View style={styles.keyItem}>
            <View style={[styles.keyDot, { backgroundColor: colors.missed }]} />
            <Text style={[styles.keyText, { color: colors.textSecondary }]} numberOfLines={1}>
              {t('Status_Missed')}
            </Text>
          </View>
          <View style={styles.keyItem}>
            <View style={[styles.keyDot, { backgroundColor: colors.pending }]} />
            <Text style={[styles.keyText, { color: colors.textSecondary }]} numberOfLines={1}>
              {t('Status_Pending')}
            </Text>
          </View>
          <View style={styles.keyCaption}>
            <View style={[styles.keySeparator, { backgroundColor: colors.cardDivider }]} />
            <Text style={[styles.footText, { color: colors.textSecondary }]} numberOfLines={1}>
              {t('Rn_CalendarDots')}
            </Text>
          </View>
        </View>
      </View>

      {/* Selected day: the heading and an outlined "Open day" action share ONE row,
          and the status/photo summary sits UNDER it on a full-width row of its own,
          so the counts never squeeze against the button. */}
      <View style={styles.selectedSection}>
        <View style={[styles.selectedHead, largeText && styles.headStacked]}>
          <Text
            style={[styles.selectedTitle, { color: colors.text }]}
            numberOfLines={largeText ? undefined : 1}>
            {formatCompactDayMonth(selected)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Calendar_OpenDay')}
            onPress={() => props.onOpenDay(selected)}
            style={({ pressed }) => [
              styles.outlineAction,
              {
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
              },
            ]}>
            <Text style={[styles.actionText, { color: colors.accent }]} numberOfLines={1}>
              {t('Calendar_OpenDay')}
            </Text>
            <Icon name="chevron-forward" size={16} color={colors.accent} />
          </Pressable>
        </View>
        {/* The rows read as ONE sentence to a screen reader (the same sentence the
            page has always spoken); visually they are real, wrapping items. */}
        <View style={styles.summary} accessible accessibilityLabel={selectedSummary}>
          {summaryItems.map((item) => (
            <View key={item.id} style={styles.summaryItem}>
              <Icon
                name={item.icon}
                size={14}
                color={
                  item.tone === 'neutral'
                    ? colors.textSecondary
                    : item.tone === 'done'
                      ? colors.done
                      : item.tone === 'missed'
                        ? colors.missed
                        : colors.pending
                }
              />
              <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
                {item.text}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Grouped agenda of the selected date: time | category icon | real
          title/detail | actual status, on a flat 16 dp surface. Its rules are inset
          to the row gutters and every row keeps a 56 dp floor and grows. */}
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
           * the description it really holds - it never prints "No meal recorded"
           * five times, and it never repeats the category as its own subtitle.
           */
          const hasTitle = slot.title !== '';
          const primary = hasTitle ? slot.title : name;
          const secondary = hasTitle
            ? name
            : slot.ingredients !== name
              ? slot.ingredients
              : '';
          // Photos are real data: show the line for them even when a slot has no
          // description at all, so a count is never silently dropped.
          const hasDetail = secondary !== '' || slot.photoCount > 0;
          return (
            <React.Fragment key={slot.mealCategoryKey}>
              {/* One 1 dp divider between every pair of rows, inset to the same
                  gutters as the content so it never touches the card's frame. */}
              {index > 0 && (
                <View style={[styles.agendaDivider, { backgroundColor: colors.cardDivider }]} />
              )}
              <View style={[styles.agendaRow, largeText && styles.agendaRowStacked]}>
                <View style={[styles.agendaMain, largeText && styles.agendaMainStacked]}>
                  {/* Time: aligned column on the left, widening with the text. */}
                  <Text
                    style={[
                      styles.agendaTime,
                      {
                        color: colors.textSecondary,
                        width: CAL.timeColumn * Math.max(1, fontScale),
                      },
                    ]}
                    numberOfLines={1}>
                    {time}
                  </Text>
                  {/* Icon tile: the same line icon the meal card wears. */}
                  <View style={[styles.agendaIcon, { backgroundColor: colors.surfaceVariant }]}>
                    <MaterialIcon
                      name={mealCategoryGlyph(slot.mealCategoryKey)}
                      size={AGENDA_GLYPH_SIZE}
                      color={colors.textSecondary}
                    />
                  </View>
                  {/* Text: title over category + photo count (or category alone).
                      Two lines normally, unlimited at large text - the row grows. */}
                  <View style={styles.copy}>
                    <Text
                      style={[styles.agendaTitle, { color: colors.text }]}
                      numberOfLines={largeText ? undefined : 2}>
                      {primary}
                    </Text>
                    {hasDetail && (
                      <View style={styles.agendaDetailRow}>
                        {secondary !== '' && (
                          <Text
                            style={[styles.agendaDetail, { color: colors.textSecondary }]}
                            numberOfLines={largeText ? undefined : 1}>
                            {secondary}
                          </Text>
                        )}
                        {slot.photoCount > 0 && (
                          <View style={styles.agendaPhotos}>
                            <Icon
                              name="camera-outline"
                              size={12}
                              color={colors.textSecondary}
                            />
                            <Text style={[styles.agendaDetail, { color: colors.textSecondary }]}>
                              {slot.photoCount}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </View>
                {/* Status badge: the real status, as a soft pill on the right. */}
                <View
                  style={[
                    styles.agendaPill,
                    largeText && styles.agendaPillStacked,
                    { backgroundColor: pill.fill },
                  ]}>
                  <Text style={[styles.agendaPillText, { color: pill.ink }]} numberOfLines={1}>
                    {statusLabel(slot.status)}
                  </Text>
                </View>
              </View>
            </React.Fragment>
          );
        })}
      </View>
    </ScrollView>
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
  content: { paddingHorizontal: metrics.pagePadding, paddingTop: 8 },
  pageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 12,
  },
  pageTitle: { ...pageTitleStyle, flexShrink: 1 },
  /** Large text: the head's two halves become two rows instead of colliding. */
  headStacked: { flexDirection: 'column', alignItems: 'flex-start', rowGap: 8 },
  /**
   * The ONE control silhouette of this page: a WHITE chip with a 1 dp neutral
   * frame, a 10 dp corner and a real 44 dp height - "Today" and "Open day" share
   * it, so neither needs a filled accent block or a hit-slop trick.
   */
  outlineAction: {
    minHeight: metrics.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: metrics.radiusSmall,
    borderWidth: 1,
  },
  actionText: { fontFamily: fonts.regular, fontSize: 14 },
  /**
   * The month board: a flat 16 dp surface - one hairline frame, NO elevation, and
   * 10 dp of padding all round (the reference's card padding).
   */
  board: {
    marginTop: 12,
    borderRadius: CAL.cardRadius,
    borderWidth: 1,
    padding: CAL.cardPadding,
  },
  /** Month navigation: label on the left, two outlined arrows on the right. */
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: CAL.controlGap,
    marginBottom: 4,
  },
  monthLabel: {
    flexShrink: 1,
    fontSize: CAL.monthSize,
    fontFamily: fonts.medium,
  },
  monthNav: { flexDirection: 'row', columnGap: CAL.controlGap },
  /** 44 x 44 outlined arrow: the real target, no hit slop needed. */
  monthArrow: {
    width: metrics.minTouch,
    height: metrics.minTouch,
    borderRadius: metrics.radiusSmall,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekHeader: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: CAL.weekdaySize, paddingVertical: 5 },
  /** Whole weeks of seven equal cells (no percentage drift). */
  grid: { rowGap: 1 },
  gridRow: { flexDirection: 'row' },
  /** A cell is at least 44 dp tall (set per row); the width follows the seven columns. */
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', rowGap: 3, paddingVertical: 1 },
  /**
   * The day badge is a CIRCLE whose size is set per render (32 dp at the default
   * scale, larger with the system text). Today RINGS it in the accent (the
   * ordinary day ink inside), the selected day FILLS it - the same silhouette
   * either way, and it stays round on every selection.
   */
  dayBadge: { alignItems: 'center', justifyContent: 'center' },
  /**
   * The selected day's fill: one absolutely filled circle INSIDE the badge, so it
   * is mounted fresh when the day appears. A background painted on an already
   * mounted badge loses its corner radius on Android and the day showed as a
   * square after a month change; this child cannot, because it never survives a
   * re-used cell (see the cell comment). Radius 100 keeps it a circle at any
   * badge size.
   */
  dayBadgeFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 100 },
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
    borderRadius: 100,
    borderWidth: 1.5,
  },
  dayNumber: {
    fontSize: 15,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
  /** Five slot marks in meal order: 5 x 5 pt dots, 2 pt apart. */
  marks: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: CAL.dotGap,
    height: CAL.dotSize,
    maxWidth: '100%',
  },
  mark: { width: CAL.dotSize, height: CAL.dotSize, borderRadius: CAL.dotSize / 2 },
  /**
   * Rule above the key: the board carries 10 dp of padding and a 1 dp frame, so a
   * 4 dp margin lands it ~15 dp in from the card's edge - inset from BOTH edges,
   * never a full-bleed line.
   */
  boardDivider: { height: 1, marginHorizontal: 4, marginTop: 8 },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 4,
    // 10 dp of air under the rule; the legend still sits close to the card floor.
    paddingTop: 10,
    paddingHorizontal: 4,
    paddingBottom: 2,
    flexWrap: 'wrap',
  },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  keyDot: { width: 6, height: 6, borderRadius: 3 },
  keyText: { fontSize: CAL.legendSize },
  /** Separator + caption travel together, so a wrapped key never strands the rule. */
  keyCaption: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', gap: 8 },
  keySeparator: { width: 1, height: 16, flexShrink: 0 },
  /** "5 dots = 5 meals" caption, pinned to the card's right edge. */
  footText: { fontSize: CAL.legendSize },
  /** Selected day: the heading row, then the full-width status/photo summary. */
  selectedSection: { marginTop: CAL.selectedTopGap },
  selectedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 10,
  },
  /** The shared text column of an agenda row. */
  copy: { flex: 1, minWidth: 0 },
  selectedTitle: {
    fontSize: CAL.selectedTitleSize,
    fontFamily: fonts.medium,
    flexShrink: 1,
  },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: CAL.summaryGap,
    rowGap: 6,
    marginTop: 6,
  },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryText: { fontFamily: fonts.regular, fontSize: CAL.summarySize },
  /** Grouped agenda: time | icon | text | status badge, on a flat 16 dp surface. */
  agenda: {
    marginTop: CAL.agendaTopGap,
    borderRadius: CAL.cardRadius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  /**
   * The rule between two rows: a lighter 1 dp line in the card's separator token,
   * INSET to the row gutters (14 dp) so it never touches the card's frame.
   */
  agendaDivider: { height: 1, marginHorizontal: CAL.agendaInset },
  agendaRow: {
    minHeight: CAL.agendaRowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: CAL.agendaRowGap,
    paddingHorizontal: CAL.agendaInset,
    paddingVertical: 10,
  },
  /** Large text: the status pill drops under the row instead of squeezing it. */
  agendaRowStacked: { flexDirection: 'column', alignItems: 'stretch', rowGap: 8 },
  agendaMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: CAL.agendaRowGap,
  },
  agendaMainStacked: { flex: 0, width: '100%' },
  /** The meal slot's own icon, in the same tile shape as a meal card. */
  agendaIcon: {
    width: CAL.categoryTile,
    height: CAL.categoryTile,
    borderRadius: CAL.categoryRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** 44 dp column at the default scale; it widens with the system text. */
  agendaTime: {
    fontSize: CAL.timeSize,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  agendaTitle: {
    fontSize: CAL.primarySize,
    fontFamily: fonts.medium,
    lineHeight: 20,
  },
  /** Detail line: category text + optional photo count, on one wrapping row. */
  agendaDetailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 4,
    marginTop: 2,
    minWidth: 0,
  },
  agendaDetail: { fontSize: CAL.secondarySize, lineHeight: 15, flexShrink: 1 },
  /** Camera glyph plus the photograph count, inline with the category. */
  agendaPhotos: { flexDirection: 'row', alignItems: 'center', columnGap: 3, flexShrink: 0 },
  /** Status badge: a soft pill on the right. */
  agendaPill: {
    alignSelf: 'center',
    borderRadius: metrics.radiusPill,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexShrink: 0,
  },
  agendaPillStacked: { alignSelf: 'flex-end' },
  agendaPillText: { fontSize: CAL.statusSize, fontFamily: fonts.medium },
});

