# Docker image for the shd-music MCP server (src/mcp).
# stdio JSON-RPC — launched by an MCP client that attaches to stdin/stdout.
#   docker build -f Dockerfile.mcp -t shd-music-mcp .
#   docker run -i --rm --env-file .env -v /srv/music:/srv/music shd-music-mcp

FROM oven/bun:1-alpine
WORKDIR /app

# ffmpeg (tags + embedded cover art) and flac (metaflac fallback) for tagging.
RUN apk add --no-cache ffmpeg flac

# Install deps against the lockfile first for better layer caching.
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY index.ts ./
COPY src ./src

# Keep the working dir on the same volume as the library so `move` publishes
# don't fall back to a cross-filesystem copy.
ENV DOWNLOAD_DIR=/srv/music/.rips \
    MUSIC_LIBRARY_DIR=/srv/music

# stdio transport — the MCP client connects to this process's stdin/stdout.
ENTRYPOINT ["bun", "run", "index.ts"]