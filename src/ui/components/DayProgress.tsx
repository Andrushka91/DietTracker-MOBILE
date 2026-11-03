// The day header's progress block, drawn the way the mockup draws it:
//
//        ╭────────╮        ✓ 3  Done
//        │  3/5   │        ✕ 1  Missed
//        │  Done  │        ◷ 1  Pending
//        ╰────────╯
//
// A three-colour ring - done green, missed red, pending grey - with the day's
// fraction INSIDE it, and the three counts beside it as glyph + bold number +
// label. The header used to draw a linear bar with "3 of 5 completed" under it:
// one number in one shape, which cannot say how much of the day is done, missed
// and still open at a glance.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { t, tFmt } from '../strings';
import { fonts, type ThemeColors } from '../theme';
import { Icon, type IconName } from './icons';
import { ProgressRing } from './ProgressRing';

/** Ring geometry, measured off the mockup: a 100 pt circle, 10 pt thick. */
export const DAY_RING_SIZE = 100;
export const DAY_RING_THICKNESS = 10;

/** The state marks beside the counts: the same three glyphs the cards use. */
const COUNT_GLYPH_SIZE = 17;

export function DayProgress(props: {
  /** Slots marked done today. */
  completed: number;
  missed: number;
  /** Slots with no outcome yet (upcoming ones included - they are still open). */
  pending: number;
  /** Every planned slot of the day: the fraction's denominator. */
  totalSlots: number;
  colors: ThemeColors;
}): React.JSX.Element {
  const { colors } = props;
  return (
    <View style={styles.row}>
      <ProgressRing
        size={DAY_RING_SIZE}
        thickness={DAY_RING_THICKNESS}
        segments={[
          { value: props.completed, color: colors.done },
          { value: props.missed, color: colors.missed },
          // Pending is the quiet neutral arc, the same tone as the statistics
          // page's pending segment: what is still open must not shout.
          { value: props.pending, color: colors.barPending },
        ]}>
        <Text
          style={[styles.fraction, { color: colors.text }]}
          // Chart labels: they have to stay INSIDE the ring, so a very large
          // system text size grows them only to the point the circle can hold.
          maxFontSizeMultiplier={1.4}>
          {tFmt('Rn_DayDoneOfTotal', props.completed, props.totalSlots)}
        </Text>
        <Text
          style={[styles.fractionLabel, { color: colors.textMuted }]}
          maxFontSizeMultiplier={1.4}>
          {t('Dashboard_CountDone')}
        </Text>
      </ProgressRing>
      <View style={styles.counts}>
        <CountRow
          icon="checkmark"
          value={props.completed}
          label={t('Dashboard_CountDone')}
          color={colors.done}
          colors={colors}
        />
        <CountRow
          icon="close"
          value={props.missed}
          label={t('Dashboard_CountMissed')}
          color={colors.missed}
          colors={colors}
        />
        <CountRow
          icon="time-outline"
          value={props.pending}
          label={t('Dashboard_CountPending')}
          color={colors.pending}
          colors={colors}
        />
      </View>
    </View>
  );
}

/** One count beside the ring: the state's glyph, its bold number, its name. */
function CountRow(props: {
  icon: IconName;
  value: number;
  label: string;
  color: string;
  colors: ThemeColors;
}): React.JSX.Element {
  return (
    <View style={styles.countRow}>
      <Icon name={props.icon} size={COUNT_GLYPH_SIZE} color={props.color} />
      <Text style={[styles.countValue, { color: props.colors.text }]}>{props.value}</Text>
      <Text style={[styles.countLabel, { color: props.colors.textSecondary }]}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Ring on the left, the three counts stacked beside it. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 18,
    marginTop: 12,
    paddingHorizontal: 2,
  },
  /** The fraction inside the ring: the loudest number of the header. */
  fraction: {
    fontSize: 20,
    lineHeight: 25,
    fontFamily: fonts.bold,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  fractionLabel: { fontSize: 13, lineHeight: 17, marginTop: 1 },
  /** The counts column: three rows, left aligned, 12 pt apart. */
  counts: { flex: 1, minWidth: 0, rowGap: 12 },
  countRow: { flexDirection: 'row', alignItems: 'center', columnGap: 8 },
  /** The number is the state's answer: bold ink, tabular so rows line up. */
  countValue: { fontFamily: fonts.bold, fontSize: 17, fontVariant: ['tabular-nums'] },
  countLabel: { fontSize: 15, flexShrink: 1 },
});
