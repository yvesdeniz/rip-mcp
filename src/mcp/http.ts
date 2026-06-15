import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import type { McpConfig } from './config';
import type { McpLogger } from './logger';

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Run the MCP server over Streamable HTTP instead of stdio.
 *
 * Exposes:
 *   - `GET  /healthz`            unauthenticated liveness probe (for nginx/uptime)
 *   - `*    <config.http.path>`  the MCP endpoint, guarded by a Bearer token
 *
 * A fresh McpServer is created per client session so backend/gateway state
 * isn't shared across unrelated connections.
 */
export async function startHttpServer(
  createMcpServer: () => McpServer,
  config: McpConfig,
  log: McpLogger,
): Promise<void> {
  const { host, port, path, token } = config.http;
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Liveness probe — intentionally unauthenticated so a proxy can health-check it.
    if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === `${path}/healthz`)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url.pathname !== path) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
      return;
    }

    // Bearer-token auth. assertUsable() guarantees a token is set in http mode.
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (provided !== token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        let transport = sessionId ? transports.get(sessionId) : undefined;

        if (!transport) {
          if (!isInitializeRequest(body)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'No valid session ID provided' },
                id: null,
              }),
            );
            return;
          }

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, transport!);
              log.info(`session opened ${id}`);
            },
          });
          transport.onclose = () => {
            const id = transport!.sessionId;
            if (id && transports.delete(id)) log.info(`session closed ${id}`);
          };

          await createMcpServer().connect(transport);
        }

        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid or missing session ID');
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method Not Allowed');
    } catch (err) {
      log.error('http request failed', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal Server Error');
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  log.info(`HTTP transport listening on http://${host}:${port}${path} (health: /healthz)`);
}
