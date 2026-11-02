// Confirm dialogs (spec 6.5) + the floating status caption (6.6).
// Every dialog has two buttons; dismissal (back/scrim tap) equals the
// CANCEL action - "default No" for destructive prompts.
//
// ONE surface for every question (the round-3 review sheet): the dialog rises
// from the bottom edge with a grabber, a bold title with a close X, an optional
// muted caption and a hairline, and the answers are full-width ROWS with a
// leading glyph - a destructive answer in the red ink, the neutral one quiet.
// A row is used instead of an iOS-style split strip because the app's questions
// have long, explicit labels ("Apply template", "Delete photo") that do not fit
// beside each other on a 360 dp phone.

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, cardShadow, themeColors, type ThemeColors } from '../theme';
import { useApp } from '../appContext';
import { t } from '../strings';
import { Icon, type IconName } from './icons';


/**
 * The sheet itself, without a Modal around it, so a surface that already IS a
 * modal (the full-screen photo viewer) can stack the same question inside its
 * own window - Android does not stack two Modals reliably.
 */
export function DialogSheet(props: {
  /** `choice-dialog` / `prompt-dialog` / `confirm-dialog`: scrim and card ids. */
  name: string;
  title: string;
  /** Second line under the title (the question's explanation). */
  caption?: string;
  isDark: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const colors = themeColors(props.isDark);
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      testID={`${props.name}-scrim`}
      style={[styles.scrim, { backgroundColor: colors.overlay }]}
      onPress={props.onDismiss}>
      <View
        testID={`${props.name}-card`}
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, paddingBottom: insets.bottom + 12 },
        ]}
        onStartShouldSetResponder={() => true}>
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{props.title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Common_Close')}
            onPress={props.onDismiss}
            hitSlop={6}
            style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        {props.caption !== undefined && props.caption !== '' && (
          <Text style={[styles.sheetCaption, { color: colors.textMuted }]}>{props.caption}</Text>
        )}
        {props.children}
      </View>
    </Pressable>
  );
}

/** The one dialog surface inside a Modal: everything the app asks, everywhere. */
function Sheet(props: {
  name: string;
  title: string;
  caption?: string;
  isDark: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={props.onDismiss}>
      <DialogSheet {...props} />
    </Modal>
  );
}

