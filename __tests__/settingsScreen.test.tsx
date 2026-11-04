// The Settings page as the r3 reference draws it: ONE scrollable page of grouped
// white cards, an account identity above a divider, a QUIET red sign-out row (not
// a solid red button), an explicit pale-indigo "Sync now" pill, 1 pt dividers
// inset to the 16 pt gutter and only BETWEEN rows.
//
// Pinned here: the guest / signed-in / expired-login states keep their truthful
// wording and ink, the sync action stays disabled without an account, the
// sign-out row is a plain tinted row, and no row draws its own border (which is
// what doubled every line before).
//
// The screen is rendered with the data/cloud layer mocked, so nothing here
// touches SQLite, the keychain or the network.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import { SyncState } from '../src/domain/enums';
import { SettingsScreen } from '../src/ui/screens/SettingsScreen';
import { Icon } from '../src/ui/components/icons';
import { lightColors } from '../src/ui/theme';
import { t, tFmt } from '../src/ui/strings';

/** ONE stable app object, mutated per test (the account, the sync state). */
const mockApp = {
  signedIn: true,
  isDark: false,
  use12HourClock: false,
  busy: null as string | null,
  busyProgress: null as unknown,
  preferences: { syncFrequency: 1, use12HourClock: false },
  syncState: SyncState.Synced,
  lastSyncSuccess: '2026-11-04T12:00:00.000Z',
  setBusy: jest.fn(),
  showStatus: jest.fn(),
  refreshSyncState: jest.fn(async () => undefined),
  notifyChanged: jest.fn(),
  setPreference: jest.fn(async () => undefined),
  signOut: jest.fn(async () => ({ ok: true })),
  signInWithConsent: jest.fn(async () => ({ ok: true })),
};

jest.mock('../src/ui/appContext', () => ({ useApp: () => mockApp }));

jest.mock('@react-navigation/native', () => {
  const ReactModule = require('react');
  return {
    useFocusEffect: (callback: () => void) => {
      ReactModule.useEffect(callback, [callback]);
    },
  };
});

jest.mock('../src/data/database', () => ({ databasePath: async () => '/data/db.sqlite' }));
jest.mock('../src/data/integrity', () => ({ checkIntegrity: async () => ({ ok: true, issues: [] }) }));
jest.mock('../src/data/backup', () => ({
  backupsDir: () => '/data/backups',
  createBackup: jest.fn(async () => ({ counts: { meals: 0, photos: 0 } })),
  restoreBackup: jest.fn(async () => ({ meals: 0, photos: 0 })),
}));
jest.mock('../src/data/repositories', () => ({
  totalPhotoBytes: async () => 0,
  getActiveAccount: async () => null,
  // 10 photographs, so the row has a real count to print.
  getPhotoCounts: async () => new Map([['a', 4], ['b', 6]]),
}));
jest.mock('../src/platform/fs', () => ({
  __esModule: true,
  default: { readDir: async () => [] },
}));
jest.mock('../src/cloud/auth', () => ({ readTokens: async () => null }));
jest.mock('../src/cloud/syncEngine', () => ({
  previewRestoreFromCloud: jest.fn(),
  restoreFromCloud: jest.fn(),
  runCycle: jest.fn(),
  subscribeDataChange: () => () => undefined,
}));
jest.mock('../src/cloud/driveProvider', () => ({
  getQuota: async () => ({ totalBytes: null, remainingBytes: null }),
}));
jest.mock('../src/services/deviceId', () => ({ getDeviceId: async () => 'device-1' }));
jest.mock('../src/services/reminders', () => ({ showSyncResultNotification: jest.fn() }));

type Renderer = TestRenderer.ReactTestRenderer;

async function renderScreen(): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<SettingsScreen />);
  });
  if (renderer === undefined) {
    throw new Error('the settings page did not render');
  }
  return renderer;
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const resolved =
    typeof style === 'function'
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

/** Every text the page prints. */
function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((value): value is string => typeof value === 'string');
}

/** A control by its accessible name. */
function control(renderer: Renderer, label: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAll(
      (node) =>
        node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function',
    )
    .pop();
  if (found === undefined) {
    throw new Error(`no control labelled "${label}"`);
  }
  return found;
}

/** The leading glyph of a row, by the icon name the row was given. */
function glyph(renderer: Renderer, name: string): TestRenderer.ReactTestInstance {
  const found = renderer.root
    .findAllByType(Icon)
    .filter((node) => node.props.name === name)
    .pop();
  if (found === undefined) {
    throw new Error(`no glyph named "${name}"`);
  }
  return found;
}

