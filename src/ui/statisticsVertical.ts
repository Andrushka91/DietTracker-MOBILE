// Statistics page values (the approved vertical-bar design).
//
// dp for layout, sp for text. Local to Statistics: the palette still comes from
// `theme.ts`, so light/dark, the state colours and the accent stay in step with
// the rest of the app. Nothing here is a global theme change.
//
// ONE page number: `STATISTICS_GUTTER`. It is the left margin, the right margin,
// the top inset (after the navigator's safe area) and the gap between every card
// on the page - the same 8 dp the approved Home and Templates pages use, so the
// three pages read as one app.

/** One gutter for the page edges and every gap between cards, in dp. */
export const STATISTICS_GUTTER = 8;

export const statisticsVerticalTokens = {
  gutter: STATISTICS_GUTTER,
  cardRadius: 16,
  controlRadius: 8,
  cardPadding: 12,
  /** The chart is inset less than the card text, so seven real targets fit. */
  chartPadding: 8,
  border: 1,
  titleSize: 24,
  titleLine: 32,
  bodySize: 12,
  bodyLine: 18,
  sectionSize: 14,
  sectionLine: 20,
  headingSize: 17,
  headingLine: 24,
  percentSize: 36,
  percentLine: 44,
  fractionSize: 16,
  fractionLine: 22,
  metricSize: 14,
  metricLine: 20,
  touchAndroid: 48,
  touchIOS: 44,
  visibleControl: 36,
  modeLabelSize: 13,
  modeLine: 20,
  modeInset: 4,
  modeGap: 4,
  segmentCheck: 14,
  periodSize: 14,
  periodLine: 20,
  arrowSize: 20,
  infoSize: 18,
  iconGap: 4,
  countGap: 16,
  chartHeight: 160,
  axisWidth: 20,
  columnWidth: 48,
  mealColumnWidth: 56,
  rangeColumnWidth: 76,
  barWidth: 18,
  barRadius: 3,
  valueMinHeight: 24,
  labelMinHeight: 40,
  chartLabelSize: 11,
  chartLabelLine: 16,
  columnBorder: 1,
  chartScrollHintSize: 11,
  chartScrollHintLine: 16,
  selectionPadding: 12,
  disclosureIcon: 18,
  /**
   * Month-chart columns: the minimum TARGET, the gap between two targets, and
   * the real scroll-content gutter at both ends when the columns overflow. The
   * month columns are distributed across the measured viewport instead of using
   * one fixed width, so all six clipped weeks of a month can fit on a phone.
   */
  monthColumnMinWidth: 48,
  monthColumnGap: 4,
  monthEdgePadding: 8,
  /** The Today shortcut beside the page title: a small neutral outline. */
  todayMinWidth: 64,
  todaySize: 13,
  todayLine: 20,
  todayPaddingX: 10,
  todayPaddingY: 6,
} as const;
