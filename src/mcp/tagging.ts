/**
 * Best-effort metadata + cover-art embedding.
 *
 * The download itself produces a valid, playable file; tagging is a polish step.
 * We prefer `ffmpeg` (handles FLAC and MP3, including embedded cover art) and
 * fall back to `metaflac` for FLAC. If neither binary is present — unlikely on a
 * machine that runs a music server — we log a warning and leave the file
 * untagged rather than failing the rip.
 */

import { rename } from 'node:fs/promises';
import { join } from 'node:path';

import type { McpLogger } from './logger';
import type { TrackMetadata } from './deezer/gateway';

export interface TagInput {
  filePath: string;
  /** 'flac' | 'mp3' */
  ext: string;
  metadata: TrackMetadata;
  /** Local path to a cover image, if one was downloaded. */
  coverPath?: string;
}

let cachedTools: { ffmpeg: string | null; metaflac: string | null } | undefined;

function tools() {
  if (!cachedTools) {
    cachedTools = {
      ffmpeg: Bun.which('ffmpeg'),
      metaflac: Bun.which('metaflac'),
    };
  }
  return cachedTools;
}

async function run(bin: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([bin, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${bin} exited ${code}: ${stderr.split('\n').slice(-5).join('\n')}`);
  }
}

function commonTags(m: TrackMetadata): Record<string, string | undefined> {
  return {
    title: m.title,
    artist: m.artist,
    album: m.album,
    album_artist: m.albumArtist,
    track: m.trackNumber ? `${m.trackNumber}${m.trackTotal ? `/${m.trackTotal}` : ''}` : undefined,
    disc: m.discNumber ? String(m.discNumber) : undefined,
    date: m.year,
    genre: m.genre,
    isrc: m.isrc,
  };
}

async function tagWithFfmpeg(bin: string, input: TagInput): Promise<void> {
  const tags = commonTags(input.metadata);
  const tmp = join(
    input.filePath.slice(0, input.filePath.lastIndexOf('/')) || '.',
    `.tagging-${Date.now()}.${input.ext}`,
  );

  const args = ['-y', '-i', input.filePath];
  if (input.coverPath) args.push('-i', input.coverPath);

  args.push('-map', '0:a');
  if (input.coverPath) args.push('-map', '1:v');
  args.push('-c', 'copy');
  if (input.ext === 'mp3') args.push('-id3v2_version', '3');
  if (input.coverPath) args.push('-disposition:v:0', 'attached_pic');

  for (const [key, value] of Object.entries(tags)) {
    if (value) args.push('-metadata', `${key}=${value}`);
  }
  args.push(tmp);

  await run(bin, args);
  await rename(tmp, input.filePath);
}

async function tagWithMetaflac(bin: string, input: TagInput): Promise<void> {
  const tags = commonTags(input.metadata);
  const args = ['--remove-all-tags'];
  const map: Record<string, string> = {
    title: 'TITLE',
    artist: 'ARTIST',
    album: 'ALBUM',
    album_artist: 'ALBUMARTIST',
    date: 'DATE',
    genre: 'GENRE',
    isrc: 'ISRC',
  };
  for (const [key, vorbis] of Object.entries(map)) {
    const value = tags[key];
    if (value) args.push(`--set-tag=${vorbis}=${value}`);
  }
  if (input.metadata.trackNumber) args.push(`--set-tag=TRACKNUMBER=${input.metadata.trackNumber}`);
  if (input.metadata.discNumber) args.push(`--set-tag=DISCNUMBER=${input.metadata.discNumber}`);
  if (input.coverPath) args.push(`--import-picture-from=${input.coverPath}`);
  args.push(input.filePath);

  await run(bin, args);
}

export async function writeTags(input: TagInput, log: McpLogger): Promise<boolean> {
  const { ffmpeg, metaflac } = tools();
  try {
    if (ffmpeg) {
      await tagWithFfmpeg(ffmpeg, input);
      return true;
    }
    if (metaflac && input.ext === 'flac') {
      await tagWithMetaflac(metaflac, input);
      return true;
    }
    log.warn('no ffmpeg/metaflac found — leaving file untagged');
    return false;
  } catch (err) {
    log.warn('tagging failed — keeping untagged file', err);
    return false;
  }
}
