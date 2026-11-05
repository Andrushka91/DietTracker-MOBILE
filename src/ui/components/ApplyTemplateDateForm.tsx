// The Apply-template RANGE form's PRESENTATION: two inclusive endpoint fields,
// the shared month calendar with the chosen range drawn on it, the inclusive
// summary, the two answers and the truthful progress/partial-result block.
//
// It is CONTROLLED and owns no draft: the Start/End values, which endpoint's
// calendar is open, the error, the run progress and the result all live in
// `PromptDialog`, and this component only draws them and reports the events. It
// is not another Modal and not a picker dependency - the calendar comes from the
// app's own `monthGrid` (Monday-first whole weeks) and the app's own formatters.
//
// The calendar is the ONE input method here: there is no typed fallback, no
// keyboard and no mode link. Choosing a day writes that endpoint and nothing
// else - the template is applied by the final answer alone.
//
// Every day is at least 48 dp and grows with the system text. Seven of those
// columns do not fit on a phone, so weekday captions and day cells share ONE
// horizontally scrolling viewport: nothing is squeezed below the touch target and
// the visible scrollbar says the rest of the week is a swipe away.

import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';

import { monthGrid } from '../calendarGrid';
import { isCalendarDate } from '../dates';
import { accentActionColors } from '../accentActions';
import { templateRangeDays, type TemplateRangeResult } from '../../services/applyTemplateRange';
import { fonts, themeColors } from '../theme';
import { formatLongDate, formatMediumDate, formatMonthLabel, t, tFmt } from '../strings';
import {
  templateActionInk,
  templateRangeTokens as range,
  templatesCalendarTokens as tpl,
} from '../templatesCalendar';
import { Icon } from './icons';

/** Which end of the range the calendar is editing. */
export type RangeEndpoint = 'start' | 'end';

/** "5 November 2026": the app's own medium date, or the raw value if unusable. */
function dateLabel(iso: string): string {
  return isCalendarDate(iso) ? formatMediumDate(iso) : iso;
}

/** "1 day" / "7 days" - the singular is its own string, never "1 days". */
function dayCountLabel(days: number): string {
  return days === 1 ? t('Rn_TemplateRangeDayOne') : tFmt('Rn_TemplateRangeDayMany', days);
}

