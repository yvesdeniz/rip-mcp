# rip mcp server

A Model Context Protocol server (JSON-RPC over stdio, built for Bun) that rips
high-quality audio from Deezer using an ARL cookie and publishes the finished
files into the local music library that backs, mainly for navidrome, but with a few tweaks you can use this anywhere to rip music automatically.

Recommended to use this with [Poke](https://poke.com)

Use lucida to rip from soundcloud, rest you can rip using deezer as it has most if not all of the released music.

Because the server runs on the same host as the music site, "upload" is just a
local move/copy into the library directory no SSH/SFTP/S3 required.

## Tools

| Tool | Arguments | Description |
| --- | --- | --- |
| `search_music` | `query: string`, `limit?: number` | Search the Deezer catalogue. Returns tracks + URLs. |
| `rip_track` | `track_url: string`, `upload?: boolean` | Download → Blowfish-decrypt → tag a track. With `upload` (default `true`) it publishes into the library. |
| `upload_file` | `local_path: string` | Publish an existing local file into the library. |

## How it works

1. **Search / metadata** use Deezer's public REST API (no auth).
2. **rip_track** authenticates the ARL against the private `gw-light` gateway,
   requests a stream token, and asks `media.deezer.com` for an encrypted CDN URL
   (FLAC with automatic fallback to MP3 320/128).
3. The encrypted payload is decrypted with the `BF_CBC_STRIPE` scheme every
   third 2048-byte block is Blowfish-CBC encrypted. We decrypt natively via
   Bun's `node:crypto` `bf-cbc` cipher (`src/mcp/deezer/crypto.ts`).
4. Tags + cover art are embedded best-effort with **ffmpeg** (preferred) or
   **metaflac**. If neither binary is installed the file is still produced,
   just untagged.
5. The result is moved/copied to `MUSIC_LIBRARY_DIR` as
   `Album Artist/Album/NN - Title.flac`.

The download backend is pluggable (`src/mcp/backends`): `deezer` (native,
default) or `lucida` for a self-hosted lucida-flow instance.

## Configuration

All via environment variables (see `.env.example`):

| Var | Default | Notes |
| --- | --- | --- |
| `MUSIC_BACKEND` | `deezer` | `deezer` or `lucida` |
| `DEEZER_ARL` | — | **Required** for the deezer backend |
| `MUSIC_QUALITY` | `FLAC` | `FLAC` \| `MP3_320` \| `MP3_128` |
| `MUSIC_LIBRARY_DIR` | `./library` | Publish destination |
| `DOWNLOAD_DIR` | OS temp dir | Working dir for decrypt/tag |
| `UPLOAD_MODE` | `move` | `move` or `copy` |
| `EMBED_TAGS` | `true` | Toggle ffmpeg/metaflac tagging |
| `LUCIDA_API_URL` / `LUCIDA_API_KEY` | — | Only for the lucida backend |
| `MCP_LOG_LEVEL` | `info` | stderr verbosity |

## Running

```bash
bun run mcp        # production
bun run mcp:dev    # watch mode
```

Register it with an MCP client:

```json
{
  "mcpServers": {
    "rip-music": {
      "command": "bun",
      "args": ["run", "src/mcp/index.ts"],
      "cwd": "/path/to/where/you/cloned"
    }
  }
}
```

> The server logs to **stderr**; stdout is reserved for the JSON-RPC protocol.
> For tagging + embedded artwork, install `ffmpeg` (recommended) or `flac`
> (`metaflac`) on the host.

## Note

Use this only with your own Deezer account/ARL and for content you're entitled
to download. The ARL is a credential — keep it in `.env` (git-ignored), never
commit it.

## Preview/Demo

<video src="src/mcp/assets/preview.mp4" controls="controls" style="max-width: 100%;"></video>

