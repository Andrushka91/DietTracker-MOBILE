// The meal card's READ MODE, drawn the way the r3 reference card draws it:
//
//   ▕ [glyph] Breakfast        (Pending)
//   ▕         07:30
//   ▕  Oats with milk            [photo][photo][photo]
//   ▕  Almond milk, banana
//   ────────────────────────────────────────────────
//   [camera][edit][clear]        │        [✕][✓]
//
// One fixed entry per category: the dishes are its title/description, and the
// photos are evidence for that same entry - there is no add-meal CTA and no
// extra record. These tests pin the compact header, the 48 pt thumbnails (4 pt
// gaps, 8 pt corners), the text-left / strip-right anatomy, the measurement
// fallback for narrow or very large text, the photo-only copy, and the rules
// that keep photos from enabling Done/Missed and the camera from surviving a
// third photograph.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import { MealCategoryKey, MealStatus, SyncStatus } from '../src/domain/enums';
import { MealCategory, MealEntry, MealPhoto } from '../src/domain/models';
import { MAX_PHOTOS_PER_MEAL } from '../src/domain/rules/photoRules';
import {
  MealCard,
  TEXT_GALLERY_GAP,
  TEXT_MIN_WIDTH,
} from '../src/ui/components/MealCard';
import { PHOTO_GAP, PHOTO_TILE } from '../src/ui/components/PhotoGallery';
import { t } from '../src/ui/strings';
import { fonts, lightColors } from '../src/ui/theme';

/** A phone-shaped window; the large-text case moves `fontScale` itself. */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const NOW = new Date('2026-11-01T18:00:00.000Z');

const CATEGORY: MealCategory = {
  id: 'cat-breakfast',
  fixedCategoryKey: MealCategoryKey.Breakfast,
  name: 'Breakfast',
  color: '#FF0F6CBD',
  icon: 'A',
  defaultTime: '07:30:00',
  displayOrder: 0,
};

const MEAL: MealEntry = {
  id: 'meal-breakfast',
  localProfileId: 'profile',
  date: '2026-11-01',
  mealCategoryId: CATEGORY.id,
  mealCategoryKey: MealCategoryKey.Breakfast,
  title: 'Oats with milk',
  ingredients: 'Almond milk, banana',
  plannedTime: '07:30:00',
  status: MealStatus.Pending,
  completedAt: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  revision: 1,
  syncStatus: SyncStatus.PendingUpload,
  cloudRevision: null,
  contentHash: null,
};

function photo(index: number): MealPhoto {
  return {
    id: `photo-${index}`,
    mealEntryId: MEAL.id,
    originalFileName: `meal-${index}.jpg`,
    localFileId: `local-${index}.jpg`,
    thumbnailId: `thumb-${index}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 1024,
    contentHash: `hash-${index}`,
    cloudObjectId: null,
    cloudRevision: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    syncStatus: SyncStatus.PendingUpload,
  };
}

type Renderer = TestRenderer.ReactTestRenderer;

function render(options: {
  meal?: MealEntry;
  photos?: MealPhoto[];
  uploadingPhoto?: boolean;
  onOpenPhoto?: (photo: MealPhoto) => void;
} = {}): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <MealCard
        meal={options.meal ?? MEAL}
        category={CATEGORY}
        photos={options.photos ?? []}
        use12HourClock={false}
        now={NOW}
        isDark={false}
        uploadingPhoto={options.uploadingPhoto}
        onSave={async () => null}
        onComplete={async () => undefined}
        onMissed={async () => undefined}
        onClear={() => undefined}
        onAddPhoto={() => undefined}
        onRemovePhoto={() => undefined}
        onOpenPhoto={options.onOpenPhoto ?? (() => undefined)}
      />,
    );
  });
  if (renderer === undefined) {
    throw new Error('the meal card did not render');
  }
  return renderer;
}


function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

function viewsWhere(
  renderer: Renderer,
  predicate: (style: Record<string, unknown>) => boolean,
): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAllByType(View).filter((node) => predicate(styleOf(node)));
}

function textOf(renderer: Renderer, value: string): TestRenderer.ReactTestInstance {
  const found = renderer.root.findAllByType(Text).find((node) => node.props.children === value);
  if (found === undefined) {
    throw new Error(`no text "${value}"`);
  }
  return found;
}

function pressable(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) => node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no pressable labelled "${label}"`);
  }
  return found;
}

/** The photo tiles, in order: the 48 pt square pressables. */
function tilesOf(renderer: Renderer): TestRenderer.ReactTestInstance[] {
  return viewsWhere(
    renderer,
    (style) => style.width === PHOTO_TILE && style.height === PHOTO_TILE,
  );
}

/** The row that holds the strip: the nearest row above a tile with the 4 pt gap. */
function galleryRow(renderer: Renderer): TestRenderer.ReactTestInstance {
  let node: TestRenderer.ReactTestInstance | null = tilesOf(renderer)[0] ?? null;
  while (node !== null) {
    const style = styleOf(node);
    if (style.flexDirection === 'row' && style.columnGap === PHOTO_GAP) {
      return node;
    }
    node = node.parent;
  }
  throw new Error('no gallery row');
}

