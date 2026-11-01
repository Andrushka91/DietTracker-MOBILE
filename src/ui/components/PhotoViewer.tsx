// Full-size in-app photo viewer (spec 11: Shell "open with" -> in-app
// full-screen viewer on both platforms).

import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MealPhoto } from '../../domain/models';
import { fileUri } from '../../data/photoStore';
import { t } from '../strings';
import { argb, themeColors } from '../theme';
import { Icon } from './icons';

export function PhotoViewer(props: {
  photo: MealPhoto;
  isDark: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const colors = themeColors(props.isDark);
  return (
    <Modal animationType="fade" visible onRequestClose={props.onClose}>
      <View style={[styles.host, { backgroundColor: props.isDark ? argb('#FF000000') : argb('#FFFFFFFF') }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Common_Close')}
          onPress={props.onClose}
          style={[styles.close, { backgroundColor: colors.accent }]}>
          <Icon name="close" size={18} color={colors.accentText} />
        </Pressable>
        <Image
          source={{ uri: fileUri(props.photo.localFileId) }}
          style={styles.image}
          resizeMode="contain"
        />
        <Text style={[styles.caption, { color: colors.text }]}>
          {props.photo.originalFileName}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  /** Round dial in the corner: the same chip language the rest of the app uses. */
  close: {
    position: 'absolute',
    top: 44,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  image: { width: '100%', height: '80%' },
  caption: { marginTop: 12, fontSize: 13, textAlign: 'center' },
});