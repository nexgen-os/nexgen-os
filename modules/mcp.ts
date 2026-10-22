// The MCP server over stdio from a checkout, with the computations of the
// modules shipped here: `npx tsx modules/mcp.ts`, with the same environment
// as `npx @nexgen-os/mcp` (packages/mcp/README.md).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { serverFromEnvironment } from '@nexgen-os/mcp';
import { MODULE_COMPUTATIONS } from './computations.js';

const { server, summary } = await serverFromEnvironment(process.env, { computations: MODULE_COMPUTATIONS });
await server.connect(new StdioServerTransport());
process.stderr.write(`${summary}\n`);