/** The photo tiles inside one container, in order. */
function tilesIn(container: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance[] {
  return container
    .findAllByType(View)
    .filter((node) => styleOf(node).width === PHOTO_TILE && styleOf(node).height === PHOTO_TILE);
}

/** The content row (text + strip), found by its 12 pt gap and top margin. */
function contentOf(renderer: Renderer): TestRenderer.ReactTestInstance {
  const found = renderer.root.findAllByType(View).find((node) => {
    const style = styleOf(node);
    return style.marginTop === 12 && style.columnGap === TEXT_GALLERY_GAP;
  });
  if (found === undefined) {
    throw new Error('no content row');
  }
  return found;
}

beforeEach(() => {
  mockWindow.width = 390;
  mockWindow.fontScale = 1;
});

describe('the compact category header', () => {
  test('draws the 36 pt tile, 16 pt category, 12 pt time and a clock badge', () => {
    const renderer = render();
    // The category tile: 36 pt square, 10 pt corner, no frame of its own.
    const tiles = viewsWhere(
      renderer,
      (style) =>
        style.width === 36 && style.height === 36 && style.borderRadius === 10 && style.borderWidth === undefined,
    );
    expect(tiles).toHaveLength(1);
    expect(styleOf(tiles[0]).backgroundColor).toBe(lightColors.surfaceVariant);

    // "Breakfast" at 16 pt medium, the planned time at 12 pt regular under it.
    const title = styleOf(textOf(renderer, 'Breakfast'));
    expect(title.fontSize).toBe(16);
    expect(title.fontFamily).toBe(fonts.medium);
    const time = styleOf(textOf(renderer, '07:30'));
    expect(time.fontSize).toBe(12);
    expect(time.color).toBe(lightColors.textMuted);
    expect(time.marginTop).toBe(2);

    // The compact 11 pt pending badge: 20 pt capsule, 8/4 padding, 4 pt gap.
    expect(styleOf(textOf(renderer, t('Status_Pending'))).fontSize).toBe(11);
    const badges = viewsWhere(
      renderer,
      (style) => style.borderRadius === 20 && style.paddingHorizontal === 8,
    );
    expect(badges).toHaveLength(1);
    expect(styleOf(badges[0]).paddingVertical).toBe(4);
    expect(styleOf(badges[0]).columnGap).toBe(4);
    // ...with a CLOCK, not the old bare dot, in the badge's own ink.
    const clock = renderer.root.findAll(
      (node) => node.props?.accessibilityLabel === 'icon:time-outline',
    );
    expect(clock.length).toBeGreaterThan(0);
    expect(clock[clock.length - 1].props.color).toBe(lightColors.textSecondary);
  });
});

describe('the read content', () => {
  test('puts the meal text on the LEFT and the strip on the RIGHT', () => {
    const renderer = render({ photos: [photo(1)] });
    const content = styleOf(contentOf(renderer));
    expect(content.flexDirection).toBe('row');
    expect(content.alignItems).toBe('flex-start');

    // Title 16/22 medium (2 lines), description 13/18 (3 lines), 3 pt apart.
    const title = textOf(renderer, 'Oats with milk');
    expect(styleOf(title).fontSize).toBe(16);
    expect(styleOf(title).lineHeight).toBe(22);
    expect(styleOf(title).fontFamily).toBe(fonts.medium);
    expect(title.props.numberOfLines).toBe(2);
    const description = textOf(renderer, 'Almond milk, banana');
    expect(styleOf(description).fontSize).toBe(13);
    expect(styleOf(description).lineHeight).toBe(18);
    expect(styleOf(description).marginTop).toBe(3);
    expect(description.props.numberOfLines).toBe(3);
  });

  test('prints the quiet copy for a photo-only entry, and for a truly empty one', () => {
    const photoOnly = render({ photos: [photo(1)], meal: { ...MEAL, title: '', ingredients: '' } });
    expect(textOf(photoOnly, t('Rn_MealPhotoOnly'))).toBeDefined();
    expect(photoOnly.root.findAllByType(Text).some((n) => n.props.children === t('Rn_MealEmpty'))).toBe(
      false,
    );
    expect(tilesOf(photoOnly)).toHaveLength(1);
    // Its Clear stays live: photographs are user content.
    expect(pressable(photoOnly, t('Meal_Clear')).props.disabled).toBe(false);

    const empty = render({ meal: { ...MEAL, title: '', ingredients: '', plannedTime: null } });
    expect(textOf(empty, t('Rn_MealEmpty'))).toBeDefined();
    expect(empty.root.findAllByType(Text).some((n) => n.props.children === t('Rn_MealPhotoOnly'))).toBe(
      false,
    );
    // Nothing typed, nothing attached, no planned time: the slot is a placeholder.
    expect(pressable(empty, t('Meal_Clear')).props.disabled).toBe(true);
  });
});


describe('the thumbnail strip', () => {
  test('is one horizontal row of 48 pt, 8 pt-cornered tiles, 4 pt apart', () => {
    const onOpenPhoto = jest.fn();
    const photos = [photo(1), photo(2), photo(3)];
    const renderer = render({ photos, onOpenPhoto });

    const tiles = tilesOf(renderer);
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(styleOf(tile).width).toBe(48);
      expect(styleOf(tile).height).toBe(48);
      expect(styleOf(tile).borderRadius).toBe(8);
    }
    // ONE row, 4 pt gaps - never a vertical stack.
    const row = galleryRow(renderer);
    expect(styleOf(row).flexDirection).toBe('row');
    expect(styleOf(row).columnGap).toBe(4);
    expect(tilesIn(row)).toHaveLength(3);
    // Three photographs occupy exactly 152 pt (48 x 3 + 4 x 2).
    expect(PHOTO_TILE * 3 + PHOTO_GAP * 2).toBe(152);

    // Each tile is its own imagebutton and opens THAT photograph.
    act(() => pressable(renderer, `${t('Photo_Show')} meal-2.jpg`).props.onPress());
    expect(onOpenPhoto).toHaveBeenCalledWith(photos[1]);
  });

  test('is absent with zero photos, so the text uses the whole width', () => {
    const renderer = render();
    expect(tilesOf(renderer)).toHaveLength(0);
    // No reserved gallery column: the text column keeps its flex.
    const content = contentOf(renderer);
    const columns = content.findAllByType(View).filter((node) => styleOf(node).flex === 1);
    expect(columns.length).toBeGreaterThanOrEqual(1);
  });
});