export interface ApplyTemplateDateFormProps {
  dark: boolean;
  /** The endpoint whose calendar is expanded, or null when both are collapsed. */
  openEndpoint: RangeEndpoint | null;
  /** The two inclusive endpoints ('yyyy-MM-dd'). */
  startValue: string;
  endValue: string;
  /** The device-local current day ('yyyy-MM-dd'). */
  today: string;
  /** The rule that was broken (invalid day / reversed range), or null. */
  error: string | null;
  /** Which field the error belongs to, so it can wear the error frame. */
  errorEndpoint: RangeEndpoint | null;
  /** The displayed month of the expanded calendar ('yyyy-MM'). */
  month: string;
  /** True while the range is being applied: everything is locked but Close. */
  busy: boolean;
  /** Completed days so far, for the determinate progress line. */
  progress: { done: number; total: number } | null;
  /** A settled PARTIAL result: the sheet stays open with one Close action. */
  result: TemplateRangeResult | null;
  cancelText: string;
  onOpenEndpoint: (endpoint: RangeEndpoint) => void;
  /** Writes ONE endpoint and moves to the next step. Never confirms. */
  onChooseDate: (iso: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ApplyTemplateDateForm(props: ApplyTemplateDateFormProps): React.JSX.Element {
  const colors = themeColors(props.dark);
  const ink = templateActionInk[props.dark ? 'dark' : 'light'];
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < tpl.stackWidth || fontScale > tpl.stackFont;
  const target = Platform.OS === 'ios' ? tpl.touchIOS : tpl.touchAndroid;
  /** Day cells keep at least 48 dp and grow with the system text. */
  const cellSize = Math.ceil(tpl.calendarCell * Math.max(1, fontScale));
  const grid = monthGrid(props.month);
  const rows: string[][] = [];
  for (let start = 0; start < grid.dates.length; start += 7) {
    rows.push(grid.dates.slice(start, start + 7));
  }
  /** Weekday captions come from the resource file ("Mo Tu We ..."), Monday first. */
  const weekdays = t('Calendar_Weekdays').split(/\s+/).filter((name) => name !== '');
  /**
   * The range is only counted when both endpoints are real days IN ORDER; an
   * incomplete or reversed pair shows no count and says what to fix instead.
   */
  const validRange =
    isCalendarDate(props.startValue) &&
    isCalendarDate(props.endValue) &&
    props.endValue >= props.startValue;
  const days = validRange
    ? templateRangeDays({ startDate: props.startValue, endDate: props.endValue })
    : null;
  /** The final answer names exactly how many days it will write. */
  const applyLabel =
    days === null
      ? t('Rn_TemplateApplyConfirm')
      : days === 1
        ? t('Rn_TemplateApplyRangeOne')
        : tFmt('Rn_TemplateApplyRangeMany', days);
  /** A settled partial result replaces the answers with one Close action. */
  const finished = props.result !== null && props.result.kind === 'partial';
  const startRef = useRef<React.ElementRef<typeof View> | null>(null);
  const endRef = useRef<React.ElementRef<typeof View> | null>(null);
  const lastEndpoint = useRef<RangeEndpoint | null>(null);

  /**
   * The Start -> End hand-off, for screen readers: opening an endpoint's calendar
   * (or moving on to the next one) hands accessibility focus to the field being
   * edited, so the two-step choice needs no separate instruction.
   */
  useEffect(() => {
    if (props.openEndpoint !== null) {
      lastEndpoint.current = props.openEndpoint;
    }
    const endpoint = props.openEndpoint ?? lastEndpoint.current;
    if (endpoint === null || props.busy) {
      return;
    }
    const tag = findNodeHandle(endpoint === 'start' ? startRef.current : endRef.current);
    if (typeof tag === 'number') {
      AccessibilityInfo.setAccessibilityFocus(tag);
    }
  }, [props.openEndpoint, props.busy]);

  /** One endpoint: its name, the day it holds, and whether it is being edited. */
  const field = (endpoint: RangeEndpoint, label: string, value: string): React.JSX.Element => {
    const active = props.openEndpoint === endpoint;
    const invalid = props.errorEndpoint === endpoint && props.error !== null;
    return (
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
        <Pressable
          ref={endpoint === 'start' ? startRef : endRef}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityValue={{ text: dateLabel(value) }}
          accessibilityState={{ expanded: active, disabled: props.busy }}
          disabled={props.busy}
          onPress={() => props.onOpenEndpoint(endpoint)}
          style={[styles.fieldTarget, { minHeight: target }]}>
          <View
            style={[
              styles.fieldOutline,
              {
                backgroundColor: colors.surface,
                borderColor: invalid ? colors.error : active ? ink.apply : colors.border,
                borderWidth: active ? range.activeBorder : tpl.border,
              },
            ]}>
            <Icon
              name="calendar-outline"
              size={tpl.icon}
              color={active ? ink.apply : colors.textSecondary}
            />
            {/* No line cap: at large text a long date wraps inside its field
                instead of being cut, and the control simply grows. */}
            <Text style={[styles.fieldDate, { color: colors.text }]}>{dateLabel(value)}</Text>
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.body}>
      <View style={[styles.fields, stacked && styles.fieldsStacked]}>
        {field('start', t('Rn_TemplateStartDate'), props.startValue)}
        {field('end', t('Rn_TemplateEndDate'), props.endValue)}
      </View>
      {days !== null && (
        <>
          {/* The inclusive count in words: "5 November 2026 – 11 November 2026 · 7 days". */}
          <Text accessibilityLiveRegion="polite" style={[styles.summary, { color: colors.text }]}>
            {tFmt(
              'Rn_TemplateRangeSummary',
              dateLabel(props.startValue),
              dateLabel(props.endValue),
              dayCountLabel(days),
            )}
          </Text>
          <Text style={[styles.helper, { color: colors.textMuted }]}>
            {t('Rn_TemplateRangeSamePlan')}
          </Text>
        </>
      )}
      {props.error !== null && (
        <Text
          testID="prompt-dialog-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.helper, { color: colors.error }]}>
          {props.error}
        </Text>
      )}
      {props.busy && (
        <Text accessibilityLiveRegion="polite" style={[styles.summary, { color: colors.text }]}>
          {tFmt(
            'Rn_TemplateRangeProgress',
            props.progress?.done ?? 0,
            props.progress?.total ?? days ?? 0,
          )}
        </Text>
      )}
      {props.result !== null && props.result.kind === 'partial' && (
        <View style={styles.result}>
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.summary, { color: colors.text }]}>
            {tFmt('Rn_TemplateRangePartial', props.result.completedDays, props.result.totalDays)}
          </Text>
          {/* The failed day's own applier may already have written some meals. */}
          <Text style={[styles.helper, { color: colors.textMuted }]}>
            {tFmt('Rn_TemplateRangePartialFailed', formatLongDate(props.result.failedDate))}
          </Text>
          {props.result.unattemptedDays > 0 && (
            <Text style={[styles.helper, { color: colors.textMuted }]}>
              {tFmt('Rn_TemplateRangePartialUnattempted', props.result.unattemptedDays)}
            </Text>
          )}
        </View>
      )}
      {props.openEndpoint !== null && (
        <View style={styles.calendar}>
          <View style={styles.monthRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Calendar_PreviousMonth')}
              onPress={props.onPreviousMonth}
              disabled={props.busy}
              style={[styles.monthArrow, { minWidth: target, minHeight: target }]}>
              <Icon name="chevron-back" size={tpl.icon} color={colors.textSecondary} />
            </Pressable>
            {/* Navigating the month changes NOTHING but the grid on screen. */}
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              style={[styles.monthLabel, { color: colors.text }]}>
              {formatMonthLabel(props.month)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Calendar_NextMonth')}
              onPress={props.onNextMonth}
              disabled={props.busy}
              style={[styles.monthArrow, { minWidth: target, minHeight: target }]}>
              <Icon name="chevron-forward" size={tpl.icon} color={colors.textSecondary} />
            </Pressable>
          </View>
          {/* ONE viewport for the captions AND the cells, so a row can never
              drift apart on a narrow screen. */}
          <ScrollView
            horizontal
            accessibilityHint={t('Rn_TemplateCalendarHint')}
            showsHorizontalScrollIndicator
            keyboardShouldPersistTaps="handled">
            <View style={{ width: cellSize * 7 }}>
              <View style={styles.week}>
                {weekdays.map((label, index) => (
                  <Text
                    key={`${label}-${index}`}
                    accessible={false}
                    style={[styles.weekday, { width: cellSize, color: colors.textMuted }]}>
                    {label}
                  </Text>
                ))}
              </View>
              {rows.map((week, weekIndex) => (
                <View key={`week-${weekIndex}`} style={styles.week}>
                  {week.map((iso) => {
                    const isStart = iso === props.startValue;
                    const isEnd = iso === props.endValue;
                    const inRange =
                      days !== null && iso >= props.startValue && iso <= props.endValue;
                    const inside = inRange && !isStart && !isEnd;
                    const today = iso === props.today;
                    /** Start / End / In range / Today are separate, named states. */
                    const words: string[] = [];
                    if (isStart && isEnd) {
                      words.push(t('Rn_TemplateRangeA11yStartEnd'));
                    } else if (isStart) {
                      words.push(t('Rn_TemplateRangeA11yStart'));
                    } else if (isEnd) {
                      words.push(t('Rn_TemplateRangeA11yEnd'));
                    } else if (inside) {
                      words.push(t('Rn_TemplateRangeA11yInside'));
                    }
                    if (today) {
                      words.push(t('Calendar_Today'));
                    }
                    return (
                      <Pressable
                        key={iso}
                        accessibilityRole="button"
                        accessibilityLabel={
                          words.length === 0
                            ? formatLongDate(iso)
                            : `${formatLongDate(iso)}, ${words.join(', ')}`
                        }
                        accessibilityState={{ selected: inRange, disabled: props.busy }}
                        disabled={props.busy}
                        onPress={() => props.onChooseDate(iso)}
                        style={({ pressed }) => [
                          styles.day,
                          {
                            width: cellSize,
                            minHeight: cellSize,
                            backgroundColor:
                              isStart || isEnd
                                ? ink.daySelected
                                : inside
                                  ? ink.inRange
                                  : pressed
                                    ? colors.surfaceVariant
                                    : 'transparent',
                            borderColor:
                              isStart || isEnd
                                ? ink.apply
                                : today && !inRange
                                  ? ink.todayBorder
                                  : 'transparent',
                            borderWidth: isStart || isEnd ? tpl.selectedBorder : tpl.todayBorder,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.dayText,
                            (isStart || isEnd) && styles.daySelectedText,
                            {
                              color:
                                isStart || isEnd
                                  ? ink.apply
                                  : inRange || iso.slice(0, 7) === props.month
                                    ? colors.text
                                    : colors.textMuted,
                            },
                          ]}>
                          {String(Number(iso.slice(8, 10)))}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
      {/* The answers keep their own 1 pt rule. While the range is being written
          every control is locked: there is no Cancel that would pretend to undo
          days already applied. */}
      <View
        style={[styles.footer, stacked && styles.footerStacked, { borderTopColor: colors.border }]}>
        {finished && props.result !== null && props.result.kind === 'partial' ? (
          /* A settled failure is a REPORT: one Close. No second Apply, no retry,
             and no Cancel implying a rollback. */
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Rn_TemplateRangeClose')}
            onPress={props.onCancel}
            style={[styles.closeTarget, stacked && styles.buttonStacked, { minHeight: target }]}>
            {({ pressed }) => (
              <View
                style={[
                  styles.button,
                  styles.closeVisible,
                  stacked && styles.buttonStacked,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
                  },
                ]}>
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  {t('Rn_TemplateRangeClose')}
                </Text>
              </View>
            )}
          </Pressable>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={props.cancelText}
              accessibilityState={{ disabled: props.busy }}
              disabled={props.busy}
              onPress={props.onCancel}
              style={[
                styles.cancelTarget,
                stacked && styles.buttonStacked,
                { minHeight: target },
                props.busy && styles.subdued,
              ]}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.button,
                    styles.cancelVisible,
                    stacked && styles.buttonStacked,
                    {
                      borderColor: ink.cancelBorder,
                      backgroundColor: pressed ? ink.cancelPressed : ink.cancelFill,
                    },
                  ]}>
                  <Text style={[styles.buttonText, { color: ink.cancel }]} numberOfLines={2}>
                    {props.cancelText}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={applyLabel}
              accessibilityState={{ disabled: props.busy }}
              disabled={props.busy}
              onPress={props.onConfirm}
              style={[
                styles.applyTarget,
                stacked && styles.buttonStacked,
                { minHeight: target },
                props.busy && styles.subdued,
              ]}>
              {({ pressed }) => {
                const action = accentActionColors(colors, pressed);
                return (
                  <View
                    style={[
                      styles.button,
                      styles.applyVisible,
                      stacked && styles.buttonStacked,
                      {
                        borderColor: action.border,
                        backgroundColor: action.fill,
                      },
                    ]}>
                    <Text
                      style={[styles.buttonText, styles.applyText, { color: action.foreground }]}
                      numberOfLines={2}>
                      {applyLabel}
                    </Text>
                  </View>
                );
              }}
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** The form's body: the two endpoint fields, the summary, then the calendar. */
  body: { paddingHorizontal: 16, marginTop: tpl.sectionGap },
  /** Both fields share one row on a phone; they wrap instead of clipping. */
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: range.fieldGap },
  fieldsStacked: { flexDirection: 'column' },
  field: { flexGrow: 1, flexBasis: range.fieldMinWidth, minWidth: 0 },
  fieldLabel: {
    fontFamily: fonts.regular,
    fontSize: tpl.meta,
    lineHeight: tpl.metaLine,
    marginBottom: tpl.labelGap,
  },
  fieldTarget: { justifyContent: 'center', paddingVertical: tpl.controlPaddingY },
  /** 36 dp visible control inside the real 48/44 dp target, 8 dp corners. */
  fieldOutline: {
    minHeight: range.fieldVisibleMin,
    borderRadius: tpl.controlRadius,
    paddingHorizontal: tpl.controlPaddingX,
    paddingVertical: tpl.controlPaddingY,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tpl.iconGap,
  },
  fieldDate: {
    flexShrink: 1,
    fontFamily: fonts.regular,
    fontSize: tpl.dateText,
    lineHeight: tpl.dateLine,
  },
  /** The inclusive count is the loudest line: it says what Apply will write. */
  summary: {
    fontFamily: fonts.medium,
    fontSize: tpl.meta,
    lineHeight: tpl.metaLine,
    marginTop: tpl.sectionGap,
  },
  helper: {
    fontFamily: fonts.regular,
    fontSize: tpl.meta,
    lineHeight: tpl.metaLine,
    marginTop: tpl.labelGap,
  },
  result: { marginTop: tpl.sectionGap },
  calendar: { marginTop: tpl.sectionGap },
  monthRow: { flexDirection: 'row', alignItems: 'center' },
  monthArrow: { justifyContent: 'center', alignItems: 'center' },
  monthLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: tpl.dateText,
    lineHeight: tpl.dateLine,
    textAlign: 'center',
  },
  week: { flexDirection: 'row' },
  weekday: {
    fontFamily: fonts.regular,
    fontSize: tpl.weekday,
    lineHeight: tpl.calendarCaptionLine,
    textAlign: 'center',
  },
  /** One day: never below the 48 dp cell, 8 dp corners, its own frame. */
  day: {
    borderRadius: tpl.controlRadius,
    justifyContent: 'center',
    alignItems: 'center',
    padding: tpl.labelGap,
  },
  dayText: { fontFamily: fonts.regular, fontSize: tpl.day, lineHeight: tpl.dayLine },
  /** An endpoint is bold as well as outlined: never colour alone. */
  daySelectedText: { fontFamily: fonts.bold },
  /** The two answers: one inset rule, right aligned, 8 dp apart. */
  footer: {
    marginTop: tpl.sectionGap,
    paddingTop: tpl.labelGap,
    borderTopWidth: tpl.border,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: tpl.actionGap,
  },
  footerStacked: { flexDirection: 'column' },
  /** Locked while the range is being written - dimmed, never repainted. */
  subdued: { opacity: tpl.disabledOpacity },
  cancelTarget: {
    minWidth: tpl.cancelMinWidth,
    justifyContent: 'center',
    paddingVertical: tpl.controlPaddingY,
  },
  applyTarget: {
    minWidth: tpl.applyMinWidth,
    justifyContent: 'center',
    paddingVertical: tpl.controlPaddingY,
  },
  /** The settled failure's single answer, the same size as Apply. */
  closeTarget: {
    minWidth: tpl.applyMinWidth,
    justifyContent: 'center',
    paddingVertical: tpl.controlPaddingY,
  },
  buttonStacked: { width: '100%' },
  /** 36 dp visible control inside the real target, 8 dp corners. */
  button: {
    minHeight: tpl.visibleControl,
    borderWidth: tpl.border,
    borderRadius: tpl.controlRadius,
    paddingHorizontal: tpl.controlPaddingX,
    paddingVertical: tpl.controlPaddingY,
    justifyContent: 'center',
    alignItems: 'center',
  },
  /** Content-driven minimum widths: the label plus its padding, never a split. */
  cancelVisible: { minWidth: tpl.cancelMinWidth },
  applyVisible: { minWidth: tpl.applyMinWidth },
  closeVisible: { minWidth: tpl.applyMinWidth },
  buttonText: {
    fontFamily: fonts.regular,
    fontSize: tpl.controlText,
    lineHeight: tpl.controlLine,
    textAlign: 'center',
  },
  /** "Apply to N days" keeps the semibold weight of the write action. */
  applyText: { fontFamily: fonts.medium },
});
