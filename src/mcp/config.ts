/**
 * Environment-driven configuration for the music-ripping MCP server.
 *
 * Everything the server needs (Deezer ARL, the local music library path, quality
 * preferences, optional Lucida endpoint) is read from `process.env` so the
 * server can be dropped onto the box that runs music.saintdeniz.dev and wired up
 * purely through `.env`.
 */

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export type Quality = 'FLAC' | 'MP3_320' | 'MP3_128';
export type Backend = 'deezer' | 'lucida';
export type UploadMode = 'move' | 'copy';

/** Deezer's internal format identifiers, ordered by preference per quality. */
export const QUALITY_FALLBACK: Record<Quality, Quality[]> = {
  FLAC: ['FLAC', 'MP3_320', 'MP3_128'],
  MP3_320: ['MP3_320', 'MP3_128'],
  MP3_128: ['MP3_128'],
};

export const FORMAT_EXTENSION: Record<Quality, string> = {
  FLAC: 'flac',
  MP3_320: 'mp3',
  MP3_128: 'mp3',
};

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value && (allowed as readonly string[]).includes(value)) return value as T;
  return fallback;
}

export interface McpConfig {
  backend: Backend;
  /** Deezer ARL cookie. Required for the native `deezer` backend. */
  arl: string;
  quality: Quality;
  /** Working directory where files are decrypted/tagged before upload. */
  downloadDir: string;
  /** Final destination library on the local server (the "private server"). */
  libraryDir: string;
  /** Whether `upload` moves the file or leaves a copy behind in downloadDir. */
  uploadMode: UploadMode;
  /** Embed cover art + tags when a tagging backend (ffmpeg/metaflac) exists. */
  embedTags: boolean;
  /** Lucida-flow base URL + key, used when `backend === 'lucida'`. */
  lucida: { baseUrl: string; apiKey: string | undefined };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const backend = pick(env.MUSIC_BACKEND, ['deezer', 'lucida'] as const, 'deezer');

  return {
    backend,
    arl: env.DEEZER_ARL?.trim() ?? '',
    quality: pick(env.MUSIC_QUALITY, ['FLAC', 'MP3_320', 'MP3_128'] as const, 'FLAC'),
    downloadDir: resolve(env.DOWNLOAD_DIR?.trim() || tmpdir()),
    libraryDir: resolve(env.MUSIC_LIBRARY_DIR?.trim() || './library'),
    uploadMode: pick(env.UPLOAD_MODE, ['move', 'copy'] as const, 'move'),
    embedTags: bool(env.EMBED_TAGS, true),
    lucida: {
      baseUrl: (env.LUCIDA_API_URL?.trim() || 'https://lucida.to').replace(/\/+$/, ''),
      apiKey: env.LUCIDA_API_KEY?.trim() || undefined,
    },
  };
}

/** Throws a readable error if the config can't support the selected backend. */
export function assertUsable(config: McpConfig): void {
  if (config.backend === 'deezer' && !config.arl) {
    throw new Error('DEEZER_ARL is not set — required for the native deezer backend.');
  }
  if (config.backend === 'lucida' && !config.lucida.baseUrl) {
    throw new Error('LUCIDA_API_URL is not set — required for the lucida backend.');
  }
}
