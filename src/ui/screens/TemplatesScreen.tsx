// Templates (spec 8.7) - the r3 mockup: a prominent "Templates" heading with a
// one-line REGULAR subtitle, one quiet inline notice ("meal details only"), then
// one outlined card per template.
//
// A card is the template and nothing else: the calendar (or meal) glyph, the
// real name and its update time, a neutral OUTLINE kind chip, a "Meal preview"
// accordion whose header carries the REAL meal count beside its chevron, and ONE
// full-width "Apply to date" control that keeps the card's floor in both
// accordion states. Apply is deliberately NEUTRAL - the card's own surface, a
// thin outline, normal ink and a slate calendar glyph; it is not an accent fill.
// The accordion is read-only - it lists the STORED contents in the order the
// applier uses them (time, the meal's own glyph, the category, then the stored
// title and description when they exist) - and a template never carries
// completion state or photographs, so no status pill, no done/missed counter and
// no photo chip can ever appear on this page.
//
// Behaviour is untouched: the list is sorted by UpdatedAt desc, applying opens
// the same validated yyyy-MM-dd prompt (today pre-filled) and merges the
// template into the target date as PENDING entries.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
import { fonts, metrics, pageTitleStyle, themeColors } from '../theme';
import { TAB_BAR_CONTENT_GAP } from '../tabBar';
import { formatMediumDate, formatTime, mealNameKey, t, tFmt } from '../strings';
import { dateDraft, dateInputProblem, isCalendarDate, DATE_INPUT_LENGTH } from '../dates';

/**
 * Sizes of the template list in dp/sp - the palette comes from the theme, so
 * light and dark mode stay in step. One card rhythm: 16 dp corners, 14 dp
 * gutters, a 1 dp outline, 44 dp controls and 44 dp minimum rows. There is
 * deliberately NO accent-fill here: Apply to date is a NEUTRAL outlined control
 * (card surface, thin outline, normal ink, slate calendar glyph), never a filled
 * blue button.
 */
