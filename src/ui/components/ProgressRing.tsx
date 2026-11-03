// A progress RING drawn with real vector arcs.
//
// The dashboard header needs a three-colour ring with rounded ends and a break
// between the arcs. `react-native-svg` draws it natively - one dashed `Circle` per
// state with a round line cap - so every arc has a uniform thickness, a true
// curvature and a clean rounded end: no dot chains, no seams, nothing to
// approximate.
//
// The dash arithmetic is pure (`ringArcs`), so the ring's proportions are tested
// without rendering: what each state covers, that the gaps are equal, and that a
// day with one state (or none) still draws the right thing.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/** One slice of the ring: how much of it, and the colour it is drawn in. */
export interface RingSegment {
  value: number;
  color: string;
}

/** One arc of the ring, in circumference points. */
export interface RingArc {
  key: string;
  color: string;
  /**
   * SVG's `strokeDasharray`: `[drawn, rest]`. `null` means "the whole circle" -
   * a day whose slots are all in one state is one closed ring, not a dash with a
   * seam where the two caps meet.
   */
  dash: [number, number] | null;
  /** `strokeDashoffset`: negative to move the dash FORWARD to its start angle. */
  offset: number;
}

/**
 * Visible air between two neighbouring arcs, as a fraction of the stroke width -
 * the mockup's small, equal breaks. A round cap grows each arc end by half a
 * stroke, so the dash gap has to be this air PLUS one stroke width.
 */
export const RING_GAP_RATIO = 0.6;

/**
 * Turns segment values into the arcs of one ring.
 *
 * Angles start at 12 o'clock and run CLOCKWISE (the canvas is rotated by -90
 * degrees, because an SVG circle begins at 3 o'clock). Segment lengths follow the
 * values exactly: 1 done / 1 missed / 3 pending is 20 % green, 20 % red and 60 %
 * grey.
 *
 * @param size      Outer diameter in points.
 * @param thickness Stroke width in points.
 */
export function ringArcs(
  segments: RingSegment[],
  size: number,
  thickness: number,
  gapRatio: number = RING_GAP_RATIO,
): RingArc[] {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0 || circumference <= 0) {
    return [];
  }
  const active = segments.filter((segment) => segment.value > 0);
  const air = thickness * gapRatio;
  const arcs: RingArc[] = [];
  let travelled = 0;
  for (const [index, segment] of active.entries()) {
    const share = (segment.value / total) * circumference;
    // One state fills the circle: no gap, no seam.
    const closed = active.length === 1;
    const gap = closed ? 0 : air + thickness;
    const drawn = share - gap;
    const start = travelled + gap / 2;
    arcs.push({
      key: `arc-${index}`,
      color: segment.color,
      dash: closed ? null : [Math.max(0.5, drawn), Math.max(0.5, circumference - drawn)],
      // `0` rather than `-0`: the first arc needs no offset at all.
      offset: start === 0 ? 0 : -start,
    });
    travelled += share;
  }
  return arcs;
}

/**
 * The ring itself. `children` are drawn in the middle (the day's fraction and its
 * caption), which is where the mockup puts them.
 */
export function ProgressRing(props: {
  segments: RingSegment[];
  /** Outer diameter in points. */
  size: number;
  /** Stroke width in points. */
  thickness: number;
  children?: React.ReactNode;
}): React.JSX.Element {
  const radius = (props.size - props.thickness) / 2;
  const arcs = ringArcs(props.segments, props.size, props.thickness);
  return (
    <View style={{ width: props.size, height: props.size }}>
      {/* Rotated so 0 degrees is 12 o'clock: an SVG circle starts at 3 o'clock. */}
      <Svg width={props.size} height={props.size} style={styles.canvas}>
        {arcs.map((arc) => (
          <Circle
            key={arc.key}
            testID="progress-ring-arc"
            cx={props.size / 2}
            cy={props.size / 2}
            r={radius}
            stroke={arc.color}
            strokeWidth={props.thickness}
            strokeLinecap="round"
            fill="none"
            {...(arc.dash === null
              ? {}
              : { strokeDasharray: arc.dash, strokeDashoffset: arc.offset })}
          />
        ))}
      </Svg>
      <View style={styles.centre}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { transform: [{ rotate: '-90deg' }] },
  /** The middle of the ring: whatever the caller wants to say there. */
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
