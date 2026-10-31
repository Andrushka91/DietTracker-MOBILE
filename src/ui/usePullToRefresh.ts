// Pull-to-refresh - the only visible synchronization surface of the app.
//
// The top status strip is gone: it sat under the system bar forever, pushing
// the page down to report background bookkeeping the user never asked for
// ("Pending changes" / "Syncing"). Synchronization now runs silently in the
// background, and a screen that shows cloud data is refreshed the way every
// native app does it - pull the list down and the platform spinner appears
// while one full cycle runs, then the screen reloads what it displays.
//
// The explicit "Synchronize now" button in Settings calls the same engine, so
// nothing is lost by removing the strip.

import { useCallback, useState } from 'react';

import { SyncTrigger } from '../domain/enums';
import { refreshStateAsync, runCycle } from '../cloud/syncEngine';
import { useApp } from './appContext';
import { t } from './strings';

export interface PullToRefresh {
  /** Drives the RefreshControl spinner of the screen's ScrollView. */
  refreshing: boolean;
  onRefresh: () => void;
}

/**
 * Wires a ScrollView's refresh control to one silent synchronization cycle
 * followed by the screen's own reload. Signed out (guest mode) there is nothing
 * to synchronize, so a pull only reloads the local data.
 */
export function usePullToRefresh(reload: () => void | Promise<void>): PullToRefresh {
  const app = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    if (refreshing) {
      return;
    }
    setRefreshing(true);
    void (async () => {
      try {
        if (app.signedIn) {
          const result = await runCycle({ trigger: SyncTrigger.Manual });
          // Background work never interrupts the user: only a genuine failure
          // is reported, and it names the reason instead of "pending changes".
          // Being offline is not a failure the user has to act on.
          if (result.error !== undefined && result.error !== 'Auth_sync_offline') {
            app.showStatus(
              t(result.error.startsWith('Auth_') ? result.error : 'Auth_sync_failed'),
            );
          }
          await refreshStateAsync();
        }
        await reload();
      } catch (error) {
        console.warn('[sync] pull-to-refresh failed', error);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [app, refreshing, reload]);

  return { refreshing, onRefresh };
}
