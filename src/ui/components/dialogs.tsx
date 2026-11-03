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
//
// ONE exception: the questions about the WHOLE account (sign out, and the
// "couldn't sync" card that replaces it when the upload before it is refused)
// use the centered ACCOUNT CARD - `AccountCard` below, requested with
// `layout: 'card'` - where a badge, centered copy, a tinted note and two pill
// answers say more in less space.

import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fonts,
  cardShadow,
  raisedShadow,
  themeColors,
  tintAlpha,
  typeScale,
  type ThemeColors,
} from '../theme';
import { useApp } from '../appContext';
import { t } from '../strings';
import { Icon, FeatherIcon, type FeatherName, type IconName } from './icons';


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

/**
 * The centered ACCOUNT card - the one surface that is not a bottom sheet.
 *
 * It is reserved for the questions about the whole account (sign out, and the
 * "couldn't sync" card that replaces it when the upload before the sign-out is
 * refused) and for the destructive questions with a shape of their own (clearing
 * a meal, deleting a photograph), where:
 *
 *   - the glyph in the quiet badge above the title says WHICH account action the
 *     card is about (log-out), instead of opening a row;
 *   - the title and the caption are centered, so the card reads as one short
 *     statement rather than as a list of answers;
 *   - a tinted note can state what just happened to the data ("Sync failed -
 *     you're still signed in") right under the caption;
 *   - the two answers sit side by side at the bottom, because account labels are
 *     short ("Cancel" / "Sync & sign out") - the reason the record-level sheet
 *     stacks its rows does not apply here.
 *
 * There is no close X: scrim tap and Android Back dismiss through `onDismiss`,
 * which is the same action as the neutral answer, exactly like every sheet.
 *
 * This is the surface WITHOUT a Modal around it - the card counterpart of
 * `DialogSheet` - so a surface that already IS a modal (the full-screen photo
 * viewer) can stack the same question inside its own window: Android does not
 * stack two Modals reliably. `Card` below is the ordinary Modal-wrapped one.
 */
/**
 * The badge glyph of the centered card: Ionicons, or Feather for the shapes only
 * it draws (the meal card's `trash-2` bin). The question then wears the SAME
 * glyph as the tool that opened it.
 */
export type CardBadge = { icon: IconName } | { feather: FeatherName };

