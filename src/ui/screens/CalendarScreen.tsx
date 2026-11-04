  // Calendar (spec 8.5) - THREE outlined blocks on the page wash, aligned and
  // 6 dp apart, with no fourth frame around them:
  //
  //   1. month strip   one 1 dp outline, arrow / centred month-year / arrow, with
  //                    equal arrow targets so the title is truly centred,
  //   2. weekday strip the same outline over a subtle neutral fill, 11 sp labels
  //                    centred over the seven date columns,
  //   3. date matrix   one 1 dp outline holding all real weeks, with the Done /
  //                    Missed / Pending key ATTACHED as its footer - a single
  //                    borderTop meets both side borders, so there is no doubled
  //                    rule, no detached divider and no gap.
  //
  // There are no per-cell borders and no heavy table lines: the selected day is
  // the filled accent circle with white text, TODAY is a thin outline drawn in
  // EVERY state - when another date is selected the outline is the accent, and
  // when today IS the selection the outline is drawn in the fill's own ink so the
  // two markers never cancel each other out. Both marks are child Views; a
  // background/border on a re-used cell loses its corner radius on Android.
  //
  // Opening a day: ONE tap selects immediately (no timer, nothing delayed), and a
  // SECOND completed tap of the same date within 300 ms calls the existing
  // props.onOpenDay with that exact tapped date. Long press and the cell's
  // accessibility "Open day" action do the same thing without a duplicate onPress.
  // Pending taps are cleared by the explicit controls (previous/next month, Today),
  // a drag, screen blur/unmount and an externally requested date - NOT by a month
  // change, because first-tapping a neighbouring month's day must still allow the
  // second tap on that same real date.
  //
  // A day with any decision shows its FIVE meal-slot marks (green done, red
  // missed, gray pending - the same three inks as the key) in meal-category order
  // below the date; an untouched day shows no marks at all, because a pending meal
  // never produced a figure. The agenda lists the five slots of the selected date
  // with the meal card's own line icon, an aligned time, the meal's title over its
  // category (or the CATEGORY alone when the slot has no title), its photograph
  // count and a small status badge (8 dp corners, like every other small control).
  // Photos and navigation are untouched: this page still only reads.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
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
 * Real touch target: Android asks for 48 dp, iOS' convention is 44 dp. The
 * visible graphics stay compact inside it - nothing here shrinks a target to fit
 * the design.
 */
const TOUCH = Platform.OS === 'android' ? 48 : 44;
/** The page gutter; it narrows (never below 4 dp) only so seven columns fit. */
const PAGE_INSET = metrics.pagePadding;
/** Narrowest grid that still gives every column a real target plus both frames. */
const GRID_MIN_WIDTH = 7 * TOUCH + 2;

/**
 * Geometry of the page (dp / sp) - the calendar reference tokens, scoped to this
 * screen. Nothing here changes date arithmetic, data or navigation: three 8 dp
 * blocks sit 6 dp apart, the day badge is 28 dp, and the status badges share the
 * 8 dp corners of every small outlined control.
 */
