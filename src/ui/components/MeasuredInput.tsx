// A text field that knows exactly how much text its own box can hold.
//
// The editor must not overflow: a meal name lives on ONE row and the notes box is
// a fixed TWO-row well. Counting characters cannot do that - a proportional font
// makes "iiii" and "WWWW" completely different widths - so this component lays
// the CURRENT text out in an invisible Text of exactly the field's width and
// typography and reads the REAL line count from `onTextLayout`. A change that
// would need one row too many is refused (the field keeps the value it had), so
// the limit is pixel-exact on any screen, font size, language or character mix,
// and it always uses the whole width instead of a conservative estimate.
//
// A stored value that is longer than the box (written by an older, wider editor)
// opens untouched: the rule only ever refuses GROWTH, never a deletion, so
// nothing that is already saved can be cut.

import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextInputProps,
  type TextLayoutEvent,
  type TextStyle,
} from 'react-native';

/**
 * True when a change has to be refused: the laid-out text needs more rows than
 * the field allows AND the change made it longer. A deletion while the text is
 * still too long is always accepted, so an over-long stored value can be edited
 * down but never grows further.
 */
export function shouldRejectOverflow(
  neededRows: number,
  allowedRows: number,
  previousLength: number,
  nextLength: number,
): boolean {
  return neededRows > allowedRows && nextLength > previousLength;
}

export interface MeasuredInputProps {
  value: string;
  onChangeText: (next: string) => void;
  /** Rows this field may use: 1 for a single line, 2 for the notes well. */
  rows: number;
  /** Padding of the visible input, subtracted from its width for the measurement. */
  paddingHorizontal: number;
  /** The input's typography (font size, line height, family) for the measurement. */
  textStyle: StyleProp<TextStyle>;
  /** The input's chrome (colours, radius, padding). */
  inputStyle?: StyleProp<TextStyle>;
  /** Room kept free at the end of a single row for the caret. */
  caretRoom?: number;
  /**
   * Reports the REAL row count of the current text (1 for an empty value). The
   * card uses it to start the notes box shallow and let it grow only when the text
   * needs a second row; the LIMIT stays `rows`, which is what the fit guard below
   * enforces - the report never loosens it.
   */
  onRows?: (rows: number) => void;
  accessibilityLabel?: string;
  placeholder?: string;
  placeholderTextColor?: string;
  keyboardType?: TextInputProps['keyboardType'];
  autoCorrect?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  textAlignVertical?: TextInputProps['textAlignVertical'];
}

export function MeasuredInput(props: MeasuredInputProps): React.JSX.Element {
  /** Width of the text area itself (the input minus its horizontal padding). */
  const [contentWidth, setContentWidth] = useState(0);
  /**
   * The last value the layout CONFIRMED to fit. A refused change is rolled back
   * to this, not to "the value before the keystroke": layout callbacks can arrive
   * out of order while typing fast, and rolling back to a value that was never
   * measured could leave the field overflowing. It starts as the value the field
   * opened with, so a stored value that is already too long is never cut - it
   * simply cannot grow.
   */
  const fitted = useRef(props.value);

  const handleLayout = (event: LayoutChangeEvent): void => {
    setContentWidth(Math.max(0, event.nativeEvent.layout.width - props.paddingHorizontal * 2));
  };

  const handleTextLayout = (event: TextLayoutEvent): void => {
    const rows = event.nativeEvent.lines.length;
    props.onRows?.(rows);
    if (rows <= props.rows) {
      fitted.current = props.value;
      return;
    }
    if (
      shouldRejectOverflow(
        rows,
        props.rows,
        fitted.current.length,
        props.value.length,
      )
    ) {
      props.onChangeText(fitted.current);
    }
  };

  const measureWidth = Math.max(1, contentWidth - (props.caretRoom ?? 0));
  return (
    <View style={styles.host}>
      <TextInput
        accessibilityLabel={props.accessibilityLabel}
        style={props.inputStyle}
        value={props.value}
        onChangeText={props.onChangeText}
        onLayout={handleLayout}
        placeholder={props.placeholder}
        placeholderTextColor={props.placeholderTextColor}
        keyboardType={props.keyboardType}
        autoCorrect={props.autoCorrect}
        multiline={props.multiline}
        numberOfLines={props.numberOfLines}
        textAlignVertical={props.textAlignVertical}
      />
      {contentWidth > 0 && (
        /* The ruler: the same text, the same typography, the field's own width,
           invisible. Its layout is the source of truth for "does it fit?". A
           single space stands in for an empty value so one row is reported. */
        <Text
          pointerEvents="none"
          accessible={false}
          style={[styles.measure, props.textStyle, { width: measureWidth }]}
          onTextLayout={handleTextLayout}>
          {props.value === '' ? ' ' : props.value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /** The wrapper only anchors the invisible ruler - the input defines the width. */
  host: { alignSelf: 'stretch' },
  measure: { position: 'absolute', top: 0, left: 0, opacity: 0 },
});
