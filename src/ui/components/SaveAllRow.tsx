// The day header's SAVE ROW - the mockup's single line, and only while it has a
// job:
//
//     ✎ 1 editor open                          [ 🖫 Save all ]
//
// NOTHING TO SAVE = NO ROW. With every editor closed the row (and the hairline
// above it) is not rendered at all, exactly as the reference draws an idle
// dashboard: there is no save control to explain and no "saved" claim to read.
//
//   editors open   "1 editor open" / "2 editors open"   button indigo + enabled
//   saving         "Saving…"                            button subdued + disabled
//   partial batch  "2 of 3 saved" (warning ink)         button still enabled
//
// The wording is deliberately LOCAL: an open editor means edits waiting in this
// card, and a save writes them to this device's database. Nothing here says the
// cloud has them - the Settings sync card is the one place that talks about the
// cloud, and a save only queues the upload for the next sync attempt.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t, tFmt } from '../strings';
import { fonts, tintAlpha, type ThemeColors } from '../theme';
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
  // No open editor and no save in flight: the row does not exist.
  if (props.unsaved === 0 && !props.saving) {
    return null;
  }
  const canSave = props.unsaved > 0 && !props.saving;
  const partial = props.notice !== undefined && props.notice !== null && props.notice !== '';

  /** Left slot: what the save state IS, and the glyph that says it. */
  let icon: IconName = 'create-outline';
  let ink = colors.accent;
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
    <View style={[styles.row, { borderTopColor: colors.hairline }]}>
      <View style={styles.status}>
        <Icon name={icon} size={18} color={ink} />
        <Text style={[styles.statusText, { color: statusInk }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Dashboard_SaveAll')}
        accessibilityState={{ disabled: !canSave }}
        disabled={!canSave}
        onPress={props.onSaveAll}
        hitSlop={4}
        style={({ pressed }) => [
          styles.button,
          {
            // Enabled: the app's indigo. Waiting: a wash of the SAME indigo with
            // indigo ink, so the button reads as "busy" instead of as a broken
            // control.
            backgroundColor: canSave
              ? colors.accentFill
              : tintAlpha(colors.accent, props.isDark ? '2E' : '1F'),
            opacity: pressed ? 0.82 : 1,
          },
        ]}>
        <Icon
          name="save-outline"
          size={18}
          color={canSave ? colors.accentFillText : colors.accent}
        />
        <Text
          numberOfLines={1}
          style={[styles.buttonText, { color: canSave ? colors.accentFillText : colors.accent }]}>
          {t('Dashboard_SaveAll')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  /** One line under the day actions, separated by a hairline. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  status: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', columnGap: 8 },
  statusText: { fontSize: 14, flexShrink: 1 },
  /** Compact pill: 44 pt tall, so the thumb finds it beside the big ring card. */
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  buttonText: { fontSize: 15, fontFamily: fonts.medium },
});
