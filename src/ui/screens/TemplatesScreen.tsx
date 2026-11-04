// Templates (spec 8.7) - a prominent "Templates" heading with a one-line
// REGULAR subtitle, one quiet inline notice ("meal details only"), then one
// compact outlined TILE per template.
//
// A tile is the template and nothing else: a 32 dp outlined calendar (or meal)
// glyph, the real name at 17 sp, then ONE wrapping metadata row - the kind and
// the REAL meal count on the left, the update time on the right - so no separate
// kind badge and no preview-count column compete with the name. Below it a single
// compact ACTION ROW, split off by one 1 dp rule: "Meal preview" + chevron on the
// left, a NEUTRAL outlined "Apply to date" on the right (36 dp visible inside a
// real 48/44 dp target, 8 dp corners, the card's own surface, normal ink, a slate
// calendar glyph - never an accent fill). Those two are SIBLING targets in a card
// that is NOT pressable, so previewing can never apply anything.
// The expanded contents render BELOW that row, in the same tile: the STORED
// entries in the order the applier uses them (time, the meal's own glyph, the
// category, then the stored title and description when they exist). A template
// never carries completion state or photographs, so no status pill, no
// done/missed counter and no photo chip can ever appear on this page.
//
// Behaviour is untouched: the list is sorted by UpdatedAt desc, applying opens
// the same validated yyyy-MM-dd prompt (today pre-filled) and merges the
// template into the target date as PENDING entries.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
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
 * Real touch target: Android asks for 48 dp, iOS' convention is 44 dp. The
 * visible graphics stay compact inside it - no control shrinks a target.
 */
const TOUCH = Platform.OS === 'android' ? 48 : 44;

/**
 * Sizes of the template list in dp/sp - the palette comes from the theme, so
 * light and dark mode stay in step. One compact tile rhythm: 12 dp corners and
 * gutters, a 1 dp outline, NO shadow, and 12 dp metadata. There is deliberately
 * NO accent fill here: Apply to date is a NEUTRAL outlined control (card
 * surface, thin outline, normal ink, slate calendar glyph) inside a real target.
 */
