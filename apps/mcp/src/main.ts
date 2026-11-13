import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpApi } from './api';
import { resolveEndpoints } from './env';
import { createServer } from './server';
import { parseMode } from './tools';

async function main() {
  const ends = resolveEndpoints();
  const mode = parseMode(process.env.TESSERAX_MCP_MODE);
  const server = createServer({ api: new HttpApi(ends.api), web: ends.web }, mode);
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel: diagnostics go to stderr only.
  process.stderr.write(`tesserax MCP server: api ${ends.api}, mode ${mode}\n`);
}

main().catch(e => {
  process.stderr.write(`tesserax MCP server failed: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
