// The three slot counts of the statistics page's primary panel, laid out exactly
// as the round-3 mockup draws them:
//
//      ✓ 19            ✕ 7            ◷ 9
//      Done            Missed         Pending
//
//      All 35 planned slots in this week.
//
// TWO lines per count: the state glyph and the BOLD number share the first line,
// and the state's name sits under the GLYPH - each cell is one third of the row
// and left aligned to it, so the three labels line up as columns. The closing
// sentence sets the period total apart in the theme's ink, the way the mockup
// does.
//
// The panel used to print all three on a single line in 14 pt semibold, which
// read as one grey sentence and made the numbers the smallest thing in the very
// block they exist for.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Counts } from '../statisticsBreakdown';
import { t, tFmt } from '../strings';
import { fonts, type ThemeColors } from '../theme';
import { Icon, type IconName } from './icons';

/**
 * Glyph size of a state mark. The mockup draws the mark just under the height of
 * the number it belongs to, so it never competes with it.
 */
const SLOT_GLYPH_SIZE = 18;

/**
 * Splits "All {0} planned slots in this {1}." around its number, so the total can
 * be drawn in the theme's ink without a second translated sentence.
 */
function plannedSentence(period: string): { before: string; after: string } {
  const [before = '', rest = ''] = t('Rn_StatAllPlanned').split('{0}');
  return { before, after: rest.replace('{1}', period) };
}

export function SlotCounts(props: {
  counts: Counts;
  /** The period word inside the closing sentence: day / week / month / year. */
  period: string;
  colors: ThemeColors;
}): React.JSX.Element {
  const { counts, colors } = props;
  const { before, after } = plannedSentence(props.period);
  return (
    <>
      <View style={styles.row}>
        <SlotCount
          icon="checkmark"
          label={t('Dashboard_CountDone')}
          value={counts.done}
          color={colors.done}
          colors={colors}
        />
        <SlotCount
          icon="close"
          label={t('Dashboard_CountMissed')}
          value={counts.missed}
          color={colors.missed}
          colors={colors}
        />
        <SlotCount
          icon="time-outline"
          label={t('Dashboard_CountPending')}
          value={counts.pending}
          color={colors.pending}
          colors={colors}
        />
      </View>
      <Text style={[styles.sentence, { color: colors.textMuted }]}>
        {before}
        <Text style={[styles.sentenceNumber, { color: colors.text }]}>{counts.total}</Text>
        {after}
        {counts.upcoming > 0 ? ` ${tFmt('Rn_StatIncludesUpcoming', counts.upcoming)}` : ''}
      </Text>
    </>
  );
}

/** One cell: the state glyph beside its number, the state's name underneath. */
function SlotCount(props: {
  icon: IconName;
  label: string;
  value: number;
  color: string;
  colors: ThemeColors;
}): React.JSX.Element {
  return (
    <View style={styles.cell}>
      <View style={styles.head}>
        <Icon name={props.icon} size={SLOT_GLYPH_SIZE} color={props.color} />
        <Text style={[styles.value, { color: props.colors.text }]}>{props.value}</Text>
      </View>
      <Text style={[styles.label, { color: props.colors.textSecondary }]}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Three equal columns; each cell is left aligned to its third of the panel. */
  row: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 12 },
  cell: { flex: 1, minWidth: 0, rowGap: 3 },
  /** First line: the state glyph and the number it counts. */
  head: { flexDirection: 'row', alignItems: 'center', columnGap: 7 },
  /** The number is what the block exists for, so it is the largest text in it. */
  value: {
    fontSize: 22,
    lineHeight: 26,
    fontFamily: fonts.bold,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  /** Second line: the state's name, under the GLYPH, not under the number. */
  label: { fontSize: 14, lineHeight: 18, fontFamily: fonts.regular },
  /** The closing sentence: muted, with the period total set apart below. */
  sentence: { marginTop: 14, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  sentenceNumber: { fontFamily: fonts.bold },
});