/** One answer row: leading glyph, label, optional chevron, hairline above. */
export function SheetRow(props: {
  label: string;
  /** Glyph before the label - every row has one, so the rows line up. */
  icon: IconName;
  onPress: () => void;
  colors: ThemeColors;
  /** `accent` = the action that does something, `danger` = it deletes. */
  tone?: 'accent' | 'danger' | 'neutral';
  /** An action that opens something else, not one that finishes the dialog. */
  chevron?: boolean;
}): React.JSX.Element {
  const tone = props.tone ?? 'neutral';
  const ink =
    tone === 'danger'
      ? props.colors.error
      : tone === 'accent'
        ? props.colors.accent
        : props.colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: props.colors.hairline },
        pressed && { backgroundColor: props.colors.surfaceVariant },
      ]}>
      <Icon name={props.icon} size={20} color={ink} />
      <Text
        style={[
          styles.rowLabel,
          { color: tone === 'neutral' ? props.colors.text : ink },
          tone !== 'neutral' && styles.rowLabelStrong,
        ]}>
        {props.label}
      </Text>
      {props.chevron === true && (
        <Icon name="chevron-forward" size={16} color={props.colors.textMuted} />
      )}
    </Pressable>
  );
}

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
    <Sheet
      name="confirm-dialog"
      title={request.title}
      caption={request.message}
      isDark={isDark}
      onDismiss={request.onCancel}>
      {request.inputDefaultValue !== undefined && (
        <View style={styles.body}>
          <TextInput
            accessibilityLabel={request.message}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceVariant }]}
            value={value}
            onChangeText={setValue}
            placeholder={request.inputDefaultValue}
            placeholderTextColor={colors.textMuted}
            maxLength={120}
          />
        </View>
      )}
      <View style={styles.rows}>
        {request.singleAction === true ? null : (
          <SheetRow
            label={request.cancelText ?? t('Common_No')}
            icon="close"
            onPress={request.onCancel}
            colors={colors}
          />
        )}
        <SheetRow
          label={request.confirmText}
          icon={request.destructive === true ? 'trash-outline' : 'checkmark'}
          tone={request.destructive === true ? 'danger' : 'accent'}
          onPress={() => request.onConfirm(value)}
          colors={colors}
        />
      </View>
    </Sheet>
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
  choices: Array<{ label: string; onPress: () => void; icon?: IconName }>;
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
    <Sheet
      name="choice-dialog"
      title={request.title}
      caption={request.message}
      isDark={isDark}
      onDismiss={request.onCancel}>
      <View style={styles.rows}>
        {request.choices.map((choice) => (
          <SheetRow
            key={choice.label}
            label={choice.label}
            icon={choice.icon ?? 'ellipse-outline'}
            tone="accent"
            chevron
            onPress={choice.onPress}
            colors={colors}
          />
        ))}
        <SheetRow
          label={request.cancelText}
          icon="close"
          onPress={request.onCancel}
          colors={colors}
        />
      </View>
    </Sheet>
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
    <Sheet
      name="prompt-dialog"
      title={request.title}
      caption={request.message}
      isDark={isDark}
      onDismiss={request.onCancel}>
      <View style={styles.body}>
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
          <Text testID="prompt-dialog-error" style={[styles.promptError, { color: colors.error }]}>
            {error}
          </Text>
        )}
      </View>
      <View style={styles.rows}>
        {/* Full-width rows: "Apply template" is two words and would be squeezed
            into a half-width strip (it wrapped on a 360 dp phone). */}
        <SheetRow
          label={request.confirmText}
          icon="checkmark"
          tone="accent"
          onPress={confirm}
          colors={colors}
        />
        <SheetRow
          label={request.cancelText}
          icon="close"
          onPress={request.onCancel}
          colors={colors}
        />
      </View>
    </Sheet>
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
  /**
   * The sheet rises from the bottom edge over a dim scrim - the round-3 review
   * dialog surface. `maxWidth` keeps it from stretching across a tablet, and the
   * card claims its own touches so only the scrim dismisses.
   */
  scrim: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    overflow: 'hidden',
  },
  /** The little handle that says "this sheet came up from the bottom". */
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    paddingLeft: 16,
    paddingRight: 8,
    marginTop: 8,
    minHeight: 40,
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  /** The question's explanation, muted, under the title. */
  sheetCaption: { fontSize: 13, lineHeight: 19, paddingHorizontal: 16, marginTop: 2 },
  /** Content between the caption and the rows (input fields, errors). */
  body: { paddingHorizontal: 16, paddingTop: 14 },
  rows: { marginTop: 12 },
  /** One answer row: 52 pt tall, leading glyph, hairline above. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1, minWidth: 0, fontSize: 15, fontFamily: fonts.regular },
  rowLabelStrong: { fontFamily: fonts.medium },
  /** The sheet's headline: bold, left aligned, with the close X beside it. */
  title: { flex: 1, minWidth: 0, fontSize: 20, fontFamily: fonts.bold, letterSpacing: -0.3 },
  input: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
  },
  /** Text prompt: the field and its optional "Today" shortcut share one row. */
  promptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    alignSelf: 'stretch',
  },
  promptInput: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
  },
  promptChip: { minHeight: 40, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  promptChipText: { fontSize: 13, fontFamily: fonts.medium },
  promptError: { marginTop: 8, fontSize: 12, lineHeight: 17 },
  captionHost: { position: 'absolute', right: 14, bottom: 100, left: 14, alignItems: 'flex-end' },
  caption: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...cardShadow,
    elevation: 4,
  },
});