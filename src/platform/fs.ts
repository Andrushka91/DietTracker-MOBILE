// File system access - a react-native-fs compatible surface implemented on top
// of expo-file-system's legacy API (bundled inside Expo Go, so the app needs no
// custom native binary). Plain absolute paths go in and come out; the file://
// scheme only appears at the expo boundary.
//
// Only the subset this codebase uses is implemented: DocumentDirectoryPath,
// exists, mkdir, readFile, writeFile, unlink, copyFile, stat and readDir.

import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';

type Encoding = 'utf8' | 'base64';

function toUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function fromUri(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

/** Modification time from expo (seconds or ms depending on platform) -> Date. */
function toDate(modificationTime: number | undefined): Date | undefined {
  if (modificationTime === undefined || modificationTime <= 0) {
    return undefined;
  }
  // Values below ~1e12 are seconds since epoch; anything larger is millis.
  return new Date(modificationTime < 1e12 ? modificationTime * 1000 : modificationTime);
}

export interface FileStat {
  size: number;
  mtime?: Date;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  mtime?: Date;
  isDirectory(): boolean;
  isFile(): boolean;
}

/** App-private data root (mirrors %LOCALAPPDATA%\DietTracker on Windows). */
export const DocumentDirectoryPath = fromUri((documentDirectory ?? '').replace(/\/+$/, ''));

async function exists(path: string): Promise<boolean> {
  try {
    const info = await getInfoAsync(toUri(path));
    return info.exists;
  } catch {
    return false;
  }
}

async function mkdir(path: string): Promise<void> {
  await makeDirectoryAsync(toUri(path), { intermediates: true });
}

async function readFile(path: string, encoding: Encoding = 'utf8'): Promise<string> {
  return readAsStringAsync(toUri(path), { encoding });
}

async function writeFile(path: string, contents: string, encoding: Encoding = 'utf8'): Promise<void> {
  await writeAsStringAsync(toUri(path), contents, { encoding });
}

async function unlink(path: string): Promise<void> {
  await deleteAsync(toUri(path), { idempotent: true });
}

async function copyFile(from: string, to: string): Promise<void> {
  await copyAsync({ from: toUri(from), to: toUri(to) });
}

async function stat(path: string): Promise<FileStat> {
  const info = await getInfoAsync(toUri(path));
  const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
  const mtime = 'modificationTime' in info ? toDate(info.modificationTime) : undefined;
  const isDirectory = 'uri' in info && typeof info.isDirectory === 'boolean' ? info.isDirectory : false;
  return {
    size,
    mtime,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  };
}

/** Directory listing with the fields SettingsScreen sorts by (name, path, mtime). */
async function readDir(path: string): Promise<DirEntry[]> {
  const names = await readDirectoryAsync(toUri(path));
  const entries: DirEntry[] = [];
  for (const name of names) {
    const child = `${path}/${name}`;
    const info = await getInfoAsync(toUri(child));
    const isDirectory = 'uri' in info && typeof info.isDirectory === 'boolean' ? info.isDirectory : false;
    entries.push({
      name,
      path: child,
      mtime: 'modificationTime' in info ? toDate(info.modificationTime) : undefined,
      isDirectory: () => isDirectory,
      isFile: () => !isDirectory,
    });
  }
  return entries;
}

const RNFS = {
  DocumentDirectoryPath,
  exists,
  mkdir,
  readFile,
  writeFile,
  unlink,
  copyFile,
  stat,
  readDir,
};

export default RNFS;