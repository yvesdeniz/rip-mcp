/**
 * Native Deezer backend: search via the public API, then download + Blowfish-
 * decrypt the encrypted FLAC straight from Deezer's CDN using the ARL cookie.
 * This is the same flow deemix implements, ported to Bun/TypeScript.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FORMAT_EXTENSION, QUALITY_FALLBACK, type McpConfig } from '../config';
import { DeezerGateway, type TrackMetadata } from '../deezer/gateway';
import { decryptStripe } from '../deezer/crypto';
import type { McpLogger } from '../logger';
import { writeTags } from '../tagging';
import { parseTrack } from '../url';
import type { MusicBackend, RipResult, SearchTrack } from './types';

export class DeezerBackend implements MusicBackend {
  readonly name = 'deezer';
  private readonly gateway: DeezerGateway;

  constructor(
    private readonly config: McpConfig,
    private readonly log: McpLogger,
  ) {
    this.gateway = new DeezerGateway(config.arl, log.child('gateway'));
  }

  async search(query: string, limit: number): Promise<SearchTrack[]> {
    return this.gateway.search(query, limit);
  }

  async rip(trackRef: string, workDir: string): Promise<RipResult> {
    const { deezerId } = parseTrack(trackRef);
    if (!deezerId) {
      throw new Error(`could not extract a Deezer track id from "${trackRef}".`);
    }

    this.log.info(`ripping track ${deezerId}`);

    // 1. Resolve an encrypted stream at the best available quality.
    const stream = await this.gateway.resolveStream(deezerId, QUALITY_FALLBACK[this.config.quality]);
    const ext = FORMAT_EXTENSION[stream.format];
    this.log.info(`granted ${stream.format} for ${deezerId}`);

    // 2. Download the encrypted payload.
    const res = await fetch(stream.url);
    if (!res.ok) throw new Error(`CDN download HTTP ${res.status}`);
    const encrypted = Buffer.from(await res.arrayBuffer());

    // 3. Decrypt the stripe-encrypted blocks. (MP3 fallbacks are encrypted the
    //    same way, so this applies regardless of format.)
    const decrypted = decryptStripe(encrypted, deezerId);

    // 4. Fetch tagging metadata + cover, write to the working directory.
    const metadata = await this.gateway.getMetadata(deezerId);
    const filePath = join(workDir, `${deezerId}.${ext}`);
    await writeFile(filePath, decrypted);

    if (this.config.embedTags) {
      const coverPath = await this.downloadCover(metadata, workDir);
      await writeTags({ filePath, ext, metadata, coverPath }, this.log);
    }

    return { localPath: filePath, format: stream.format, bytes: decrypted.length, metadata };
  }

  private async downloadCover(meta: TrackMetadata, workDir: string): Promise<string | undefined> {
    if (!meta.coverUrl) return undefined;
    try {
      const res = await fetch(meta.coverUrl);
      if (!res.ok) return undefined;
      const coverPath = join(workDir, `${meta.id}.cover.jpg`);
      await writeFile(coverPath, Buffer.from(await res.arrayBuffer()));
      return coverPath;
    } catch (err) {
      this.log.warn(`cover download failed for ${meta.id}`, err);
      return undefined;
    }
  }
}
