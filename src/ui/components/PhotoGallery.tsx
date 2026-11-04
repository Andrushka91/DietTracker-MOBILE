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
 * Tile edge in points (the reference's 48 pt thumbnail). Exported so the CARD can
 * measure the strip before deciding whether the text still has 120 pt beside it;
 * three tiles and two 4 pt gaps are exactly 152 pt.
 */
export const PHOTO_TILE = 48;

/** Air between two thumbnails: 4 pt, the reference's tight strip. */
export const PHOTO_GAP = 4;

/**
 * Horizontal strip of thumbnails. The whole thumbnail is the single touch target
 * that opens the viewer at THAT photo's index; removal lives in the viewer, so no
 * overlapping badges, no "+N" tile and no extra upload tile exist here.
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
  /** One horizontal row, 4 pt between photographs, never wrapping or stacking. */
  row: { flexDirection: 'row', columnGap: PHOTO_GAP },
  tileHost: {
    width: PHOTO_TILE,
    height: PHOTO_TILE,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tile: { width: '100%', height: '100%' },
});
