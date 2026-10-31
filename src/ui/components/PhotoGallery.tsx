// Photo gallery (spec 8.4) - up to three square thumbnails inside the meal
// card. A tap opens the full-size viewer; every tile carries its own small
// circular X in the corner. While a photograph is being saved and uploaded a
// placeholder tile with the spinner sits at the end of the row, so the wait is
// visible exactly where the photograph will appear.

import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { MealPhoto } from '../../domain/models';
import { thumbnailUri } from '../../data/photoStore';
import { t } from '../strings';
import { fonts, argb, type ThemeColors } from '../theme';

/** Tile edge in points: three tiles + two gaps fit beside the action buttons. */
const TILE = 62;

export function PhotoGallery(props: {
  photos: MealPhoto[];
  colors: ThemeColors;
  /** A photograph of this meal is being saved / uploaded right now. */
  uploading?: boolean;
  onOpen: (photo: MealPhoto) => void;
  onRemove: (photo: MealPhoto) => void;
}): React.JSX.Element | null {
  const uploading = props.uploading === true;
  if (props.photos.length === 0 && !uploading) {
    return null;
  }
  return (
    <View style={styles.host}>
      <View style={styles.row}>
        {props.photos.map((photo) => (
          <View key={photo.id} style={[styles.tileHost, { borderColor: props.colors.border }]}>
            <Pressable
              accessibilityLabel={photo.originalFileName}
              onPress={() => props.onOpen(photo)}>
              {/* Fill: the image keeps the tile's rounded corners exactly. */}
              <Image
                source={{ uri: thumbnailUri(photo.thumbnailId) }}
                style={[styles.tile, { backgroundColor: props.colors.surfaceVariant }]}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Common_Close')}
              onPress={() => props.onRemove(photo)}
              hitSlop={8}
              style={styles.remove}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
        {uploading && (
          <View
            style={[
              styles.tileHost,
              styles.uploadTile,
              { borderColor: props.colors.border, backgroundColor: props.colors.surfaceVariant },
            ]}>
            <ActivityIndicator size="small" color={props.colors.accent} />
          </View>
        )}
      </View>
      {uploading && (
        <Text style={[styles.caption, { color: props.colors.textMuted }]}>
          {t('Photo_Uploading')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flexShrink: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 8 },
  /** Rounded clip + the delete badge that sits inside the corner. */
  tileHost: {
    width: TILE,
    height: TILE,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tile: { width: '100%', height: '100%' },
  uploadTile: { alignItems: 'center', justifyContent: 'center' },
  /**
   * Small dark circle over the photograph - readable on any picture, and the
   * whole 20 pt disc is the touch target (hitSlop adds 8 pt around it).
   */
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: argb('#99000000'),
  },
  removeText: { color: argb('#FFFFFFFF'), fontSize: 11, fontFamily: fonts.medium, lineHeight: 13 },
  caption: { fontSize: 11, marginTop: 4 },
});
