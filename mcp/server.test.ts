import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createVisualFlowServer } from './server.ts';

const made: string[] = [];

afterEach(() => {
  for (const directory of made.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const draft = {
  name: 'MCP field',
  circuit: {
    nodes: [
      { id: 'picture', kind: 'source', op: 'grid', x: 20, y: 40 },
      { id: 'out', kind: 'out', x: 260, y: 40 },
    ],
    cords: [{ from: 'picture/c', to: 'out/c' }],
  },
};

describe('the MCP boundary', () => {
  it('lists context, validates a draft, and saves it through the protocol', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-flow-mcp-server-'));
    made.push(directory);
    const server = createVisualFlowServer({ schemeFile: path.join(directory, 'scheme.json') });
    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'list_nodes',
          'list_flows',
          'get_flow',
          'validate_flow',
          'save_flow',
          'review_node_design',
        ]),
      );
      expect(tools.tools.find((tool) => tool.name === 'save_flow')?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      });

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(
        expect.arrayContaining(['build-flow', 'design-node']),
      );
      const design = await client.getPrompt({
        name: 'design-node',
        arguments: { goal: 'make bright areas trail' },
      });
      expect(design.messages[0].content).toMatchObject({
        type: 'text',
        text: expect.stringContaining('review_node_design'),
      });

      const resource = await client.readResource({ uri: 'visual-flow://nodes' });
      expect(resource.contents[0]).toMatchObject({ mimeType: 'application/json' });
      expect(JSON.parse('text' in resource.contents[0] ? resource.contents[0].text : '').nodes).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'source' })]),
      );

      const listed = await client.callTool({ name: 'list_flows', arguments: {} });
      expect(listed.isError).not.toBe(true);
      const revision = (listed.structuredContent as { revision: string }).revision;

      const validation = await client.callTool({
        name: 'validate_flow',
        arguments: { id: 'mcp-field', flow: draft },
      });
      expect(validation.structuredContent).toMatchObject({ valid: true });

      const saved = await client.callTool({
        name: 'save_flow',
        arguments: {
          id: 'mcp-field',
          flow: draft,
          expected_revision: revision,
        },
      });
      expect(saved.isError).not.toBe(true);
      expect(saved.structuredContent).toMatchObject({ id: 'mcp-field', valid: true });

      const held = await client.callTool({ name: 'get_flow', arguments: { id: 'mcp-field' } });
      expect(held.structuredContent).toMatchObject({
        id: 'mcp-field',
        flow: { name: 'MCP field' },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("boots over stdio in Node's strip-only TypeScript runtime", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-flow-mcp-stdio-'));
    made.push(directory);
    const client = new Client({ name: 'stdio-test-agent', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--disable-warning=ExperimentalWarning', 'mcp/index.ts'],
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { OPENFLOW_VISUALS_SCHEME: path.join(directory, 'scheme.json') },
      stderr: 'pipe',
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('save_flow');
    } finally {
      await client.close();
    }
  });
});
