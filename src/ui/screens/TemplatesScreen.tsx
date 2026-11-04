// Templates (spec 8.7) - the r3 mockup: a prominent "Templates" heading with a
// one-line subtitle, ONE quiet info strip ("meal details only"), then one
// compact white card per template.
//
// A card is the template and nothing else: the calendar (or meal) glyph, the
// real name and its update time, the kind badge, the real number of meals, a
// full-width "Meal preview" accordion and ONE full-width "Apply to date" button
// that keeps the card's floor in both accordion states. The accordion is
// read-only - it lists the STORED contents in the order the applier uses them
// (time, the meal's own glyph, the category, then the stored title and
// description when they exist) - and a template never carries completion state
// or photographs, so no status pill, no done/missed counter and no photo chip
// can ever appear on this page.
//
// Behaviour is untouched: the list is sorted by UpdatedAt desc, applying opens
// the same validated yyyy-MM-dd prompt (today pre-filled) and merges the
// template into the target date as PENDING entries.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { MealCategory, MealTemplate, MealTemplateContent } from '../../domain/models';
import { formatDate } from '../../domain/analytics';
import { getTemplates } from '../../data/repositories';
import { applyTemplate, ensureCategories } from '../../services/mealTracking';
import { subscribeDataChange } from '../../cloud/syncEngine';
import { useApp } from '../appContext';
import { PromptDialog } from '../components/dialogs';
import { Icon, MaterialIcon } from '../components/icons';
import { mealCategoryGlyph } from '../mealGlyphs';
import {
  cardShadow,
  fonts,
  metrics,
  pageTitleStyle,
  themeColors,
  tintAlpha,
  typeScale,
} from '../theme';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';
import { formatMediumDate, formatTime, mealNameKey, t, tFmt } from '../strings';
import { dateDraft, dateInputProblem, isCalendarDate, DATE_INPUT_LENGTH } from '../dates';


