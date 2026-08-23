#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createVisualFlowServer } from './server.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemeFile = process.env.BSV_VISUALS_SCHEME ?? path.resolve(here, '../scheme.json');
const server = createVisualFlowServer({ schemeFile });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`visual[flow] MCP server ready; scheme: ${schemeFile}`);
