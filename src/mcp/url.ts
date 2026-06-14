/**
 * Helpers for turning the many shapes of "track url" a user might paste into a
 * canonical Deezer track id.
 */

export interface ParsedTrack {
  /** Numeric Deezer track id, when the source resolves to Deezer. */
  deezerId: string | undefined;
  /** The original (possibly non-Deezer) url, for pass-through backends. */
  raw: string;
}

/**
 * Accepts:
 *   - https://www.deezer.com/track/123 / https://deezer.com/en/track/123
 *   - deezer:track:123
 *   - a Lucida-style wrapper:  https://lucida.to/?url=<deezer url>&...
 *   - a bare numeric id
 */
export function parseTrack(input: string): ParsedTrack {
  const value = input.trim();

  // Unwrap Lucida-style links that carry the real url as a query param.
  try {
    const u = new URL(value);
    const inner = u.searchParams.get('url');
    if (inner) {
      const innerParsed = parseTrack(inner);
      if (innerParsed.deezerId) return { deezerId: innerParsed.deezerId, raw: value };
    }
  } catch {
    /* not a URL — fall through */
  }

  if (/^\d+$/.test(value)) return { deezerId: value, raw: value };

  const colon = /deezer:track:(\d+)/i.exec(value);
  if (colon) return { deezerId: colon[1], raw: value };

  const path = /deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i.exec(value);
  if (path) return { deezerId: path[1], raw: value };

  return { deezerId: undefined, raw: value };
}
