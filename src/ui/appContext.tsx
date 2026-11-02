// App-wide context: the single store the five tabs share (spec 6 shell).
// Holds the bootstrapped profile + preferences, the account id, the sync
// state shown by the Settings card, the busy overlay (6.4) and the floating
// status caption (6.6). Every mutation writes immediately (no Save button - 8.8).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import { SyncState } from '../domain/enums';
import { AppPreferences, UserProfile } from '../domain/models';
import { bootstrapApp, defaultPreferences } from '../services/bootstrap';
import { getActiveAccount, getPreferences, upsertPreferences } from '../data/repositories';
import { notifyLocalChange, refreshStateAsync, subscribeSyncState } from '../cloud/syncEngine';
import {
  signInWithGoogle,
  signOutGoogle,
  type SignInResult,
  type AccountSyncProgress,
  type SignOutResult,
} from '../cloud/session';
import { t } from './strings';

/** Busy overlay stages (spec 6.4 stage sentences). */
export type BusyStage =
  | 'sync'
  | 'savingPhoto'
  | 'uploading'
  | 'downloading'
  | 'signingIn'
  | 'signingOut'
  | 'restoring'
  | 'loadingAccount'
  | 'waitingForBrowser'
  | null;

export interface AppState {
  ready: boolean;
  profile: UserProfile | null;
  preferences: AppPreferences | null;
  accountId: string | null;
  signedIn: boolean;
  onboardingCompleted: boolean;
  syncState: SyncState;
  lastSyncSuccess: string | null;
  busy: BusyStage;
  /**
   * Determinate progress of the running busy stage (sign-out uploads). Null
   * means "no measurable progress" - the overlay then shows the spinner.
   */
  busyProgress: AccountSyncProgress | null;
  /** Floating status caption (spec 6.6). */
  status: string | null;
  isDark: boolean;
  use12HourClock: boolean;
}

export interface AppActions {
  setBusy: (stage: BusyStage) => void;
  showStatus: (message: string) => void;
  clearStatus: () => void;
  /** Writes one preference immediately + confirms (spec 8.8). */
  setPreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  signInWithConsent: (consent: boolean) => Promise<SignInResult>;
  signOut: (discardChanges: boolean) => Promise<SignOutResult>;
  /** Call after any local mutation so strip + debounce react (spec 7.2). */
  notifyChanged: () => void;
  refreshSyncState: () => Promise<void>;
  reloadPreferences: () => Promise<void>;
}

const DEFAULT_STATE: AppState = {
  ready: false,
  profile: null,
  preferences: null,
  accountId: null,
  signedIn: false,
  onboardingCompleted: false,
  syncState: SyncState.NotConfigured,
  lastSyncSuccess: null,
  busy: null,
  busyProgress: null,
  status: null,
  isDark: false,
  use12HourClock: false,
};

interface ContextValue extends AppState, AppActions {}

const AppContext = createContext<ContextValue | null>(null);

