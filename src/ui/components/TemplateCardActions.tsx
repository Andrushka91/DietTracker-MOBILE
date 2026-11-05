// The template card's action footer (the approved design).
//
// ONE flush, two-column footer attached to the card's own frame: the Preview
// half on the left (list glyph, the word, then a chevron) and the Apply plan
// half on the right, its pale accent wash covering the whole half (the word,
// then an arrow). Both halves are INDEPENDENT 48/44 dp targets that fill their
// side edge to edge - no resting outline, no floating capsule, no 12 dp side
// gutter - and the card's own corners shape the footer, so nothing here is a
// rounded floating control.
//
// Presentation only. `onTogglePreview` and `onRequestApply` are the caller's
// existing callbacks, held by SIBLING targets in a card that is not pressable,
// so previewing can never apply anything and applying never previews.

import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { accentActionColors } from '../accentActions';
import { type ThemeColors } from '../theme';
import { templateCardActions as k } from '../templateCardActions';

export type TemplateCardActionIcon = 'list' | 'chevron-down' | 'chevron-up' | 'arrow-right';

export interface TemplateCardActionsProps {
  colors: ThemeColors;
  /** Nothing to disclose: the Apply half then spans the whole footer. */
  canPreview: boolean;
  expanded: boolean;
  /** Short localized labels: "Preview" / "Apply plan". */
  previewText: string;
  applyText: string;
  /** Contextual accessible names carrying the template's own display name. */
  previewAccessibilityLabel: string;
  applyAccessibilityLabel: string;
  /** The existing meal-count wording, exposed as the disclosure's value. */
  countLabel: string;
  /** Only a guard that already exists may be passed here. */
  disabled?: boolean;
  onTogglePreview: () => void;
  onRequestApply: () => void;
  /** The app's installed icon wrapper (Feather); no icon package here. */
  renderIcon: (name: TemplateCardActionIcon, color: string, size: number) => React.ReactNode;
}

export function TemplateCardActions(props: TemplateCardActionsProps): React.JSX.Element {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState<'preview' | 'apply' | null>(null);
  const { colors } = props;
  /**
   * A narrow footer (or very large text) stacks the halves: Preview above
   * Apply plan, the separator turning horizontal. The empty-template footer
   * never stacks - it is one full-width half already.
   */
  const stacked =
    props.canPreview &&
    ((width > 0 && width < 2 * k.minInlineColumn) || fontScale > k.stackFontScale);
  const target = Platform.OS === 'ios' ? k.targetIOS : k.targetAndroid;
  const locked = props.disabled === true;
  /** Glyphs are decoration: the words already say what each half does. */
  const decorative = (
    name: TemplateCardActionIcon,
    color: string,
    size: number = k.icon,
  ): React.ReactNode => (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {props.renderIcon(name, color, size)}
    </View>
  );

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.footer, { borderTopColor: colors.border }, stacked && styles.stacked]}>
      {props.canPreview && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.previewAccessibilityLabel}
            accessibilityState={{ expanded: props.expanded, disabled: locked }}
            accessibilityValue={{ text: props.countLabel }}
            disabled={locked}
            onPress={props.onTogglePreview}
            onFocus={() => setFocused('preview')}
            onBlur={() => setFocused(null)}
            style={({ pressed }) => [
              styles.action,
              stacked && styles.stackedAction,
              {
                minHeight: target,
                backgroundColor:
                  props.expanded || pressed ? colors.surfaceVariant : colors.cardFill,
                borderColor: focused === 'preview' ? colors.accent : 'transparent',
              },
              locked && styles.disabled,
            ]}>
            {decorative('list', colors.textSecondary)}
            <Text style={[styles.label, { color: colors.textSecondary }]}>{props.previewText}</Text>
            {decorative(
              props.expanded ? 'chevron-up' : 'chevron-down',
              colors.textSecondary,
              k.chevron,
            )}
          </Pressable>
          <View
            accessible={false}
            pointerEvents="none"
            style={[
              styles.divider,
              { backgroundColor: colors.border },
              stacked && styles.stackedDivider,
            ]}
          />
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.applyAccessibilityLabel}
        accessibilityState={{ disabled: locked }}
        disabled={locked}
        onPress={props.onRequestApply}
        onFocus={() => setFocused('apply')}
        onBlur={() => setFocused(null)}
        style={({ pressed }) => [
          styles.action,
          stacked && styles.stackedAction,
          {
            minHeight: target,
            // The app's own accent wash (light 1A / dark 2E, pressed 2E/32),
            // covering the WHOLE half - never a small inset button.
            backgroundColor: accentActionColors(colors, pressed).fill,
            borderColor: focused === 'apply' ? colors.accent : 'transparent',
          },
          locked && styles.disabled,
        ]}>
        <Text style={[styles.label, styles.applyLabel, { color: colors.accent }]}>
          {props.applyText}
        </Text>
        {decorative('arrow-right', colors.accent)}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Flush footer: one top rule, two stretched columns, no side gutters. */
  footer: {
    borderTopWidth: k.rule,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  stacked: { flexDirection: 'column' },
  /**
   * One half. `flex: 1` makes the pair equal and edge-to-edge; the 2 dp border
   * is the reserved focus ring (transparent at rest) so focusing never shifts
   * the label. No radius: the card's own corners shape the footer.
   */
  action: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: k.paddingX,
    paddingVertical: k.paddingY,
    gap: k.contentGap,
    borderWidth: k.focusWidth,
    borderRadius: 0,
  },
  stackedAction: { flex: 0, width: '100%' },
  divider: { width: k.rule, height: k.dividerHeight, alignSelf: 'center' },
  stackedDivider: { width: '100%', height: k.rule },
  /** 13/20 sp; wraps rather than truncating, so translations always fit. */
  label: {
    flexShrink: 1,
    fontFamily: k.regular,
    fontSize: k.labelSize,
    lineHeight: k.labelLine,
    textAlign: 'center',
  },
  applyLabel: { fontFamily: k.medium },
  disabled: { opacity: k.disabledOpacity },
});