const TPL = {
  cardRadius: 16,
  cardPadding: 14,
  borderWidth: 1,
  headerIcon: 36,
  headerGap: 10,
  kindRadius: 8,
  previewMinHeight: 44,
  rowMinHeight: 44,
  rowGap: 10,
  timeColumn: 44,
  categoryTile: 28,
  categoryRadius: 8,
  applyTopGap: 12,
  applyMinHeight: 44,
  applyRadius: 10,
} as const;



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
  const { width, fontScale } = useWindowDimensions();
  /** Large text or a narrow window: the card head stacks instead of squeezing. */
  const stacked = fontScale > 1.3 || width < 350;
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
      <Text accessibilityRole="header" style={[styles.pageTitle, { color: colors.text }]}>
        {t('Nav_Templates')}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t('Rn_TemplateSubtitle')}</Text>

      {/* The same fact the old tinted strip carried, as ONE quiet line: the
          outline glyph and the message, with no box and no warning tone. */}
      <View style={styles.notice}>
        <Icon name="information-circle-outline" size={16} color={colors.textMuted} />
        <Text style={[styles.noticeText, { color: colors.textMuted }]}>{t('Rn_TemplateInfo')}</Text>
      </View>

      {templates.length === 0 && (
        <View
          style={[
            styles.card,
            styles.emptyPanel,
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
        /** The REAL stored meal count, in the card's singular/plural wording. */
        const countLabel =
          contents.length === 1
            ? t('Rn_TemplateMealCountOne')
            : tFmt('Rn_TemplateMealCount', contents.length);
        /** Single-meal templates wear their own category's glyph in the tile. */
        const slotKey =
          template.templateMealSlot ?? template.templateMeal?.mealCategoryKey ?? null;
        return (
        <View
          key={template.id}
          style={[
            styles.card,
            { backgroundColor: colors.cardFill, borderColor: colors.border },
          ]}>
          {/* Header: the kind's glyph, the real name over its update time, and
              the kind badge pinned to the right (under the name at large text). */}
          <View style={[styles.header, stacked && styles.headerStacked]}>
            <View style={[styles.identity, stacked && styles.identityStacked]}>
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
                <Text
                  style={[styles.name, { color: colors.text }]}
                  numberOfLines={stacked ? undefined : 2}>
                  {isCalendarDate(template.name) ? formatMediumDate(template.name) : template.name}
                </Text>
                <Text style={[styles.updated, { color: colors.textMuted }]} numberOfLines={1}>
                  {formatUpdated(template.updatedAt, isCalendarDate(template.name))}
                </Text>
              </View>
            </View>
            {/* A neutral OUTLINE chip on the card's own surface - not a grey fill. */}
            <View
              style={[
                styles.badge,
                stacked && styles.badgeStacked,
                { borderColor: colors.border, backgroundColor: colors.cardFill },
              ]}>
              <Text style={[styles.badgeText, { color: colors.textSecondary }]} numberOfLines={1}>
                {template.isFullDay ? t('Template_KindDay') : t('Template_KindMeal')}
              </Text>
            </View>
          </View>

          {/* A template with nothing stored has no accordion to hang its count
              on, so the real count stays as one quiet line. */}
          {contents.length === 0 && (
            <Text style={[styles.emptyCount, { color: colors.textMuted }]} numberOfLines={1}>
              {countLabel}
            </Text>
          )}
          {/* Read-only contents, so the day's meals can be inspected before
              anything is written into the diary. The rows come from the stored
              template payload, not from a prototype.

              Dividers: one above the accordion, one under it (which becomes the
              first meal row's top rule when the panel is open), and one between
              every pair of rows - all inset to the card's 16 dp gutter. */}
          {contents.length > 0 && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Rn_TemplateMealPreview')}
                accessibilityState={{ expanded: open }}
                accessibilityValue={{ text: countLabel }}
                onPress={() => togglePreview(template.id)}
                style={({ pressed }) => [
                  styles.previewToggle,
                  pressed && { backgroundColor: colors.surfaceVariant },
                ]}>
                <Text style={[styles.previewToggleText, { color: colors.text }]} numberOfLines={1}>
                  {t('Rn_TemplateMealPreview')}
                </Text>
                {/* The REAL count sits with the preview it belongs to, right
                    before the chevron - the card spends no line on it. */}
                <Text style={[styles.count, { color: colors.textMuted }]} numberOfLines={1}>
                  {countLabel}
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
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <View style={styles.previewRow}>
                      <Text style={[styles.previewTime, { color: colors.textMuted }]} numberOfLines={1}>
                        {time === '' ? t('Rn_TemplateNoTime') : time}
                      </Text>
                      <View style={[styles.previewIcon, { backgroundColor: colors.surfaceVariant }]}>
                        <MaterialIcon
                          name={mealCategoryGlyph(content.mealCategoryKey)}
                          size={16}
                          color={colors.textSecondary}
                        />
                      </View>
                      <View style={styles.previewCopy}>
                        {/* Stored titles and details wrap instead of being cut:
                            they are the data this page exists to show. */}
                        <Text style={[styles.previewTitle, { color: colors.text }]} numberOfLines={2}>
                          {primary}
                        </Text>
                        {details !== '' && (
                          <Text
                            style={[styles.previewDetail, { color: colors.textMuted }]}
                            numberOfLines={2}>
                            {details}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })
            : contents.length > 0 && (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              )}
          {/* ONE neutral action at the card's floor, in both accordion states:
              the card's own surface, a thin outline, normal ink and a slate
              calendar glyph - no accent fill, gradient or shadow. It only OPENS
              the existing date sheet; nothing is applied until a valid date is
              confirmed there. */}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Template_Apply')}
              onPress={() => requestApply(template)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.apply,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceVariant : colors.cardFill,
                },
              ]}>
              <MaterialIcon name="calendar-month-outline" size={17} color={colors.textSecondary} />
              <Text style={[styles.applyText, { color: colors.text }]} numberOfLines={1}>
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
            // "Apply template" - the reference's headline, stacked over the
            // real template summary (see `applyingSummary`).
            title: t('Rn_TemplateApplyTitle'),
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
  /** One small REGULAR line under the heading - no italics, no warning tone. */
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2, fontFamily: fonts.regular },
  /**
   * The notice: the same fact as ONE quiet line - an outline glyph and the
   * message at caption size. No wash, no border, no box of its own.
   */
  notice: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 7,
  },
  noticeText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18, fontFamily: fonts.regular },
  /** Empty state: an icon in a soft tile, then the sentence, centred together. */
  emptyPanel: { alignItems: 'center', paddingVertical: 28, rowGap: 10 },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { fontSize: 14, textAlign: 'center', lineHeight: 19, fontFamily: fonts.regular },
  /**
   * ONE template: the card's own surface, a 1 dp outline and NO shadow. The card
   * carries no padding - every section below holds the 14 dp gutter, so the
   * dividers sit inside the frame while the rows stay full width.
   */
  card: {
    marginTop: 12,
    borderWidth: TPL.borderWidth,
    borderRadius: TPL.cardRadius,
  },
  /** Header: glyph tile | name over update time | the kind chip on the right. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: TPL.headerGap,
    paddingHorizontal: TPL.cardPadding,
    paddingTop: TPL.cardPadding,
  },
  /** Large text / narrow window: the name gets the full width, chip underneath. */
  headerStacked: { flexDirection: 'column', alignItems: 'stretch', rowGap: 8 },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: TPL.headerGap,
  },
  identityStacked: { flex: 0, width: '100%' },
  /** Soft tile behind the kind glyph - the same treatment as a meal icon. */
  tile: {
    width: TPL.headerIcon,
    height: TPL.headerIcon,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontFamily: fonts.medium, letterSpacing: -0.2 },
  updated: { fontSize: 11, lineHeight: 16, marginTop: 2, fontFamily: fonts.regular },
  /** A neutral OUTLINE chip on the card's own surface - never a grey fill. */
  badge: {
    borderWidth: TPL.borderWidth,
    borderRadius: TPL.kindRadius,
    paddingHorizontal: 7,
    paddingVertical: 4,
    flexShrink: 0,
  },
  badgeStacked: { alignSelf: 'flex-start', marginLeft: TPL.headerIcon + TPL.headerGap },
  badgeText: { fontSize: 11, fontFamily: fonts.regular },
  /** A template with nothing stored still prints its real count, quietly. */
  emptyCount: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
    paddingHorizontal: TPL.cardPadding,
    fontFamily: fonts.regular,
  },
  /** A 1 dp rule inset to the card's 14 dp gutter (never the frame itself). */
  divider: { height: TPL.borderWidth, marginHorizontal: TPL.cardPadding },
  /** "Meal preview": a 44 dp row - label left, REAL count, then the chevron. */
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    minHeight: TPL.previewMinHeight,
    paddingHorizontal: TPL.cardPadding,
  },
  previewToggleText: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.medium },
  /** The real meal count beside the chevron; it stays on one quiet line. */
  count: { flexShrink: 1, fontSize: 11, fontFamily: fonts.regular, textAlign: 'right' },
  /** One read-only meal: time | 28 dp glyph tile | title over its stored detail. */
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: TPL.rowGap,
    minHeight: TPL.rowMinHeight,
    paddingHorizontal: TPL.cardPadding,
    paddingVertical: 8,
  },
  previewTime: {
    fontSize: 12,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
    minWidth: TPL.timeColumn,
    flexShrink: 0,
  },
  previewIcon: {
    width: TPL.categoryTile,
    height: TPL.categoryTile,
    borderRadius: TPL.categoryRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCopy: { flex: 1, minWidth: 0 },
  previewTitle: { fontSize: 14, lineHeight: 19, fontFamily: fonts.medium },
  previewDetail: { fontSize: 11, lineHeight: 16, marginTop: 1, fontFamily: fonts.regular },
  /** The action block: 12 dp of air above, the 14 dp gutter, 14 dp below. */
  actions: {
    paddingHorizontal: TPL.cardPadding,
    paddingTop: TPL.applyTopGap,
    paddingBottom: TPL.cardPadding,
  },
  /**
   * The ONE action, full width in both accordion states: 44 dp tall, 10 dp
   * corners, a thin neutral outline on the card's own surface, normal ink and a
   * slate calendar glyph. Deliberately NOT an accent fill (a blue Apply button
   * was rejected) and no shadow of its own.
   */
  apply: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 8,
    minHeight: TPL.applyMinHeight,
    borderWidth: TPL.borderWidth,
    borderRadius: TPL.applyRadius,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  applyText: { flexShrink: 1, fontSize: 14, fontFamily: fonts.regular, textAlign: 'center' },
  status: { fontSize: 13, fontFamily: fonts.medium, marginTop: 12 },
});
