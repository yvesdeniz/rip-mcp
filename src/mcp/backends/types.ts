/**
 * Backend abstraction so the MCP tools don't care whether a track is ripped via
 * the native Deezer gateway or a self-hosted Lucida-flow instance.
 */

import type { Quality } from '../config';
import type { TrackMetadata } from '../deezer/gateway';

export interface SearchTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  explicit: boolean;
  url: string;
}

export interface RipResult {
  /** Absolute path to the decrypted, tagged file in the working directory. */
  localPath: string;
  /** Format actually delivered. */
  format: Quality;
  bytes: number;
  metadata: TrackMetadata;
}

export interface MusicBackend {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchTrack[]>;
  /**
   * Download + decrypt + tag a single track into `workDir`, returning the local
   * path. The track reference is whatever the user passed (url / id); each
   * backend resolves it itself.
   */
  rip(trackRef: string, workDir: string): Promise<RipResult>;
}