/**
 * Date prompt for "Apply to date" (spec 8.7). The Windows app shows a
 * CalendarDatePicker; the phone asks for the same `yyyy-MM-dd` value in a
 * small text prompt pre-filled with today, so no extra picker dependency is
 * needed. RN-only wording until the Windows resw gains the same key. The field
 * is MASKED (`dateDraft` below in ../dates): only digits can be typed, the two
 * dashes are inserted for the user, and no other character can reach the
 * validator - see `_tests_/dateHandoff.test.ts`.
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

  /**
   * The Apply sheet's summary: the SAME name the card prints (a template named
   * after its day is shown as a long date) plus the real meal count, in the
   * card's own singular/plural wording. Nothing is invented when no template is
   * selected - the sheet is not mounted then.
   */
  const applyingSummary =
    applying === null
      ? ''
      : `${isCalendarDate(applying.name) ? formatMediumDate(applying.name) : applying.name} · ${
          templateContents(applying).length === 1
            ? t('Rn_TemplateMealCountOne')
            : tFmt('Rn_TemplateMealCount', templateContents(applying).length)
        }`;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        // Same air above the docked bar as the other pages.
        { paddingBottom: TAB_BAR_CONTENT_GAP },
      ]}>
      <Text style={[styles.pageTitle, { color: colors.text }]}>{t('Nav_Templates')}</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={2}>
        {t('Rn_TemplateSubtitle')}
      </Text>

      {/* ONE quiet strip where the italic warning used to be: the same fact
          ("no state, no photos") as a pale wash of the one accent, so it reads
          as context for the list instead of as an error about it. */}
      <View
        style={[
          styles.infoStrip,
          { backgroundColor: tintAlpha(colors.accent, app.isDark ? '2E' : '14') },
        ]}>
        <Icon name="information-circle-outline" size={18} color={colors.textSecondary} />
        <Text style={[styles.infoText, { color: colors.textSecondary }]} numberOfLines={2}>
          {t('Rn_TemplateInfo')}
        </Text>
      </View>

      {templates.length === 0 && (
        <View
          style={[
            styles.card,
            styles.emptyPanel,
            cardShadow,
            { backgroundColor: colors.cardFill, borderColor: colors.border },
          ]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceVariant }]}>
            <Icon name="layers-outline" size={24} color={colors.textMuted} />
          </View>
          <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('Template_Empty')}</Text>
        </View>
      )}

      {templates.map((template) => {
        const open = expanded.includes(template.id);
        const contents = templateContents(template);
        /** Single-meal templates wear their own category's glyph in the tile. */
        const slotKey =
          template.templateMealSlot ?? template.templateMeal?.mealCategoryKey ?? null;
        return (
        <View
          key={template.id}
          style={[
            styles.card,
            cardShadow,
            { backgroundColor: colors.cardFill, borderColor: colors.border },
          ]}>
          {/* Header: the kind's glyph, the real name over its update time, and
              the kind badge pinned to the right. */}
          <View style={styles.header}>
            <View style={[styles.tile, { backgroundColor: colors.surfaceVariant }]}>
              {template.isFullDay ? (
                <MaterialIcon
                  name="calendar-month-outline"
                  size={20}
                  color={colors.textSecondary}
                />
              ) : slotKey === null ? (
                <Icon name="restaurant-outline" size={20} color={colors.textSecondary} />
              ) : (
                <MaterialIcon
                  name={mealCategoryGlyph(slotKey)}
                  size={20}
                  color={colors.textSecondary}
                />
              )}
            </View>
            <View style={styles.headerText}>
              {/* Two lines: at large text sizes the date must WRAP, not be cut
                  to "30 October 20…" by the badge beside it. */}
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
                {isCalendarDate(template.name) ? formatMediumDate(template.name) : template.name}
              </Text>
              <Text style={[styles.updated, { color: colors.textMuted }]} numberOfLines={1}>
                {formatUpdated(template.updatedAt, isCalendarDate(template.name))}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.surfaceVariant }]}>
              <Text style={[styles.badgeText, { color: colors.textSecondary }]} numberOfLines={1}>
                {template.isFullDay ? t('Template_KindDay') : t('Template_KindMeal')}
              </Text>
            </View>
          </View>

          {/* The real number of stored meals, counted from the payload. */}
          <Text style={[styles.count, { color: colors.textMuted }]} numberOfLines={1}>
            {contents.length === 1
              ? t('Rn_TemplateMealCountOne')
              : tFmt('Rn_TemplateMealCount', contents.length)}
          </Text>
          {/* Read-only contents, so the day's meals can be inspected before
              anything is written into the diary. The rows come from the stored
              template payload, not from a prototype.

              Dividers: one above the accordion, one under it (which becomes the
              first meal row's top rule when the panel is open), and one between
              every pair of rows - all inset to the card's 16 dp gutter. */}
          {contents.length > 0 && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Rn_TemplateMealPreview')}
                accessibilityState={{ expanded: open }}
                onPress={() => togglePreview(template.id)}
                style={({ pressed }) => [
                  styles.previewToggle,
                  pressed && { backgroundColor: colors.surfaceVariant },
                ]}>
                <Text style={[styles.previewToggleText, { color: colors.text }]} numberOfLines={1}>
                  {t('Rn_TemplateMealPreview')}
                </Text>
                <Icon
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>
            </>
          )}
          {open
            ? contents.map((content) => {
                const category = categories.find(
                  (candidate) => candidate.fixedCategoryKey === content.mealCategoryKey,
                );
                const categoryName =
                  category !== undefined && category.name !== ''
                    ? category.name
                    : t(mealNameKey(content.mealCategoryKey));
                /**
                 * The EFFECTIVE planned time, exactly as the calendar's agenda
                 * resolves it: the template's own stored time, else the
                 * category's planned time (which is what the diary shows for a
                 * slot without one). Only a slot whose category is unknown falls
                 * back to the "no time" caption.
                 */
                const time = formatTime(
                  content.plannedTime ?? (category !== undefined ? category.defaultTime : null),
                  app.use12HourClock,
                );
                /**
                 * Hierarchy: the meal's own NAME leads when it has one, with the
                 * category and the stored description on the meta line under it
                 * ("Breakfast · with berries"); a slot without a name leads with
                 * its CATEGORY and shows the description underneath. The category
                 * is always printed (it is never blank), so a row can never read
                 * as an anonymous glyph, and nothing is invented.
                 */
                const hasTitle = content.title !== '';
                const primary = hasTitle ? content.title : categoryName;
                const details = hasTitle
                  ? content.ingredients === ''
                    ? categoryName
                    : `${categoryName} · ${content.ingredients}`
                  : content.ingredients;
                return (
                  <View key={content.mealCategoryKey}>
                    <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewTime, { color: colors.textMuted }]} numberOfLines={1}>
                        {time === '' ? t('Rn_TemplateNoTime') : time}
                      </Text>
                      <View style={[styles.previewIcon, { backgroundColor: colors.surfaceVariant }]}>
                        <MaterialIcon
                          name={mealCategoryGlyph(content.mealCategoryKey)}
                          size={18}
                          color={colors.textSecondary}
                        />
                      </View>
                      <View style={styles.previewCopy}>
                        <Text style={[styles.previewTitle, { color: colors.text }]} numberOfLines={1}>
                          {primary}
                        </Text>
                        {details !== '' && (
                          <Text
                            style={[styles.previewDetail, { color: colors.textMuted }]}
                            numberOfLines={1}>
                            {details}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })
            : contents.length > 0 && (
                <View style={[styles.divider, { backgroundColor: colors.hairline }]} />
              )}
          {/* ONE full-width action at the card's floor, in both states. */}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Template_Apply')}
              onPress={() => requestApply(template)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.apply,
                { backgroundColor: colors.accentFill },
                pressed && { opacity: 0.85 },
              ]}>
              <MaterialIcon
                name="calendar-month-outline"
                size={18}
                color={colors.accentFillText}
              />
              <Text style={[styles.applyText, { color: colors.accentFillText }]} numberOfLines={1}>
                {t('Template_Apply')}
              </Text>
            </Pressable>
          </View>
        </View>
        );
      })}

      {status !== null && <Text style={[styles.status, { color: colors.accent }]}>{status}</Text>}
      {applying !== null && (
        <PromptDialog
          isDark={app.isDark}
          request={{
            // The compact Apply-template sheet (r3 reference). Every other
            // prompt - the template NAME prompt included - keeps the default
            // layout, because this variant is opt-in per call site.
            layout: 'template-date',
            title: t('Template_ApplyTitle'),
            // The input's accessible name and the fallback hint; the sheet shows
            // the template summary under the title and a visible field label.
            message: t('Rn_TemplateDatePrompt'),
            contextLabel: applyingSummary,
            fieldLabel: t('Rn_TemplateDateLabel'),
            formatHint: t('Rn_TemplateDateFormatHint'),
            initialValue: formatDate(new Date()),
            cancelText: t('Common_Cancel'),
            // "Apply template", not a generic OK: the action writes five meals.
            confirmText: t('Rn_TemplateApplyConfirm'),
            today: { label: t('Calendar_Today'), value: formatDate(new Date()) },
            // The target date is digits only: `dateDraft` drops every other
            // character on the way in and inserts the two dashes itself, so
            // Android's number pad (which has no dash key) can still type the
            // whole date, and a letter, a slash or a second date can never be
            // typed, pasted or reach the validator.
            keyboardType: 'number-pad',
            sanitize: dateDraft,
            maxLength: DATE_INPUT_LENGTH,
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
  /** Page frame; the bottom padding is computed at render time (tab bar). */
  content: { padding: metrics.pagePadding },
  pageTitle: { ...pageTitleStyle },
  /**
   * One quiet line under the heading - the page's only explanation. It keeps the
   * italic the mockup draws (the same slant the notice used to wear) but not its
   * warning tone.
   */
  subtitle: { fontSize: typeScale.subheadline, lineHeight: 20, marginTop: 2, fontStyle: 'italic' },
  /**
   * The info strip: a wash of the one accent (tinted at render time, so it
   * follows light/dark), the info glyph and one wrapping line. No border - the
   * wash alone separates it from the page.
   */
  infoStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: metrics.radiusSmall,
  },
  infoText: { flex: 1, minWidth: 0, fontSize: typeScale.footnote, lineHeight: 18 },
  /**
   * ONE template: a white card with a hairline frame and a soft shadow. It has
   * NO padding of its own - every section below carries the 16 dp gutter, so the
   * dividers can sit 16 dp in from the frame while the card's own top and bottom
   * stay tight.
   */
  card: {
    marginTop: 14,
    borderRadius: metrics.radius,
    borderWidth: metrics.cardBorder,
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
  /** Header: glyph tile | name over update time | kind badge. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  /** Soft tile behind the kind glyph - the same treatment as a meal icon. */
  tile: {
    width: 40,
    height: 40,
    borderRadius: metrics.radiusSmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  name: { fontSize: typeScale.headline, fontFamily: fonts.medium, letterSpacing: -0.2 },
  updated: { fontSize: typeScale.footnote, lineHeight: 17, marginTop: 1 },
  badge: {
    borderRadius: metrics.radiusPill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 0,
  },
  badgeText: { fontSize: typeScale.caption, fontFamily: fonts.medium },
  /** The real meal count: one quiet line, 8 dp under the header, 12 dp of air. */
  count: { fontSize: 14, lineHeight: 19, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  /** A hairline inset to the card's 16 dp gutter (never the frame itself). */
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  /** "Meal preview": a full-width 44 pt row, label left, chevron right. */
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    minHeight: metrics.minTouch,
    paddingHorizontal: 16,
  },
  previewToggleText: {
    flex: 1,
    minWidth: 0,
    fontSize: typeScale.subheadline,
    fontFamily: fonts.medium,
  },
  /** One read-only meal: time | glyph tile | category over its stored detail. */
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    minHeight: metrics.minTouch,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  previewTime: {
    fontSize: typeScale.footnote,
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    flexShrink: 0,
  },
  previewIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCopy: { flex: 1, minWidth: 0 },
  previewTitle: { fontSize: typeScale.subheadline, lineHeight: 20 },
  previewDetail: { fontSize: typeScale.caption, lineHeight: 16, marginTop: 1 },
  /** The action block: 12 dp of air above, the 16 dp gutter, 16 dp below. */
  actions: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  /**
   * The ONE primary action, full width in both accordion states: 44 pt tall, the
   * accent fill and a 12 pt corner (the mockup's button radius - deliberately
   * rounder than `radiusSmall`, so it reads as the page's primary control).
   */
  apply: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 8,
    minHeight: metrics.minTouch,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  applyText: { fontSize: typeScale.subheadline, fontFamily: fonts.medium },
  status: { fontSize: typeScale.footnote, fontFamily: fonts.medium, marginTop: 12 },
});