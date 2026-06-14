/**
 * Entry point for the music-ripping MCP server.
 *
 * Speaks JSON-RPC over stdio, so launch it from an MCP client config such as:
 *
 *   {
 *     "mcpServers": {
 *       "shd-music": { "command": "bun", "args": ["run", "src/mcp/index.ts"] }
 *     }
 *   }
 *
 * All diagnostics go to stderr; stdout is reserved for the protocol.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildServer } from './src/mcp/server';
import { createLogger } from './src/mcp/logger';


const log = createLogger('mcp');

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('shd-music MCP server ready on stdio');
}

main().catch((err) => {
  log.error('fatal startup error', err);
  process.exit(1);
});
