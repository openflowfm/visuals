#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { schemeFile, shown } from '../server/home.ts';
import { createVisualFlowServer } from './server.ts';

const file = schemeFile();
const server = createVisualFlowServer({ schemeFile: file });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`visual[flow] MCP server ready; scheme: ${shown(file)}`);
