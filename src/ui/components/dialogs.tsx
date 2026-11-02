// Confirm dialogs (spec 6.5) + the floating status caption (6.6).
// Every dialog has two buttons; dismissal (back/scrim tap) equals the
// CANCEL action - "default No" for destructive prompts.

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fonts, cardShadow, themeColors } from '../theme';
import { useApp } from '../appContext';
import { t } from '../strings';

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Left/neutral button label; dismiss maps to this action. */
  cancelText?: string;
  confirmText: string;
  /** Right button label; when omitted the right button is hidden (OK only). */
  /** True = red confirm button (destructive). */
  destructive?: boolean;
  /**
   * True = only the confirm button is drawn (an acknowledgement, not a choice).
   * Used when the app must state an outcome the user cannot change - e.g. a
   * sign-out that was refused because the changes could not be uploaded.
   */
  singleAction?: boolean;
  /**
   * Name prompt (spec 6.5 "Save-as-template name prompt"): when set the dialog
   * shows a single-line text field pre-filled with this value (default
   * `yyyy-MM-dd`) and hands the typed name to `onConfirm`.
   */
  inputDefaultValue?: string;
  onCancel: () => void;
  onConfirm: (value?: string) => void;
}

export function ConfirmDialog({
  request,
  isDark,
}: {
  request: ConfirmRequest;
  isDark: boolean;
}): React.JSX.Element {
  const colors = themeColors(isDark);
  const [value, setValue] = useState(request.inputDefaultValue ?? '');
  return (
    <Modal transparent animationType="fade" visible onRequestClose={request.onCancel}>
      <Pressable
        style={[styles.scrim, { backgroundColor: colors.overlay }]}
        onPress={request.onCancel}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.text }]}>{request.title}</Text>
            <Text style={[styles.message, { color: colors.textSecondary }]}>{request.message}</Text>
            {request.inputDefaultValue !== undefined && (
              <TextInput
                accessibilityLabel={request.message}
                style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceVariant }]}
                value={value}
                onChangeText={setValue}
                placeholder={request.inputDefaultValue}
                placeholderTextColor={colors.textMuted}
                maxLength={120}
              />
            )}
          </View>
          {/* iOS alert actions: a hairline-separated strip across the full
              width; the tint marks both buttons, a destructive confirm in red,
              the default action in medium weight. */}
          <View style={[styles.actions, { borderTopColor: colors.border }]}>
            {request.singleAction === true ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={request.onCancel}
                style={styles.action}>
                <Text style={[styles.actionText, { color: colors.accent }]}>
                  {request.cancelText ?? t('Common_No')}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => request.onConfirm(value)}
              style={[
                styles.action,
                request.singleAction === true ? null : styles.actionDivider,
                request.singleAction === true ? null : { borderLeftColor: colors.border },
              ]}>
              <Text
                style={[
                  styles.actionText,
                  styles.actionTextStrong,
                  { color: request.destructive === true ? colors.error : colors.accent },
                ]}>
                {request.confirmText}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * A question with more than two real answers - currently the photograph source
 * (Camera / Gallery / Cancel).
 *
 * It is deliberately NOT a `ConfirmRequest`: in the old two-button dialog the
 * cancel side had to carry "Gallery", so every dismissal (backdrop, Android
 * back, and the Cancel row) launched the system picker. Here `onCancel` is the
 * ONLY thing dismissal can do, and a picker starts only from an explicit
 * choice. The card swallows its own touches so a tap on the text never counts
 * as a backdrop tap.
 */
export interface ChoiceDialogRequest {
  title: string;
  message: string;
  /** Neutral dismissal label ("Cancel"). */
  cancelText: string;
  /** Deliberate actions in reading order (e.g. Camera, Gallery). */
  choices: Array<{ label: string; onPress: () => void }>;
  onCancel: () => void;
}

