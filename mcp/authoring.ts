import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  NODE_FAMILIES,
  wouldLoop,
  type FlowDef,
  type NodeKind,
  type Scheme,
} from '../protocol.ts';
import { merge } from '../server/scheme.ts';
import {
  compileFlow,
  inletsOf,
  modesOf,
  NODE_SPECS,
  reachesOut,
  splitPort,
  wouldFeedItself,
  type PortSpec,
  type Signal,
} from '../src/render/circuit.ts';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  at?: string;
}

export interface FlowValidation {
  valid: boolean;
  diagnostics: Diagnostic[];
  stats: {
    nodes: number;
    cords: number;
    values: number;
    tracks: number;
    draws: string | null;
  };
}

export interface SchemeSnapshot {
  scheme: Scheme;
  /** A hash of the exact file the caller read, including explanatory metadata kept in `_`. */
  revision: string;
  exists: boolean;
}

export interface SaveFlowResult extends FlowValidation {
  id: string;
  revision: string;
  flow: FlowDef;
}

const NODE_KINDS = Object.keys(NODE_SPECS) as NodeKind[];
const FLOW_ID = /^[a-z][a-z0-9_-]*$/;

const issue = (
  diagnostics: Diagnostic[],
  severity: Severity,
  code: string,
  message: string,
  at?: string,
) => diagnostics.push({ severity, code, message, ...(at ? { at } : {}) });

/**
 * The strict door an agent-authored graph goes through before it can be saved.
 *
 * `merge` and `repaired` are deliberately forgiving because they load files
 * written by old versions of the app. An authoring tool needs the opposite
 * bargain: report the wrong port or missing end to the agent that can fix it,
 * rather than silently accepting a different graph.
 */
