import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { FlowDef } from '../protocol.ts';
import { NODE_SPECS } from '../src/render/circuit.ts';
import {
  FlowAuthoringStore,
  nodeCatalog,
  reviewNodeDesign,
  validateFlow,
  type NodeProposal,
} from './authoring.ts';

const NODE_KINDS = Object.keys(NODE_SPECS) as [string, ...string[]];
const SignalSchema = z.enum(['p', 'n', 'c']);
const NodeKindSchema = z.enum(NODE_KINDS);
const NumberMapSchema = z.record(z.string(), z.number().finite());

const CircuitNodeSchema = z.object({
  id: z.string().min(1).describe("Unique inside the flow; cords use it in 'node/port'."),
  kind: NodeKindSchema,
  x: z.number().finite().describe('Horizontal canvas position in graph units.'),
  y: z.number().finite().describe('Vertical canvas position in graph units.'),
  previewOutlet: z.string().min(1).optional(),
  op: z.string().min(1).optional().describe('Fixed mode, or the contained flow id on a flow node.'),
  of: z.string().min(1).optional().describe('Exact Live track name for a track node.'),
  values: NumberMapSchema.optional().describe('Held 0–1 values by settable inlet name.'),
  depths: NumberMapSchema.optional().describe('Signed modulation depths, -1–1, by inlet name.'),
  value: z.number().min(0).max(1).optional().describe("A value node's own number."),
  smooth: z.number().min(0).max(1).optional().describe("A track node's smoothing."),
  label: z.string().optional().describe("A value node's faceplate name."),
});

const CircuitSchema = z.object({
  nodes: z.array(CircuitNodeSchema),
  cords: z.array(
    z.object({
      from: z.string().min(3).describe("Outlet address, such as 'source1/c'."),
      to: z.string().min(3).describe("Inlet address, such as 'out/c'."),
    }),
  ),
});

const FlowSchema = z.object({
  name: z.string().min(1),
  circuit: CircuitSchema,
  rolled: z.boolean().optional(),
});

const ProposedPortSchema = z.object({
  name: z.string().min(1),
  signal: SignalSchema,
  description: z.string(),
  default: z.number().finite().optional(),
  live_default: z.enum(['beat', 'energy']).optional(),
});

const ProposedModeSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inlets: z.array(ProposedPortSchema).optional(),
});

const NodeProposalSchema = z.object({
  kind: z.string().min(1),
  description: z.string(),
  behavior: z.string(),
  why_node: z.string(),
  runtime: z.enum(['expression', 'multi-tap', 'render-pass', 'cpu-state', 'set-data']),
  inlets: z.array(ProposedPortSchema),
  outlets: z.array(ProposedPortSchema),
  modes: z.array(ProposedModeSchema),
});

const DiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  at: z.string().optional(),
});

const ValidationOutputSchema = z.object({
  valid: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  stats: z.object({
    nodes: z.number(),
    cords: z.number(),
    values: z.number(),
    tracks: z.number(),
    draws: z.string().nullable(),
  }),
});

