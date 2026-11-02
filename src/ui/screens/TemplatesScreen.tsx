// Templates (spec 8.7) - list sorted by UpdatedAt desc; each row: name,
// kind label (Meal / Day), summary, updated timestamp, "Apply to date"
// button (defaults to today) -> status "Applied for {date}". Empty state
// text + the notice caption. Applying merges into the target date as
// PENDING entries. No destructive template management (parity with Windows).

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { MealCategory, MealTemplate, MealTemplateContent } from '../../domain/models';
import { formatDate } from '../../domain/analytics';
import { getTemplates } from '../../data/repositories';
import { applyTemplate, ensureCategories } from '../../services/mealTracking';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { BarButton } from '../components/buttons';
import { PromptDialog } from '../components/dialogs';
import { Icon } from '../components/icons';
import { fonts, metrics, pageTitleStyle, cardShadow, themeColors } from '../theme';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';
import { formatMediumDate, formatTime, mealNameKey, t, tFmt } from '../strings';
import { dateInputProblem, isCalendarDate } from '../dates';

/**
 * Date prompt for "Apply to date" (spec 8.7). The Windows app shows a
 * CalendarDatePicker; the phone asks for the same `yyyy-MM-dd` value in a
 * small text prompt pre-filled with today, so no extra picker dependency is
 * needed. RN-only wording until the Windows resw gains the same key.
 */
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
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [categories, setCategories] = useState<MealCategory[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  /** Template whose target date is being typed (the prompt keeps its own value). */
  const [applying, setApplying] = useState<MealTemplate | null>(null);
  /** Ids of the templates whose (read-only) contents are expanded. */
  const [expanded, setExpanded] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setCategories(await ensureCategories());
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

  /**
   * The target date is validated BEFORE any domain call: a blank, malformed or
   * impossible value used to fall back to today and apply the template to the
   * wrong day. The prompt explains the problem and keeps the typed value; only a
   * deliberate "Today" fills a valid date, and only a valid date is applied.
   */
  const dateError = (value: string): string | null => {
    const problem = dateInputProblem(value);
    if (problem === 'blank') {
      return t('Rn_TemplateDateRequired');
    }
    if (problem === 'format') {
      return t('Rn_TemplateDateFormat');
    }
    if (problem === 'impossible') {
      return t('Rn_TemplateDateImpossible');
    }
    return null;
  };

  const applyToDate = async (template: MealTemplate, date: string): Promise<void> => {
    await applyTemplate(template, date, app.accountId);
    setStatus(tFmt('Template_Applied', date));
    app.notifyChanged();
  };

  const requestApply = (template: MealTemplate): void => {
    setApplying(template);
  };

  /** Read-only contents of a template, in the order the applier uses them. */
  const templateContents = (template: MealTemplate): MealTemplateContent[] =>
    template.isFullDay
      ? template.templateDay
      : template.templateMeal !== null
        ? [template.templateMeal]
        : [];

  const togglePreview = (id: string): void => {
    setExpanded((open) => (open.includes(id) ? open.filter((key) => key !== id) : [...open, id]));
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // Same air above the docked bar as the other pages.
        { paddingBottom: TAB_BAR_CONTENT_GAP },
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

      {templates.map((template) => {
        const open = expanded.includes(template.id);
        const contents = templateContents(template);
        return (
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
                {isCalendarDate(template.name) ? formatMediumDate(template.name) : template.name}
              </Text>
              <Text style={[styles.updated, { color: colors.textMuted }]} numberOfLines={1}>
                {formatUpdated(template.updatedAt, isCalendarDate(template.name))}
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
          {/* Read-only contents, so the day's meals can be inspected before
              anything is written into the diary. The rows come from the stored
              template payload, not from a prototype. */}
          {contents.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Rn_TemplatePreview')}
              accessibilityState={{ expanded: open }}
              onPress={() => togglePreview(template.id)}
              style={[styles.previewToggle, { borderTopColor: colors.hairline }]}>
              <Text style={[styles.previewToggleText, { color: colors.accent }]}>
                {open ? t('Rn_TemplatePreviewHide') : t('Rn_TemplatePreview')}
              </Text>
              <Icon
                name={open ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.accent}
              />
            </Pressable>
          )}
          {open && (
            <View style={styles.preview}>
              {contents.map((content) => {
                const category = categories.find(
                  (candidate) => candidate.fixedCategoryKey === content.mealCategoryKey,
                );
                const categoryName =
                  category !== undefined && category.name !== ''
                    ? category.name
                    : t(mealNameKey(content.mealCategoryKey));
                const time = formatTime(content.plannedTime, app.use12HourClock);
                return (
                  <View
                    key={content.mealCategoryKey}
                    style={[styles.previewRow, { borderTopColor: colors.hairline }]}>
                    <View style={styles.previewCopy}>
                      <Text style={[styles.previewCategory, { color: colors.textMuted }]}>
                        {categoryName}
                      </Text>
                      <Text
                        style={[styles.previewTitle, { color: colors.text }]}
                        numberOfLines={1}>
                        {content.title !== ''
                          ? content.title
                          : content.ingredients !== ''
                            ? content.ingredients
                            : t('Rn_TemplateNoTitle')}
                      </Text>
                    </View>
                    <Text style={[styles.previewTime, { color: colors.textMuted }]}>
                      {time === '' ? t('Rn_TemplateNoTime') : time}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
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
        );
      })}

      {status !== null && <Text style={[styles.status, { color: colors.accent }]}>{status}</Text>}
      {applying !== null && (
        <PromptDialog
          isDark={app.isDark}
          request={{
            title: t('Template_ApplyTitle'),
            message: t('Rn_TemplateDatePrompt'),
            initialValue: formatDate(new Date()),
            cancelText: t('Common_Cancel'),
            // "Apply template", not a generic OK: the action writes five meals.
            confirmText: t('Rn_TemplateApplyConfirm'),
            today: { label: t('Calendar_Today'), value: formatDate(new Date()) },
            validate: dateError,
            onCancel: () => setApplying(null),
            onConfirm: (value) => {
              const template = applying;
              setApplying(null);
              // Only a validated date reaches the domain call.
              void applyToDate(template, value).catch((error) => {
                console.warn('[templates] the template could not be applied', error);
                setStatus(t('Settings_SaveFailed'));
              });
            },
          }}
        />
      )}
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
  /** "Preview contents" disclosure: a quiet accent row above the apply button. */
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    minHeight: 44,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  previewToggleText: { fontSize: 12, fontFamily: fonts.medium },
  preview: { marginTop: 2 },
  /** One read-only meal: category over its title, planned time on the right. */
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    minHeight: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  previewCopy: { flex: 1, minWidth: 0 },
  previewCategory: { fontSize: 11, lineHeight: 15 },
  previewTitle: { fontSize: 13, lineHeight: 18, fontFamily: fonts.medium },
  previewTime: { fontSize: 12, fontVariant: ['tabular-nums'], flexShrink: 0 },
  updated: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', marginTop: 12 },
  status: { fontSize: 13, fontFamily: fonts.medium },
});