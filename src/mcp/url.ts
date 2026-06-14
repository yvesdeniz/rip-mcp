export interface ParsedTrack {
  deezerId: string | undefined;
  raw: string;
}

export function parseTrack(input: string): ParsedTrack {
  const value = input.trim();

  try {
    const u = new URL(value);
    const inner = u.searchParams.get('url');
    if (inner) {
      const innerParsed = parseTrack(inner);
      if (innerParsed.deezerId) return { deezerId: innerParsed.deezerId, raw: value };
    }
  } catch {
  }

  if (/^\d+$/.test(value)) return { deezerId: value, raw: value };

  const colon = /deezer:track:(\d+)/i.exec(value);
  if (colon) return { deezerId: colon[1], raw: value };

  const path = /deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i.exec(value);
  if (path) return { deezerId: path[1], raw: value };

  return { deezerId: undefined, raw: value };
}
