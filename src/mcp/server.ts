/**
 * MCP server definition: registers the three music tools and routes them to the
 * configured backend + local storage.
 */

import { mkdir } from 'node:fs/promises';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { assertUsable, loadConfig, type McpConfig } from './config';
import { DeezerBackend } from './backends/deezer';
import { LucidaBackend } from './backends/lucida';
import type { MusicBackend } from './backends/types';
import { createLogger } from './logger';
import { publishFile, publishTrack } from './storage';

const log = createLogger('mcp');

function makeBackend(config: McpConfig): MusicBackend {
  switch (config.backend) {
    case 'lucida':
      return new LucidaBackend(config, log.child('lucida'));
    case 'deezer':
    default:
      return new DeezerBackend(config, log.child('deezer'));
  }
}

/** Wrap a handler so thrown errors become a clean MCP error result. */
function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

export function buildServer(): McpServer {
  const config = loadConfig();
  assertUsable(config);
  const backend = makeBackend(config);

  log.info(`backend=${config.backend} quality=${config.quality} library=${config.libraryDir}`);

  const server = new McpServer({ name: 'shd-music', version: '1.0.0' });

  server.registerTool(
    'search_music',
    {
      title: 'Search music',
      description:
        'Search the Deezer catalogue for tracks. Returns id, title, artist, album, ' +
        'duration and a track URL that can be passed to rip_track.',
      inputSchema: {
        query: z.string().min(1).describe('Search terms, e.g. "Daft Punk Around the World"'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
      },
    },
    async ({ query, limit }) => {
      try {
        const results = await backend.search(query, limit ?? 10);
        if (results.length === 0) return toolResult(`No results for "${query}".`);
        const lines = results.map(
          (t) =>
            `• ${t.artist} — ${t.title} [${t.album}] (${formatDuration(t.durationSec)})` +
            `${t.explicit ? ' 🅴' : ''}\n  ${t.url}`,
        );
        return toolResult(`Found ${results.length} track(s):\n\n${lines.join('\n')}`);
      } catch (err) {
        log.error('search_music failed', err);
        return toolResult(`Search failed: ${errMsg(err)}`, true);
      }
    },
  );

  server.registerTool(
    'rip_track',
    {
      title: 'Rip track',
      description:
        'Download a high-quality (FLAC by default) copy of a track from a Deezer ' +
        'URL or id, tag it, and optionally publish it to the local music library.',
      inputSchema: {
        track_url: z.string().min(1).describe('Deezer track URL, deezer:track:<id>, or numeric id'),
        upload: z
          .boolean()
          .optional()
          .describe('Move the finished file into the music library (default true)'),
      },
    },
    async ({ track_url, upload }) => {
      try {
        await mkdir(config.downloadDir, { recursive: true });
        const rip = await backend.rip(track_url, config.downloadDir);
        const { metadata } = rip;
        const sizeMb = (rip.bytes / 1024 / 1024).toFixed(1);
        const summary = `${metadata.artist} — ${metadata.title} [${metadata.album}]`;

        if (upload ?? true) {
          const published = await publishTrack(
            rip.localPath,
            metadata,
            extOf(rip.localPath),
            config,
            log,
          );
          return toolResult(
            `Ripped ${rip.format} (${sizeMb} MB): ${summary}\n` +
              `Published (${published.mode}) → ${published.destination}`,
          );
        }

        return toolResult(
          `Ripped ${rip.format} (${sizeMb} MB): ${summary}\nFile staged at ${rip.localPath} (not uploaded).`,
        );
      } catch (err) {
        log.error('rip_track failed', err);
        return toolResult(`Rip failed: ${errMsg(err)}`, true);
      }
    },
  );

  server.registerTool(
    'upload_file',
    {
      title: 'Upload file',
      description:
        'Publish an existing local audio file into the music library on this server ' +
        '(move or copy, per UPLOAD_MODE). Use for files already on disk.',
      inputSchema: {
        local_path: z.string().min(1).describe('Absolute path to a file on this server'),
      },
    },
    async ({ local_path }) => {
      try {
        const published = await publishFile(local_path, config, log);
        const sizeMb = (published.bytes / 1024 / 1024).toFixed(1);
        return toolResult(
          `Published (${published.mode}, ${sizeMb} MB) → ${published.destination}`,
        );
      } catch (err) {
        log.error('upload_file failed', err);
        return toolResult(`Upload failed: ${errMsg(err)}`, true);
      }
    },
  );

  return server;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? 'flac' : path.slice(dot + 1);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