export function DialogCard(props: {
  /** `confirm-dialog`: scrim and card ids. */
  name: string;
  title: string;
  caption?: string;
  /** Glyph of the badge; `undefined` draws no badge at all. */
  badge?: CardBadge;
  /**
   * Card layout only: how the badge is painted. `quiet` (default) is the neutral
   * control wash with the secondary ink - the badge of a question that deletes
   * nothing (a sign-out ends the session, it keeps every record). `danger` is the
   * wash of the red with the red glyph, for the questions that DO remove
   * something (clearing a meal).
   */
  badgeTone?: 'quiet' | 'danger';
  destructive?: boolean;
  /** The paragraph under the caption: what the answer actually does. */
  body?: string;
  /** ONE bold line in the red ink, the consequence to read before answering. */
  warning?: string;
  note?: { icon: IconName; title: string; message: string };
  /** Working state: the answers are replaced by the spinner/bar block. */
  busy?: CardProgress;
  isDark: boolean;
  onDismiss: () => void;
  actions: React.ReactNode;
}): React.JSX.Element {
  const colors = themeColors(props.isDark);
  const busy = props.busy !== undefined;
  const ratio = props.busy?.progress;
  const danger = props.badgeTone === 'danger';
  const badgeInk = danger ? colors.missed : colors.textSecondary;
  return (
    <Pressable
      testID={`${props.name}-scrim`}
      style={[styles.cardScrim, { backgroundColor: colors.overlay }]}
      // A working card cannot be dismissed: the upload is still running and it is
      // the only copy of those records until it settles.
      onPress={busy ? undefined : props.onDismiss}>
      <View
        testID={`${props.name}-card`}
        style={[styles.card, { backgroundColor: colors.surface }]}
        onStartShouldSetResponder={() => true}>
        {props.badge !== undefined && (
          <View
            style={[
              styles.badge,
              {
                backgroundColor: danger
                  ? tintAlpha(colors.missed, props.isDark ? '2E' : '1F')
                  : colors.surfaceVariant,
              },
            ]}>
            {'icon' in props.badge ? (
              <Icon name={props.badge.icon} size={26} color={badgeInk} />
            ) : (
              <FeatherIcon name={props.badge.feather} size={26} color={badgeInk} />
            )}
          </View>
        )}
        <Text style={[styles.cardTitle, { color: colors.text }]}>{props.title}</Text>
        {props.caption !== undefined && props.caption !== '' && (
          <Text style={[styles.cardCaption, { color: colors.textMuted }]}>{props.caption}</Text>
        )}
        {props.body !== undefined && props.body !== '' && (
          <Text style={[styles.cardBody, { color: colors.textSecondary }]}>{props.body}</Text>
        )}
        {props.warning !== undefined && props.warning !== '' && (
          <Text style={[styles.cardWarning, { color: colors.missed }]}>{props.warning}</Text>
        )}
        {props.note !== undefined && (
          <View
            testID={`${props.name}-note`}
            style={[
              styles.note,
              { backgroundColor: tintAlpha(colors.warning, props.isDark ? '2E' : '1F') },
            ]}>
            <Icon name={props.note.icon} size={24} color={colors.warning} />
            <View style={styles.noteCopy}>
              <Text style={[styles.noteTitle, { color: colors.text }]}>{props.note.title}</Text>
              <Text style={[styles.noteMessage, { color: colors.textMuted }]}>
                {props.note.message}
              </Text>
            </View>
          </View>
        )}
        {props.busy === undefined ? (
          <View style={styles.cardActions}>{props.actions}</View>
        ) : (
          /**
           * The working block of the round-3 mockup: the bar, the counted line in
           * the primary ink and the one reassurance - no spinner, because the bar
           * already is the progress report, and the title/caption above say what
           * the wait is for.
           */
          <View style={styles.cardBusy}>
            {ratio !== undefined && (
              <View style={[styles.syncTrack, { backgroundColor: colors.surfaceVariant }]}>
                <View
                  style={[
                    styles.syncFill,
                    {
                      backgroundColor: colors.accent,
                      width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`,
                    },
                  ]}
                />
              </View>
            )}
            {props.busy.detail !== undefined && props.busy.detail !== '' && (
              <Text style={[styles.syncCount, { color: colors.text }]}>{props.busy.detail}</Text>
            )}
            {props.busy.hint !== undefined && props.busy.hint !== '' && (
              <Text style={[styles.syncHint, { color: colors.textMuted }]}>{props.busy.hint}</Text>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** The account card inside a Modal (same fade-in as every sheet). */
function Card(props: {
  name: string;
  title: string;
  caption?: string;
  badge?: CardBadge;
  badgeTone?: 'quiet' | 'danger';
  destructive?: boolean;
  body?: string;
  warning?: string;
  note?: { icon: IconName; title: string; message: string };
  busy?: CardProgress;
  isDark: boolean;
  onDismiss: () => void;
  actions: React.ReactNode;
}): React.JSX.Element {
  return (
    <Modal
      transparent
      animationType="fade"
      visible
      // Android Back is inert while the card works, exactly like the busy sheet.
      onRequestClose={props.busy !== undefined ? () => undefined : props.onDismiss}>
      <DialogCard {...props} />
    </Modal>
  );
}

/**
 * One answer of the card: a full-height pill beside its sibling. The destructive
 * answer takes the red fill (with `onState` ink, which is white on the deep light
 * red and near-black on the bright dark one) and the neutral one the quiet
 * control fill, so "Cancel" is visibly the way out and the red button is visibly
 * the decision.
 *
 * Exported beside `DialogCard`, so a caller that builds the card itself (the
 * photo viewer) gets the same pills instead of a look-alike.
 */
export function DialogCardAction(props: {
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  destructive?: boolean;
}): React.JSX.Element {
  const destructive = props.destructive === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.cardAction,
        {
          backgroundColor: destructive ? props.colors.error : props.colors.surfaceVariant,
          opacity: pressed ? 0.82 : 1,
        },
      ]}>
      <Text
        numberOfLines={1}
        style={[
          styles.cardActionLabel,
          { color: destructive ? props.colors.onState : props.colors.text },
        ]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/**
 * The bottom-edge sheet that carries progress. It has two faces:
 *
 * - the default one: a spinner and one sentence (plus an optional thin bar,
 *   count and hint) - used by the short jobs such as syncing on demand or
 *   saving a photo;
 * - the account SYNC sheet, requested with `subtitle`: the round-3 mockup's
 *   layout - a left-aligned headline, the current step, a thick bar, the number
 *   of documents that arrived and the "keep the app open" line. Signing in is the
 *   one transfer long enough (and important enough) to deserve it.
 *
 * It deliberately has no close control and its scrim never dismisses - the
 * operation it reports owns the screen until it settles.
 */
export function LoadingSheet(props: {
  /** `busy-dialog` / `loading-dialog`: scrim and card ids. */
  name: string;
  /** The one sentence that says what is happening ("Saving the photograph…"). */
  message: string;
  /**
   * The account-boundary SYNC sheet: a second, muted line under the message
   * ("Downloading your saved meals and photos"). When it is set the sheet uses
   * the big left-aligned layout of the mockup - headline, subtitle, a thick bar,
   * the counted line and the reassurance - instead of the compact spinner row.
   */
  subtitle?: string;
  /** Muted line under the message (document counts, "waiting for the connection"). */
  detail?: string;
  /** Muted hint at the very bottom ("this can take a few seconds"). */
  hint?: string;
  /** 0-1 determinate progress; null/undefined = indeterminate spinner. */
  progress?: number | null;
  isDark: boolean;
}): React.JSX.Element {
  const colors = themeColors(props.isDark);
  const insets = useSafeAreaInsets();
  const ratio =
    props.progress === null || props.progress === undefined
      ? null
      : Math.min(1, Math.max(0, props.progress));
  return (
    // The scrim claims its own touches: a busy sheet is a report, not a question,
    // so there is nothing to answer and nothing to dismiss.
    <View
      testID={`${props.name}-scrim`}
      onStartShouldSetResponder={() => true}
      style={[styles.scrim, { backgroundColor: colors.overlay }]}>
      <View
        testID={`${props.name}-card`}
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, paddingBottom: insets.bottom + 18 },
        ]}
        onStartShouldSetResponder={() => true}>
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        {props.subtitle === undefined ? (
          <View style={styles.loadingBody}>
            <View style={styles.loadingHead}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={[styles.loadingMessage, { color: colors.text }]}>{props.message}</Text>
            </View>
            {ratio !== null && (
              <View style={[styles.loadingTrack, { backgroundColor: colors.surfaceVariant }]}>
                <View
                  style={[
                    styles.loadingFill,
                    { width: `${Math.round(ratio * 100)}%`, backgroundColor: colors.accent },
                  ]}
                />
              </View>
            )}
            {props.detail !== undefined && props.detail !== '' && (
              <Text style={[styles.loadingDetail, { color: colors.textMuted }]}>{props.detail}</Text>
            )}
            {props.hint !== undefined && props.hint !== '' && (
              <Text style={[styles.loadingHint, { color: colors.textMuted }]}>{props.hint}</Text>
            )}
          </View>
        ) : (
          /**
           * The account SYNC sheet (the round-3 mockup): a headline that names the
           * transfer, the step underneath, a thick bar, the counted line in the
           * primary ink and one reassurance - all left aligned, because this is a
           * report the user reads, not a sentence beside a spinner.
           */
          <View style={styles.syncBody}>
            <Text style={[styles.syncTitle, { color: colors.text }]}>{props.message}</Text>
            <Text style={[styles.syncSubtitle, { color: colors.textMuted }]}>{props.subtitle}</Text>
            {ratio !== null && (
              <View style={[styles.syncTrack, { backgroundColor: colors.surfaceVariant }]}>
                <View
                  style={[
                    styles.syncFill,
                    { width: `${Math.round(ratio * 100)}%`, backgroundColor: colors.accent },
                  ]}
                />
              </View>
            )}
            {props.detail !== undefined && props.detail !== '' && (
              <Text style={[styles.syncCount, { color: colors.text }]}>{props.detail}</Text>
            )}
            {props.hint !== undefined && props.hint !== '' && (
              <Text style={[styles.syncHint, { color: colors.textMuted }]}>{props.hint}</Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * The loading sheet inside its own Modal window: the app-wide "please wait"
 * surface. There is no dismiss control and the Android back key is ignored, so
 * the page behind stays untouched until the operation has settled.
 */
export function LoadingDialog({
  name = 'loading-dialog',
  ...rest
}: {
  message: string;
  /** Set = the big account-sync layout (headline + subtitle + thick bar). */
  subtitle?: string;
  detail?: string;
  hint?: string;
  progress?: number | null;
  name?: string;
  isDark: boolean;
}): React.JSX.Element {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
      <LoadingSheet name={name} {...rest} />
    </Modal>
  );
}

/** One answer row: leading glyph, label, optional chevron, hairline above. */
export function SheetRow(props: {
  label: string;
  /**
   * Glyph before the label. The answer rows of a question carry one so the rows
   * line up; a plain "No" asks for `undefined` and reads as quiet text, because
   * neither an X nor a bin says anything about a sign-out.
   */
  icon?: IconName;
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
      {props.icon !== undefined && <Icon name={props.icon} size={20} color={ink} />}
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

/**
 * The working state of the account card: while it is set the card IS the
 * progress surface - the two answers give way to the bar, the counted line and
 * the reassurance, and nothing dismisses the card until the operation settles
 * (scrim, Android Back and the answers are all inert), because leaving would
 * hide an upload that is still the only copy of the records.
 */
export interface CardProgress {
  /** 0-1 of the bar; omitted = no bar, the copy alone reports the work. */
  progress?: number;
  /** Primary-ink line under the bar ("1 of 3 changes synced"). */
  detail?: string;
  /** Muted reassurance under it ("Please keep the app open."). */
  hint?: string;
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
   * Glyph of the confirm row. Defaults to the trash can for a destructive answer
   * and the checkmark otherwise. A sign-out is destructive for the session but
   * deletes nothing, so it asks for the log-out glyph instead of a bin; `null`
   * draws no glyph at all.
   */
  confirmIcon?: IconName | null;
  /**
   * Glyph of the cancel row. Defaults to the X; `null` draws none, which is what
   * a plain "No" wants - a cross next to "No" reads as "close the dialog", not
   * as the answer.
   */
  cancelIcon?: IconName | null;
  /**
   * Which surface asks the question.
   *
   *   `sheet` (default)  the bottom sheet every record-level question uses.
   *   `card`             the centered alert card, reserved for the questions that
   *                      are about the WHOLE account - where a highlighted note
   *                      about what happens to the data belongs right next to the
   *                      answer, and the two answers sit side by side.
   *
   * The card has no answer ROWS: `confirmIcon` becomes the glyph of the badge
   * above the title (the answers are plain pill buttons, so their row glyphs are
   * not drawn) and `singleAction` collapses the pair into one full-width answer.
   */
  layout?: 'sheet' | 'card';
  /**
   * Card layout only: the paragraph under the caption - what the answer actually
   * does ("This clears the meal's details and status, …").
   */
  body?: string;
  /**
   * Card layout only: ONE bold line in the red ink, the consequence the user has
   * to read before answering ("This can't be undone.").
   */
  warning?: string;
  /**
   * Card layout only: the glyph of the badge. Defaults to `confirmIcon`; `feather`
   * is for the shapes only Feather draws, so a destructive card can wear the same
   * bin as the tool that opened it.
   */
  badge?: CardBadge;
  /**
   * Card layout only: how the badge is painted. `quiet` (default) is the neutral
   * control wash with the secondary ink - a question that deletes nothing (a
   * sign-out ends the session, it keeps every record). `danger` is a wash of the
   * missed red with the red glyph, for the questions that DO remove something.
   */
  badgeTone?: 'quiet' | 'danger';
  /**
   * Card layout only: a tinted panel under the message - a leading glyph, a bold
   * caption and one or two quiet lines (the sign-out promises the upload there).
   */
  note?: { icon: IconName; title: string; message: string };
  /**
   * Card layout only: the card is WORKING. The answers are replaced by the
   * spinner/bar block and every dismissal is ignored until the operation
   * settles; the caller then either drops the card or hands it a new request.
   */
  busy?: CardProgress;
  /**
   * True = only the confirm button is drawn (an acknowledgement, not a choice).
   * Used when the app must state an outcome the user cannot change - e.g. a
   * sign-out that was refused because the changes could not be uploaded.
   */
  singleAction?: boolean;
  /**
   * A question that needs TYPED text is `PromptDialog`'s job, not this one's: it
   * can refuse a value and keep the form open, which a two-answer confirm cannot
   * (the old pre-filled name field here is gone with the "name it after the day"
   * default - see `src/ui/templateName.ts`).
   */
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
  // `null` means "draw no glyph"; an omitted glyph keeps the historical default,
  // so every other question in the app looks exactly as it did.
  const cancelIcon: IconName | undefined =
    request.cancelIcon === null ? undefined : (request.cancelIcon ?? 'close');
  const confirmIcon: IconName | undefined =
    request.confirmIcon === null
      ? undefined
      : (request.confirmIcon ?? (request.destructive === true ? 'trash-outline' : 'checkmark'));
  if (request.layout === 'card') {
    // The account card: the badge carries the glyph of the decision (the log-out
    // sign for a sign-out), the two answers are pills side by side, and there is
    // no close X - the neutral answer and the scrim are the two ways out.
    return (
      <Card
        name="confirm-dialog"
        title={request.title}
        caption={request.message}
        badge={request.badge ?? (confirmIcon === undefined ? undefined : { icon: confirmIcon })}
        badgeTone={request.badgeTone}
        destructive={request.destructive === true}
        body={request.body}
        warning={request.warning}
        note={request.note}
        busy={request.busy}
        isDark={isDark}
        onDismiss={request.onCancel}
        actions={
          <>
            {request.singleAction === true ? null : (
              <DialogCardAction
                label={request.cancelText ?? t('Common_No')}
                onPress={request.onCancel}
                colors={colors}
              />
            )}
            <DialogCardAction
              label={request.confirmText}
              onPress={() => request.onConfirm()}
              colors={colors}
              destructive={request.destructive === true}
            />
          </>
        }
      />
    );
  }
  return (

    <Sheet
      name="confirm-dialog"
      title={request.title}
      caption={request.message}
      isDark={isDark}
      onDismiss={request.onCancel}>
      <View style={styles.rows}>
        {request.singleAction === true ? null : (
          <SheetRow
            label={request.cancelText ?? t('Common_No')}
            icon={cancelIcon}
            onPress={request.onCancel}
            colors={colors}
          />
        )}
        <SheetRow
          label={request.confirmText}
          icon={confirmIcon}
          tone={request.destructive === true ? 'danger' : 'accent'}
          onPress={() => request.onConfirm()}
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
 *
 * A question whose value has a fixed shape (a date) also passes `sanitize` and
 * `keyboardType`: the field then cannot hold a character that has no business in
 * it, so the user never produces an error the dialog has to explain.
 */
export interface PromptDialogRequest {
  title: string;
  message: string;
  initialValue: string;
  cancelText: string;
  confirmText: string;
  /** Optional shortcut that only FILLS the field with a known-good value. */
  today?: { label: string; value: string };
  /**
   * Keyboard the platform shows. The target-date prompt asks for the number pad:
   * `sanitize` inserts the separators, so no dash key is needed.
   */
  keyboardType?: TextInputProps['keyboardType'];
  /**
   * Runs on EVERY keystroke BEFORE the value is stored, so a character the field
   * must not hold never enters the draft at all.
   */
  sanitize?: (raw: string) => string;
  /** Longest accepted text (default `PROMPT_MAX_LENGTH`). */
  maxLength?: number;
  /** Returns an error message, or null when the value is acceptable. */
  validate: (value: string) => string | null;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

/** Default ceiling for a prompt's text: a template NAME is the longest question. */
const PROMPT_MAX_LENGTH = 120;

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
              // The mask runs FIRST: a forbidden character never reaches the
              // field, the error line or the validator.
              setValue(request.sanitize === undefined ? next : request.sanitize(next));
              if (error !== null) {
                setError(null);
              }
            }}
            placeholder={request.initialValue}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={request.keyboardType}
            maxLength={request.maxLength ?? PROMPT_MAX_LENGTH}
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
  /** Loading sheet body: spinner row, optional bar, optional muted lines. */
  loadingBody: { paddingTop: 16, paddingHorizontal: 20, rowGap: 12 },
  loadingHead: { flexDirection: 'row', alignItems: 'center', columnGap: 12 },
  loadingMessage: { flex: 1, minWidth: 0, fontSize: 15, fontFamily: fonts.medium, lineHeight: 21 },
  loadingTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  loadingFill: { height: 8, borderRadius: 4 },
  loadingDetail: { fontSize: 12, lineHeight: 17 },
  loadingHint: { fontSize: 12, lineHeight: 17 },
  /**
   * The account sync sheet (the round-3 mockup): a left-aligned headline, the
   * current step under it, a thick bar, the counted line and the "keep it open"
   * hint. The paddings are wider than the plain sheet's because this block is
   * read as a small page rather than glanced at as a status line.
   */
  syncBody: { paddingHorizontal: 24, paddingTop: 22 },
  syncTitle: {
    fontSize: typeScale.title,
    lineHeight: 33,
    fontFamily: fonts.bold,
    letterSpacing: -0.6,
  },
  syncSubtitle: { fontSize: typeScale.headline, lineHeight: 23, marginTop: 6 },
  syncTrack: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 22 },
  syncFill: { height: 10, borderRadius: 5 },
  syncCount: { fontSize: typeScale.headline, lineHeight: 23, fontFamily: fonts.medium, marginTop: 16 },
  syncHint: { fontSize: typeScale.subheadline, lineHeight: 21, marginTop: 10 },
  captionHost: { position: 'absolute', right: 14, bottom: 100, left: 14, alignItems: 'flex-end' },
  caption: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...cardShadow,
    elevation: 4,
  },
  /**
   * The account card: centered in the window (the one dialog that is not a
   * bottom sheet), padded so it never touches a screen edge, and capped so it
   * stays a card on a tablet instead of becoming a full-width band.
   */
  cardScrim: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    paddingTop: 24,
    paddingBottom: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    ...raisedShadow,
  },
  /** The quiet glyph badge above the title (56 pt, the mockup's rounded square). */
  badge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: fonts.bold,
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 14,
  },
  cardCaption: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  /** The card's paragraph: what the answer does, in the readable secondary ink. */
  cardBody: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 6,
  },
  /** The consequence line: bold, red, one sentence, right under the paragraph. */
  cardWarning: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fonts.bold,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 6,
  },
  /** The note: a warning wash, a leading glyph, a bold caption and quiet lines. */
  note: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    columnGap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: 16,
  },
  noteCopy: { flex: 1, minWidth: 0 },
  noteTitle: { fontSize: 14, lineHeight: 19, fontFamily: fonts.bold },
  noteMessage: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  /** The two answers of the card share one row, full width, 48 pt tall. */
  cardActions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    columnGap: 10,
    marginTop: 20,
  },
  cardAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cardActionLabel: { fontSize: 15, fontFamily: fonts.medium },
  /**
   * The working block that takes the answers' place. No padding of its own: the
   * bar, the counted line and the hint carry their own rhythm, so the block
   * matches the mockup's spacing exactly.
   */
  cardBusy: { alignSelf: 'stretch' },
});