export function ChoiceDialog({
  request,
  isDark,
}: {
  request: ChoiceDialogRequest;
  isDark: boolean;
}): React.JSX.Element {
  const colors = themeColors(isDark);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={request.onCancel}>
      <Pressable
        testID="choice-dialog-scrim"
        style={[styles.scrim, { backgroundColor: colors.overlay }]}
        onPress={request.onCancel}>
        <View
          testID="choice-dialog-card"
          style={[styles.dialog, { backgroundColor: colors.surface }]}
          // A responder on the card stops the tap from reaching the scrim, so the
          // dialog body itself never dismisses it (children keep their own taps).
          onStartShouldSetResponder={() => true}>
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.text }]}>{request.title}</Text>
            <Text style={[styles.message, { color: colors.textSecondary }]}>{request.message}</Text>
          </View>
          <View style={styles.choices}>
            {request.choices.map((choice) => (
              <Pressable
                key={choice.label}
                accessibilityRole="button"
                accessibilityLabel={choice.label}
                onPress={choice.onPress}
                style={({ pressed }) => [
                  styles.choiceRow,
                  { borderTopColor: colors.border },
                  pressed && { backgroundColor: colors.surfaceVariant },
                ]}>
                <Text style={[styles.actionText, styles.actionTextStrong, { color: colors.accent }]}>
                  {choice.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={request.cancelText}
              onPress={request.onCancel}
              style={({ pressed }) => [
                styles.choiceRow,
                { borderTopColor: colors.border },
                pressed && { backgroundColor: colors.surfaceVariant },
              ]}>
              <Text style={[styles.actionText, { color: colors.textSecondary }]}>
                {request.cancelText}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * A single-line text prompt that can REFUSE a value without closing.
 *
 * `ConfirmDialog` always closes on confirm and has no place for an error, which
 * is how an invalid date used to fall through to a domain call. This dialog
 * keeps the typed value and the form on screen while `validate` reports what is
 * wrong; `today` only fills the field, it never applies anything.
 */
export interface PromptDialogRequest {
  title: string;
  message: string;
  initialValue: string;
  cancelText: string;
  confirmText: string;
  /** Optional shortcut that only FILLS the field with a known-good value. */
  today?: { label: string; value: string };
  /** Returns an error message, or null when the value is acceptable. */
  validate: (value: string) => string | null;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

export function PromptDialog({
  request,
  isDark,
}: {
  request: PromptDialogRequest;
  isDark: boolean;
}): React.JSX.Element {
  const colors = themeColors(isDark);
  const [value, setValue] = useState(request.initialValue);
  const [error, setError] = useState<string | null>(null);

  const confirm = (): void => {
    const failure = request.validate(value);
    if (failure !== null) {
      // The dialog stays open: the typed value is still there to correct.
      setError(failure);
      return;
    }
    request.onConfirm(value.trim());
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={request.onCancel}>
      <Pressable
        testID="prompt-dialog-scrim"
        style={[styles.scrim, { backgroundColor: colors.overlay }]}
        onPress={request.onCancel}>
        <View
          testID="prompt-dialog-card"
          style={[styles.dialog, { backgroundColor: colors.surface }]}
          onStartShouldSetResponder={() => true}>
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.text }]}>{request.title}</Text>
            <Text style={[styles.message, { color: colors.textSecondary }]}>{request.message}</Text>
            <View style={styles.promptRow}>
              <TextInput
                accessibilityLabel={request.message}
                style={[
                  styles.promptInput,
                  { color: colors.text, backgroundColor: colors.surfaceVariant },
                  error !== null && { borderWidth: 1, borderColor: colors.error },
                ]}
                value={value}
                onChangeText={(next) => {
                  setValue(next);
                  if (error !== null) {
                    setError(null);
                  }
                }}
                placeholder={request.initialValue}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={120}
              />
              {request.today !== undefined && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={request.today.label}
                  onPress={() => {
                    setValue(request.today?.value ?? '');
                    setError(null);
                  }}
                  hitSlop={6}
                  style={({ pressed }) => [styles.promptChip, { opacity: pressed ? 0.6 : 1 }]}>
                  <Text style={[styles.promptChipText, { color: colors.accent }]}>
                    {request.today.label}
                  </Text>
                </Pressable>
              )}
            </View>
            {error !== null && (
              <Text
                testID="prompt-dialog-error"
                style={[styles.promptError, { color: colors.error }]}>
                {error}
              </Text>
            )}
          </View>
          <View style={styles.choices}>
            {/* Full-width rows: "Apply template" is two words and would be
                squeezed into a half-width strip (it wrapped on a 360 dp phone). */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={request.confirmText}
              onPress={confirm}
              style={({ pressed }) => [
                styles.choiceRow,
                { borderTopColor: colors.border },
                pressed && { backgroundColor: colors.surfaceVariant },
              ]}>
              <Text style={[styles.actionText, styles.actionTextStrong, { color: colors.accent }]}>
                {request.confirmText}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={request.cancelText}
              onPress={request.onCancel}
              style={({ pressed }) => [
                styles.choiceRow,
                { borderTopColor: colors.border },
                pressed && { backgroundColor: colors.surfaceVariant },
              ]}>
              <Text style={[styles.actionText, { color: colors.textSecondary }]}>
                {request.cancelText}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

/** Floating status caption (spec 6.6) - bottom-right above the tab bar. */
export function StatusCaption(): React.JSX.Element | null {
  const { status, isDark } = useApp();
  if (status === null) {
    return null;
  }
  const colors = themeColors(isDark);
  return (
    <View pointerEvents="none" style={styles.captionHost}>
      <View style={[styles.caption, { backgroundColor: colors.surface }]}>
        <Text style={{ color: colors.text }}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  /** iOS alert: narrow centered card, 14 pt corners, hairline action strip. */
  dialog: {
    borderRadius: 16,
    width: '78%',
    maxWidth: 320,
    overflow: 'hidden',
    ...cardShadow,
  },
  content: { paddingHorizontal: 18, paddingTop: 20, alignItems: 'center' },
  title: { fontSize: 17, fontFamily: fonts.medium, textAlign: 'center' },
  message: { fontSize: 14, marginTop: 6, lineHeight: 20, textAlign: 'center' },
  input: {
    marginTop: 14,
    alignSelf: 'stretch',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  action: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actionDivider: { borderLeftWidth: StyleSheet.hairlineWidth },
  actionText: { fontSize: 17, textAlign: 'center' },
  actionTextStrong: { fontFamily: fonts.medium },
  /** Stacked answer rows of the photo-source choice (Camera / Gallery / Cancel). */
  choices: { marginTop: 4 },
  choiceRow: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  /** Text prompt: the field and its optional "Today" shortcut share one row. */
  promptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    alignSelf: 'stretch',
    marginTop: 14,
  },
  promptInput: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    textAlign: 'center',
  },
  promptChip: { minHeight: 40, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  promptChipText: { fontSize: 13, fontFamily: fonts.medium },
  promptError: { marginTop: 8, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  captionHost: { position: 'absolute', right: 14, bottom: 100, left: 14, alignItems: 'flex-end' },
  caption: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...cardShadow,
    elevation: 4,
  },
});