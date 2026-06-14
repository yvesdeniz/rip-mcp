/**
 * Lucida-flow backend.
 *
 * This targets a *self-hosted* lucida-flow instance rather than the public
 * lucida.to site. Because lucida deployments expose slightly different routes,
 * the endpoints below are intentionally simple and overridable via env. The
 * expected contract is:
 *
 *   POST {LUCIDA_API_URL}/api/fetch
 *        body:  { "url": <track url>, "format": "flac"|"mp3" }
 *        auth:  Authorization: Bearer {LUCIDA_API_KEY}   (optional)
 *        resp:  the audio file as an octet-stream (already decrypted/tagged)
 *
 * Search + tagging metadata still come from Deezer's public API, which needs no
 * auth and gives consistent results.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FORMAT_EXTENSION, type McpConfig, type Quality } from '../config';
import { DeezerGateway, type TrackMetadata } from '../deezer/gateway';
import type { McpLogger } from '../logger';
import { writeTags } from '../tagging';
import { parseTrack } from '../url';
import type { MusicBackend, RipResult, SearchTrack } from './types';

export class LucidaBackend implements MusicBackend {
  readonly name = 'lucida';
  // Reused purely for its unauthenticated public-API helpers.
  private readonly deezer: DeezerGateway;

  constructor(
    private readonly config: McpConfig,
    private readonly log: McpLogger,
  ) {
    this.deezer = new DeezerGateway('', log.child('public-api'));
  }

  async search(query: string, limit: number): Promise<SearchTrack[]> {
    return this.deezer.search(query, limit);
  }

  async rip(trackRef: string, workDir: string): Promise<RipResult> {
    const parsed = parseTrack(trackRef);
    const sourceUrl = parsed.deezerId ? `https://www.deezer.com/track/${parsed.deezerId}` : parsed.raw;
    const wantFlac = this.config.quality === 'FLAC';

    this.log.info(`requesting ${sourceUrl} from lucida-flow`);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.lucida.apiKey) headers.Authorization = `Bearer ${this.config.lucida.apiKey}`;

    const res = await fetch(`${this.config.lucida.baseUrl}/api/fetch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: sourceUrl, format: wantFlac ? 'flac' : 'mp3' }),
    });
    if (!res.ok) {
      throw new Error(`lucida-flow HTTP ${res.status}: ${await res.text().catch(() => '')}`.trim());
    }

    const contentType = res.headers.get('content-type') ?? '';
    const format: Quality = contentType.includes('flac') || wantFlac ? 'FLAC' : 'MP3_320';
    const ext = FORMAT_EXTENSION[format];
    const bytes = Buffer.from(await res.arrayBuffer());

    // Without a Deezer id we can't enrich tags, so fall back to a stub.
    const metadata = parsed.deezerId
      ? await this.deezer.getMetadata(parsed.deezerId)
      : stubMetadata();

    const filePath = join(workDir, `${metadata.id}.${ext}`);
    await writeFile(filePath, bytes);

    if (this.config.embedTags && parsed.deezerId) {
      const coverPath = await this.downloadCover(metadata.coverUrl, metadata.id, workDir);
      await writeTags({ filePath, ext, metadata, coverPath }, this.log);
    }

    return { localPath: filePath, format, bytes: bytes.length, metadata };
  }

  private async downloadCover(
    coverUrl: string | undefined,
    id: string,
    workDir: string,
  ): Promise<string | undefined> {
    if (!coverUrl) return undefined;
    try {
      const res = await fetch(coverUrl);
      if (!res.ok) return undefined;
      const coverPath = join(workDir, `${id}.cover.jpg`);
      await writeFile(coverPath, Buffer.from(await res.arrayBuffer()));
      return coverPath;
    } catch {
      return undefined;
    }
  }
}

function stubMetadata(): TrackMetadata {
  const id = `lucida-${Date.now()}`;
  return {
    id,
    title: id,
    artist: 'Unknown Artist',
    albumArtist: 'Unknown Artist',
    album: 'Unknown Album',
    trackNumber: 0,
    trackTotal: 0,
    discNumber: 1,
    year: undefined,
    isrc: undefined,
    genre: undefined,
    coverUrl: undefined,
  };
}
