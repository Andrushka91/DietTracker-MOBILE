// Home's LOCAL compact tokens (the approved v3 reference).
//
// dp for layout, sp for text. Nothing here is a global theme change: the values
// describe the dashboard header (date row, progress ring and metrics, day
// actions) and the page frame around the five meal cards. Meal cards, the tab
// bar and every other screen keep their own metrics.
//
// There is exactly ONE number for page spacing: `HOME_CARD_GUTTER`. It is the
// content's left margin, its right margin, its top margin (AFTER the system
// safe area), the gap between the header card and the first meal card AND the
// gap between every pair of meal cards. Measuring one distance therefore keeps
// the header and the meal cards at the same outer width on a phone.

/** One source for the page edges and every vertical card gap, in dp. */
export const HOME_CARD_GUTTER = 8;

/** The Home header's dimensions (dp) and its typography (sp). */
export const homeCompact = {
  headerRadius: 16,
  border: 1,
  paddingX: 10,
  paddingY: 6,
  /** Android / iOS minimum touch targets; the visible controls are smaller. */
  touchAndroid: 48,
  touchIOS: 44,
  /** The date row's floor: 20 dp date + 2 dp + 16 dp caption still fits. */
  dateMinHeight: 48,
  dateSize: 15,
  dateLine: 20,
  todaySize: 11,
  todayLine: 16,
  dateCaptionGap: 2,
  progressGapTop: 4,
  ringSize: 64,
  ringStroke: 6,
  ringLegendGap: 8,
  fractionSize: 18,
  fractionLine: 24,
  ringCaptionSize: 11,
  ringCaptionLine: 14,
  metricMinHeight: 56,
  metricSize: 20,
  metricLine: 26,
  metricLabelSize: 12,
  metricLabelLine: 18,
  metricIcon: 16,
  metricGap: 4,
  metricPaddingX: 4,
  dividerHeight: 24,
  actionsGapTop: 4,
  actionsGap: 8,
  controlRadius: 8,
  controlVisibleMinHeight: 32,
  controlPaddingY: 5,
  controlPaddingX: 10,
  controlLabelSize: 13,
  controlLabelLine: 20,
  controlIcon: 16,
  controlIconGap: 6,
  disabledOpacity: 0.45,
  arrowIcon: 22,
  /** Header-to-first-card, card-to-card and page-edge distances, all equal. */
  listGapTop: HOME_CARD_GUTTER,
  mealGap: HOME_CARD_GUTTER,
  pagePaddingX: HOME_CARD_GUTTER,
  pagePaddingTop: HOME_CARD_GUTTER,
  /** Below this width - or above this font scale - actions stack full width. */
  stackWidth: 350,
  stackFontScale: 1.2,
  stackedMetricMinHeight: 44,
  footerGap: 8,
  noteSize: 12,
  noteLine: 18,
} as const;

/**
 * The "Today" caption's ink. It is NOT a new global theme colour: the word
 * already says today, and the restrained indigo only reinforces it. Light ink
 * on the white card, the lighter indigo on the dark card.
 */
export const homeTodayInk = {
  light: '#4655D6',
  dark: '#ADB5FF',
} as const;
