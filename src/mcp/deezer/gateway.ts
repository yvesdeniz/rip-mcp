/**
 * Thin client for Deezer's private "gw-light" gateway plus the public REST API.
 *
 * - The **gateway** (authenticated with the ARL cookie) yields the per-track
 *   download token, media version and a signed CDN url for the encrypted FLAC.
 * - The **public API** (no auth) is used for search and for rich tagging
 *   metadata (album artist, cover art, release year, genre, ISRC).
 */

import type { Quality } from '../config';
import type { McpLogger } from '../logger';

const GW_LIGHT = 'https://www.deezer.com/ajax/gw-light.php';
const MEDIA_URL = 'https://media.deezer.com/v1/get_url';
const PUBLIC_API = 'https://api.deezer.com';

const CIPHER = 'BF_CBC_STRIPE';

export interface DeezerSearchTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  explicit: boolean;
  url: string;
}

/** Display/tagging metadata sourced from the public API. */
export interface TrackMetadata {
  id: string;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  trackNumber: number;
  trackTotal: number;
  discNumber: number;
  year: string | undefined;
  isrc: string | undefined;
  genre: string | undefined;
  coverUrl: string | undefined;
}

/** Result of resolving a downloadable stream from the gateway. */
export interface StreamSource {
  url: string;
  /** The format actually granted (may be a fallback below the request). */
  format: Quality;
  trackToken: string;
}

interface GatewayResult<T> {
  results: T;
  error: unknown[] | Record<string, unknown>;
}

function gwError(payload: GatewayResult<unknown>): string | undefined {
  const err = payload.error;
  if (Array.isArray(err)) return err.length ? JSON.stringify(err) : undefined;
  if (err && typeof err === 'object' && Object.keys(err).length) return JSON.stringify(err);
  return undefined;
}

export class DeezerGateway {
  private apiToken = '';
  private licenseToken = '';
  private sid = '';
  private ready = false;

  constructor(
    private readonly arl: string,
    private readonly log: McpLogger,
  ) {}

  /** Authenticate the ARL and cache the CSRF/license tokens + session cookie. */
  private async ensureSession(): Promise<void> {
    if (this.ready) return;

    const res = await this.callGateway<{
      USER: { USER_ID: number; OPTIONS?: { license_token?: string } };
      checkForm: string;
    }>('deezer.getUserData', {}, /* needsToken */ false, /* captureCookies */ true);

    if (!res.results?.USER?.USER_ID) {
      throw new Error('Deezer rejected the ARL cookie (USER_ID is 0). Refresh DEEZER_ARL.');
    }
    this.apiToken = res.results.checkForm;
    this.licenseToken = res.results.USER.OPTIONS?.license_token ?? '';
    this.ready = true;
    this.log.info(`authenticated as Deezer user ${res.results.USER.USER_ID}`);
  }

