import { copyFile, mkdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { McpConfig } from './config';
import type { TrackMetadata } from './deezer/gateway';
import type { McpLogger } from './logger';

export function sanitize(part: string): string {
  return (
    part
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 180) || 'Unknown'
  );
}

export function libraryPathFor(library: string, meta: TrackMetadata, ext: string): string {
  const disc = meta.discNumber > 0 ? meta.discNumber : 1;
  const track = meta.trackNumber > 0 ? String(meta.trackNumber).padStart(2, '0') : '00';
  const prefix = meta.discNumber > 1 ? `${disc}-${track}` : track;
  const fileName = `${sanitize(`${prefix} - ${meta.title}`)}.${ext}`;
  return join(library, sanitize(meta.albumArtist), sanitize(meta.album), fileName);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function uniquePath(path: string): Promise<string> {
  if (!(await exists(path))) return path;
  const dot = path.lastIndexOf('.');
  const stem = dot === -1 ? path : path.slice(0, dot);
  const ext = dot === -1 ? '' : path.slice(dot);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`could not find a free filename for ${path}`);
}

export interface PublishResult {
  destination: string;
  mode: McpConfig['uploadMode'];
  bytes: number;
}

export async function publishTrack(
  localPath: string,
  meta: TrackMetadata,
  ext: string,
  config: McpConfig,
  log: McpLogger,
  flat = false,
): Promise<PublishResult> {
  const foldered = libraryPathFor(config.libraryDir, meta, ext);
  // `flat` drops the file straight in the library root, reusing just the
  // "NN - Title.ext" leaf instead of the Album Artist/Album/ subtree.
  const target = await uniquePath(
    flat ? join(config.libraryDir, basename(foldered)) : foldered,
  );
  return place(localPath, target, config, log);
}

export async function publishFile(
  localPath: string,
  config: McpConfig,
  log: McpLogger,
): Promise<PublishResult> {
  if (!(await exists(localPath))) throw new Error(`file not found: ${localPath}`);
  const target = await uniquePath(join(config.libraryDir, basename(localPath)));
  return place(localPath, target, config, log);
}

async function place(
  localPath: string,
  target: string,
  config: McpConfig,
  log: McpLogger,
): Promise<PublishResult> {
  await mkdir(dirname(target), { recursive: true });

  if (config.uploadMode === 'move') {
    try {
      await rename(localPath, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await copyFile(localPath, target);
    }
  } else {
    await copyFile(localPath, target);
  }

  const { size } = await stat(target);
  log.info(`published → ${target}`, { mode: config.uploadMode, bytes: size });
  return { destination: target, mode: config.uploadMode, bytes: size };
}
