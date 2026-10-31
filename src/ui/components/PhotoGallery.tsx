// Photo gallery (spec 8.4) - grey framed strip inside the meal card: header
// counts the photographs, a tap opens the full-size viewer, each tile has its
// own X to remove (confirmation handled by the card's owner).

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { MealPhoto } from '../../domain/models';
import { thumbnailUri } from '../../data/photoStore';
import { t } from '../strings';
import { fonts, argb, type ThemeColors } from '../theme';

export function PhotoGallery(props: {
  photos: MealPhoto[];
  colors: ThemeColors;
  onOpen: (photo: MealPhoto) => void;
  onRemove: (photo: MealPhoto) => void;
}): React.JSX.Element | null {
  if (props.photos.length === 0) {
    return null;
  }
  return (
    <View
      style={[styles.host, { backgroundColor: props.colors.surfaceVariant }]}>
      <Text style={[styles.header, { color: props.colors.textMuted }]}>
        {t('Photo_GalleryHeader')} ({props.photos.length})
      </Text>
      <View style={styles.row}>
        {props.photos.map((photo) => (
          <View key={photo.id} style={styles.tileHost}>
            <Pressable accessibilityLabel={photo.originalFileName} onPress={() => props.onOpen(photo)}>
              <Image
                source={{ uri: thumbnailUri(photo.thumbnailId) }}
                style={[styles.tile, { backgroundColor: props.colors.border }]}
              />
            </Pressable>
            <Pressable
              accessibilityLabel={t('Common_Close')}
              onPress={() => props.onRemove(photo)}
              hitSlop={6}
              style={[styles.remove, { backgroundColor: props.colors.error }]}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    borderRadius: 10,
    padding: 6,
    flexShrink: 1,
  },
  header: { fontSize: 11, marginBottom: 4 },
  row: { flexDirection: 'row', columnGap: 6 },
  tileHost: { position: 'relative' },
  tile: { width: 46, height: 46, borderRadius: 8 },
  remove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: argb('#FFFFFFFF'), fontSize: 10, fontFamily: fonts.medium },
});