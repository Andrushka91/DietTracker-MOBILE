// Full-size in-app photo viewer (spec 11: Shell "open with" -> in-app
// full-screen viewer on both platforms), following the round-3 review design:
//
//   header      Close (X) - meal name over its date - delete photo (trash)
//   stage       the original image, contained (never stretched), swipeable
//   pager       ‹ n of m › and explicit zoom out / zoom in
//   strip       the meal's thumbnails, the current one ringed in the accent
//   hint        "Swipe to browse · Pinch or double-tap to zoom"
//   confirm     "Remove the photograph?" - asked before anything is deleted
//
// There is deliberately NO "…" options area: the header carries one delete
// tool, and photo details (file, size, added, sync) are no longer shown. One
// glyph, one action, and the destructive step still asks first.
//
// The chrome is deliberately dark in both themes: a photograph is judged against
// a neutral background, and a white frame around a picture changes how bright it
// looks. The confirmation panel itself follows the app theme.
//
// Zoom is implemented with PanResponder + Animated (no extra native dependency):
// two fingers pinch between 1x and 4x, a double tap toggles 2.5x, and a zoomed
// picture can be dragged inside its frame. Paging is switched off while zoomed so
// a drag never fights between "next photo" and "pan the photo".

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MealPhoto } from '../../domain/models';
import { fileUri, thumbnailUri } from '../../data/photoStore';
import { t, tFmt } from '../strings';
import { argb, fonts, themeColors } from '../theme';
import { DialogCard, DialogCardAction } from './dialogs';
import { Icon } from './icons';

/** Zoom limits shared by the pinch, the double tap and the two buttons. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
/** A tap that travels further than this is a page swipe, not a double tap. */
const TAP_SLOP = 12;

