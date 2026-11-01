// Small shared controls used by the meal card and settings rows.
// Chrome is deliberately square: filled neutral/accent buttons with a crisp
// 4 pt corner (never a capsule, never a circle) and matching icon buttons, so
// every control in the app reads as the same family.

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { fonts, type ThemeColors } from '../theme';
import { t } from '../strings';

export function IconButton(props: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Explicit glyph colour - the symbol only, the button chrome stays neutral. */
  tint?: string;
  colors: ThemeColors;
}): React.JSX.Element {
  const tint = props.disabled === true
    ? props.colors.textMuted
    : props.tint ?? (props.danger === true ? props.colors.missed : props.colors.text);
  // Square control chrome: 1 px control stroke, control fill, 4 px corners.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      hitSlop={4}
      style={[
        styles.iconButton,
        {
          backgroundColor: props.colors.surfaceVariant,
          borderColor: props.colors.border,
          opacity: props.disabled === true ? 0.4 : 1,
        },
      ]}>
      <Text style={[styles.glyph, { color: tint }]}>{props.glyph}</Text>
    </Pressable>
  );
}

export function BarButton(props: {
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /**
   * Compact chrome for dense action rows: the Windows settings page draws
   * these buttons at FontSize 13 with an 8 px side padding (SettingsPage.xaml),
   * which keeps three labelled buttons on one row on a phone.
   */
  compact?: boolean;
  /** Optional leading glyph (emoji / symbol) drawn before the label. */
  glyph?: string;
  /**
   * Optional layout tweak (e.g. flexShrink) merged after the base chrome.
   *
   * There is deliberately no `busy` prop: an operation long enough to need a
   * spinner raises the GLOBAL busy overlay (shell.tsx), so the button itself
   * never swaps its glyph for an indicator and the screen cannot be used while
   * the operation runs.
   */
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const background =
    props.accent === true
      ? props.colors.accentFill
      : props.danger === true
        ? props.colors.missed
        : props.colors.surfaceVariant;
  const foreground =
    props.accent === true
      ? props.colors.accentFillText
      : props.danger === true
        ? props.colors.accentText
        : props.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled === true}
      onPress={props.onPress}
      style={[
        styles.bar,
        props.compact === true && styles.barCompact,
        {
          backgroundColor: background,
          borderColor:
            props.accent === true || props.danger === true
              ? background
              : props.colors.border,
          opacity: props.disabled === true ? 0.4 : 1,
        },
        props.style,
      ]}>
      {/* One line: a compressed button ellipsizes its label instead of wrapping
          taller, so rows that must stay on one line never break. */}
      {props.glyph !== undefined && (
        <Text style={[styles.barGlyph, { color: foreground }]}>{props.glyph}</Text>
      )}
      <Text
        style={[styles.barLabel, props.compact === true && styles.barLabelCompact, { color: foreground }]}
        numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/**
 * Maps a stable validation code onto its localized Error_* string (the
 * Windows resw keys mirror the same codes).
 */
export function localizedCode(code: string): string {
  const key = `Error_${code.replace(/\./g, '_')}`;
  const text = t(key);
  return text === key ? code : text;
}

/**
 * iOS segmented control (HIG): a fill track with the selected segment raised
 * in the accent tint. Purely visual - the caller keeps owning the value.
 */
export function Segmented(props: {
  /** Ordered segment labels; the index identifies the selection. */
  options: string[];
  /** Index of the selected segment. */
  index: number;
  onChange: (index: number) => void;
  colors: ThemeColors;
}): React.JSX.Element {
  return (
    <View
      style={[styles.segment, { backgroundColor: props.colors.surfaceVariant }]}
      accessibilityRole="tablist">
      {props.options.map((label, index) => {
        const selected = index === props.index;
        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => props.onChange(index)}
            style={[
              styles.segmentItem,
              selected && [
                styles.segmentSelected,
                { backgroundColor: props.colors.accentFill },
              ],
            ]}>
            <Text
              style={[
                styles.segmentLabel,
                { color: selected ? props.colors.accentFillText : props.colors.textSecondary },
                selected && styles.segmentLabelSelected,
              ]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    minWidth: 36,
    height: 32,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  glyph: { fontSize: 15 },
  bar: {
    flexDirection: 'row',
    columnGap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Button labels are never bold: they draw the regular cut of the bundled
   * typeface. The top bar buttons (Previous day / Today / Next day, the month
   * arrows, the calendar actions) are the most visible labels of the app, and
   * the medium cut made them look like headings instead of controls.
   */
  barLabel: { fontFamily: fonts.regular, fontSize: 14 },
  /** Leading symbol of a labelled button (account card, wide actions). */
  barGlyph: { fontSize: 14 },
  /** SettingsPage.xaml draws the privacy/backup buttons at FontSize 13 / Padding 8,4. */
  barCompact: { paddingHorizontal: 10, paddingVertical: 6, minHeight: 32 },
  barLabelCompact: { fontSize: 13 },
  /** Segmented control: squared track with a raised selected segment. */
  segment: { flexDirection: 'row', borderRadius: 6, padding: 2 },
  segmentItem: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  segmentSelected: {
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentLabel: { fontFamily: fonts.regular, fontSize: 13 },
  segmentLabelSelected: { fontFamily: fonts.medium },
});