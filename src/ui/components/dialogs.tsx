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
            <Pressable
              accessibilityRole="button"
              onPress={request.onCancel}
              style={styles.action}>
              <Text style={[styles.actionText, { color: colors.accent }]}>
                {request.cancelText ?? t('Common_No')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => request.onConfirm(value)}
              style={[styles.action, styles.actionDivider, { borderLeftColor: colors.border }]}>
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
    borderRadius: 14,
    width: '78%',
    maxWidth: 320,
    overflow: 'hidden',
    ...cardShadow,
  },
  content: { paddingHorizontal: 16, paddingTop: 18, alignItems: 'center' },
  title: { fontSize: 17, fontFamily: fonts.medium, textAlign: 'center' },
  message: { fontSize: 13, marginTop: 5, lineHeight: 18, textAlign: 'center' },
  input: {
    marginTop: 14,
    alignSelf: 'stretch',
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
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
  captionHost: { position: 'absolute', right: 14, bottom: 70, left: 14, alignItems: 'flex-end' },
  caption: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...cardShadow,
    elevation: 4,
  },
});