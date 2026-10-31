// Installation/device identifier - stored as a file in the secure/ folder
// (spec 4.6). Non-identifying: it never encodes the account or the user; it
// only lets the sync engine tell its own uploads apart from other devices'
// (echo suppression, spec 7.5).

import RNFS from '../platform/fs';

import { newGuid } from '../domain/rules/mealSlotRules';
import { dataRoot } from '../data/database';

let cached: string | null = null;

function deviceIdFilePath(): string {
  return `${dataRoot()}/secure/deviceid`;
}

/** Reads (or creates) the installation id. Cached per session. */
export async function getDeviceId(): Promise<string> {
  if (cached !== null) {
    return cached;
  }
  const path = deviceIdFilePath();
  try {
    if (await RNFS.exists(path)) {
      cached = (await RNFS.readFile(path, 'utf8')).trim();
      if (cached !== '') {
        return cached;
      }
    }
  } catch (error) {
    console.warn('[device] id read failed', error);
  }
  cached = newGuid();
  try {
    const dir = `${dataRoot()}/secure`;
    if (!(await RNFS.exists(dir))) {
      await RNFS.mkdir(dir);
    }
    await RNFS.writeFile(path, cached, 'utf8');
  } catch (error) {
    console.warn('[device] id write failed', error);
  }
  return cached;
}

/** Test hook - resets the session cache. */
export function resetDeviceIdCache(): void {
  cached = null;
}