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
  localPath: string;
  format: Quality;
  bytes: number;
  metadata: TrackMetadata;
}

export interface MusicBackend {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchTrack[]>;
  rip(trackRef: string, workDir: string): Promise<RipResult>;
}
