// The "Clear this meal?" question, built in ONE place - the compact centered card
// of the mockup:
//
//     [ bin badge ]            the Clear bin in a wash of the red
//     Clear this meal?         bold, centered
//     Lunch · 13:30            the meal the question is about
//     This clears the meal's details and status,
//     and deletes all attached photos.
//     This can't be undone.    bold, red
//     [ Cancel ] [ Clear meal ]
//
// It used to be a bottom sheet with "No" / "Yes" rows and one long paragraph that
// mixed what disappears with the warning. Splitting them - paragraph, then one
// bold red line, then the two answers - is what makes the compact card readable,
// and the caption names the meal so the answer cannot land on the wrong card.
//
// The badge wears the SAME bin the Clear tool draws (Feather `trash-2`), so the
// question looks like it came from the button that opened it.

import type { ConfirmRequest } from './components/dialogs';
import type { MealEntry } from '../domain/models';
import { formatTime, mealNameKey, t } from './strings';

export function clearMealRequest(props: {
  entry: MealEntry;
  /**
   * The meal's category name exactly as its card prints it (null when it has not
   * loaded yet - the category key's own name is the fallback).
   */
  categoryName: string | null;
  use12HourClock: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ConfirmRequest {
  const name = props.categoryName ?? t(mealNameKey(props.entry.mealCategoryKey));
  const time = formatTime(props.entry.plannedTime, props.use12HourClock);
  return {
    layout: 'card',
    destructive: true,
    title: t('Meal_ClearTitle'),
    // "Lunch · 13:30" - or just the meal's name when it has no planned time.
    message: time === '' ? name : `${name} · ${time}`,
    body: t('Rn_ClearMealBody'),
    warning: t('Rn_ClearMealWarning'),
    badge: { feather: 'trash-2' },
    // The two sign-out cards keep their QUIET badge (signing out deletes nothing);
    // this question removes records, so its bin sits in a wash of the red.
    badgeTone: 'danger',
    cancelText: t('Common_Cancel'),
    confirmText: t('Meal_Clear'),
    onCancel: props.onCancel,
    onConfirm: props.onConfirm,
  };
}
