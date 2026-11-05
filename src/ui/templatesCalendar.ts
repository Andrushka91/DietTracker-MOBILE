// Templates + Apply-template picker tokens (the approved reference).
//
// Layout dp, text sp. Local presentation values only: the neutral colours still
// come from `theme.ts` (both palettes already match the reference exactly), so
// this module adds the ONE page gutter, the dimensions of the two surfaces and
// the two -- and only two -- coloured action families the design introduces:
//
//   apply   the restrained blue of "Apply to date" on a card AND of
//           "Apply template" in the popup, so the action keeps one identity.
//   cancel  the outlined red of the popup's Cancel. It CANCELS, it never
//           deletes anything, so there is no destructive dialog and no solid
//           red slab - just a complete outline.
//
// Nothing here restyles the shared buttons: a template action is not the app's
// accent action.

/**
 * ONE page gutter, matching the approved Home `HOME_CARD_GUTTER`: left edge,
 * right edge, top (after the safe area), the gap between the notice and the
 * first card, and the gap between every pair of card BORDERS. Same number, same
 * measurement on both pages so they read as one app.
 */
export const TEMPLATE_GUTTER = 8;

export const templatesCalendarTokens = {
  /** Page frame + the list of cards (see TEMPLATE_GUTTER). */
  gutter: TEMPLATE_GUTTER,
  pageTop: TEMPLATE_GUTTER,
  sectionGap: 8,
  /** The action row's own separation - independent of the page gutter. */
  actionGap: 8,
  cardRadius: 12,
  cardPadding: 12,
  border: 1,
  controlRadius: 8,
  iconTile: 32,
  titleGap: 10,
  pageTitle: 24,
  pageTitleLine: 32,
  pageName: 17,
  pageNameLine: 23,
  meta: 12,
  metaLine: 18,
  touchAndroid: 48,
  touchIOS: 44,
  visibleControl: 36,
  controlText: 13,
  controlLine: 20,
  controlPaddingX: 10,
  controlPaddingY: 6,
  applyMinWidth: 136,
  cancelMinWidth: 64,
  icon: 16,
  iconGap: 6,
  /** The popup's own chrome (the host sheet keeps its existing values). */
  labelGap: 4,
  dateText: 14,
  dateLine: 20,
  dateMinWidth: 176,
  textInputMinWidth: 150,
  weekday: 12,
  calendarCell: 48,
  selectedBorder: 2,
  day: 14,
  dayLine: 20,
  todayBorder: 1,
  calendarCaptionLine: 20,
  /** Narrow window / large text: both surfaces stack their controls. */
  stackWidth: 350,
  stackFont: 1.3,
  /** A control that is locked (writing in flight) is dimmed, never repainted. */
  disabledOpacity: 0.45,
} as const;

/**
 * The two coloured families, light and dark. Everything else is theme ink.
 * `inRange` is the pale band of the days INSIDE a chosen range: it is tinted far
 * lighter than an endpoint, so a range can never read as a completion state.
 */
export const templateActionInk = {
  light: {
    apply: '#2457B8',
    applyFill: '#F0F5FF',
    applyBorder: '#9BB8E8',
    applyPressed: '#E3EDFF',
    cancel: '#A52F40',
    cancelBorder: '#D7A0A8',
    cancelFill: '#FFF7F8',
    cancelPressed: '#FFF0F2',
    daySelected: '#E3EDFF',
    inRange: '#F0F5FF',
    todayBorder: '#667085',
  },
  dark: {
    apply: '#A8C8FF',
    applyFill: '#192B47',
    applyBorder: '#698BBD',
    applyPressed: '#223A5D',
    cancel: '#FFACB7',
    cancelBorder: '#A36270',
    cancelFill: '#2C2028',
    cancelPressed: '#39202B',
    daySelected: '#223A5D',
    inRange: '#192B47',
    todayBorder: '#9AA8BA',
  },
} as const;

/**
 * RANGE-ONLY additions (the Start/End fields above the existing calendar). The
 * page, popup chrome and calendar keep the values above - this block adds no new
 * palette and no new gutter.
 */
export const templateRangeTokens = {
  fieldGap: 8,
  /** Narrow enough that BOTH fields share a phone row; they wrap at large text. */
  fieldMinWidth: 132,
  fieldVisibleMin: 36,
  /** The active endpoint's frame is one step thicker, never a new colour. */
  activeBorder: 2,
} as const;

export type TemplateActionInk = (typeof templateActionInk)['light'];