const TPL = {
  cardRadius: 12,
  cardPadding: 12,
  borderWidth: 1,
  headerIcon: 32,
  iconRadius: 8,
  headerGap: 10,
  nameSize: 17,
  metaSize: 11,
  previewMinHeight: TOUCH,
  rowMinHeight: TOUCH,
  rowGap: 10,
  timeColumn: 44,
  categoryTile: 28,
  categoryRadius: 8,
  actionGap: 8,
  actionDivider: 24,
  applyMinHeight: TOUCH,
  applyVisibleHeight: 36,
  applyMinWidth: 140,
  applyRadius: 8,
  applyLabelSize: 13,
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
          {/* Header: the kind's glyph, the real name, then ONE wrapping metadata
              row - kind · REAL meal count on the left, the update time on the
              right. The old kind badge and the preview-count column are gone:
              the same facts share this line instead of competing with the name. */}
          <View style={styles.header}>
            <View
              style={[
                styles.tile,
                { borderColor: colors.border, backgroundColor: colors.cardFill },
              ]}>
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
              {/* Two lines: a saved date or a long custom name WRAPS (and is
                  unrestricted at large text) instead of being cut. */}
              <Text
                style={[styles.name, { color: colors.text }]}
                numberOfLines={stacked ? undefined : 2}>
                {isCalendarDate(template.name) ? formatMediumDate(template.name) : template.name}
              </Text>
              <View style={styles.metadata}>
                <Text style={[styles.metaText, { color: colors.textMuted }]}>
                  {template.isFullDay ? t('Template_KindDay') : t('Template_KindMeal')} ·{' '}
                  {countLabel}
                </Text>
                <Text style={[styles.metaText, styles.updated, { color: colors.textMuted }]}>
                  {formatUpdated(template.updatedAt, isCalendarDate(template.name))}
                </Text>
              </View>
            </View>
          </View>

          {/* ONE compact action row under the header, split off by a single 1 dp
              rule: "Meal preview" on the left, "Apply to date" on the right.
              These are SIBLING targets - the card itself is not pressable, so
              previewing can never apply anything and applying never previews.
              An empty template has nothing to preview: it keeps Apply alone. */}
          <View
            style={[
              styles.actions,
              { borderTopColor: colors.border },
              stacked && styles.actionsStacked,
            ]}>
            {contents.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Rn_TemplateMealPreview')}
                accessibilityState={{ expanded: open }}
                accessibilityValue={{ text: countLabel }}
                onPress={() => togglePreview(template.id)}
                style={({ pressed }) => [
                  styles.previewToggle,
                  stacked && styles.previewToggleStacked,
                  pressed && { backgroundColor: colors.surfaceVariant },
                ]}>
                <Text
                  style={[styles.previewLabel, { color: colors.text }]}
                  numberOfLines={stacked ? undefined : 1}>
                  {t('Rn_TemplateMealPreview')}
                </Text>
                <Icon
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>
            )}
            {/* A quiet vertical rule between the two targets - horizontal layout
                only; stacked controls are separated by their own rows. */}
            {contents.length > 0 && !stacked && (
              <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Template_Apply')}
              onPress={() => requestApply(template)}
              style={({ pressed }) => [
                styles.applyTarget,
                stacked && styles.applyTargetStacked,
                contents.length === 0 && styles.applyTargetOnly,
                // The whole target answers a press; the button stays neutral.
                pressed && { opacity: 0.7 },
              ]}>
              {/* A real 48/44 dp target around a 36 dp visible NEUTRAL button:
                  8 dp corners, a thin outline on the card's own surface, normal
                  ink, a slate calendar glyph - never an accent fill or shadow. */}
              <View
                style={[
                  styles.apply,
                  { borderColor: colors.border, backgroundColor: colors.cardFill },
                ]}>
                <MaterialIcon
                  name="calendar-month-outline"
                  size={15}
                  color={colors.textSecondary}
                />
                <Text style={[styles.applyText, { color: colors.text }]} numberOfLines={1}>
                  {t('Template_Apply')}
                </Text>
              </View>
            </Pressable>
          </View>
          {/* Expanded contents sit BELOW the action row, inside the same card:
              one top rule, then one thin inset line between rows. Read-only, in
              the order the applier uses - no status and no photographs. */}
          {open && contents.length > 0 && (
            <View style={[styles.previewPanel, { borderTopColor: colors.border }]}>
              {contents.map((content, index) => {
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
                    {index > 0 && (
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    )}
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
              })}
            </View>
          )}
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
   * ONE template tile: the card's own surface, a 1 dp outline, 12 dp corners and
   * NO shadow or elevation. The card carries no padding - the header and the
   * action row hold the 12 dp gutter, so the rules sit inside the frame.
   */
  card: {
    marginTop: 12,
    borderWidth: TPL.borderWidth,
    borderRadius: TPL.cardRadius,
    overflow: 'hidden',
  },
  /** Header: the kind's outlined glyph tile, then the name over its metadata. */
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: TPL.headerGap,
    padding: TPL.cardPadding,
  },
  /** 32 dp tile, 8 dp corners, a thin outline on the card's own surface. */
  tile: {
    width: TPL.headerIcon,
    height: TPL.headerIcon,
    borderRadius: TPL.iconRadius,
    borderWidth: TPL.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  name: {
    fontSize: TPL.nameSize,
    lineHeight: 23,
    fontFamily: fonts.medium,
    letterSpacing: -0.2,
  },
  /**
   * Kind · real meal count, then the update time at the right of the SAME row;
   * both WRAP under a long name instead of overlapping it.
   */
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 3,
    marginTop: 3,
  },
  metaText: { fontSize: TPL.metaSize, lineHeight: 16, fontFamily: fonts.regular, flexShrink: 1 },
  updated: { marginLeft: 'auto' },
  /** A 1 dp rule inset to the card's 12 dp gutter (never the frame itself). */
  divider: { height: TPL.borderWidth, marginHorizontal: TPL.cardPadding },
  /** "Meal preview": its own 48/44 dp target - label left, chevron right. */
  previewToggle: {
    flex: 1,
    minWidth: 0,
    minHeight: TPL.previewMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    paddingVertical: 6,
    borderRadius: 6,
  },
  previewToggleStacked: { flex: 0, width: '100%' },
  previewLabel: { flexShrink: 1, fontSize: 13, fontFamily: fonts.regular },
  /**
   * The expanded contents BELOW the action row: one top rule, then a thin inset
   * line between rows. The page's own scroll view scrolls it - no inner one.
   */
  previewPanel: { borderTopWidth: TPL.borderWidth, paddingBottom: 4 },
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
  /**
   * ONE compact action row under the header, split off by a single 1 dp rule:
   * the preview target grows, the Apply target keeps its 140 dp minimum.
   */
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: TPL.actionGap,
    paddingHorizontal: TPL.cardPadding,
    borderTopWidth: TPL.borderWidth,
    minHeight: TPL.previewMinHeight,
  },
  /** Narrow window / large text: the controls stack, Apply stays right aligned. */
  actionsStacked: { flexDirection: 'column', alignItems: 'stretch', rowGap: 2, paddingBottom: 4 },
  /** The quiet rule between the two targets - horizontal layout only. */
  actionDivider: { width: TPL.borderWidth, height: TPL.actionDivider },
  /** The real 48/44 dp target around the 36 dp visible button. */
  applyTarget: {
    minHeight: TPL.applyMinHeight,
    minWidth: TPL.applyMinWidth,
    justifyContent: 'center',
  },
  applyTargetStacked: { alignSelf: 'flex-end' },
  /** Nothing to preview: the Apply control stays alone, right aligned. */
  applyTargetOnly: { marginLeft: 'auto' },
  /**
   * The visible control: 36 dp tall, 8 dp corners, a thin neutral outline on the
   * card's own surface, normal ink and a slate calendar glyph. Deliberately NOT
   * an accent fill (a blue Apply button was rejected) and no shadow of its own.
   */
  apply: {
    minHeight: TPL.applyVisibleHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: TPL.borderWidth,
    borderRadius: TPL.applyRadius,
  },
  applyText: {
    flexShrink: 1,
    fontSize: TPL.applyLabelSize,
    fontFamily: fonts.regular,
    textAlign: 'center',
  },
  status: { fontSize: 13, fontFamily: fonts.medium, marginTop: 12 },
});
