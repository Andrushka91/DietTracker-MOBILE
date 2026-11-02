// Photo gallery (spec 8.4) - up to three square thumbnails inside the meal
// card. Every tile carries TWO small badges in its corners: an expand button
// ("Show") that opens the photograph full screen, and the X that removes it -
// tapping the picture itself does the same as "Show", the badge only makes the
// gesture visible. While a photograph is being saved a compact caption with a
// spinner sits under the thumbnails, so progress is visible without a
// placeholder square appearing next to the pictures that already landed.

import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

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
  /** A photograph of this meal is being saved right now. */
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
      {uploading && (
        <View style={styles.uploadRow}>
          <ActivityIndicator size="small" color={props.colors.accent} />
          <Text style={[styles.caption, { color: props.colors.textMuted }]}>
            {t('Photo_Uploading')}
          </Text>
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
  /** Compact progress line under the thumbnails (no extra tile in the row). */
  uploadRow: { flexDirection: 'row', alignItems: 'center', columnGap: 6, marginTop: 6 },
  caption: { fontSize: 12 },
});