describe('the narrow / large-text fallback', () => {
  test('moves the SAME horizontal strip below the text when the row is narrow', () => {
    const renderer = render({ photos: [photo(1), photo(2), photo(3)] });
    expect(styleOf(contentOf(renderer)).flexDirection).toBe('row');

    // A 200 pt content row cannot give the text its 120 pt beside 152 pt of
    // photographs (120 + 12 + 152 = 284).
    expect(TEXT_MIN_WIDTH + TEXT_GALLERY_GAP + PHOTO_TILE * 3 + PHOTO_GAP * 2).toBe(284);
    act(() => {
      contentOf(renderer).props.onLayout({ nativeEvent: { layout: { width: 200 } } });
    });

    expect(styleOf(contentOf(renderer)).flexDirection).toBe('column');
    // Still ONE row of three thumbnails - nothing is hidden or stacked vertically.
    expect(tilesOf(renderer)).toHaveLength(3);
    expect(tilesIn(galleryRow(renderer))).toHaveLength(3);
  });

  test('stacks at large text, and lets the title and description grow', () => {
    mockWindow.fontScale = 1.5;
    const renderer = render({ photos: [photo(1)] });

    expect(styleOf(contentOf(renderer)).flexDirection).toBe('column');
    // The badge drops under the identity, offset past the glyph tile.
    const badges = viewsWhere(renderer, (style) => style.borderRadius === 20);
    expect(styleOf(badges[0]).alignSelf).toBe('flex-start');
    expect(styleOf(badges[0]).marginLeft).toBe(46);
    // No line caps when the text needs the room.
    expect(textOf(renderer, 'Oats with milk').props.numberOfLines).toBeUndefined();
    expect(textOf(renderer, 'Almond milk, banana').props.numberOfLines).toBeUndefined();
  });
});

describe('the rules the card must not break', () => {
  test('disables the camera at three photographs and while uploading', () => {
    const full = render({ photos: [photo(1), photo(2), photo(3)] });
    expect(pressable(full, t('Photo_Add')).props.disabled).toBe(true);
    expect(MAX_PHOTOS_PER_MEAL).toBe(3);

    const uploading = render({ photos: [photo(1)], uploadingPhoto: true });
    expect(pressable(uploading, t('Photo_Add')).props.disabled).toBe(true);

    const room = render({ photos: [photo(1), photo(2)] });
    expect(pressable(room, t('Photo_Add')).props.disabled).toBe(false);
  });

  test('photographs alone never enable Done or Missed', () => {
    const renderer = render({
      photos: [photo(1), photo(2)],
      meal: { ...MEAL, title: '', ingredients: '' },
    });
    expect(pressable(renderer, t('Meal_MarkDone')).props.disabled).toBe(true);
    expect(pressable(renderer, t('Meal_MarkMissed')).props.disabled).toBe(true);
    // ...and the camera still opens the ONE existing entry's photo flow.
    expect(pressable(renderer, t('Photo_Add')).props.disabled).toBe(false);
  });

  test('a future day keeps both state marks disabled', () => {
    const renderer = render({ meal: { ...MEAL, date: '2026-11-02' } });
    expect(pressable(renderer, t('Meal_MarkDone')).props.disabled).toBe(true);
    expect(pressable(renderer, t('Meal_MarkMissed')).props.disabled).toBe(true);
    // Editing is always allowed: it edits THIS entry, it adds no meal.
    expect(pressable(renderer, t('Common_Edit')).props.disabled).toBe(false);
  });
});