export function useApp(): ContextValue {
  const value = useContext(AppContext);
  if (value === null) {
    throw new Error('useApp must be used inside <AppProvider>');
  }
  return value;
}

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const scheme = useColorScheme();
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useCallback((partial: Partial<AppState>) => {
    setState((current) => ({ ...current, ...partial }));
  }, []);

  const boot = useCallback(async () => {
    const { profile, preferences } = await bootstrapApp();
    const account = await getActiveAccount();
    patch({
      ready: true,
      profile,
      preferences,
      accountId: account?.id ?? null,
      signedIn: account !== null,
      onboardingCompleted: preferences.onboardingCompleted,
      use12HourClock: preferences.use12HourClock,
    });
    await refreshStateAsync();
  }, [patch]);

  useEffect(() => {
    void boot();
    // boot runs once at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live sync state for the status strip (spec 6.3).
  useEffect(() => {
    const unsubscribe = subscribeSyncState((syncState, lastSuccess) => {
      patch({ syncState, lastSyncSuccess: lastSuccess });
    });
    return unsubscribe;
  }, [patch]);

  const applyAccount = useCallback(async () => {
    const account = await getActiveAccount();
    patch({ accountId: account?.id ?? null, signedIn: account !== null });
  }, [patch]);

  const reloadPreferences = useCallback(async () => {
    const currentProfile =
      state.profile ?? (await bootstrapApp()).profile;
    const preferences = await getPreferences(currentProfile.id);
    patch({
      profile: currentProfile,
      preferences,
      onboardingCompleted: preferences?.onboardingCompleted ?? false,
      use12HourClock: preferences?.use12HourClock ?? false,
    });
  }, [patch, state.profile]);

  // A new stage always starts without a leftover bar; closing the overlay
  // (null) drops both the stage and its progress.
  const setBusy = useCallback(
    (stage: BusyStage) => patch({ busy: stage, busyProgress: null }),
    [patch],
  );

  const showStatus = useCallback(
    (message: string) => {
      patch({ status: message });
      if (statusTimer.current !== null) {
        clearTimeout(statusTimer.current);
      }
      statusTimer.current = setTimeout(() => {
        patch({ status: null });
      }, 6000);
    },
    [patch],
  );

  const clearStatus = useCallback(() => {
    if (statusTimer.current !== null) {
      clearTimeout(statusTimer.current);
    }
    patch({ status: null });
  }, [patch]);

  const setPreference = useCallback(
    async <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
      const profile = state.profile;
      const current = state.preferences;
      if (profile === null || current === null) {
        return;
      }
      const next: AppPreferences = {
        ...current,
        [key]: value,
        updatedAt: new Date().toISOString(),
      };
      try {
        await upsertPreferences(next);
        patch({ preferences: next, use12HourClock: next.use12HourClock });
        showStatus(t('Settings_Saved'));
        notifyLocalChange();
      } catch {
        showStatus(t('Settings_SaveFailed'));
      }
    },
    [patch, showStatus, state.preferences, state.profile],
  );

  const completeOnboarding = useCallback(async () => {
    const profile = state.profile;
    const current = state.preferences;
    if (profile === null) {
      return;
    }
    const base = current ?? defaultPreferences(profile.id);
    const next: AppPreferences = {
      ...base,
      onboardingCompleted: true,
      updatedAt: new Date().toISOString(),
    };
    await upsertPreferences(next);
    patch({ preferences: next, onboardingCompleted: true });
  }, [patch, state.preferences, state.profile]);

  const signInWithConsent = useCallback(
    async (consent: boolean): Promise<SignInResult> => {
      // The account boundary reports every document it settles, so the busy
      // overlay paints a real 0-100 % bar: after signing in the user WAITS for
      // the account's dataset inside that bar instead of being dropped into
      // half-empty screens and having to guess where the records went.
      const result = await signInWithGoogle({
        consentGranted: consent,
        onProgress: (progress) => patch({ busyProgress: progress }),
      });
      patch({ busyProgress: null });
      await applyAccount();
      await reloadPreferences();
      return result;
    },
    [applyAccount, patch, reloadPreferences],
  );

  const signOut = useCallback(
    async (discardChanges: boolean): Promise<SignOutResult> => {
      // The account boundary reports every uploaded document, so the busy
      // overlay paints a real 0-100 % bar: the user sees that the app is working
      // through the outbox instead of guessing why the sign-out is "stuck".
      const result = await signOutGoogle({
        discardChanges,
        onProgress: (progress) => patch({ busyProgress: progress }),
      });
      patch({ busyProgress: null });
      if (result.ok) {
        await boot();
      }
      return result;
    },
    [boot, patch],
  );

  const notifyChanged = useCallback(() => notifyLocalChange(), []);

  const refreshSyncState = useCallback(async () => {
    await refreshStateAsync();
  }, []);

  const value = useMemo<ContextValue>(
    () => ({
      ...state,
      isDark: scheme === 'dark',
      setBusy,
      showStatus,
      clearStatus,
      setPreference,
      completeOnboarding,
      signInWithConsent,
      signOut,
      notifyChanged,
      refreshSyncState,
      reloadPreferences,
    }),
    [
      state,
      scheme,
      setBusy,
      showStatus,
      clearStatus,
      setPreference,
      completeOnboarding,
      signInWithConsent,
      signOut,
      notifyChanged,
      refreshSyncState,
      reloadPreferences,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}