export function validateFlow(
  id: string,
  flow: FlowDef,
  flows: Record<string, FlowDef>,
): FlowValidation {
  const diagnostics: Diagnostic[] = [];
  const circuit = flow.circuit;
  const library = { ...flows, [id]: flow };
  const ids = new Set<string>();

  if (!FLOW_ID.test(id)) {
    issue(
      diagnostics,
      'error',
      'flow.id.spelling',
      'A flow id must start with a lowercase letter and contain only a-z, 0-9, _ or -.',
      'id',
    );
  }
  if (!flow.name.trim()) {
    issue(diagnostics, 'error', 'flow.name.empty', 'A flow needs a name.', 'name');
  }

  for (const node of circuit.nodes) {
    if (!node.id.trim()) {
      issue(diagnostics, 'error', 'node.id.empty', 'Every node needs an id.', 'nodes');
    } else if (node.id.includes('/')) {
      issue(
        diagnostics,
        'error',
        'node.id.separator',
        "A node id cannot contain '/'; that separates a node from its port.",
        node.id,
      );
    }
    if (ids.has(node.id)) {
      issue(
        diagnostics,
        'error',
        'node.id.duplicate',
        `Node id '${node.id}' appears more than once.`,
        node.id,
      );
    }
    ids.add(node.id);

    const spec = NODE_SPECS[node.kind];
    if (!spec) {
      issue(
        diagnostics,
        'error',
        'node.kind.unknown',
        `Node '${node.id}' has unknown kind '${String(node.kind)}'.`,
        node.id,
      );
      continue;
    }

    const modes = modesOf(node.kind);
    if (modes.length > 0 && node.op && !modes.includes(node.op)) {
      issue(
        diagnostics,
        'error',
        'node.mode.unknown',
        `'${node.op}' is not a ${node.kind} mode. Choose one of: ${modes.join(', ')}.`,
        node.id,
      );
    } else if (modes.length > 0 && !node.op) {
      issue(
        diagnostics,
        'warning',
        'node.mode.implicit',
        `No mode is written; ${node.kind} will use '${modes[0]}'.`,
        node.id,
      );
    }
    if (modes.length === 0 && spec.named !== 'flow' && node.op) {
      issue(
        diagnostics,
        'error',
        'node.mode.unused',
        `${node.kind} has no mode, so '${node.op}' would do nothing.`,
        node.id,
      );
    }
    if (spec.named !== 'track' && node.of) {
      issue(
        diagnostics,
        'error',
        'node.target.unused',
        `Only a track node can name a Live track; '${node.of}' would do nothing here.`,
        node.id,
      );
    }
    if (node.kind !== 'value' && (node.value !== undefined || node.label !== undefined)) {
      issue(
        diagnostics,
        'error',
        'node.value.unused',
        `Only a value node can hold its own value or label.`,
        node.id,
      );
    }
    if (node.kind !== 'track' && node.smooth !== undefined) {
      issue(
        diagnostics,
        'error',
        'node.smooth.unused',
        `Only a track node can smooth its reading.`,
        node.id,
      );
    }

    if (spec.named === 'track' && !node.of?.trim()) {
      issue(
        diagnostics,
        'warning',
        'node.track.unset',
        'This track node does not name a Live track, so it will read zero.',
        node.id,
      );
    }
    if (spec.named === 'flow') {
      if (!node.op) {
        issue(
          diagnostics,
          'error',
          'node.flow.unset',
          'A flow node must name the flow it contains.',
          node.id,
        );
      } else if (!library[node.op]) {
        issue(
          diagnostics,
          'error',
          'node.flow.missing',
          `Flow '${node.op}' does not exist.`,
          node.id,
        );
      } else if (wouldLoop(library, id, node.op)) {
        issue(
          diagnostics,
          'error',
          'node.flow.loop',
          `Putting '${node.op}' here would make '${id}' contain itself.`,
          node.id,
        );
      }
    }

    const inlets = inletsOf(node);
    const settable = new Set(
      inlets.filter((port) => port.kind === 'n' && port.at !== undefined).map((port) => port.name),
    );
    for (const [name, value] of Object.entries(node.values ?? {})) {
      if (!settable.has(name)) {
        issue(
          diagnostics,
          'error',
          'node.value.unknown',
          `'${name}' is not a settable inlet on this ${node.op ?? node.kind}.`,
          `${node.id}/${name}`,
        );
      }
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        issue(
          diagnostics,
          'error',
          'node.value.range',
          `A held number must be between zero and one; received ${value}.`,
          `${node.id}/${name}`,
        );
      }
    }
    for (const [name, depth] of Object.entries(node.depths ?? {})) {
      if (!settable.has(name)) {
        issue(
          diagnostics,
          'error',
          'node.depth.unknown',
          `'${name}' is not a settable inlet on this ${node.op ?? node.kind}.`,
          `${node.id}/${name}`,
        );
      }
      if (!Number.isFinite(depth) || depth < -1 || depth > 1) {
        issue(
          diagnostics,
          'error',
          'node.depth.range',
          `A modulation depth must be between minus one and one; received ${depth}.`,
          `${node.id}/${name}`,
        );
      }
    }
    if (
      node.previewOutlet &&
      !spec.outlets.some((outlet) => outlet.name === node.previewOutlet)
    ) {
      issue(
        diagnostics,
        'error',
        'node.preview.unknown',
        `'${node.previewOutlet}' is not an outlet on ${node.kind}.`,
        node.id,
      );
    }
  }

  const ends = circuit.nodes.filter((node) => node.kind === 'out');
  if (ends.length !== 1) {
    issue(
      diagnostics,
      'error',
      'flow.out.count',
      `A flow needs exactly one out node; this graph has ${ends.length}.`,
      'nodes',
    );
  }

  const byId = new Map(circuit.nodes.map((node) => [node.id, node]));
  const fed = new Set<string>();
  for (const [index, cord] of circuit.cords.entries()) {
    const from = splitPort(cord.from);
    const to = splitPort(cord.to);
    const source = byId.get(from.node);
    const sink = byId.get(to.node);
    const outlet = source ? NODE_SPECS[source.kind]?.outlets.find((p) => p.name === from.port) : null;
    const inlet = sink ? inletsOf(sink).find((p) => p.name === to.port) : null;

    if (!source) {
      issue(
        diagnostics,
        'error',
        'cord.source.node',
        `Cord source node '${from.node}' does not exist.`,
        `cords[${index}]`,
      );
    } else if (!outlet) {
      issue(
        diagnostics,
        'error',
        'cord.source.port',
        `'${cord.from}' is not an outlet.`,
        `cords[${index}]`,
      );
    }
    if (!sink) {
      issue(
        diagnostics,
        'error',
        'cord.target.node',
        `Cord target node '${to.node}' does not exist.`,
        `cords[${index}]`,
      );
    } else if (!inlet) {
      issue(
        diagnostics,
        'error',
        'cord.target.port',
        `'${cord.to}' is not an inlet.`,
        `cords[${index}]`,
      );
    }
    if (outlet && inlet && outlet.kind !== inlet.kind) {
      issue(
        diagnostics,
        'error',
        'cord.signal',
        `'${cord.from}' carries ${outlet.kind}, while '${cord.to}' takes ${inlet.kind}.`,
        `cords[${index}]`,
      );
    }
    if (fed.has(cord.to)) {
      issue(
        diagnostics,
        'error',
        'cord.target.duplicate',
        `More than one cord feeds '${cord.to}'. An inlet takes one signal.`,
        `cords[${index}]`,
      );
    }
    fed.add(cord.to);

    if (outlet && inlet) {
      const without = {
        nodes: circuit.nodes,
        cords: circuit.cords.filter((_other, at) => at !== index),
      };
      if (wouldFeedItself(without, cord.from, cord.to)) {
        issue(
          diagnostics,
          'error',
          'cord.loop',
          `Connecting '${cord.from}' to '${cord.to}' makes the graph feed itself.`,
          `cords[${index}]`,
        );
      }
    }
  }

  if (ends.length === 1 && !reachesOut(circuit)) {
    issue(
      diagnostics,
      'warning',
      'flow.out.unfed',
      'Nothing reaches out, so this flow currently draws transparent black.',
      ends[0].id,
    );
  }

  for (const node of circuit.nodes) {
    for (const name of Object.keys(node.depths ?? {})) {
      if (!fed.has(`${node.id}/${name}`)) {
        issue(
          diagnostics,
          'warning',
          'node.depth.unwired',
          `The depth on '${name}' has no cord to scale and currently does nothing.`,
          `${node.id}/${name}`,
        );
      }
    }
  }

  let stats: FlowValidation['stats'] = {
    nodes: circuit.nodes.length,
    cords: circuit.cords.length,
    values: 0,
    tracks: 0,
    draws: null,
  };
  if (!diagnostics.some((entry) => entry.severity === 'error')) {
    const compiled = compileFlow(library, id);
    stats = {
      nodes: circuit.nodes.length,
      cords: circuit.cords.length,
      values: compiled.values.length,
      tracks: compiled.tracks.length,
      draws: compiled.draws,
    };
    if (compiled.error) {
      issue(diagnostics, 'error', 'flow.compile', compiled.error, id);
    }
  }

  return {
    valid: !diagnostics.some((entry) => entry.severity === 'error'),
    diagnostics,
    stats,
  };
}

