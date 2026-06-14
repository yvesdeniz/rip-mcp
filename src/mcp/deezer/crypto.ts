/**
 * Deezer stream cryptography.
 *
 * Deezer serves tracks encrypted with the `BF_CBC_STRIPE` scheme: the file is
 * split into 2048-byte blocks and **every third block** is encrypted with
 * Blowfish-CBC (the rest are plaintext). The Blowfish key is derived per-track
 * from the track id. Bun's `node:crypto` is backed by BoringSSL but still
 * exposes the `bf-cbc` cipher, so we decrypt natively without a JS Blowfish
 * implementation. (`setAutoPadding(false)` is essential — each block must come
 * back as exactly 2048 bytes, with no PKCS padding stripped.)
 */

import { createHash, createDecipheriv } from 'node:crypto';

const BLOWFISH_SECRET = 'g4el58wc0zvf9na1';
const STRIPE_IV = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
const CHUNK_SIZE = 2048;

/** Derive the 16-byte Blowfish key for a given numeric Deezer track id. */
export function blowfishKey(trackId: string): Buffer {
  const md5 = createHash('md5').update(trackId, 'ascii').digest('hex'); // 32 hex chars
  const key = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    key[i] = md5.charCodeAt(i) ^ md5.charCodeAt(i + 16) ^ BLOWFISH_SECRET.charCodeAt(i);
  }
  return key;
}

/**
 * Decrypt a full encrypted track buffer in place-of-copy, applying the stripe
 * pattern. Returns a new buffer of identical length.
 */
export function decryptStripe(encrypted: Buffer, trackId: string): Buffer {
  const key = blowfishKey(trackId);
  const out = Buffer.allocUnsafe(encrypted.length);

  let offset = 0;
  let index = 0;
  while (offset < encrypted.length) {
    const end = Math.min(offset + CHUNK_SIZE, encrypted.length);
    const chunk = encrypted.subarray(offset, end);

    // Only complete 2048-byte blocks on every third boundary are encrypted.
    if (index % 3 === 0 && chunk.length === CHUNK_SIZE) {
      const decipher = createDecipheriv('bf-cbc', key, STRIPE_IV);
      decipher.setAutoPadding(false);
      const decoded = Buffer.concat([decipher.update(chunk), decipher.final()]);
      decoded.copy(out, offset);
    } else {
      chunk.copy(out, offset);
    }

    offset = end;
    index++;
  }

  return out;
}
