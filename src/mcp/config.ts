import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export type Quality = 'FLAC' | 'MP3_320' | 'MP3_128';
export type Backend = 'deezer' | 'lucida';
export type UploadMode = 'move' | 'copy';
export type Transport = 'stdio' | 'http';

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
  arl: string;
  quality: Quality;
  downloadDir: string;
  libraryDir: string;
  uploadMode: UploadMode;
  embedTags: boolean;
  lucida: { baseUrl: string; apiKey: string | undefined };
  transport: Transport;
  http: { host: string; port: number; path: string; token: string | undefined };
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
    transport: pick(env.MCP_TRANSPORT, ['stdio', 'http'] as const, 'stdio'),
    http: {
      host: env.MCP_HTTP_HOST?.trim() || '127.0.0.1',
      port: Number(env.MCP_HTTP_PORT) || 4040,
      path: normalizePath(env.MCP_HTTP_PATH?.trim() || '/mcp'),
      token: env.MCP_AUTH_TOKEN?.trim() || undefined,
    },
  };
}

function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed || '/' : `/${trimmed}`;
}

export function assertUsable(config: McpConfig): void {
  if (config.backend === 'deezer' && !config.arl) {
    throw new Error('DEEZER_ARL is not set — required for the native deezer backend.');
  }
  if (config.backend === 'lucida' && !config.lucida.baseUrl) {
    throw new Error('LUCIDA_API_URL is not set — required for the lucida backend.');
  }
  if (config.transport === 'http' && !config.http.token) {
    throw new Error(
      'MCP_AUTH_TOKEN is not set — refusing to start an unauthenticated HTTP endpoint. ' +
        'Set a long random token (it is exposed to the internet via nginx).',
    );
  }
}
