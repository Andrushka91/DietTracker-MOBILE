// Regression tests for the confirmed cloud defects (audit 31 Oct 2026):
//  - Google Drive objects are addressed by their file ID, never by the flat
//    file name (downloads, photo binaries and deletes),
//  - a stale index is refreshed instead of reporting a file as missing,
//  - duplicate flat names pick the newest content deliberately,
//  - payloads are real UTF-8 (Romanian diacritics, emoji) in the complete
//    multipart body.

jest.mock('../src/cloud/auth', () => {
  class AuthError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    AuthError,
    getValidAccessToken: jest.fn(async () => 'test-token'),
  };
});

import {
  deleteObject,
  downloadObject,
  downloadObjectBase64,
  listObjects,
  resetObjectIndex,
  resolveObjectId,
  uploadObject,
  utf8Bytes,
  utf8Decode,
} from '../src/cloud/driveProvider';

type FakeResponse = {
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function jsonResponse(body: unknown): FakeResponse {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
    json: async () => body,
    text: async () => text,
  };
}

function bytesResponse(bytes: Uint8Array): FakeResponse {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => copy.buffer as ArrayBuffer,
    json: async () => ({}),
    text: async () => new TextDecoder().decode(copy),
  };
}

const notFound: FakeResponse = {
  ok: false,
  status: 404,
  arrayBuffer: async () => new ArrayBuffer(0),
  json: async () => ({}),
  text: async () => 'not found',
};

type Call = { url: string; method: string };

const calls: Call[] = [];
let handler: (url: string, method: string) => Promise<FakeResponse>;

beforeEach(() => {
  resetObjectIndex();
  calls.length = 0;
  handler = async () => notFound;
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      return handler(url, method);
    },
  );
});

const ENTITY_PATH = 'entities/MealEntry/9aa0da4a-7517-4677-b303-e0cb15d80396.json';
const DRIVE_NAME = 'entities__MealEntry__9aa0da4a-7517-4677-b303-e0cb15d80396.json';

function listing(files: Array<{ id: string; name: string; modifiedTime: string; version?: string }>) {
  return jsonResponse({ files });
}

