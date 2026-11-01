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
import { Icon } from '../components/icons';
import { fonts, metrics, pageTitleStyle, cardShadow, themeColors } from '../theme';
import { useFloatingTabBarClearance } from '../tabBar';
import { formatMediumDate, t, tFmt } from '../strings';

/**
 * Date prompt for "Apply to date" (spec 8.7). The Windows app shows a
 * CalendarDatePicker; the phone asks for the same `yyyy-MM-dd` value in a
 * small text prompt pre-filled with today, so no extra picker dependency is
 * needed. RN-only wording until the Windows resw gains the same key.
 */
const DATE_PROMPT = 'Enter the target date (yyyy-MM-dd)';

/**
 * Stored ISO timestamp -> "30 October 2026 · 20:43". A value that does not look
 * like an ISO timestamp is shown untouched, so nothing is lost if the shape ever
 * changes.
 */
function formatUpdated(value: string, sameDay: boolean): string {
  const datePart = value.slice(0, 10);
  const timePart = value.slice(11, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || timePart === '') {
    return value;
  }
  // A template named after its day does not need the date twice in one row.
  return sameDay
    ? `${t('Rn_Updated')} ${timePart}`
    : `${t('Rn_Updated')} ${formatMediumDate(datePart)} · ${timePart}`;
}

export function TemplatesScreen(): React.JSX.Element {
  const app = useApp();
  const colors = themeColors(app.isDark);
  const bottomClearance = useFloatingTabBarClearance();
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
      contentContainerStyle={[
        styles.content,
        // Same bottom room as the other pages: the floating tab bar never
        // covers the last template row.
        { paddingBottom: bottomClearance },
      ]}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Templates')}</Text>
      <Text style={[styles.notice, { color: colors.textMuted }]}>{t('Template_Notice')}</Text>

      {templates.length === 0 && (
        <View style={[styles.panel, styles.emptyPanel, cardShadow, { backgroundColor: colors.cardFill }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceVariant }]}>
            <Icon name="layers-outline" size={24} color={colors.textMuted} />
          </View>
          <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('Template_Empty')}</Text>
        </View>
      )}

      {templates.map((template) => (
        <View
          key={template.id}
          style={[styles.panel, cardShadow, { backgroundColor: colors.cardFill, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={[styles.tile, { backgroundColor: colors.surfaceVariant }]}>
              <Icon
                name={template.isFullDay ? 'calendar-outline' : 'restaurant-outline'}
                size={20}
                color={colors.textSecondary}
              />
            </View>
            <View style={styles.heading}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {isDate(template.name) ? formatMediumDate(template.name) : template.name}
              </Text>
              <Text style={[styles.updated, { color: colors.textMuted }]} numberOfLines={1}>
                {formatUpdated(template.updatedAt, isDate(template.name))}
              </Text>
            </View>
            <View style={[styles.kind, { backgroundColor: colors.surfaceVariant }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.medium }}>
                {template.isFullDay ? t('Template_KindDay') : t('Template_KindMeal')}
              </Text>
            </View>
          </View>
          <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={2}>
            {template.isFullDay
              ? tFmt('Template_DaySummary', template.templateDay.length)
              : (template.templateMeal?.title ?? '')}
          </Text>
          <View style={styles.actions}>
            <BarButton
              compact
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
  content: { padding: metrics.pagePadding, rowGap: metrics.gridGap },
  pageTitle: { ...pageTitleStyle },
  notice: { fontSize: 12, fontStyle: 'italic', lineHeight: 17 },
  panel: {
    borderRadius: metrics.radius,
    borderWidth: metrics.cardBorder,
    padding: 16,
    ...cardShadow,
  },
  /** Empty state: an icon in a soft tile, then the sentence, centred together. */
  emptyPanel: { alignItems: 'center', paddingVertical: 28, rowGap: 10 },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { fontSize: 14, textAlign: 'center', lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', columnGap: 10 },
  /** Soft tile behind the template kind glyph - same treatment as a meal icon. */
  tile: {
    width: 38,
    height: 38,
    borderRadius: metrics.radiusSmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { flex: 1 },
  name: { fontSize: 16, fontFamily: fonts.medium, letterSpacing: -0.1 },
  kind: { borderRadius: metrics.radiusPill, paddingHorizontal: 9, paddingVertical: 4 },
  summary: { fontSize: 14, lineHeight: 19, marginTop: 10 },
  updated: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', marginTop: 12 },
  status: { fontSize: 13, fontFamily: fonts.medium },
});