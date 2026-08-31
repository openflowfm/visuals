#!/usr/bin/env node
// Writes the node reference in the user manual from the vocabulary itself.
//
// `nodeCatalog()` already assembles what the MCP server tells an agent about
// every node: the family, the modes, every inlet and outlet, and the one
// sentence each carries. That is the same thing a person needs, and the app
// shows those sentences on the node — so the manual page is a rendering of
// them rather than a second set of words that can disagree with the first.
//
//   node visuals/tools/generate-manual.ts            writes wiki/Nodes.md
//   node visuals/tools/generate-manual.ts --check    fails if it is stale
//   node visuals/tools/generate-manual.ts --stdout   prints it instead

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeCatalog } from '../mcp/authoring.ts';
import { MAX_SHADER_WORK } from '../client/render/circuit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.resolve(here, '../../wiki/Nodes.md');

type Catalog = ReturnType<typeof nodeCatalog>;
type Node = Catalog[number];
type Inlet = Node['variants'][number]['inlets'][number];

const SIGNALS: Record<string, string> = { p: 'point', n: 'number', c: 'colour' };

// A cell is one sentence of someone's prose; a stray pipe would end the row.
const cell = (text: string) => text.replace(/\|/g, '\\|');

const table = (head: string[], rows: string[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

// What a number inlet starts on. Two of them start on something alive rather
// than a setting, which is worth saying here for the same reason the app says
// it: a row that is already moving looks broken until you know it is a signal.
const startsOn = (inlet: Inlet): string => {
  if (inlet.default !== undefined) return `\`${inlet.default}\``;
  if (inlet.liveDefault === 'energy') return 'the room';
  if (inlet.liveDefault === 'beat') return 'the beat';
  return '—';
};

const portRows = (ports: readonly Inlet[]) =>
  ports.map((port) => [
    `\`${port.name}\``,
    SIGNALS[port.signal] ?? port.signal,
    port.signal === 'n' ? startsOn(port) : '—',
    cell(port.description) + (port.control === 'toggle' ? ' *(a switch)*' : ''),
  ]);

const identity = (port: Inlet) => `${port.name}|${port.signal}|${port.description}|${port.default}`;

const section = (node: Node): string => {
  const out: string[] = [`### \`${node.kind}\``, '', node.description, ''];

  if (node.target === 'track') {
    out.push('Names a track in your set.', '');
  } else if (node.target === 'flow') {
    out.push('Names one of your own flows, used whole.', '');
  } else if (node.target?.startsWith('media:')) {
    out.push(`Names a ${node.target.slice(6)} from your media folder.`, '');
  }

  // Most nodes hold every inlet steady across their modes, and repeating an
  // identical table once per mode is how a reference page becomes unreadable.
  // So: the inlets they all share, then only what a mode adds.
  const first = node.variants[0]?.inlets ?? [];
  const shared = first.filter((port) =>
    node.variants.every((variant) => variant.inlets.some((other) => identity(other) === identity(port))),
  );
  const sharedIds = new Set(shared.map(identity));

  if (node.variants.length > 1 || node.variants[0]?.mode) {
    const rows = node.variants.map((variant) => {
      const extra = variant.inlets.filter((port) => !sharedIds.has(identity(port)));
      return [
        `\`${variant.mode}\``,
        cell(variant.description),
        extra.length ? extra.map((port) => `\`${port.name}\``).join(', ') : '—',
      ];
    });
    out.push('**Modes**', '', table(['mode', 'what it does', 'inlets of its own'], rows), '');
  }

  if (shared.length) {
    out.push(
      node.variants.length > 1 ? '**Inlets**, on every mode' : '**Inlets**',
      '',
      table(['inlet', 'signal', 'starts on', 'what it is for'], portRows(shared)),
      '',
    );
  }

  const modeOnly = node.variants.flatMap((variant) =>
    variant.inlets.filter((port) => !sharedIds.has(identity(port))),
  );
  const seen = new Set<string>();
  const distinct = modeOnly.filter((port) => !seen.has(identity(port)) && seen.add(identity(port)));
  if (distinct.length) {
    out.push('**Inlets a mode brings with it**', '', table(['inlet', 'signal', 'starts on', 'what it is for'], portRows(distinct)), '');
  }

  out.push('**Outlets**', '', table(['outlet', 'signal', 'what comes out'], node.outlets.map((port) => [`\`${port.name}\``, SIGNALS[port.signal] ?? port.signal, cell(port.description)])), '');

  if (node.work > 0) {
    const varies = new Set(node.variants.map((variant) => variant.work)).size > 1;
    out.push(
      varies
        ? `**Costs** up to ${node.work} of the ${MAX_SHADER_WORK} a flow may spend, depending on the mode.`
        : `**Costs** ${node.work} of the ${MAX_SHADER_WORK} a flow may spend.`,
      '',
    );
  }

  return out.join('\n');
};

const render = (catalog: Catalog): string => {
  const families = [...new Set(catalog.map((node) => node.family))];
  const lines: string[] = [
    '# Nodes',
    '',
    'Every node you can put on a flow, what it takes in and what it gives back.',
    '',
    '> Generated from the vocabulary itself — the sentences here are the ones the app',
    "> shows on the node. Editing this page by hand edits a copy; run `npm run dev:node-manual`",
    '> in the repo instead.',
    '',
    '[Visuals](Visuals) is the page to read first: what a flow is, how you wire one, and how',
    'a set becomes a show. This is the reference you come back to.',
    '',
    '## The three signals',
    '',
    'A cord carries one of three things, and an inlet only takes its own kind.',
    '',
    table(
      ['signal', 'is'],
      [
        ['**point**', 'where in the frame you are looking'],
        ['**number**', 'anything scalar — one you set, a meter, the beat'],
        ['**colour**', 'a picture'],
      ],
    ),
    '',
    'Every number inlet can be set on the node itself, so a flow works before anything is',
    'wired into it. The **starts on** column is what it holds until you say otherwise; two of',
    'them start on something alive rather than a number, and a drag catches that signal and',
    'holds it where it was.',
    '',
    '## Every node',
    '',
    table(
      ['node', 'family', 'what it does'],
      catalog.map((node) => [`[\`${node.kind}\`](#${node.kind})`, node.family, cell(node.description)]),
    ),
    '',
  ];

  for (const family of families) {
    const members = catalog.filter((node) => node.family === family);
    lines.push(`## ${family}`, '', `*${members[0]?.familyDescription}*`, '');
    for (const node of members) lines.push(section(node));
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
};

const text = render(nodeCatalog());

if (process.argv.includes('--stdout')) {
  process.stdout.write(text);
} else if (process.argv.includes('--check')) {
  const held = fs.existsSync(page) ? fs.readFileSync(page, 'utf8') : '';
  if (held !== text) {
    console.error('wiki/Nodes.md is stale; run npm run dev:node-manual');
    process.exit(1);
  }
  console.log('wiki/Nodes.md is current.');
} else {
  if (!fs.existsSync(path.dirname(page))) {
    console.error(`no wiki checkout at ${path.dirname(page)} — clone the wiki beside the repo first`);
    process.exit(1);
  }
  fs.writeFileSync(page, text);
  console.log(`wrote ${path.relative(path.resolve(here, '../..'), page)} — ${nodeCatalog().length} nodes`);
}