beforeEach(() => {
  mockApp.signedIn = true;
  mockApp.isDark = false;
  mockApp.syncState = SyncState.Synced;
  mockApp.preferences = { syncFrequency: 1, use12HourClock: false };
});

describe('the grouped layout', () => {
  test('draws one 1 pt divider between rows, inset to the 16 dp gutter', async () => {
    const renderer = await renderScreen();
    const dividers = renderer.root
      .findAllByType(View)
      .map((node) => styleOf(node))
      .filter((style) => style.height === 1 && style.marginHorizontal === 16);
    // Account 1, cloud 2, data 3, more 2 - never above a group's first row and
    // never below its last (the card's own frame is the edge there).
    expect(dividers).toHaveLength(8);
    // No row draws its own top border: that is what doubled every line before.
    const bordered = renderer.root
      .findAllByType(View)
      .map((node) => styleOf(node))
      .filter((style) => typeof style.borderTopWidth === 'number' && style.borderTopWidth > 0);
    expect(bordered).toHaveLength(0);
  });

  test('keeps the 52 / 64 pt row rhythm and the real stored facts', async () => {
    const renderer = await renderScreen();
    const heights = renderer.root
      .findAll((node) => node.props?.accessibilityRole === 'button')
      .map((node) => styleOf(node).minHeight)
      .filter((value): value is number => typeof value === 'number');
    expect(heights).toContain(52);
    expect(heights).toContain(64);
    // Photo storage: the real size under the label, the real count on the right.
    const printed = texts(renderer);
    expect(printed).toContain(tFmt('Rn_PhotoStorageSize', '0.00 MB'));
    expect(printed).toContain(tFmt('Rn_PhotoCount', 10));
  });
});

describe('the account card', () => {
  test('signed in: a quiet red Sign out row, never a filled button', async () => {
    const renderer = await renderScreen();
    const signOut = control(renderer, t('Account_SignOut'));
    // A plain row: no fill of its own (only the pressed state paints one).
    expect(styleOf(signOut).backgroundColor).toBeUndefined();
    const label = renderer.root
      .findAllByType(Text)
      .filter((node) => node.props.children === t('Account_SignOut'))[0];
    expect((StyleSheet.flatten(label.props.style) as { color?: string }).color).toBe(
      lightColors.error,
    );
    expect(glyph(renderer, 'log-out-outline').props.color).toBe(lightColors.error);
    // Nothing on the page is a solid danger block any more.
    const filled = renderer.root
      .findAllByType(View)
      .map((node) => styleOf(node))
      .filter((style) => style.backgroundColor === lightColors.error);
    expect(filled).toHaveLength(0);
  });

  test('signed out: guest identity, sign-in action, disabled sync', async () => {
    mockApp.signedIn = false;
    const renderer = await renderScreen();
    const printed = texts(renderer);
    expect(printed).toContain(t('Rn_GuestAccount'));
    expect(printed).toContain(t('Rn_GuestDetail'));
    expect(printed).toContain(t('Account_Google'));
    expect(printed).not.toContain(t('Account_SignOut'));
    // The sync row tells a guest the truth and never claims "Up to date".
    expect(printed).toContain(t('Rn_SyncGuest'));
    expect(printed).not.toContain(t('Rn_SyncOk'));
    // Sync now is disabled and dimmed without an account.
    const pill = control(renderer, t('Rn_SyncNow'));
    expect(pill.props.disabled).toBe(true);
    expect(styleOf(pill).opacity).toBe(0.55);
  });
});

describe('the sync row', () => {
  test('an expired login is red and says so', async () => {
    mockApp.syncState = SyncState.AuthenticationRequired;
    const renderer = await renderScreen();
    const printed = texts(renderer);
    expect(printed).toContain(t('Rn_SyncAuthTitle'));
    expect(printed).toContain(t('Rn_SyncAuthDetail'));
    expect(glyph(renderer, 'alert-circle-outline').props.color).toBe(lightColors.error);
  });

  test('green only for a genuine success, with a 44 pt pale pill', async () => {
    const renderer = await renderScreen();
    expect(texts(renderer)).toContain(t('Rn_SyncOk'));
    expect(glyph(renderer, 'cloud-done-outline').props.color).toBe(lightColors.success);
    const pill = control(renderer, t('Rn_SyncNow'));
    expect(styleOf(pill).minHeight).toBe(44);
    expect(styleOf(pill).borderRadius).toBe(12);
    expect(pill.props.disabled).toBe(false);
    // The pill is a wash of the accent, not the accent itself.
    expect(styleOf(pill).backgroundColor).not.toBe(lightColors.accentFill);
  });
});
