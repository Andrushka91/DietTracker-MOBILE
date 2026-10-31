// Port of DietTracker.Core.Utilities.Hashing - SHA-256, lower-case hex.
// Used for content hashes (envelope integrity, echo suppression), photo
// deduplication and backup manifests.

import { sha256 } from 'js-sha256';

/** SHA-256 of a UTF-8 string, lower-case hexadecimal. */
export function sha256OfString(value: string): string {
  return sha256(value);
}

/** SHA-256 of raw bytes, lower-case hexadecimal. */
export function sha256OfBytes(bytes: Uint8Array): string {
  return sha256(bytes);
}

/**
 * SHA-256 of a binary file read through the file system layer (base64 decoded).
 * Lower-case hex, matching Windows' Convert.ToHexStringLower.
 */
export function sha256OfBase64(base64: string): string {
  return sha256(decodeBase64(base64));
}

/** Base64 -> bytes without depending on atob/Buffer (works in Hermes + tests). */
function decodeBase64(base64: string): Uint8Array {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[=]+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = alphabet.indexOf(clean[i]);
    if (value < 0) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (buffer >> bits) & 0xff;
      byteIndex += 1;
    }
  }
  return bytes.subarray(0, byteIndex);
}