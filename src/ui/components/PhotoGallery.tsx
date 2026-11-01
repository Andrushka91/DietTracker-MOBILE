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
import { argb, type ThemeColors, metrics } from '../theme';
import { Icon } from './icons';

/**
 * Tile edge in points. The strip has its own row above the action buttons, so
 * even the third picture keeps a comfortable size: three tiles + two gaps stay
 * well inside the narrowest phone card (a 360 pt screen leaves ~322 pt).
 */
const TILE = 56;

export function PhotoGallery(props: {
  photos: MealPhoto[];
  colors: ThemeColors;
  /** A photograph of this meal is being saved right now. */
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
      {props.photos.length > 0 && (
        <View style={styles.row}>
          {props.photos.map((photo) => (
            <View key={photo.id} style={[styles.tileHost, { borderColor: props.colors.border }]}>
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel={photo.originalFileName}
                onPress={() => props.onOpen(photo)}>
                {/* Fill: the image keeps the tile's corners exactly. */}
                <Image
                  source={{ uri: thumbnailUri(photo.thumbnailId) }}
                  style={[styles.tile, { backgroundColor: props.colors.surfaceVariant }]}
                />
              </Pressable>
              {/* "Show": expands the photograph to the full-screen viewer. The
                  picture itself stays tappable, this badge makes it obvious. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('Photo_Show')} ${photo.originalFileName}`}
                onPress={() => props.onOpen(photo)}
                hitSlop={10}
                style={styles.expand}>
                <Icon name="expand-outline" size={12} color={argb('#FFFFFFFF')} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Common_Close')}
                onPress={() => props.onRemove(photo)}
                hitSlop={10}
                style={styles.remove}>
                <Icon name="close" size={12} color={argb('#FFFFFFFF')} />
              </Pressable>
            </View>
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
  host: { flexShrink: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 6 },
  /** Rounded clip + the two badges that sit inside the corners. */
  tileHost: {
    width: TILE,
    height: TILE,
    borderRadius: metrics.radiusSmall,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tile: { width: '100%', height: '100%' },
  /**
   * Small dark badges over the photograph - readable on any picture. 24 pt with
   * a 10 pt hitSlop gives a 44 pt touch target; the X keeps its top-right corner
   * and "Show" the opposite one, so a thumb never removes a picture while
   * aiming for the full-screen viewer.
   */
  expand: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: argb('#99000000'),
  },
  remove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: argb('#99000000'),
  },
  /** Compact progress line under the thumbnails (no extra tile in the row). */
  uploadRow: { flexDirection: 'row', alignItems: 'center', columnGap: 6, marginTop: 6 },
  caption: { fontSize: 12 },
});
