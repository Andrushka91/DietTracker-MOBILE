// The photo viewer's ONE tool: a trash in the header.
//
// The viewer used to open a "…" options sheet holding "Photo details" and
// "Remove photo", so deleting a picture took three taps and the header carried
// an element that is not an action. The design now puts a single delete glyph in
// the header (the same place "…" had) and keeps exactly one guard: the
// confirmation panel, which is the only thing that actually deletes.
//
// Pinned here: no "…" glyph, a `trash-outline` in the header, a press opens the
// question WITHOUT deleting, "No" dismisses, and only the confirm button calls
// `onRemove` with the photograph the viewer is showing.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { SyncStatus } from '../src/domain/enums';
import { MealPhoto } from '../src/domain/models';
import { PhotoViewer } from '../src/ui/components/PhotoViewer';
import { t } from '../src/ui/strings';

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

  test('asks before deleting, and "No" changes nothing', () => {
    const removed: MealPhoto[] = [];
    const renderer = render((item) => removed.push(item));

    act(() => {
      buttons(renderer, t('Rn_ViewerRemove'))[0].props.onPress();
    });
    // Nothing has been deleted yet: the question is on screen.
    expect(removed).toHaveLength(0);
    const question = renderer.root.findAll(
      (node) => node.props?.children === t('Photo_RemoveTitle'),
    );
    expect(question.length).toBeGreaterThan(0);

    act(() => {
      buttons(renderer, t('Common_No'))[0].props.onPress();
    });
    expect(removed).toHaveLength(0);
    // The panel closed again, so only the header's trash is left.
    expect(buttons(renderer, t('Rn_ViewerRemove'))).toHaveLength(1);
  });

  test('the confirm row deletes the photograph on screen, in the app sheet', () => {
    const removed: MealPhoto[] = [];
    const renderer = render((item) => removed.push(item));

    act(() => {
      buttons(renderer, t('Rn_ViewerRemove'))[0].props.onPress();
    });
    // The question is the app's shared sheet, not a bespoke panel.
    const card = renderer.root
      .findAll((node) => node.props?.testID === 'viewer-confirm-card')
      .pop();
    expect(card).toBeDefined();
    expect((StyleSheet.flatten(card?.props.style) as Record<string, unknown>).borderTopLeftRadius).toBe(20);

    // Two "delete" targets now: the header glyph and the sheet's red row.
    const candidates = buttons(renderer, t('Rn_ViewerRemove'));
    expect(candidates).toHaveLength(2);
    const row = candidates[candidates.length - 1];
    expect(styleOf(row).minHeight).toBe(52);

    act(() => {
      row.props.onPress();
    });
    expect(removed).toHaveLength(1);
    // `initialIndex` 1 - the second photograph, not the first or the last.
    expect(removed[0].id).toBe('b');
  });
});