describe('Drive addressing', () => {
  test('download uses the Drive file id, never the flat file name', async () => {
    handler = async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        return listing([{ id: 'drive-id-123', name: DRIVE_NAME, modifiedTime: '2026-10-31T10:00:00Z' }]);
      }
      return bytesResponse(new TextEncoder().encode('{"ok":true}'));
    };

    const objects = await listObjects();
    expect(objects[0].path).toBe(ENTITY_PATH);

    const text = await downloadObject(ENTITY_PATH);
    expect(text).toBe('{"ok":true}');

    const media = calls.filter((call) => call.url.includes('alt=media'));
    expect(media).toHaveLength(1);
    expect(media[0].url).toContain('/files/drive-id-123?alt=media');
    expect(media[0].url).not.toContain('entities__');
  });

  test('a byte download of a photograph also resolves the id', async () => {
    const photoPath = 'photos/93e06287-fab7-436a-8938-a196bdf711a0.bin';
    handler = async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        return listing([
          {
            id: 'photo-file-1',
            name: 'photos__93e06287-fab7-436a-8938-a196bdf711a0.bin',
            modifiedTime: '2026-10-31T10:00:00Z',
          },
        ]);
      }
      return bytesResponse(Uint8Array.from([1, 2, 3, 4]));
    };

    const base64 = await downloadObjectBase64(photoPath);
    expect(base64).toBe('AQIDBA==');
    expect(calls.some((call) => call.url.includes('/files/photo-file-1?alt=media'))).toBe(true);
  });

  test('delete addresses the id and an already absent file is a no-op', async () => {
    let deleted = false;
    handler = async (url, method) => {
      if (method === 'DELETE') {
        deleted = true;
        return { ...notFound, ok: true, status: 204 };
      }
      if (url.includes('spaces=appDataFolder')) {
        return listing(
          deleted
            ? []
            : [{ id: 'drive-id-9', name: DRIVE_NAME, modifiedTime: '2026-10-31T10:00:00Z' }],
        );
      }
      return notFound;
    };

    await listObjects();
    await deleteObject(ENTITY_PATH);

    const deletes = calls.filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toContain('/files/drive-id-9');
    expect(deletes[0].url).not.toContain('entities__');

    // Deleting again is a no-op: the object is gone from the account.
    calls.length = 0;
    await deleteObject(ENTITY_PATH);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  test('a stale index is refreshed before a file is called missing', async () => {
    let listingRound = 0;
    handler = async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        listingRound += 1;
        // The change feed listed nothing (the other device had not uploaded the
        // record yet); the download then refreshes the index once and finds it.
        return listingRound === 1
          ? listing([])
          : listing([{ id: 'late-id', name: DRIVE_NAME, modifiedTime: '2026-10-31T10:05:00Z' }]);
      }
      return bytesResponse(new TextEncoder().encode('{"late":true}'));
    };

    await listObjects();
    expect(await resolveObjectId(ENTITY_PATH)).toBe('late-id');
    expect(await downloadObject(ENTITY_PATH)).toBe('{"late":true}');
  });

  test('a stale entry whose file was deleted is retried under the new id', async () => {
    let lists = 0;
    handler = async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        lists += 1;
        return listing([{ id: `id-${lists}`, name: DRIVE_NAME, modifiedTime: '2026-10-31T10:00:00Z' }]);
      }
      if (url.includes('/files/id-1?alt=media')) {
        return notFound;
      }
      return bytesResponse(new TextEncoder().encode('{"reborn":true}'));
    };

    expect(await downloadObject(ENTITY_PATH)).toBe('{"reborn":true}');
    expect(lists).toBe(2);
  });

  test('a genuinely absent object returns null instead of throwing', async () => {
    handler = async () => listing([]);
    expect(await downloadObject(ENTITY_PATH)).toBeNull();
    expect(await downloadObjectBase64('photos/missing.bin')).toBeNull();
  });

  test('duplicate flat names keep the newest content', async () => {
    handler = async (url) => {
      if (url.includes('spaces=appDataFolder')) {
        return listing([
          { id: 'old-id', name: DRIVE_NAME, modifiedTime: '2026-10-31T09:00:00Z' },
          { id: 'new-id', name: DRIVE_NAME, modifiedTime: '2026-10-31T11:00:00Z' },
        ]);
      }
      return bytesResponse(new TextEncoder().encode('{}'));
    };

    await listObjects();
    expect(await resolveObjectId(ENTITY_PATH)).toBe('new-id');
  });
});


describe('UTF-8 encoding', () => {
  test('Romanian text and emoji survive the encoder byte for byte', () => {
    const value = 'Șnițel cu mămăligă 🥗 și brânză';
    const bytes = utf8Bytes(value);
    expect(new TextDecoder().decode(bytes)).toBe(value);
    // 'Ș' is U+0218 -> 0xC8 0x98, not a truncated 0x18.
    expect(Array.from(bytes.slice(0, 2))).toEqual([0xc8, 0x98]);
    expect(utf8Decode(bytes.buffer.slice(0) as ArrayBuffer)).toBe(value);
  });

  test('a byte order mark written by Windows is dropped on read', () => {
    const payload = new TextEncoder().encode('\uFEFF{"a":"b"}');
    expect(utf8Decode(payload.buffer.slice(0) as ArrayBuffer)).toBe('{"a":"b"}');
  });

  test('the complete multipart upload body carries UTF-8 JSON', async () => {
    let captured: Uint8Array | null = null;
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(
      async (_url: string, init: { method?: string; body?: Uint8Array }) => {
        if (init.body !== undefined) {
          captured = init.body;
        }
        return jsonResponse({
          id: 'new-id',
          name: DRIVE_NAME,
          version: '7',
          modifiedTime: '2026-10-31T12:00:00Z',
          size: '10',
        });
      },
    );

    const json = '{"title":"Șnițel 🥗"}';
    await uploadObject(ENTITY_PATH, json, 'application/json', null);

    expect(captured).not.toBeNull();
    const body = new TextDecoder().decode(captured as unknown as Uint8Array);
    expect(body).toContain('{"title":"Șnițel 🥗"}');
    // The metadata part and both boundaries are present and terminated.
    expect(body).toContain('Content-Type: application/json; charset=UTF-8');
    expect(body.trimEnd().endsWith('--')).toBe(true);
  });
});