export function PhotoViewer(props: {
  /** The meal's photographs, in their stored order. */
  photos: MealPhoto[];
  /** Index of the photograph the user tapped. */
  initialIndex: number;
  /** Meal name shown above the picture. */
  context: string;
  /** Date caption under the meal name. */
  contextDetail: string;
  use12HourClock: boolean;
  isDark: boolean;
  onClose: () => void;
  /** Called only after the user confirms the removal. */
  onRemove: (photo: MealPhoto) => void;
}): React.JSX.Element {
  const colors = themeColors(props.isDark);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(props.initialIndex);
  const [scale, setScale] = useState(MIN_ZOOM);
  const [confirming, setConfirming] = useState(false);
  const pagerRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleRef = useRef(MIN_ZOOM);
  const translateRef = useRef({ x: 0, y: 0 });

  const count = props.photos.length;
  const boundedIndex = Math.min(index, Math.max(count - 1, 0));
  const photo = props.photos[boundedIndex];
  /**
   * The stage fills the room left between the header, the paging/zoom controls,
   * the thumbnail strip and the hint. It used to be capped at 56 % of the
   * screen, which left a large dead area under a portrait photograph. The
   * fallback is only used for the first frame, before the frame is measured.
   */
  const [stageHeight, setStageHeight] = useState(
    Math.round(Math.min(height * 0.7, width * 1.4)),
  );
  const zoomed = scale > MIN_ZOOM + 0.01;

  // The chrome is dark in both themes, so the system status icons must be light
  // while the viewer is open. Unmounting restores the app's own bar style.
  useEffect(() => {
    StatusBar.setBarStyle('light-content', true);
    return () => StatusBar.setBarStyle(themeColors(props.isDark).statusBarStyle, true);
  }, [props.isDark]);
  const applyScale = (next: number): void => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    scaleRef.current = clamped;
    setScale(clamped);
    if (clamped === MIN_ZOOM) {
      translateRef.current = { x: 0, y: 0 };
      translate.setValue({ x: 0, y: 0 });
      return;
    }
    // Keep the picture inside its frame after a zoom change.
    const maxX = (width * (clamped - 1)) / 2;
    const maxY = (stageHeight * (clamped - 1)) / 2;
    const x = Math.max(-maxX, Math.min(maxX, translateRef.current.x));
    const y = Math.max(-maxY, Math.min(maxY, translateRef.current.y));
    translateRef.current = { x, y };
    translate.setValue({ x, y });
  };

  // A new photograph always starts at 1x: keeping the previous zoom would show
  // the next picture already cropped.
  useEffect(() => {
    applyScale(MIN_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundedIndex]);

  const go = (next: number): void => {
    const target = Math.max(0, Math.min(count - 1, next));
    setIndex(target);
    pagerRef.current?.scrollTo({ x: target * width, animated: true });
  };

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const page = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
    if (page !== boundedIndex) {
      setIndex(page);
    }
  };

  /**
   * Two-finger pinch (and one-finger panning while zoomed). The capture phase
   * runs before the paging ScrollView, so a pinch is never mistaken for a swipe.
   */
  const pinchRef = useRef<{ distance: number; base: number } | null>(null);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (event) =>
          event.nativeEvent.touches.length === 2 ||
          (scaleRef.current > MIN_ZOOM + 0.01 && event.nativeEvent.touches.length === 1),
        onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length === 2,
        onPanResponderGrant: (event) => {
          const touches = event.nativeEvent.touches;
          if (touches.length === 2) {
            const [a, b] = touches;
            pinchRef.current = {
              distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
              base: scaleRef.current,
            };
            return;
          }
          panStartRef.current = { ...translateRef.current };
        },
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;
          if (touches.length === 2 && pinchRef.current !== null) {
            const [a, b] = touches;
            const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            const ratio = distance / Math.max(pinchRef.current.distance, 1);
            applyScale(pinchRef.current.base * ratio);
            return;
          }
          if (scaleRef.current > MIN_ZOOM + 0.01) {
            const maxX = (width * (scaleRef.current - 1)) / 2;
            const maxY = (stageHeight * (scaleRef.current - 1)) / 2;
            const x = Math.max(-maxX, Math.min(maxX, panStartRef.current.x + gesture.dx));
            const y = Math.max(-maxY, Math.min(maxY, panStartRef.current.y + gesture.dy));
            translateRef.current = { x, y };
            translate.setValue({ x, y });
          }
        },
        onPanResponderRelease: () => {
          pinchRef.current = null;
          if (scaleRef.current <= MIN_ZOOM + 0.01) {
            applyScale(MIN_ZOOM);
          }
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, stageHeight],
  );

  /**
   * Double tap toggles zoom. The handlers live on the page view instead of a
   * Pressable so they never claim the responder: a horizontal drag still pages.
   */
  const lastTapRef = useRef(0);
  const tapRef = useRef({ x: 0, y: 0, moved: false });
  const onTouchStart = (event: { nativeEvent: { pageX: number; pageY: number } }): void => {
    tapRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, moved: false };
  };
  const onTouchMove = (event: { nativeEvent: { pageX: number; pageY: number } }): void => {
    if (
      Math.abs(event.nativeEvent.pageX - tapRef.current.x) > TAP_SLOP ||
      Math.abs(event.nativeEvent.pageY - tapRef.current.y) > TAP_SLOP
    ) {
      tapRef.current.moved = true;
    }
  };
  const onTouchEnd = (): void => {
    if (tapRef.current.moved) {
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      applyScale(zoomed ? MIN_ZOOM : DOUBLE_TAP_ZOOM);
      return;
    }
    lastTapRef.current = now;
  };

  const closeConfirm = (): void => {
    setConfirming(false);
  };

  /** Viewer chrome is dark in both themes; only the confirmation follows the app. */
  const chrome = argb('#FF0B0F14');
  const chromeText = argb('#FFF5F7FA');
  const chromeMuted = argb('#FF9AA8BA');


  return (
    <Modal
      animationType="fade"
      visible
      statusBarTranslucent
      onRequestClose={() => (confirming ? closeConfirm() : props.onClose())}>
      <View
        style={[
          styles.host,
          {
            backgroundColor: chrome,
            paddingTop: insets.top + 4,
            paddingBottom: insets.bottom + 8,
          },
        ]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Common_Close')}
            onPress={props.onClose}
            hitSlop={6}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="close" size={24} color={chromeText} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.context, { color: chromeText }]} numberOfLines={1}>
              {props.context}
            </Text>
            {props.contextDetail !== '' && (
              <Text style={[styles.contextDetail, { color: chromeMuted }]} numberOfLines={1}>
                {props.contextDetail}
              </Text>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Rn_ViewerRemove')}
            onPress={() => setConfirming(true)}
            hitSlop={6}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="trash-outline" size={22} color={chromeText} />
          </Pressable>
        </View>

        {/* The measured frame, not a guess: a portrait picture gets every point
            the surrounding chrome does not need. */}
        <View
          style={styles.stage}
          onLayout={(event) => {
            const measured = Math.round(event.nativeEvent.layout.height);
            if (measured > 0 && Math.abs(measured - stageHeight) > 1) {
              setStageHeight(measured);
            }
          }}
          {...panResponder.panHandlers}>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            contentOffset={{ x: boundedIndex * width, y: 0 }}
            style={styles.pager}>
            {props.photos.map((item, itemIndex) => (
              <View
                key={item.id}
                style={{ width, height: stageHeight }}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}>
                <Animated.Image
                  accessibilityLabel={
                    itemIndex === boundedIndex ? item.originalFileName : undefined
                  }
                  source={{ uri: fileUri(item.localFileId) }}
                  // The original image is CONTAINED: letterboxed if needed, never
                  // stretched or cropped by the frame.
                  resizeMode="contain"
                  style={[
                    styles.image,
                    { width, height: stageHeight },
                    itemIndex === boundedIndex
                      ? {
                          transform: [
                            { scale },
                            { translateX: translate.x },
                            { translateY: translate.y },
                          ],
                        }
                      : null,
                  ]}
                />
              </View>
            ))}
          </ScrollView>
        </View>


        <View style={styles.pagerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Rn_ViewerPrevious')}
            accessibilityState={{ disabled: boundedIndex === 0 }}
            disabled={boundedIndex === 0}
            onPress={() => go(boundedIndex - 1)}
            hitSlop={6}
            style={[styles.step, { opacity: boundedIndex === 0 ? 0.35 : 1 }]}>
            <Icon name="chevron-back" size={22} color={chromeText} />
          </Pressable>
          <Text style={[styles.position, { color: chromeText }]}>
            {tFmt('Rn_ViewerCount', boundedIndex + 1, count)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Rn_ViewerNext')}
            accessibilityState={{ disabled: boundedIndex >= count - 1 }}
            disabled={boundedIndex >= count - 1}
            onPress={() => go(boundedIndex + 1)}
            hitSlop={6}
            style={[styles.step, { opacity: boundedIndex >= count - 1 ? 0.35 : 1 }]}>
            <Icon name="chevron-forward" size={22} color={chromeText} />
          </Pressable>
          <View style={styles.spacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Rn_ViewerZoomOut')}
            accessibilityState={{ disabled: !zoomed }}
            disabled={!zoomed}
            onPress={() => applyScale(scale - 1)}
            hitSlop={6}
            style={[styles.step, { opacity: zoomed ? 1 : 0.35 }]}>
            <Icon name="remove" size={22} color={chromeText} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Rn_ViewerZoomIn')}
            accessibilityState={{ disabled: scale >= MAX_ZOOM }}
            disabled={scale >= MAX_ZOOM}
            onPress={() => applyScale(scale + 1)}
            hitSlop={6}
            style={[styles.step, { opacity: scale >= MAX_ZOOM ? 0.35 : 1 }]}>
            <Icon name="add" size={22} color={chromeText} />
          </Pressable>
        </View>

        {count > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // The strip keeps its own height: without this the ScrollView grows
            // and pushes the hint against the bottom edge of the screen.
            style={styles.stripScroll}
            contentContainerStyle={styles.strip}>
            {props.photos.map((item, itemIndex) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={tFmt('Rn_ViewerCount', itemIndex + 1, count)}
                accessibilityState={{ selected: itemIndex === boundedIndex }}
                onPress={() => go(itemIndex)}
                style={[
                  styles.thumbHost,
                  { borderColor: itemIndex === boundedIndex ? colors.accent : 'transparent' },
                ]}>
                <Image source={{ uri: thumbnailUri(item.thumbnailId) }} style={styles.thumb} />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Text style={[styles.hint, { color: chromeMuted }]}>{t('Rn_ViewerHint')}</Text>


        {/* Destructive step: the header's trash opens THIS, and only the red pill
            deletes. It is the app's centered CARD without its own Modal - the
            viewer already IS a modal and Android does not stack two of them
            reliably - so the question looks like the clear-meal card: badge,
            title, what happens, then Cancel / Delete photo. */}
        {confirming && photo !== undefined && (
          <DialogCard
            name="viewer-confirm"
            title={t('Rn_PhotoRemoveTitle')}
            body={t('Rn_PhotoRemoveBody')}
            badge={{ feather: 'trash-2' }}
            badgeTone="danger"
            isDark={props.isDark}
            onDismiss={closeConfirm}
            actions={
              <>
                <DialogCardAction
                  label={t('Common_Cancel')}
                  onPress={closeConfirm}
                  colors={colors}
                />
                <DialogCardAction
                  label={t('Rn_ViewerRemove')}
                  onPress={() => props.onRemove(photo)}
                  colors={colors}
                  destructive
                />
              </>
            }
          />
        )}
      </View>
    </Modal>
  );
}


const styles = StyleSheet.create({
  host: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    paddingHorizontal: 8,
    minHeight: 52,
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0, alignItems: 'center' },
  context: { fontSize: 15, fontFamily: fonts.medium, lineHeight: 20 },
  contextDetail: { fontSize: 12, lineHeight: 17 },
  stage: { flex: 1, minHeight: 180, justifyContent: 'center' },
  pager: { flexGrow: 0 },
  image: { backgroundColor: 'transparent' },
  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    columnGap: 2,
  },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  spacer: { flex: 1 },
  position: { fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 56, textAlign: 'center' },
  stripScroll: { flexGrow: 0, flexShrink: 0 },
  strip: { columnGap: 6, paddingHorizontal: 16, paddingTop: 6, alignItems: 'center' },
  /** 48 pt tile with the accent ring the reference uses for "this one". */
  thumbHost: {
    width: 48,
    height: 48,
    borderRadius: 9,
    borderWidth: 2,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  hint: { fontSize: 12, textAlign: 'center', paddingHorizontal: 16, paddingTop: 8 },
  /** The shared sheet's rows inside the viewer (no Modal, no scrim of our own). */
});
