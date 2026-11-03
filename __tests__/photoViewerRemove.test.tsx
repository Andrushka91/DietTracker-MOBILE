// The photo viewer's ONE tool: a trash in the header.
//
// The viewer used to open a "…" options sheet holding "Photo details" and
// "Remove photo", so deleting a picture took three taps and the header carried
// an element that is not an action. The design now puts a single delete glyph in
// the header (the same place "…" had) and keeps exactly one guard: the centered
// confirmation card, which is the only thing that actually deletes.
//
// Pinned here: no "…" glyph, a `trash-outline` in the header, a press opens the
// question WITHOUT deleting, the card is the app's centered surface (not the old
// bottom sheet with "No" / "Yes" rows) with the red bin badge and two pills, and
// only "Delete photo" calls `onRemove` - with the photograph the viewer shows.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { SyncStatus } from '../src/domain/enums';
import { MealPhoto } from '../src/domain/models';
import { PhotoViewer } from '../src/ui/components/PhotoViewer';
import { t } from '../src/ui/strings';
import { lightColors, tintAlpha } from '../src/ui/theme';

type Renderer = TestRenderer.ReactTestRenderer;

function photo(id: string): MealPhoto {
  return {
    id,
    mealEntryId: 'meal-breakfast',
    originalFileName: `${id}.jpg`,
    localFileId: `${id}.jpg`,
    thumbnailId: `${id}-thumb.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 1234,
    contentHash: 'hash',
    cloudObjectId: null,
    cloudRevision: null,
    createdAt: '2026-11-01T07:30:00.000Z',
    updatedAt: '2026-11-01T07:30:00.000Z',
    syncStatus: SyncStatus.PendingUpload,
  };
}

const PHOTOS = [photo('a'), photo('b'), photo('c')];

function render(onRemove: (removed: MealPhoto) => void): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <PhotoViewer
        photos={PHOTOS}
        initialIndex={1}
        context="Breakfast"
        contextDetail="Sunday, 1 November 2026"
        use12HourClock={false}
        isDark={false}
        onClose={() => undefined}
        onRemove={onRemove}
      />,
    );
  });
  if (renderer === undefined) {
    throw new Error('the viewer did not render');
  }
  return renderer;
}

/** Every button carrying an accessibility label. */
function buttons(renderer: Renderer, label: string): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
  );
}

function glyphs(renderer: Renderer): string[] {
  const labels = renderer.root
    .findAll(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith('icon:'),
    )
    .map((node) => node.props.accessibilityLabel as string);
  return [...new Set(labels)];
}

function styleOf(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
  const style = node.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return (StyleSheet.flatten(resolved) ?? {}) as Record<string, unknown>;
}

describe('the photo viewer header', () => {
  test('carries a delete tool and no "…" options entry', () => {
    const renderer = render(() => undefined);
    expect(glyphs(renderer)).not.toContain('icon:ellipsis-horizontal');
    expect(glyphs(renderer)).toContain('icon:trash-outline');
    // The trash IS the header's right-hand tool, labelled with the action.
    const trash = buttons(renderer, t('Rn_ViewerRemove'));
    expect(trash).toHaveLength(1);
  });

  test('asks before deleting, and Cancel changes nothing', () => {
    const removed: MealPhoto[] = [];
    const renderer = render((item) => removed.push(item));

    act(() => {
      buttons(renderer, t('Rn_ViewerRemove'))[0].props.onPress();
    });
    // Nothing has been deleted yet: the question is on screen.
    expect(removed).toHaveLength(0);
    const question = renderer.root.findAll(
      (node) => node.props?.children === t('Rn_PhotoRemoveTitle'),
    );
    expect(question.length).toBeGreaterThan(0);

    act(() => {
      buttons(renderer, t('Common_Cancel'))[0].props.onPress();
    });
    expect(removed).toHaveLength(0);
    // The card closed again, so only the header's trash is left.
    expect(buttons(renderer, t('Rn_ViewerRemove'))).toHaveLength(1);
  });

  test('the card is the centered one: red bin badge, body, two pills', () => {
    const renderer = render(() => undefined);
    act(() => {
      buttons(renderer, t('Rn_ViewerRemove'))[0].props.onPress();
    });

    // The centered card, rounded on ALL corners - not the bottom sheet, whose
    // top corners alone are rounded.
    const card = renderer.root
      .findAll((node) => node.props?.testID === 'viewer-confirm-card')
      .pop();
    expect(card).toBeDefined();
    const cardStyle = StyleSheet.flatten(card?.props.style) as Record<string, unknown>;
    expect(cardStyle.borderRadius).toBe(24);
    expect(cardStyle.borderTopLeftRadius).toBeUndefined();

    // Badge: the same bin the meal card's Clear tool draws, in a wash of the red.
    const badge = renderer.root
      .findAll(
        (node) =>
          StyleSheet.flatten(node.props?.style) !== undefined &&
          (StyleSheet.flatten(node.props.style) as Record<string, unknown>).width === 56 &&
          (StyleSheet.flatten(node.props.style) as Record<string, unknown>).borderRadius === 16,
      )
      .pop();
    expect(badge).toBeDefined();
    expect((StyleSheet.flatten(badge?.props.style) as Record<string, unknown>).backgroundColor).toBe(
      tintAlpha(lightColors.missed, '1F'),
    );
    const bin = renderer.root.findAll(
      (node) => node.props?.accessibilityLabel === 'feather:trash-2',
    );
    expect(bin.length).toBeGreaterThan(0);

    // The body says what the answer does; there is no red "can't be undone" line.
    expect(
      renderer.root.findAll((node) => node.props?.children === t('Rn_PhotoRemoveBody')).length,
    ).toBeGreaterThan(0);
  });

  test('"Delete photo" deletes the photograph on screen', () => {
    const removed: MealPhoto[] = [];
    const renderer = render((item) => removed.push(item));

    act(() => {
      buttons(renderer, t('Rn_ViewerRemove'))[0].props.onPress();
    });
    // Two "delete" targets now: the header glyph and the card's red pill.
    const candidates = buttons(renderer, t('Rn_ViewerRemove'));
    expect(candidates).toHaveLength(2);
    const pill = candidates[candidates.length - 1];
    expect(styleOf(pill).backgroundColor).toBe(lightColors.error);
    expect(styleOf(pill).flex).toBe(1);

    act(() => {
      pill.props.onPress();
    });
    expect(removed).toHaveLength(1);
    // `initialIndex` 1 - the second photograph, not the first or the last.
    expect(removed[0].id).toBe('b');
  });
});
