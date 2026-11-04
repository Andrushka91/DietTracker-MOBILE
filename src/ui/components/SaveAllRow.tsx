// The day header's SAVE ROW - the mockup's single line, and only while it has a
// job:
//
//     ✎ 1 editor open                          [ 🖫 Save all ]
//
// NOTHING TO SAVE = NO ROW. With every editor closed the row (and the hairline
// above it) is not rendered at all, exactly as the reference draws an idle
// dashboard: there is no save control to explain and no "saved" claim to read.
//
//   editors open   "1 editor open" / "2 editors open"   neutral outline + enabled
//   saving         "Saving…"                            subdued + disabled
//   partial batch  "2 of 3 saved" (warning ink)         button still enabled
//
// The control is deliberately NEUTRAL: the card's own surface inside a thin
// border, normal ink and a slate glyph, 36 pt tall inside a real 44 pt target.
// No indigo fill - saving a card is routine housekeeping, not a call to action.
//
// The wording is deliberately LOCAL: an open editor means edits waiting in this
// card, and a save writes them to this device's database. Nothing here says the
// cloud has them - the Settings sync card is the one place that talks about the
// cloud, and a save only queues the upload for the next sync attempt.

import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { t, tFmt } from '../strings';
import { fonts, type ThemeColors } from '../theme';
import { Icon, type IconName } from './icons';

export function SaveAllRow(props: {
  /** Cards holding unsaved edits; 0 means there is nothing to save. */
  unsaved: number;
  /** True while the batch save is running. */
  saving: boolean;
  /** A partial result worth naming ("2 of 3 saved"); null when all of it landed. */
  notice?: string | null;
  onSaveAll: () => void;
  colors: ThemeColors;
  isDark: boolean;
}): React.JSX.Element | null {
  const { colors } = props;
  const { width, fontScale } = useWindowDimensions();
  // No open editor and no save in flight: the row does not exist.
  if (props.unsaved === 0 && !props.saving) {
    return null;
  }
  const canSave = props.unsaved > 0 && !props.saving;
  const partial = props.notice !== undefined && props.notice !== null && props.notice !== '';
  /** Narrow window or the largest text sizes: the control drops under the status. */
  const stacked = width > 0 && (width < 350 || fontScale > 1.3);

  /**
   * Left slot: what the save state IS, and the glyph that says it. The glyph is
   * NEUTRAL - the save control is part of an ordinary page, not a call to action.
   */
  let icon: IconName = 'create-outline';
  let ink = colors.textSecondary;
  let label =
    props.unsaved === 1 ? t('Rn_EditorOpenOne') : tFmt('Rn_EditorsOpen', props.unsaved);
  if (props.saving) {
    icon = 'save-outline';
    ink = colors.textMuted;
    label = t('Rn_Saving');
  } else if (partial) {
    // A partial save is the one result that must be named: those editors are
    // still open, so the button stays live.
    icon = 'alert-circle-outline';
    ink = colors.warning;
    label = props.notice as string;
  }
  const statusInk = props.saving ? colors.textMuted : colors.text;

  return (
    <View
      style={[styles.row, stacked && styles.rowStacked, { borderTopColor: colors.hairline }]}>
      <View style={[styles.status, stacked && styles.statusStacked]}>
        <Icon name={icon} size={16} color={ink} />
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.statusText, { color: statusInk }]}
          numberOfLines={1}>
          {label}
        </Text>
      </View>
      {/* The 44 pt target; the visible control inside it is the smaller neutral
          outline, so "Save all" stays quiet beside the cards it saves. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Dashboard_SaveAll')}
        accessibilityState={{ disabled: !canSave, busy: props.saving }}
        disabled={!canSave}
        onPress={props.onSaveAll}
        style={[styles.target, stacked && styles.targetStacked, !canSave && styles.subdued]}>
        {({ pressed }) => (
          <View
            style={[
              styles.button,
              {
                borderColor: colors.border,
                backgroundColor: pressed && canSave ? colors.surfaceVariant : colors.cardFill,
              },
            ]}>
            <Icon name="save-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.buttonText, { color: colors.text }]} numberOfLines={1}>
              {t('Dashboard_SaveAll')}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  /** One line under the day actions, separated by its one existing hairline. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', rowGap: 6 },
  status: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  statusStacked: { flex: 0, width: '100%' },
  statusText: { fontSize: 13, fontFamily: fonts.regular, flexShrink: 1 },
  /** The real 44 pt touch target, never narrower than 96 pt. */
  target: { minHeight: 44, minWidth: 96, justifyContent: 'center' },
  targetStacked: { alignSelf: 'flex-end' },
  /** Busy or disabled: the control is subdued, never repainted. */
  subdued: { opacity: 0.5 },
  /**
   * The visible control: the card's own surface inside a 1 pt neutral border,
   * 36 pt tall with 8 pt corners, a slate glyph and normal 13 pt ink. It is the
   * same quiet family as the editor's Cancel / Save - no accent fill.
   */
  button: {
    minWidth: 96,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  buttonText: { fontSize: 13, fontFamily: fonts.regular, flexShrink: 1 },
});