const CAL = {
  blockRadius: 8,
  monthSize: 20,
  controlVisible: 36,
  blockGap: 6,
  weekdayMinHeight: 28,
  weekdaySize: 11,
  cellMinHeight: TOUCH,
  dayBadgeSize: 28,
  dotSize: 5,
  dotGap: 2,
  legendSize: 11,
  legendInset: 8,
  legendPad: 6,
  dividerTopGap: 4,
  selectedTopGap: 10,
  summarySize: 12,
  summaryGap: 10,
  /** Air between the centred summary and the agenda card under it. */
  agendaTopGap: 4,
  agendaRowMinHeight: 52,
  agendaInset: 14,
  agendaRowGap: 10,
  timeColumn: 44,
  timeSize: 12,
  categoryTile: 30,
  categoryRadius: 8,
  primarySize: 15,
  secondarySize: 11,
  statusSize: 11,
  statusRadius: 8,
  doubleTapWindow: 300,
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
  /** The system text scale and the window width: the two things that resize it. */
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  /**
   * The page gutter narrows (never below 4 dp) only so seven platform-sized date
   * columns still fit: an ordinary phone keeps ONE seven-column grid and only a
   * genuinely narrow window falls back to horizontal panning.
   */
  const pageInset = Math.min(PAGE_INSET, Math.max(4, (windowWidth - GRID_MIN_WIDTH) / 2));
  const [innerWidth, setInnerWidth] = useState(0);
  /** Last completed date tap (component-local, never global) and its timestamp. */
  const lastTap = useRef<{ date: string; at: number } | null>(null);
  /** Set by a long press / accessibility open so the paired onPress is ignored. */
  const suppressPress = useRef(false);
  /**
   * Clears the pending tap pair. Called by the EXPLICIT actions only - the month
   * arrows, Today, a drag, blur/unmount and an externally requested date. It is
   * deliberately NOT tied to the month state: first-tapping a neighbouring
   * month's day moves the grid and must still allow the second tap on that date.
   */
  const resetTap = useCallback(() => {
    lastTap.current = null;
    suppressPress.current = false;
  }, []);
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

  /**
   * Leaving the tab (or unmounting) drops any half-finished tap pair. This is a
   * SEPARATE focus effect on purpose: the reload effect above re-runs whenever the
   * month changes, and a month change must never clear the pending pair - else the
   * second tap on a neighbouring month's day could never open it.
   */
  useFocusEffect(useCallback(() => resetTap, [resetTap]));

  // A background cycle that imported another device's records redraws the
  // month too, so a tab left open never shows a stale colour.
  useEffect(() => subscribeDataChange(() => void reload()), [reload]);

  const shiftMonth = (delta: number): void => {
    // An explicit month control ends any half-finished tap pair.
    resetTap();
    const year = Number(month.slice(0, 4));
    const next = new Date(year, Number(month.slice(5, 7)) - 1 + delta, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  /** Selects a date; a neighbouring month's day moves the grid with it. */
  const selectDate = (date: string): void => {
    // Setting the same month string is a no-op, so this never re-renders needlessly.
    setMonth(date.slice(0, 7));
    setSelected(date);
  };

  /**
   * ONE completed tap: the date is selected IMMEDIATELY (no timer, nothing
   * delayed), and the day opens only when the SAME date was completed again within
   * the 300 ms window - the exact tapped date, never a possibly stale selection.
   */
  const activateDate = (date: string): void => {
    if (suppressPress.current) {
      // This press belongs to the long press / accessibility open that just ran;
      // opening again would fire the callback twice.
      suppressPress.current = false;
      return;
    }
    const now = Date.now();
    const previous = lastTap.current;
    const elapsed = previous === null ? -1 : now - previous.at;
    const open =
      previous !== null &&
      previous.date === date &&
      elapsed >= 0 &&
      elapsed <= CAL.doubleTapWindow;
    // Assigned BEFORE the selection: a neighbouring-month tap re-renders the grid,
    // and the pair lives in refs, so it simply is never stale.
    lastTap.current = open ? null : { date, at: now };
    selectDate(date);
    if (open) {
      props.onOpenDay(date);
    }
  };

  /** Long press / accessibility "Open day": opens that exact date once. */
  const openDate = (date: string): void => {
    lastTap.current = null;
    suppressPress.current = true;
    selectDate(date);
    props.onOpenDay(date);
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
    // An externally requested date is a fresh arrival: no pending tap survives it.
    resetTap();
    setMonth(target.slice(0, 7));
    setSelected(target);
  }, [props.initialDate, props.initialDateRequestId, resetTap]);

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
   * Grid width: seven platform-sized columns plus both 1 dp frames, or the board's
   * own width when the page is wider. A narrower page pans instead of pressing a
   * cell under the touch target, and every real week stays visible.
   */
  const availableWidth =
    innerWidth > 0 ? innerWidth : Math.max(0, windowWidth - 2 * pageInset);
  const gridWidth = Math.max(GRID_MIN_WIDTH, availableWidth);
  /**
   * Day-mark geometry. The badge keeps its 28 dp circle at the default scale and
   * grows with the system text (capped at 1.4, the same cap the day number wears),
   * and the cell keeps at least the platform touch target - so a larger font makes
   * the matrix taller instead of clipping a date. No date arithmetic is involved.
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
        // The gutter narrows only when seven date columns would otherwise fall
        // under the platform touch target (see pageInset above).
        { paddingHorizontal: pageInset },
        // Air above the docked bar's divider (see src/ui/tabBar.ts): the agenda
        // never ends flush against it.
        { paddingBottom: TAB_BAR_CONTENT_GAP },
      ]}>
      <View style={styles.pageHead}>
        <Text style={[styles.pageTitle, { color: colors.text }]} numberOfLines={1}>
          {t('Nav_Calendar')}
        </Text>
      </View>

      {/* 1. Month strip: ONE neutral outline, arrow / centred month-year / arrow.
          Both arrow targets are the same width, so the title is truly centred. */}
      <View
        style={[styles.monthRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Calendar_PreviousMonth')}
          onPress={() => shiftMonth(-1)}
          style={styles.monthArrowTarget}>
          {({ pressed }) => (
            <View style={[styles.monthArrow, pressed && { backgroundColor: colors.surfaceVariant }]}>
              <Icon name="chevron-back" size={19} color={colors.textSecondary} />
            </View>
          )}
        </Pressable>
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={[styles.monthLabel, { color: colors.text }]}
          numberOfLines={largeText ? undefined : 1}>
          {formatMonthLabel(month)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Calendar_NextMonth')}
          onPress={() => shiftMonth(1)}
          style={styles.monthArrowTarget}>
          {({ pressed }) => (
            <View style={[styles.monthArrow, pressed && { backgroundColor: colors.surfaceVariant }]}>
              <Icon name="chevron-forward" size={19} color={colors.textSecondary} />
            </View>
          )}
        </Pressable>
      </View>

      {/* 2 + 3. The weekday strip and the date matrix, aligned on the same border
          box: a narrower window pans this pair instead of compressing a column
          below the platform touch target. */}
      <View onLayout={(event) => setInnerWidth(event.nativeEvent.layout.width)}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={resetTap}>
          <View style={{ width: gridWidth }}>
            <View
              style={[
                styles.weekHeader,
                { borderColor: colors.border, backgroundColor: colors.surfaceVariant },
              ]}>
              {weekdays.map((weekday) => (
                <Text key={weekday} style={[styles.weekday, { color: colors.textSecondary }]}>
                  {weekday}
                </Text>
              ))}
            </View>

            <View
              style={[
                styles.dateMatrix,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}>
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
                    accessibilityHint={t('Rn_CalendarSelectHint')}
                    accessibilityActions={[{ name: 'openDay', label: t('Calendar_OpenDay') }]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === 'openDay') {
                        openDate(cell.date);
                      }
                    }}
                    // A fresh gesture re-arms the pair, so a long press never
                    // swallows the NEXT intentional tap.
                    onPressIn={() => {
                      suppressPress.current = false;
                    }}
                    onPress={() => activateDate(cell.date)}
                    onLongPress={() => openDate(cell.date)}
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

              {/* The key is the matrix's own FOOTER: ONE 1 dp borderTop spans the
                  interior and meets both side borders - no doubled line, no
                  detached divider and no gap between the grid and its legend. */}
              <View style={[styles.legend, { borderTopColor: colors.cardDivider }]}>
                <View style={styles.legendItem}>
                  <View style={[styles.keyDot, { backgroundColor: colors.done }]} />
                  <Text
                    style={[styles.legendText, { color: colors.textSecondary }]}
                    numberOfLines={1}>
                    {t('Status_Done')}
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.keyDot, { backgroundColor: colors.missed }]} />
                  <Text
                    style={[styles.legendText, { color: colors.textSecondary }]}
                    numberOfLines={1}>
                    {t('Status_Missed')}
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.keyDot, { backgroundColor: colors.pending }]} />
                  <Text
                    style={[styles.legendText, { color: colors.textSecondary }]}
                    numberOfLines={1}>
                    {t('Status_Pending')}
                  </Text>
                </View>
                <View style={styles.legendCaption}>
                  <View style={[styles.legendSeparator, { backgroundColor: colors.cardDivider }]} />
                  <Text
                    style={[styles.legendText, { color: colors.textSecondary }]}
                    numberOfLines={1}>
                    {t('Rn_CalendarDots')}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Selected day: the real summary only. The old heading row (the compact
          date plus its "double-tap a date to open" hint) is gone - the selected
          cell in the grid IS the date, and a second tap of it (or a long press /
          the accessibility action) still opens the day. Removing the row hands
          that height back to the agenda. */}
      <View style={styles.selectedSection}>
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
  /** Page frame; the horizontal gutter and bottom padding are set at render time. */
  content: { paddingTop: 8 },
  pageHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pageTitle: { ...pageTitleStyle, flexShrink: 1 },

  /** 1. Month strip: one outline, equal arrow targets, a centred title. */
  monthRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH,
    borderWidth: 1,
    borderRadius: CAL.blockRadius,
  },
  /** Platform-sized and EQUAL on both sides, so the title is truly centred. */
  monthArrowTarget: {
    width: TOUCH,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The visible 36 dp pressed area inside that target. */
  monthArrow: {
    width: CAL.controlVisible,
    height: CAL.controlVisible,
    borderRadius: CAL.blockRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    paddingHorizontal: 4,
    fontSize: CAL.monthSize,
    fontFamily: fonts.medium,
  },

  /** 2. Weekday strip: the same outline over a subtle neutral fill. */
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: CAL.weekdayMinHeight,
    borderWidth: 1,
    borderRadius: CAL.blockRadius,
    marginTop: CAL.blockGap,
  },
  weekday: { flex: 1, textAlign: 'center', fontSize: CAL.weekdaySize, paddingVertical: 3 },

  /** 3. Date matrix: one outline, every real week, the key attached as its foot. */
  dateMatrix: {
    borderWidth: 1,
    borderRadius: CAL.blockRadius,
    overflow: 'hidden',
    marginTop: CAL.blockGap,
  },
  gridRow: { flexDirection: 'row' },
  /** A cell is at least the platform target tall (set per row); NO cell borders. */
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', rowGap: 3, paddingVertical: 1 },
  dayBadge: { alignItems: 'center', justifyContent: 'center' },
  dayBadgeFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 100 },
  dayBadgeRing: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 100,
    borderWidth: 1.5,
  },
  dayNumber: { fontSize: 15, fontFamily: fonts.medium, fontVariant: ['tabular-nums'] },
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
   * The key, ATTACHED to the matrix: one 1 dp borderTop spans the whole interior
   * and meets both side borders - no inset rule, no second line, no gap.
   */
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 4,
    borderTopWidth: 1,
    marginTop: CAL.dividerTopGap,
    paddingHorizontal: CAL.legendInset,
    paddingVertical: CAL.legendPad,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  keyDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: CAL.legendSize, fontFamily: fonts.regular },
  /** Separator + caption travel together, so a wrapped key never strands the rule. */
  legendCaption: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', gap: 8 },
  legendSeparator: { width: 1, height: 16, flexShrink: 0 },

  /**
   * Selected day: the real summary, CENTRED over the agenda card so it reads as
   * a caption for the day's list rather than a left-aligned stray line. It wraps
   * (and keeps centring) when the counts no longer fit on one line.
   */
  selectedSection: { marginTop: CAL.selectedTopGap },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: CAL.summaryGap,
    rowGap: 6,
    marginTop: 4,
  },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryText: { fontFamily: fonts.regular, fontSize: CAL.summarySize },
  /** Grouped agenda: time | icon | text | status badge, on a flat card. */
  agenda: {
    marginTop: CAL.agendaTopGap,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  /** The rule between two rows: inset to the row gutters, never on the frame. */
  agendaDivider: { height: 1, marginHorizontal: CAL.agendaInset },
  agendaRow: {
    minHeight: CAL.agendaRowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: CAL.agendaRowGap,
    paddingHorizontal: CAL.agendaInset,
    paddingVertical: 10,
  },
  /** Large text: the status badge drops under the row instead of squeezing it. */
  agendaRowStacked: { flexDirection: 'column', alignItems: 'stretch', rowGap: 8 },
  agendaMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: CAL.agendaRowGap,
  },
  agendaMainStacked: { flex: 0, width: '100%' },
  /** The shared text column of an agenda row. */
  copy: { flex: 1, minWidth: 0 },
  /** The meal slot's own icon, in the same tile shape as a meal card. */
  agendaIcon: {
    width: CAL.categoryTile,
    height: CAL.categoryTile,
    borderRadius: CAL.categoryRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  /** Status badge: the SAME 8 dp corners as every other small control. */
  agendaPill: {
    alignSelf: 'center',
    borderRadius: CAL.statusRadius,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  agendaPillStacked: { alignSelf: 'flex-end' },
  agendaPillText: { fontSize: CAL.statusSize, fontFamily: fonts.medium },
});
