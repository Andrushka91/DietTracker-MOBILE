// Templates (spec 8.7) - list sorted by UpdatedAt desc; each row: name,
// kind label (Meal / Day), summary, updated timestamp, "Apply to date"
// button (defaults to today) -> status "Applied for {date}". Empty state
// text + the notice caption. Applying merges into the target date as
// PENDING entries. No destructive template management (parity with Windows).

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { MealTemplate } from '../../domain/models';
import { formatDate, parseDate } from '../../domain/analytics';
import { getTemplates } from '../../data/repositories';
import { applyTemplate } from '../../services/mealTracking';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { BarButton } from '../components/buttons';
import { ConfirmDialog, type ConfirmRequest } from '../components/dialogs';
import { fonts, cardShadow, themeColors, typeScale } from '../theme';
import { t, tFmt } from '../strings';

/**
 * Date prompt for "Apply to date" (spec 8.7). The Windows app shows a
 * CalendarDatePicker; the phone asks for the same `yyyy-MM-dd` value in a
 * small text prompt pre-filled with today, so no extra picker dependency is
 * needed. RN-only wording until the Windows resw gains the same key.
 */
const DATE_PROMPT = 'Enter the target date (yyyy-MM-dd)';

export function TemplatesScreen(): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfirmRequest | null>(null);

  const reload = useCallback(async () => {
    setTemplates(await getTemplates());
  }, []);

  // Reloaded whenever the tab comes to the front, so templates imported by a
  // background cycle are listed without a pull gesture.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // A background cycle that imported another device's templates reloads the list.
  useEffect(() => subscribeDataChange(() => void reload()), [reload]);

  /** True for a real calendar day written as yyyy-MM-dd. */
  const isDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const parsed = parseDate(value);
    return !Number.isNaN(parsed.getTime()) && formatDate(parsed) === value;
  };

  const applyToDate = async (template: MealTemplate, requested: string): Promise<void> => {
    const date = isDate(requested) ? requested : formatDate(new Date());
    await applyTemplate(template, date, app.accountId);
    setStatus(tFmt('Template_Applied', date));
    app.notifyChanged();
  };

  const requestApply = (template: MealTemplate): void => {
    setDialog({
      title: t('Template_ApplyTitle'),
      message: DATE_PROMPT,
      cancelText: t('Common_Cancel'),
      confirmText: t('Common_Ok'),
      inputDefaultValue: formatDate(new Date()),
      onCancel: () => setDialog(null),
      onConfirm: (value) => {
        setDialog(null);
        void applyToDate(template, (value ?? '').trim());
      },
    });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Templates')}</Text>
      <Text style={[styles.notice, { color: colors.textMuted }]}>{t('Template_Notice')}</Text>

      {templates.length === 0 && (
        <View style={[styles.panel, cardShadow, { backgroundColor: colors.cardFill }]}>
          <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('Template_Empty')}</Text>
        </View>
      )}

      {templates.map((template) => (
        <View
          key={template.id}
          style={[styles.panel, cardShadow, { backgroundColor: colors.cardFill }]}>
          <View style={styles.row}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {template.name}
            </Text>
            <View style={[styles.kind, { backgroundColor: colors.surfaceVariant }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                {template.isFullDay ? t('Template_KindDay') : t('Template_KindMeal')}
              </Text>
            </View>
          </View>
          <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={2}>
            {template.isFullDay
              ? tFmt('Template_DaySummary', template.templateDay.length)
              : (template.templateMeal?.title ?? '')}
          </Text>
          <Text style={[styles.updated, { color: colors.textMuted }]}>
            {template.updatedAt.slice(0, 16).replace('T', ' ')}
          </Text>
          <View style={styles.actions}>
            <BarButton
              label={t('Template_Apply')}
              accent
              onPress={() => requestApply(template)}
              colors={colors}
            />
          </View>
        </View>
      ))}

      {status !== null && <Text style={[styles.status, { color: colors.accent }]}>{status}</Text>}
      {dialog !== null && <ConfirmDialog request={dialog} isDark={app.isDark} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, paddingBottom: 104, rowGap: 10 },
  pageTitle: { fontSize: typeScale.title, fontFamily: fonts.medium },
  notice: { fontSize: 12, fontStyle: 'italic' },
  panel: { borderRadius: 16, padding: 14 },
  empty: { fontSize: 14, textAlign: 'center', paddingVertical: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', columnGap: 8 },
  name: { fontSize: 16, fontFamily: fonts.medium, flex: 1 },
  kind: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 },
  summary: { fontSize: 13, marginTop: 4 },
  updated: { fontSize: 11, marginTop: 4 },
  actions: { flexDirection: 'row', marginTop: 10 },
  status: { fontSize: 13, fontFamily: fonts.medium },
});