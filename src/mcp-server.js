#!/usr/bin/env node
// MCP サーバー（Claude Code / Claude Desktop などから使う入口）
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Policy } from './policy.js';
import { History } from './history.js';
import { AIBrowser } from './browser.js';
import { TOOLS, callTool, resultToText } from './tools.js';
import { VERSION } from './version.js';

const client = process.env.AIB_CLIENT || 'mcp';
const policy = new Policy();
const history = new History({ client });
const browser = new AIBrowser({ policy, history });

const server = new Server({ name: 'ai-browser', version: VERSION }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await callTool(browser, name, args);
    const content = [{ type: 'text', text: resultToText(result) }];
    if (result && result.base64) content.push({ type: 'image', data: result.base64, mimeType: 'image/png' });
    return { content };
  } catch (e) {
    return { content: [{ type: 'text', text: `エラー: ${e.message}` }], isError: true };
  }
});

history.write({ kind: 'session', event: 'start', version: VERSION, policyFile: policy.file });

async function shutdown() {
  history.write({ kind: 'session', event: 'end' });
  await browser.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);

await server.connect(new StdioServerTransport());
