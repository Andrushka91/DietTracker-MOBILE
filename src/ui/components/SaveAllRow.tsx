import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { t, tFmt } from '../strings';
import { fonts, type ThemeColors } from '../theme';
import { accentActionColors, cancelActionColors } from '../accentActions';
import { controls as k } from './compact-editor.tokens';
import { Icon } from './icons';

/** The interactive area around every face: 48 dp on Android, 44 dp on iOS. */
const SAVE_TARGET_MIN = Platform.OS === 'ios' ? k.targetIOS : k.targetAndroid;

export function SaveAllRow(props: {
  unsaved: number;
  saving: boolean;
  /**
   * A card's OWN save is running. The bulk actions must not start underneath it,
   * so both faces are disabled - the status sentence is unchanged.
   */
  locked?: boolean;
  notice?: string | null;
  onSaveAll: () => void;
  onCancelAll: () => void;
  colors: ThemeColors;
  isDark: boolean;
}): React.JSX.Element | null {
  const { colors } = props;
  const { width, fontScale } = useWindowDimensions();
  if (props.unsaved === 0 && !props.saving) { return null; }
  const locked = props.locked === true;
  const canAct = props.unsaved > 0 && !props.saving && !locked;
  const partial = props.notice !== undefined && props.notice !== null && props.notice !== '';
  const stacked = width > 0 && (width < 350 || fontScale > 1.3);
  const label = props.saving
    ? t('Rn_Saving')
    : partial
      ? (props.notice as string)
      : props.unsaved === 1
        ? t('Rn_EditorOpenOne')
        : tFmt('Rn_EditorsOpen', props.unsaved);
  /**
   * The quiet glyph beside the sentence: a pencil for open drafts, a disk while
   * the batch runs, a warning for a partial result. It is DECORATION - the
   * sentence already says the state in words - so it carries no count, no
   * "saved"/"synced" claim and nothing for a screen reader.
   */
  const statusIcon = props.saving
    ? 'save-outline'
    : partial
      ? 'alert-circle-outline'
      : 'create-outline';
  // Secondary ink for the wording, muted while the batch runs. The partial
  // notice keeps its own truthful sentence.
  const statusInk = props.saving ? colors.textMuted : colors.textSecondary;
  return (
    <View style={[styles.row, stacked && styles.rowStacked, { borderTopColor: colors.hairline }]}>
      <View style={[styles.status, stacked && styles.statusStacked]}>
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <Icon name={statusIcon} size={14} color={statusInk} />
        </View>
        <Text accessibilityLiveRegion="polite" style={[styles.statusText, { color: statusInk }]}>
          {label}
        </Text>
      </View>
      {/* Cancel all first, then Save all: the discard sits beside the save, in the
          same red family as a single card's Cancel. Each face is only as wide as
          its own label plus the shared 5 dp padding — never an equal-width pair. */}
      <View style={[styles.pair, stacked && styles.pairStacked]}>
        <ControlFace
          label={t('Rn_CancelAll')}
          kind="cancel"
          disabled={!canAct}
          onPress={props.onCancelAll}
          colors={colors}
          align={stacked ? undefined : 'trailing'}
        />
        <ControlFace
          label={t('Dashboard_SaveAll')}
          kind="save"
          disabled={!canAct}
          onPress={props.onSaveAll}
          colors={colors}
          busy={props.saving}
          align={stacked ? undefined : 'leading'}
        />
      </View>
    </View>
  );
}

function ControlFace(props: { label: string; kind: 'save'|'cancel'; disabled: boolean; onPress: () => void; colors: ThemeColors; align?: 'leading' | 'trailing'; busy?: boolean }): React.JSX.Element {
  const ink = props.kind === 'cancel' ? cancelActionColors(props.colors) : accentActionColors(props.colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.kind === 'cancel' ? t('Rn_CancelAll') : t('Dashboard_SaveAll')}
      accessibilityState={{ disabled: props.disabled, busy: props.busy === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.controlTarget, props.disabled && styles.subdued]}>
      {/* The face is content-sized - its own label plus the shared 5 dp padding -
          and hugs the target edge that FACES ITS PARTNER, so the two visible
          outlines stay k.gap apart instead of gaining the wrapper's slack. */}
      <View
        style={[
          styles.control,
          props.align === 'trailing' && styles.faceTrailing,
          props.align === 'leading' && styles.faceLeading,
          { borderColor: ink.border, backgroundColor: ink.fill },
        ]}>
        <Text style={[styles.controlLabel, { color: ink.foreground }]}>{props.label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * The bulk row: the hairline stays, but only 4 dp of air above it and none
   * below it - the 48/44 dp targets inside already carry their own transparent
   * slack, so the old 8 + 6 dp stacked on top of that. Readable air is unchanged;
   * a wrapped status or large text still grows the row.
   */
  row: { flexDirection: 'row', alignItems: 'center', columnGap: k.gap, marginTop: 4, paddingTop: 0, borderTopWidth: StyleSheet.hairlineWidth },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', rowGap: 6 },
  status: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  statusStacked: { flex: 0, width: '100%' },
  /** 12/18 sp secondary ink beside the 14 dp glyph; wraps, never clamped. */
  statusText: { fontSize: 12, lineHeight: 18, fontFamily: fonts.regular, flexShrink: 1 },
  pair: { flexDirection: 'row', alignItems: 'center', columnGap: k.gap, alignSelf: 'flex-end' },
  pairStacked: { flexDirection: 'column', alignItems: 'stretch', rowGap: k.gap },
  subdued: { opacity: k.disabledOpacity },
  /**
   * A real 48/44 dp target around each face. `alignItems: 'center'` keeps a SHORT
   * face short even when the row stacks, so Cancel all / Save all never stretch to
   * an equal width.
   */
  controlTarget: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: SAVE_TARGET_MIN,
    minHeight: SAVE_TARGET_MIN,
  },
  control: { borderWidth: k.border, borderRadius: k.radius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: k.paddingX, paddingVertical: k.paddingY },
  /**
   * Row layout only: the face hugs the edge of its own target that faces its
   * partner (logical start/end, so RTL flips with the row). A face shorter than
   * the 48/44 dp target then leaves its slack OUTSIDE the pair, and the two
   * visible outlines sit exactly k.gap apart. The stacked fallback passes no
   * align, so both faces stay centred there.
   */
  faceTrailing: { alignSelf: 'flex-end' },
  faceLeading: { alignSelf: 'flex-start' },
  controlLabel: { fontFamily: fonts.regular, fontSize: k.fontSize, lineHeight: k.lineHeight, textAlign: 'center' },
});

