/**
 * Document IDs are ULIDs: 26 characters, Crockford base32, time-ordered.
 * They are also the document's filename (`docs/<id>.md`), so they must be
 * filesystem-safe on every platform and never change once assigned.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

interface WebCrypto {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

// Web Crypto exists in every runtime Sheaf targets (WebView2, WebKit, Android
// WebView, Node ≥ 19). Reached through globalThis so this package needs no DOM
// or Node type declarations.
function randomBytes(count: number): Uint8Array {
  const crypto = (globalThis as unknown as { crypto: WebCrypto }).crypto;
  return crypto.getRandomValues(new Uint8Array(count));
}

export function newId(now: number = Date.now()): string {
  let time = "";
  let t = Math.floor(now);
  for (let i = 0; i < 10; i++) {
    time = ALPHABET.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  let random = "";
  for (const byte of randomBytes(16)) random += ALPHABET.charAt(byte % 32);
  return time + random;
}

export function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
}