const revisionOf = (text: string) =>
  `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;

/** A small file store with optimistic concurrency around the existing scheme record. */
export class FlowAuthoringStore {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  read(): SchemeSnapshot {
    const exists = fs.existsSync(this.file);
    const text = exists ? fs.readFileSync(this.file, 'utf8') : '';
    let raw: Partial<Scheme> = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text) as Partial<Scheme>;
      } catch (error) {
        throw new Error(`Cannot read ${path.basename(this.file)}: ${(error as Error).message}`);
      }
    }
    return { scheme: merge(raw), revision: revisionOf(text), exists };
  }

  saveFlow(
    id: string,
    flow: FlowDef,
    expectedRevision: string,
    replace = false,
  ): SaveFlowResult {
    if (!FLOW_ID.test(id)) {
      throw new Error(
        'A flow id must start with a lowercase letter and contain only a-z, 0-9, _ or -.',
      );
    }
    const snapshot = this.read();
    if (snapshot.revision !== expectedRevision) {
      throw new Error(
        `The scheme changed after it was read. Read it again and retry with revision ${snapshot.revision}.`,
      );
    }
    if (snapshot.scheme.flows[id] && !replace) {
      throw new Error(
        `Flow '${id}' already exists. Set replace to true only if replacing it is intended.`,
      );
    }

    const validation = validateFlow(id, flow, snapshot.scheme.flows);
    if (!validation.valid) {
      const reasons = validation.diagnostics
        .filter((entry) => entry.severity === 'error')
        .map((entry) => entry.message)
        .join(' ');
      throw new Error(`Flow '${id}' was not saved. ${reasons}`);
    }

    const currentText = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8') : '';
    if (revisionOf(currentText) !== expectedRevision) {
      throw new Error(
        `The scheme changed while the flow was being checked. Read it again and retry with revision ${revisionOf(currentText)}.`,
      );
    }
    const next: Scheme = {
      ...snapshot.scheme,
      flows: { ...snapshot.scheme.flows, [id]: flow },
    };
    let held: Record<string, unknown> = {};
    if (currentText.trim()) {
      held = JSON.parse(currentText) as Record<string, unknown>;
    }
    const text = `${JSON.stringify({ ...held, ...next }, null, 2)}\n`;
    const temporary = path.join(
      path.dirname(this.file),
      `.${path.basename(this.file)}.${process.pid}.${Date.now()}.tmp`,
    );
    try {
      fs.writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }

    return {
      ...validation,
      id,
      flow,
      revision: revisionOf(text),
    };
  }
}

export interface DocumentedPort {
  name: string;
  signal: Signal;
  description: string;
  settable: boolean;
  default?: number;
  liveDefault?: 'beat' | 'energy';
}

const documentedPort = (port: PortSpec): DocumentedPort => ({
  name: port.name,
  signal: port.kind,
  description: port.description,
  settable: port.at !== undefined,
  ...(port.at !== undefined ? { default: port.at } : {}),
  ...(port.kind === 'n' && port.at === undefined
    ? { liveDefault: port.fallback === 'uEnergy' ? ('energy' as const) : ('beat' as const) }
    : {}),
});

/** The complete headless vocabulary, including every mode-dependent inlet. */
export function nodeCatalog() {
  return NODE_KINDS.map((kind) => {
    const spec = NODE_SPECS[kind];
    const family = NODE_FAMILIES.find((entry) => entry.kinds.includes(kind));
    const workOf = (mode?: string): number => {
      if (typeof spec.work !== 'function') return spec.work ?? 0;
      return spec.work({ id: kind, kind, ...(mode ? { op: mode } : {}), x: 0, y: 0 });
    };
    const variants = spec.modes?.length
      ? spec.modes.map((mode) => ({
          mode: mode.name,
          description: mode.description,
          work: workOf(mode.name),
          inlets: inletsOf({ id: kind, kind, op: mode.name, x: 0, y: 0 }).map(documentedPort),
        }))
      : [
          {
            mode: null,
            description: spec.description,
            work: workOf(),
            inlets: inletsOf({ id: kind, kind, x: 0, y: 0 }).map(documentedPort),
          },
        ];
    return {
      kind,
      name: spec.name,
      family: family?.name ?? 'other',
      familyDescription: family?.about ?? '',
      description: spec.description,
      target: spec.named ?? null,
      /** Worst-case fixed work across its modes; each variant carries its exact charge. */
      work: Math.max(...variants.map((variant) => variant.work)),
      defaultMode: spec.modes?.[0]?.name ?? null,
      variants,
      outlets: spec.outlets.map(documentedPort),
    };
  });
}

export interface ProposedPort {
  name: string;
  signal: Signal;
  description: string;
  default?: number;
  liveDefault?: 'beat' | 'energy';
}

export interface ProposedMode {
  name: string;
  description: string;
  /** The complete inlet list for this mode. Omit to use the node's common inlets. */
  inlets?: ProposedPort[];
}

export interface NodeProposal {
  kind: string;
  description: string;
  behavior: string;
  whyNode: string;
  runtime: 'expression' | 'multi-tap' | 'render-pass' | 'cpu-state' | 'set-data';
  inlets: ProposedPort[];
  outlets: ProposedPort[];
  modes: ProposedMode[];
}

export interface NodeDesignReview {
  ready: boolean;
  diagnostics: Diagnostic[];
  nearest: { kind: string; mode: string | null; signature: string }[];
  implementationPlan: string[];
  proposal: NodeProposal;
}

const DAW_WORDS = new Set([
  'transport',
  'scene',
  'clip',
  'cue',
  'bus',
  'send',
  'return',
  'warp',
  'quantize',
  'follow action',
  'slot',
  'take',
  'punch',
  'bounce',
  'freeze',
]);

const signature = (inlets: readonly { signal: Signal }[], outlets: readonly { signal: Signal }[]) =>
  `${inlets.map((port) => port.signal).sort().join('')} → ${outlets
    .map((port) => port.signal)
    .sort()
    .join('')}`;

/** Review a proposed node against the vocabulary and its implementation boundaries. */
export function reviewNodeDesign(proposal: NodeProposal): NodeDesignReview {
  const diagnostics: Diagnostic[] = [];
  const words = [proposal.kind, ...proposal.modes.map((mode) => mode.name)];

  if (!/^[a-z][a-z0-9_-]*$/.test(proposal.kind)) {
    issue(
      diagnostics,
      'error',
      'node.kind.spelling',
      'A node kind must start with a lowercase letter and contain only a-z, 0-9, _ or -.',
      'kind',
    );
  }
  if (NODE_KINDS.includes(proposal.kind as NodeKind)) {
    issue(
      diagnostics,
      'error',
      'node.kind.exists',
      `'${proposal.kind}' is already a node kind. Consider whether this belongs as one of its modes.`,
      'kind',
    );
  }
  for (const word of words) {
    if (DAW_WORDS.has(word.toLowerCase())) {
      issue(
        diagnostics,
        'error',
        'node.name.daw',
        `'${word}' already has a specific meaning in a DAW and cannot name this concept.`,
        word,
      );
    }
  }
  if (!proposal.description.trim()) {
    issue(diagnostics, 'error', 'node.description.empty', 'Describe what the node does.', 'description');
  }
  if (!proposal.behavior.trim()) {
    issue(
      diagnostics,
      'error',
      'node.behavior.empty',
      'State the headless behavior the renderer must implement.',
      'behavior',
    );
  }
  if (!proposal.whyNode.trim()) {
    issue(
      diagnostics,
      'error',
      'node.boundary.empty',
      'Explain why this is a new kind rather than a mode of an existing node.',
      'whyNode',
    );
  }
  if (proposal.outlets.length === 0) {
    issue(
      diagnostics,
      'error',
      'node.outlets.empty',
      'A new authorable node needs at least one outlet.',
      'outlets',
    );
  }

  const inspectPorts = (ports: readonly ProposedPort[], at: string, output = false) => {
    const names = new Set<string>();
    for (const port of ports) {
      if (!port.name.trim() || port.name.includes('/')) {
        issue(
          diagnostics,
          'error',
          'node.port.spelling',
          "A port needs a name without '/'.",
          `${at}/${port.name}`,
        );
      }
      if (DAW_WORDS.has(port.name.toLowerCase())) {
        issue(
          diagnostics,
          'error',
          'node.name.daw',
          `'${port.name}' already has a specific meaning in a DAW and cannot name this port.`,
          `${at}/${port.name}`,
        );
      }
      if (names.has(port.name)) {
        issue(
          diagnostics,
          'error',
          'node.port.duplicate',
          `Port '${port.name}' appears more than once.`,
          at,
        );
      }
      names.add(port.name);
      if (!port.description.trim()) {
        issue(
          diagnostics,
          'error',
          'node.port.description',
          `Document what '${port.name}' ${output ? 'emits' : 'accepts'}.`,
          `${at}/${port.name}`,
        );
      }
      if (output && (port.default !== undefined || port.liveDefault !== undefined)) {
        issue(
          diagnostics,
          'error',
          'node.outlet.default',
          'Only an inlet can have a default.',
          `${at}/${port.name}`,
        );
      }
      if (port.signal !== 'n' && (port.default !== undefined || port.liveDefault !== undefined)) {
        issue(
          diagnostics,
          'error',
          'node.port.default.signal',
          'Only a number inlet can hold a number or a live default.',
          `${at}/${port.name}`,
        );
      }
      if (
        port.default !== undefined &&
        (!Number.isFinite(port.default) || port.default < 0 || port.default > 1)
      ) {
        issue(
          diagnostics,
          'error',
          'node.port.default.range',
          'A number inlet default must be between zero and one.',
          `${at}/${port.name}`,
        );
      }
      if (port.default !== undefined && port.liveDefault !== undefined) {
        issue(
          diagnostics,
          'error',
          'node.port.default.two',
          'Choose a held number or a live default, not both.',
          `${at}/${port.name}`,
        );
      }
    }
  };

  inspectPorts(proposal.inlets, 'inlets');
  inspectPorts(proposal.outlets, 'outlets', true);
  const modeNames = new Set<string>();
  for (const mode of proposal.modes) {
    if (modeNames.has(mode.name)) {
      issue(
        diagnostics,
        'error',
        'node.mode.duplicate',
        `Mode '${mode.name}' appears more than once.`,
        'modes',
      );
    }
    modeNames.add(mode.name);
    if (!mode.description.trim()) {
      issue(
        diagnostics,
        'error',
        'node.mode.description',
        `Document what choosing '${mode.name}' does.`,
        `modes/${mode.name}`,
      );
    }
    if (mode.inlets) inspectPorts(mode.inlets, `modes/${mode.name}/inlets`);
  }

  const firstInlets = proposal.modes.find((mode) => mode.inlets)?.inlets ?? proposal.inlets;
  const proposedSignature = signature(firstInlets, proposal.outlets);
  const nearest = nodeCatalog()
    .flatMap((node) =>
      node.variants.map((variant) => ({
        kind: node.kind,
        mode: variant.mode,
        signature: signature(variant.inlets, node.outlets),
      })),
    )
    .filter((node) => node.signature === proposedSignature)
    .slice(0, 8);
  if (nearest.length > 0) {
    issue(
      diagnostics,
      'warning',
      'node.boundary.similar',
      `The same signal shape already exists on ${nearest
        .map((node) => `${node.kind}${node.mode ? `/${node.mode}` : ''}`)
        .join(', ')}. Check whether this is a mode there.`,
      'whyNode',
    );
  }

  const implementationPlan = [
    'Add the kind and any fixed mode vocabulary to protocol.ts; keep saved wire names stable.',
    'Add its documented NodeSpec, every port description, mode descriptions, and emitter in src/render/circuit.ts.',
    proposal.runtime === 'render-pass'
      ? 'Design the extra render pass and its budget in src/render; expression nodes are the default, so justify this boundary.'
      : proposal.runtime === 'cpu-state' || proposal.runtime === 'set-data'
        ? 'Define the CPU/server value source and protocol payload before the shader slot that consumes it.'
        : proposal.runtime === 'multi-tap'
          ? 'Account for multiplied upstream evaluation and keep the MAX_LINES failure visible and harmless.'
          : 'Implement the node as a point, number, or colour expression in the existing single-pass compiler.',
    'Let the browser derive its row and presets from NODE_SPECS; do not add a second description table.',
    'Add compiler tests for defaults, every mode, port types, cycles, and cost limits that apply.',
    'Update docs/flows.md and the Visuals wiki page in the same feature change.',
  ];

  return {
    ready: !diagnostics.some((entry) => entry.severity === 'error'),
    diagnostics,
    nearest,
    implementationPlan,
    proposal,
  };
}
