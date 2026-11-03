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

import { fonts, metrics, type ThemeColors } from '../theme';
import { FeatherIcon, Icon, MaterialIcon, type FeatherName, type IconName, type MaterialName } from './icons';
import { t } from '../strings';

/**
 * The one glyph an icon button draws.
 *
 * Ionicons owns the actions; the two shapes it does not draw come from Feather -
 * the one font that owns the mockup's shape - the same deliberate exception the
 * tab bar makes for its calendar (see components/icons.tsx):
 *
 *   * the meal card's Edit tool is Feather `edit`: a square open at the TOP-RIGHT
 *     with a plain pencil through the gap (Ionicons' `create-outline` adds a nib
 *     and a collar, so it reads as a fountain pen, not a pencil),
 *   * its Clear bin is Feather `trash-2`: a thin lid line overhanging the body, an
 *     arched handle, rounded corners and TWO short bars (Ionicons' `trash-outline`
 *     tapers its body and carries three; Material's can has a thick filled lid).
 */
export type IconButtonGlyph =
  | {
      /** Ionicons name - the app draws one icon family, never emoji. */
      icon: IconName;
    }
  | {
      /** MaterialCommunityIcons name - only for a shape Ionicons lacks. */
      material: MaterialName;
    }
  | {
      /** Feather name - only for a shape neither other family draws. */
      feather: FeatherName;
    };

export function IconButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Explicit glyph colour - the symbol only, the button chrome stays neutral. */
  tint?: string;
  /** Glyph size in points (default 20). */
  size?: number;
  /** Square size in points (default metrics.minTouch). Never below 44. */
  touch?: number;
  colors: ThemeColors;
} & IconButtonGlyph): React.JSX.Element {
  const tint = props.disabled === true
    ? props.colors.disabledText
    : props.tint ?? (props.danger === true ? props.colors.missed : props.colors.textSecondary);
  /**
   * A toolbar-style icon button: no permanent chip, just the glyph on the card.
   * Five filled 32 pt chips per meal made the action row louder than the meal
   * itself; the 44 pt square (with hitSlop) is still a full touch target, and
   * the pressed state paints the chip so the tap is acknowledged.
   */
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: props.touch ?? metrics.minTouch,
          height: props.touch ?? metrics.minTouch,
          backgroundColor: pressed ? props.colors.surfaceVariant : 'transparent',
          opacity: props.disabled === true ? 0.45 : 1,
        },
      ]}>
      {'icon' in props ? (
        <Icon name={props.icon} size={props.size ?? 20} color={tint} />
      ) : 'material' in props ? (
        <MaterialIcon name={props.material} size={props.size ?? 20} color={tint} />
      ) : (
        <FeatherIcon name={props.feather} size={props.size ?? 20} color={tint} />
      )}
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
  /** Optional leading icon drawn before the label. */
  icon?: IconName;
  /** Glyph colour when the chip itself must stay neutral (e.g. day actions). */
  iconColor?: string;
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
  /**
   * Disabled controls are a distinct state, not a faded primary: a washed accent
   * with the accent's ink (the old look) read as a broken button. They now use
   * the neutral disabled pair, which is unambiguous in both themes.
   */
  const background =
    props.disabled === true
      ? props.colors.disabledFill
      : props.accent === true
        ? props.colors.accentFill
        : props.danger === true
          ? props.colors.missed
          : props.colors.surfaceVariant;
  const foreground =
    props.disabled === true
      ? props.colors.disabledText
      : props.accent === true
        ? props.colors.accentFillText
        : props.danger === true
          ? props.colors.accentText
          : props.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.bar,
        props.compact === true && styles.barCompact,
        {
          backgroundColor: background,
          borderColor:
            props.disabled === true
              ? props.colors.disabledFill
              : props.accent === true || props.danger === true
                ? background
                : props.colors.border,
          opacity: props.disabled === true ? 1 : pressed ? 0.7 : 1,
        },
        props.style,
      ]}>
      {/* One line: a compressed button ellipsizes its label instead of wrapping
          taller, so rows that must stay on one line never break. */}
      {props.icon !== undefined && (
        <Icon name={props.icon} size={16} color={props.disabled === true ? foreground : props.iconColor ?? foreground} />
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
            hitSlop={4}
            style={[
              styles.segmentItem,
              // The selected segment is a raised SURFACE with accent ink (the
              // round-3 review design), not a second accent button: the page's
              // one filled control must stay the primary action.
              selected && [styles.segmentSelected, { backgroundColor: props.colors.surface }],
            ]}>
            <Text
              style={[
                styles.segmentLabel,
                { color: selected ? props.colors.accent : props.colors.textSecondary },
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
    width: metrics.minTouch,
    height: metrics.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: metrics.radiusSmall,
  },
  bar: {
    flexDirection: 'row',
    columnGap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: metrics.radiusSmall,
    minHeight: metrics.minTouch,
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
  /** SettingsPage.xaml draws the privacy/backup buttons at FontSize 13 / Padding 8,4. */
  barCompact: { paddingHorizontal: 10, paddingVertical: 7, minHeight: 36, columnGap: 5 },
  barLabelCompact: { fontSize: 13 },
  /** Segmented control: a pill track with a raised selected segment. */
  segment: {
    flexDirection: 'row',
    borderRadius: metrics.radiusSmall,
    padding: 3,
    columnGap: 2,
  },
  segmentItem: {
    flex: 1,
    height: 40,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: metrics.radiusChip,
  },
  segmentSelected: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentLabel: { fontFamily: fonts.regular, fontSize: 13 },
  segmentLabelSelected: { fontFamily: fonts.medium },
});