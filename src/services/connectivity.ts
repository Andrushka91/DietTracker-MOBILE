// Connectivity monitor (spec: triggers include ConnectivityRestored; the
// Offline state of the status strip comes from here). Uses NetInfo, which
// behaves identically on Android and iOS.

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type ConnectivityListener = (online: boolean) => void;

let lastOnline = true;
const listeners = new Set<ConnectivityListener>();

let started = false;

/** Starts the global listener (called once from App bootstrap). */
export function startConnectivityWatch(): void {
  if (started) {
    return;
  }
  started = true;
  NetInfo.addEventListener((state: NetInfoState) => {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    if (online !== lastOnline) {
      const cameBack = !lastOnline && online;
      lastOnline = online;
      for (const listener of listeners) {
        listener(online);
      }
      if (cameBack) {
        for (const listener of restoredListeners) {
          listener();
        }
      }
    }
  });
}

const restoredListeners = new Set<() => void>();

/** Fires when connectivity RETURNS (SyncTrigger.ConnectivityRestored). */
export function onConnectivityRestored(listener: () => void): () => void {
  restoredListeners.add(listener);
  return () => restoredListeners.delete(listener);
}

export function onConnectivityChange(listener: ConnectivityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current best-known state (defaults to online until the first event). */
export function isOnline(): boolean {
  return lastOnline;
}

/** One-shot probe used before a manual cycle. */
export async function checkOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    lastOnline = state.isConnected === true && state.isInternetReachable !== false;
    return lastOnline;
  } catch {
    return lastOnline;
  }
}