const annotations = {
  read: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  write: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const success = <T extends object>(value: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

const failure = (error: unknown) => ({
  isError: true,
  content: [
    {
      type: 'text' as const,
      text: error instanceof Error ? error.message : String(error),
    },
  ],
});

const proposalOf = (input: z.infer<typeof NodeProposalSchema>): NodeProposal => ({
  kind: input.kind,
  description: input.description,
  behavior: input.behavior,
  whyNode: input.why_node,
  runtime: input.runtime,
  inlets: input.inlets.map((port) => ({
    name: port.name,
    signal: port.signal,
    description: port.description,
    ...(port.default !== undefined ? { default: port.default } : {}),
    ...(port.live_default !== undefined ? { liveDefault: port.live_default } : {}),
  })),
  outlets: input.outlets.map((port) => ({
    name: port.name,
    signal: port.signal,
    description: port.description,
    ...(port.default !== undefined ? { default: port.default } : {}),
    ...(port.live_default !== undefined ? { liveDefault: port.live_default } : {}),
  })),
  modes: input.modes.map((mode) => ({
    name: mode.name,
    description: mode.description,
    ...(mode.inlets
      ? {
          inlets: mode.inlets.map((port) => ({
            name: port.name,
            signal: port.signal,
            description: port.description,
            ...(port.default !== undefined ? { default: port.default } : {}),
            ...(port.live_default !== undefined ? { liveDefault: port.live_default } : {}),
          })),
        }
      : {}),
  })),
});

export interface VisualFlowServerOptions {
  schemeFile: string;
}

/** Create the transport-independent server so tests and stdio use the exact same tools. */
export function createVisualFlowServer({ schemeFile }: VisualFlowServerOptions): McpServer {
  const store = new FlowAuthoringStore(schemeFile);
  const server = new McpServer(
    { name: 'visual-flow-authoring', version: '0.1.0' },
    {
      instructions:
        'Inspect the documented node vocabulary before authoring. Validate a flow before saving it, and pass the latest scheme revision to every write. Node designs are reviews and implementation plans; adding a node still requires a code and wiki change.',
    },
  );

  server.registerResource(
    'node-catalog',
    'visual-flow://nodes',
    {
      title: 'visual[flow] node catalog',
      description: 'Every node, mode, inlet, outlet, signal type, and user-facing description.',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ nodes: nodeCatalog() }, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'scheme',
    'visual-flow://scheme',
    {
      title: 'Current visual[flow] scheme',
      description: 'The current resolved flow library and its optimistic-concurrency revision.',
      mimeType: 'application/json',
    },
    (uri) => {
      const snapshot = store.read();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ revision: snapshot.revision, scheme: snapshot.scheme }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_nodes',
    {
      title: 'List documented nodes',
      description:
        'Read the headless node vocabulary. Filter by kind for every mode-dependent inlet and all outputs.',
      inputSchema: z.object({ kind: NodeKindSchema.optional() }),
      outputSchema: z.object({ nodes: z.array(z.unknown()) }),
      annotations: annotations.read,
    },
    async ({ kind }) => {
      const nodes = nodeCatalog().filter((node) => kind === undefined || node.kind === kind);
      return success({ nodes });
    },
  );

  server.registerTool(
    'list_flows',
    {
      title: 'List flows',
      description:
        'List the current flow library with graph sizes and the revision required by save_flow.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        revision: z.string(),
        flows: z.array(
          z.object({ id: z.string(), name: z.string(), nodes: z.number(), cords: z.number() }),
        ),
      }),
      annotations: annotations.read,
    },
    async () => {
      try {
        const snapshot = store.read();
        const flows = Object.entries(snapshot.scheme.flows)
          .map(([id, flow]) => ({
            id,
            name: flow.name,
            nodes: flow.circuit.nodes.length,
            cords: flow.circuit.cords.length,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return success({ revision: snapshot.revision, flows });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'get_flow',
    {
      title: 'Get a flow',
      description: 'Read one complete graph, the current scheme revision, and its validation result.',
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: z.object({
        revision: z.string(),
        id: z.string(),
        flow: FlowSchema,
        validation: ValidationOutputSchema,
      }),
      annotations: annotations.read,
    },
    async ({ id }) => {
      try {
        const snapshot = store.read();
        const flow = snapshot.scheme.flows[id];
        if (!flow) return failure(new Error(`Flow '${id}' does not exist.`));
        return success({
          revision: snapshot.revision,
          id,
          flow,
          validation: validateFlow(id, flow, snapshot.scheme.flows),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'validate_flow',
    {
      title: 'Validate a flow draft',
      description:
        'Check node ids, modes, values, every cord endpoint and signal, nested-flow loops, graph loops, output, and compiler limits without writing.',
      inputSchema: z.object({ id: z.string().min(1), flow: FlowSchema }),
      outputSchema: ValidationOutputSchema,
      annotations: annotations.read,
    },
    async ({ id, flow }) => {
      try {
        const snapshot = store.read();
        return success(validateFlow(id, flow as FlowDef, snapshot.scheme.flows));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'save_flow',
    {
      title: 'Save a validated flow',
      description:
        'Create a flow, or explicitly replace one, in scheme.json. Requires the exact revision returned by list_flows or get_flow and refuses invalid graphs.',
      inputSchema: z.object({
        id: z.string().min(1),
        flow: FlowSchema,
        expected_revision: z.string().min(1),
        replace: z.boolean().default(false),
      }),
      outputSchema: ValidationOutputSchema.extend({
        id: z.string(),
        revision: z.string(),
        flow: FlowSchema,
      }),
      annotations: annotations.write,
    },
    async ({ id, flow, expected_revision, replace }) => {
      try {
        return success(store.saveFlow(id, flow as FlowDef, expected_revision, replace));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'review_node_design',
    {
      title: 'Review a proposed node design',
      description:
        'Check a proposed node boundary, complete port/mode documentation, signal shape, naming, runtime cost, and required implementation touchpoints. This does not modify code.',
      inputSchema: NodeProposalSchema,
      outputSchema: z.object({
        ready: z.boolean(),
        diagnostics: z.array(DiagnosticSchema),
        nearest: z.array(
          z.object({ kind: z.string(), mode: z.string().nullable(), signature: z.string() }),
        ),
        implementationPlan: z.array(z.string()),
        proposal: z.unknown(),
      }),
      annotations: annotations.read,
    },
    async (input) => success(reviewNodeDesign(proposalOf(input))),
  );

  server.registerPrompt(
    'build-flow',
    {
      title: 'Build a visual[flow] graph',
      description: 'A safe workflow for turning a visual intention into a saved flow.',
      argsSchema: {
        goal: z.string().describe('What the picture should do and what should drive it.'),
      },
    },
    ({ goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Build a visual[flow] graph for: ${goal}`,
              'Start with list_nodes and list_flows. Use only documented ports and explicit modes.',
              "A flow has exactly one out node. Cord addresses are 'nodeId/portName'; signals p, n, and c only connect to the same signal.",
              'Use 0–1 for held values and -1–1 for modulation depths. Validate the complete draft before saving.',
              'Call save_flow with the latest revision. Do not replace an existing flow unless that is explicitly intended.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'design-node',
    {
      title: 'Design a new visual[flow] node',
      description: 'Distill an idea into a documented, implementable node boundary.',
      argsSchema: {
        goal: z.string().describe('The missing visual or control behavior.'),
      },
    },
    ({ goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Design a visual[flow] node for: ${goal}`,
              'Read visual-flow://nodes first. Prefer a mode of an existing node when the signal boundary and wiring stay the same.',
              'Define one plain-language node description, every inlet and outlet with p/n/c plus a description, and every fixed mode with its own description.',
              'Numbers consumed by nodes are 0–1. State whether each number inlet holds a default or follows the live beat/energy when unwired.',
              'Choose the runtime cost honestly: expression, multi-tap, render-pass, CPU state, or set data.',
              'Submit the complete proposal to review_node_design before changing protocol.ts or renderer code.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
