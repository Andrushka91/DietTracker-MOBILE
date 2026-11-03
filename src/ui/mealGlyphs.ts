// The glyph each fixed meal category wears on its card - the mockup's five line
// icons, not the category's emoji.
//
// `MealCategory.Icon` stays DATA (it is stored, synced and is what the Windows app
// shows), but the phone no longer paints an emoji as chrome: an emoji renders
// differently on every Android skin, ignores the theme ink, and cannot be aligned
// like a glyph. The five categories are FIXED (a domain enum), so the drawing is
// fixed with them:
//
//   breakfast        a bowl with a spoon      `bowl-mix-outline`
//   morning snack    an apple                 `food-apple-outline`
//   lunch            a fork and a knife        `silverware-fork-knife`
//   afternoon snack  a bitten cookie          `cookie-outline`
//   dinner           a serving cloche         `room-service-outline`
//
// All five come from MaterialCommunityIcons: it draws these shapes with the
// mockup's thin, even stroke, and neither Ionicons nor Feather has a bowl, a
// cookie or a cloche at all.

import { MealCategoryKey } from '../domain/enums';
import type { MaterialName } from './components/icons';

/**
 * Glyph size inside the card's 36 pt tile. The tile's tile/padding are unchanged,
 * so the header line keeps its height whatever the glyph is.
 */
export const MEAL_GLYPH_SIZE = 22;

/** One line icon per fixed category. */
const MEAL_GLYPHS: Record<MealCategoryKey, MaterialName> = {
  [MealCategoryKey.Breakfast]: 'bowl-mix-outline',
  [MealCategoryKey.MorningSnack]: 'food-apple-outline',
  [MealCategoryKey.Lunch]: 'silverware-fork-knife',
  [MealCategoryKey.AfternoonSnack]: 'cookie-outline',
  [MealCategoryKey.Dinner]: 'room-service-outline',
};

/**
 * The glyph of a category key. An unknown key (a legacy row written by another
 * client) still gets a mark instead of a hole in the header.
 */
export function mealCategoryGlyph(key: MealCategoryKey): MaterialName {
  return MEAL_GLYPHS[key] ?? 'silverware-fork-knife';
}
