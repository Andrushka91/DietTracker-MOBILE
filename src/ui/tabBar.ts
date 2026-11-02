// Docked tab bar geometry - ONE source of truth for the bar itself (App.tsx),
// for the tab items (components/TabBar.tsx) and for the air every scrolling page
// keeps above the bar.
//
// The bar is DOCKED, exactly like the r3 review mockups
// (`.ds-nav` in diettracker-r3-review-today.html / -settings.html): it is a
// normal sibling below the pages - no `position: 'absolute'`, no side insets, no
// rounded outer corners and no floating shadow - so react-navigation lays the
// pages out ABOVE it and a page can never slide underneath. Its height is
//
//     TAB_BAR_CONTENT_HEIGHT  (top air + one tab row)
//   + the device's bottom safe-area inset
//
// and the surface paints across that whole height, INCLUDING the gesture area,
// so nothing of the page shows around or below the bar. The navigator supplies
// the inset as the bar's `paddingBottom` and also reports the whole height to
// `BottomTabBarHeightContext`; we only supply the content height plus the top
// air.
//
// Because the navigator already reserves the bar's full height, a page must NOT
// reserve it again: the only number a page needs is the air between its last
// card and the bar's top divider - TAB_BAR_CONTENT_GAP (the mockups' 18 pt page
// bottom padding). The old floating bar needed bottom offset + bar height + gap
// of padding in every page, which is exactly the double reserve that would now
// leave a hole above a docked bar.
//
// Reference values (mockups):
//   bar        background surface, 1 pt top divider (line), padding 8 / 4 / 13,
//              five equal columns
//   tab        min-height 52, column, gap 5, caption 11 pt / 16 pt line
//   glyph      21 pt, in a 12 pt-rounded chip padded 5 x 14 -> 49 x 31
//   selected   accent ink, glyph chip filled with the accent tint

/** Glyph size inside the bar. */
export const TAB_GLYPH_SIZE = 21;
/** Selected-glyph chip: 21 pt glyph + 5 / 14 pt padding, 12 pt corners. */
export const TAB_GLYPH_CHIP_WIDTH = 49;
export const TAB_GLYPH_CHIP_HEIGHT = 31;
export const TAB_GLYPH_CHIP_RADIUS = 12;
/** Caption line box (11 pt type on a 16 pt line) and the chip-to-caption gap. */
export const TAB_LABEL_LINE_HEIGHT = 16;
export const TAB_LABEL_GAP = 5;
/** One tab: chip, gap, caption - the mockups' 52 pt tab. */
export const TAB_BAR_ITEM_HEIGHT = TAB_GLYPH_CHIP_HEIGHT + TAB_LABEL_GAP + TAB_LABEL_LINE_HEIGHT;
/** react-navigation's own vertical padding inside a tab (`tabVerticalUiKit`). */
export const TAB_BAR_ITEM_PADDING = 5;
/** Air above the tabs, below the divider (the mockups' 8 pt bar padding). */
export const TAB_BAR_PADDING_TOP = 6;
/** Air left and right of the tabs (the mockups' 4 pt bar padding). */
export const TAB_BAR_EDGE_PADDING = 4;
/** Air a page keeps between its last card and the bar's top divider. */
export const TAB_BAR_CONTENT_GAP = 18;
/** Height of the bar WITHOUT the device's bottom safe-area inset. */
export const TAB_BAR_CONTENT_HEIGHT =
  TAB_BAR_PADDING_TOP + TAB_BAR_ITEM_PADDING * 2 + TAB_BAR_ITEM_HEIGHT;

/**
 * The device's bottom safe-area inset, sanitised: an unmeasured (NaN), negative
 * or infinite value falls back to 0 instead of poisoning the bar's height.
 */
export function safeBottomInset(bottomInset: number): number {
  return Number.isFinite(bottomInset) && bottomInset > 0 ? bottomInset : 0;
}

/**
 * Total height of the docked bar: its own content plus the bottom safe-area
 * inset, whose surface the bar paints over (the navigator puts the same inset on
 * the bar's `paddingBottom`, which keeps the tabs above the gesture area).
 */
export function tabBarHeight(bottomInset: number): number {
  return TAB_BAR_CONTENT_HEIGHT + safeBottomInset(bottomInset);
}