  private async callGateway<T>(
    method: string,
    body: unknown,
    needsToken: boolean,
    captureCookies = false,
  ): Promise<GatewayResult<T>> {
    const params = new URLSearchParams({
      method,
      input: '3',
      api_version: '1.0',
      api_token: needsToken ? this.apiToken : '',
    });

    const cookie = [`arl=${this.arl}`, this.sid && `sid=${this.sid}`].filter(Boolean).join('; ');

    const res = await fetch(`${GW_LIGHT}?${params}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; shd-mcp/1.0)',
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });

    if (captureCookies) {
      const setCookie = res.headers.get('set-cookie') ?? '';
      const sid = /sid=([^;]+)/.exec(setCookie)?.[1];
      if (sid) this.sid = sid;
    }

    if (!res.ok) throw new Error(`gateway ${method} HTTP ${res.status}`);
    const payload = (await res.json()) as GatewayResult<T>;
    const err = gwError(payload);
    if (err) throw new Error(`gateway ${method} error: ${err}`);
    return payload;
  }

  /** Fetch the track token + media version needed to request a stream. */
  private async getSongToken(trackId: string): Promise<{ trackToken: string }> {
    const res = await this.callGateway<{ TRACK_TOKEN: string }>(
      'song.getData',
      { sng_id: trackId },
      true,
    );
    if (!res.results?.TRACK_TOKEN) {
      throw new Error(`no TRACK_TOKEN for track ${trackId} (region locked or unavailable?)`);
    }
    return { trackToken: res.results.TRACK_TOKEN };
  }

  /**
   * Resolve a playable, encrypted CDN url for the requested quality, walking the
   * provided fallback list until Deezer grants one (HiFi/FLAC requires the
   * account to actually have lossless access).
   */
  async resolveStream(trackId: string, qualities: Quality[]): Promise<StreamSource> {
    await this.ensureSession();
    const { trackToken } = await this.getSongToken(trackId);

    const res = await fetch(MEDIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_token: this.licenseToken,
        media: [
          {
            type: 'FULL',
            formats: qualities.map((format) => ({ cipher: CIPHER, format })),
          },
        ],
        track_tokens: [trackToken],
      }),
    });

    if (!res.ok) throw new Error(`get_url HTTP ${res.status}`);
    const payload = (await res.json()) as {
      data?: Array<{
        media?: Array<{ format: Quality; sources: Array<{ url: string }> }>;
        errors?: Array<{ code: number; message: string }>;
      }>;
    };

    const entry = payload.data?.[0];
    const media = entry?.media?.[0];
    const url = media?.sources?.[0]?.url;
    if (!url || !media) {
      const reason = entry?.errors?.map((e) => e.message).join('; ') || 'no media returned';
      throw new Error(`could not resolve stream for track ${trackId}: ${reason}`);
    }

    return { url, format: media.format, trackToken };
  }

  // ---- Public API (unauthenticated) ----------------------------------------

  async search(query: string, limit: number): Promise<DeezerSearchTrack[]> {
    const url = `${PUBLIC_API}/search/track?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`search HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{
        id: number;
        title: string;
        link: string;
        duration: number;
        explicit_lyrics: boolean;
        artist: { name: string };
        album: { title: string };
      }>;
      error?: { message: string };
    };
    if (json.error) throw new Error(`search error: ${json.error.message}`);

    return (json.data ?? []).map((t) => ({
      id: String(t.id),
      title: t.title,
      artist: t.artist.name,
      album: t.album.title,
      durationSec: t.duration,
      explicit: t.explicit_lyrics,
      url: t.link,
    }));
  }

  async getMetadata(trackId: string): Promise<TrackMetadata> {
    const trackRes = await fetch(`${PUBLIC_API}/track/${trackId}`);
    if (!trackRes.ok) throw new Error(`track metadata HTTP ${trackRes.status}`);
    const track = (await trackRes.json()) as {
      error?: { message: string };
      id: number;
      title: string;
      isrc?: string;
      track_position?: number;
      disk_number?: number;
      release_date?: string;
      artist: { name: string };
      album: { id: number; title: string; cover_xl?: string; cover_big?: string };
    };
    if (track.error) throw new Error(`track metadata error: ${track.error.message}`);

    // Album lookup enriches the tags (album artist, genre, total tracks, year).
    let albumArtist = track.artist.name;
    let genre: string | undefined;
    let trackTotal = 0;
    let year = track.release_date?.slice(0, 4);
    try {
      const albumRes = await fetch(`${PUBLIC_API}/album/${track.album.id}`);
      if (albumRes.ok) {
        const album = (await albumRes.json()) as {
          artist?: { name: string };
          genres?: { data?: Array<{ name: string }> };
          nb_tracks?: number;
          release_date?: string;
        };
        albumArtist = album.artist?.name ?? albumArtist;
        genre = album.genres?.data?.[0]?.name;
        trackTotal = album.nb_tracks ?? 0;
        year = year ?? album.release_date?.slice(0, 4);
      }
    } catch (err) {
      this.log.warn(`album lookup failed for ${trackId}`, err);
    }

    return {
      id: String(track.id),
      title: track.title,
      artist: track.artist.name,
      albumArtist,
      album: track.album.title,
      trackNumber: track.track_position ?? 0,
      trackTotal,
      discNumber: track.disk_number ?? 1,
      year,
      isrc: track.isrc,
      genre,
      coverUrl: track.album.cover_xl ?? track.album.cover_big,
    };
  }
}
