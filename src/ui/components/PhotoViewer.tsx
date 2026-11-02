// Full-size in-app photo viewer (spec 11: Shell "open with" -> in-app
// full-screen viewer on both platforms).
//
// Meal/date context, position counter, previous/next paging (chevrons or the
// thumbnail strip), and a labelled Remove action that always asks for
// confirmation before the existing removal callback runs. The original image is
// contained, never stretched.

import React, { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { MealPhoto } from '../../domain/models';
import { fileUri, thumbnailUri } from '../../data/photoStore';
import { t } from '../strings';
import { argb, fonts, themeColors } from '../theme';
import { Icon } from './icons';

export function PhotoViewer(props: {
  /** The meal's photographs, in their stored order. */
  photos: MealPhoto[];
  /** Index of the photograph the user tapped. */
  initialIndex: number;
  /** Meal and date shown above the picture. */
  context: string;
  isDark: boolean;
  onClose: () => void;
  /** Called only after the user confirms the removal. */
  onRemove: (photo: MealPhoto) => void;
}): React.JSX.Element {
  const colors = themeColors(props.isDark);
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(props.initialIndex);
  const [confirming, setConfirming] = useState(false);
  const count = props.photos.length;
  const photo = props.photos[Math.min(index, Math.max(count - 1, 0))];
  const go = (next: number): void => {
    setConfirming(false);
    setIndex(Math.max(0, Math.min(count - 1, next)));
  };
  const background = props.isDark ? argb('#FF000000') : argb('#FFFFFFFF');

  return (
    <Modal animationType="fade" visible onRequestClose={props.onClose}>
      <View style={[styles.host, { backgroundColor: background }]}>
        <View style={styles.topBar}>
          <View style={styles.topText}>
            <Text style={[styles.context, { color: colors.text }]} numberOfLines={1}>
              {props.context}
            </Text>
            <Text style={[styles.position, { color: colors.textMuted }]}>
              {`${index + 1} / ${count}`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Common_Close')}
            onPress={props.onClose}
            style={[styles.close, { backgroundColor: colors.accent }]}>
            <Icon name="close" size={18} color={colors.accentText} />
          </Pressable>
        </View>
        {photo !== undefined && (
          <>
            <View style={styles.stage}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous photograph"
                disabled={index === 0}
                onPress={() => go(index - 1)}
                style={[styles.step, { opacity: index === 0 ? 0.3 : 1 }]}>
                <Icon name="chevron-back" size={28} color={colors.text} />
              </Pressable>
              <Image
                key={photo.id}
                accessibilityLabel={photo.originalFileName}
                source={{ uri: fileUri(photo.localFileId) }}
                style={[styles.image, { width: width - 96 }]}
                resizeMode="contain"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next photograph"
                disabled={index >= count - 1}
                onPress={() => go(index + 1)}
                style={[styles.step, { opacity: index >= count - 1 ? 0.3 : 1 }]}>
                <Icon name="chevron-forward" size={28} color={colors.text} />
              </Pressable>
            </View>
            <Text style={[styles.caption, { color: colors.text }]}>{photo.originalFileName}</Text>
            {count > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.strip}>
                {props.photos.map((item, itemIndex) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Photograph ${itemIndex + 1}`}
                    accessibilityState={{ selected: itemIndex === index }}
                    onPress={() => go(itemIndex)}
                    style={[
                      styles.thumbHost,
                      { borderColor: itemIndex === index ? colors.accent : colors.border },
                    ]}>
                    <Image source={{ uri: thumbnailUri(item.thumbnailId) }} style={styles.thumb} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.actions}>
              {confirming ? (
                <>
                  <Text style={[styles.confirmText, { color: colors.text }]}>
                    Remove this photograph? It is deleted from this device and from the connected
                    account at the next synchronization.
                  </Text>
                  <View style={styles.confirmRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Keep photograph"
                      onPress={() => setConfirming(false)}
                      style={[styles.actionButton, { borderColor: colors.border }]}>
                      <Text style={[styles.actionText, { color: colors.text }]}>{t('Common_No')}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Confirm remove photograph"
                      onPress={() => props.onRemove(photo)}
                      style={[
                        styles.actionButton,
                        { backgroundColor: colors.missed, borderColor: colors.missed },
                      ]}>
                      <Text style={[styles.actionText, { color: colors.onState }]}>{t('Common_Yes')}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove photograph"
                  onPress={() => setConfirming(true)}
                  style={[styles.actionButton, { borderColor: colors.border }]}>
                  <Icon name="trash-outline" size={18} color={colors.missed} />
                  <Text style={[styles.actionText, { color: colors.missed }]}>Remove photograph</Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    paddingTop: 44,
    paddingBottom: 24,
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  topBar: { flexDirection: 'row', alignItems: 'center', columnGap: 12 },
  topText: { flex: 1, minWidth: 0 },
  context: { fontSize: 15, fontFamily: fonts.medium },
  position: { fontSize: 12, marginTop: 2 },
  /** Round dial: the same chip language the rest of the app uses. */
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stage: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1 },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  image: { height: '100%' },
  caption: { fontSize: 13, textAlign: 'center', marginTop: 8 },
  strip: { columnGap: 6, paddingVertical: 10, alignItems: 'center' },
  thumbHost: { width: 48, height: 48, borderRadius: 6, borderWidth: 2, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  actions: { rowGap: 8 },
  confirmText: { fontSize: 13, lineHeight: 18 },
  confirmRow: { flexDirection: 'row', columnGap: 8 },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 8,
    paddingHorizontal: 12,
  },
  actionText: { fontSize: 14, fontFamily: fonts.medium },
});

