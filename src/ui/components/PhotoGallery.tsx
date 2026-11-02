// Photo gallery (spec 8.4) - up to three square thumbnails inside the meal
// card. The whole tile is ONE touch target that opens the photograph full
// screen; removal lives in the viewer, so no overlapping badges sit on the
// picture.
//
// While a photograph is being saved the app-wide bottom busy sheet reports the
// wait ("Saving the photograph…"), the same surface every dialog rises in. The
// card itself stays quiet, so the pictures that already landed keep the whole
// strip instead of a caption pushing them around.

import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { MealPhoto } from '../../domain/models';
import { thumbnailUri } from '../../data/photoStore';
import { t } from '../strings';
import { type ThemeColors } from '../theme';

/**
 * Tile edge in points. The strip has its own row above the action buttons, so
 * even the third picture keeps a comfortable size: three tiles + two gaps stay
 * well inside the narrowest phone card (a 360 pt screen leaves ~322 pt).
 */
const TILE = 48;

/**
 * Horizontal strip of thumbnails. The whole thumbnail is the single touch target
 * that opens the viewer; removal lives in the viewer, so no overlapping badges.
 */
export function PhotoGallery(props: {
  photos: MealPhoto[];
  colors: ThemeColors;
  /**
   * A photograph of this meal is being saved right now. The strip stays mounted
   * (so it does not blink away and back), but the wait itself is reported by the
   * app-wide busy sheet - no caption sits on the card.
   */
  uploading?: boolean;
  onOpen: (photo: MealPhoto) => void;
}): React.JSX.Element | null {
  const uploading = props.uploading === true;
  if (props.photos.length === 0 && !uploading) {
    return null;
  }
  return (
    <View style={styles.host}>
      {props.photos.length > 0 && (
        <View style={styles.row}>
          {props.photos.map((photo) => (
            <Pressable
              key={photo.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${t('Photo_Show')} ${photo.originalFileName}`}
              onPress={() => props.onOpen(photo)}
              style={[styles.tileHost, { borderColor: props.colors.border }]}>
              <Image
                source={{ uri: thumbnailUri(photo.thumbnailId) }}
                style={[styles.tile, { backgroundColor: props.colors.surfaceVariant }]}
              />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flexShrink: 0 },
  /** One horizontal row, 6 pt between photographs, never wrapping. */
  row: { flexDirection: 'row', columnGap: 6 },
  tileHost: {
    width: TILE,
    height: TILE,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tile: { width: '100%', height: '100%' },
});
