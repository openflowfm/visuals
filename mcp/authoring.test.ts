import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FlowDef } from '../protocol.ts';
import { ARRAY_MODES, FIELD_MODES } from '../protocol.ts';
import { FIELD_WORK } from '../client/render/glsl/fields.ts';
import {
  FlowAuthoringStore,
  nodeCatalog,
  reviewNodeDesign,
  validateFlow,
  type NodeProposal,
} from './authoring.ts';

const made: string[] = [];

afterEach(() => {
  for (const directory of made.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const temporaryScheme = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-flow-mcp-'));
  made.push(directory);
  return path.join(directory, 'scheme.json');
};

const flow = (): FlowDef => ({
  name: 'Agent field',
  circuit: {
    nodes: [
      { id: 'picture', kind: 'source', op: 'plasma', x: 20, y: 40 },
      { id: 'out', kind: 'out', x: 260, y: 40 },
    ],
    cords: [{ from: 'picture/c', to: 'out/c' }],
  },
});

describe('the agent-facing node catalog', () => {
  it('carries every node, mode, inlet, and outlet description', () => {
    const catalog = nodeCatalog();
    expect(catalog.map((node) => node.kind)).toContain('out');
    expect(catalog.find((node) => node.kind === 'lens')?.variants).toHaveLength(12);
    expect(catalog.find((node) => node.kind === 'array')?.variants.map((variant) => variant.mode))
      .toEqual(ARRAY_MODES);
    expect(catalog.find((node) => node.kind === 'field')).toMatchObject({
      work: 16,
      variants: FIELD_MODES.map((mode) => ({ mode, work: FIELD_WORK[mode] })),
    });
    const video = catalog.find((node) => node.kind === 'video');
    expect(video).toMatchObject({ target: 'media:video', defaultMode: 'loop' });
    expect(video?.variants.map((variant) => variant.mode)).toEqual(['loop', 'once', 'scrub']);
    // A played clip takes a speed and a freeze; a scrubbed one takes a position
    // and cannot take either, because both answer the question its position
    // inlet has already answered. An agent reading this catalog has to be told
    // which of the two it is looking at, so the mode has to move the inlets here
    // exactly as it does on the faceplate.
    for (const variant of video?.variants ?? []) {
      const named = variant.inlets.map((port) => port.name);
      if (variant.mode === 'scrub') {
        expect(named).toContain('position');
        expect(named).not.toContain('pace');
        expect(named).not.toContain('freeze');
      } else {
        expect(variant.inlets.find((port) => port.name === 'pace')).toMatchObject({ default: 0.5 });
        expect(variant.inlets.find((port) => port.name === 'freeze')).toMatchObject({ default: 0 });
      }
    }
    const image = catalog.find((node) => node.kind === 'image');
    expect(image).toMatchObject({ target: 'media:image', defaultMode: 'cover' });
    expect(image?.variants.map((variant) => variant.mode)).toEqual(['cover', 'contain']);
    const lfo = catalog.find((node) => node.kind === 'lfo');
    expect(lfo).toMatchObject({ defaultMode: 'sine', target: null });
    // Eight, since the six a `wave` node used to own came across when the two
    // merged — it was the same oscillator with a worse clock.
    expect(lfo?.variants.map((variant) => variant.mode)).toEqual([
      'sine',
      'triangle',
      'saw',
      'ramp',
      'square',
      'pulse',
      'noise',
      'sample-hold',
    ]);
    for (const variant of lfo?.variants ?? []) {
      expect(variant.inlets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'rate', default: 0.5, display: 'lfo-rate' }),
          expect.objectContaining({ name: 'sync', default: 1, control: 'toggle' }),
          expect.objectContaining({ name: 'phase', default: 0, display: 'phase' }),
        ]),
      );
    }
    expect(
      catalog
        .find((node) => node.kind === 'field')
        ?.variants.find((variant) => variant.mode === 'metaballs')
        ?.inlets.map((port) => port.name),
    ).toEqual(['p', 'energy', 'balls', 'apart']);
    expect(
      catalog
        .find((node) => node.kind === 'lfo')
        ?.variants[0].inlets.find((port) => port.name === 'clock')?.liveDefault,
    ).toBe('beat');
    for (const node of catalog) {
      expect(node.description.trim()).not.toBe('');
      expect(node.variants.length).toBeGreaterThan(0);
      for (const variant of node.variants) {
        expect(variant.description.trim()).not.toBe('');
        for (const port of variant.inlets) expect(port.description.trim()).not.toBe('');
      }
      for (const port of node.outlets) expect(port.description.trim()).not.toBe('');
    }
  });
});

describe('strict flow validation', () => {
  it('proves a complete graph compiles through the real vocabulary', () => {
    const validation = validateFlow('agent', flow(), {});
    expect(validation.valid).toBe(true);
    expect(validation.diagnostics).toEqual([]);
    expect(validation.stats).toMatchObject({ nodes: 2, cords: 1, tracks: 0 });
  });

  it('reports bad addresses, wrong signals, missing ends, and stale values', () => {
    const broken: FlowDef = {
      name: 'Broken',
      circuit: {
        nodes: [
          { id: 'beat', kind: 'playback', op: 'beat', x: 0, y: 0 },
          {
            id: 'colour',
            kind: 'source',
            op: 'solid',
            x: 100,
            y: 0,
            values: { absent: 0.5 },
          },
        ],
        cords: [
          { from: 'beat/n', to: 'colour/p' },
          { from: 'missing/c', to: 'colour/p' },
        ],
      },
    };
    const codes = validateFlow('broken', broken, {}).diagnostics.map((entry) => entry.code);
    // No out is legal now — a provider gives instead — but a flow with neither
    // an out nor a give is a flow nothing can hear from, and it says so.
    expect(codes).toContain('flow.out.missing');
    expect(codes).toContain('node.value.unknown');
    expect(codes).toContain('cord.signal');
    expect(codes).toContain('cord.source.node');
    expect(codes).toContain('cord.target.duplicate');
  });

  it('keeps an unselected video drawable but warns about its transparent result', () => {
    const draft: FlowDef = {
      name: 'Video',
      circuit: {
        nodes: [
          { id: 'video', kind: 'video', op: 'loop', x: 0, y: 0 },
          { id: 'out', kind: 'out', x: 200, y: 0 },
        ],
        cords: [{ from: 'video/c', to: 'out/c' }],
      },
    };
    const result = validateFlow('video', draft, {});
    expect(result.valid).toBe(true);
    expect(result.diagnostics.map((entry) => entry.code)).toContain('node.video.unset');
    expect(result.stats.videos).toBe(1);
  });

  it('keeps an unselected image drawable but warns about its transparent result', () => {
    const draft: FlowDef = {
      name: 'Image',
      circuit: {
        nodes: [
          { id: 'image', kind: 'image', op: 'contain', x: 0, y: 0 },
          { id: 'out', kind: 'out', x: 200, y: 0 },
        ],
        cords: [{ from: 'image/c', to: 'out/c' }],
      },
    };
    const result = validateFlow('image', draft, {});
    expect(result.valid).toBe(true);
    expect(result.diagnostics.map((entry) => entry.code)).toContain('node.image.unset');
    expect(result.stats.images).toBe(1);
  });

  it('refuses a nested flow that contains itself', () => {
    const recursive: FlowDef = {
      name: 'Recursive',
      circuit: {
        nodes: [
          { id: 'again', kind: 'flow', op: 'recursive', x: 0, y: 0 },
          { id: 'out', kind: 'out', x: 200, y: 0 },
        ],
        cords: [{ from: 'again/c', to: 'out/c' }],
      },
    };
    const result = validateFlow('recursive', recursive, {});
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toContain('node.flow.loop');
  });
});

describe('scheme writes', () => {
  it('creates a validated flow and returns the new revision', () => {
    const file = temporaryScheme();
    const store = new FlowAuthoringStore(file);
    const before = store.read();
    const saved = store.saveFlow('agent', flow(), before.revision);
    expect(saved.revision).not.toBe(before.revision);
    expect(store.read().scheme.flows.agent).toEqual(flow());
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).flows.agent.name).toBe('Agent field');
  });

  it('will not overwrite a scheme or an existing flow by accident', () => {
    const file = temporaryScheme();
    const store = new FlowAuthoringStore(file);
    const before = store.read();
    const saved = store.saveFlow('agent', flow(), before.revision);
    expect(() => store.saveFlow('second', flow(), before.revision)).toThrow('scheme changed');
    expect(() => store.saveFlow('agent', flow(), saved.revision)).toThrow('already exists');
  });

  it('keeps explanatory fields the app does not own', () => {
    const file = temporaryScheme();
    fs.writeFileSync(file, `${JSON.stringify({ _: { note: 'keep me' } }, null, 2)}\n`);
    const store = new FlowAuthoringStore(file);
    const before = store.read();
    store.saveFlow('agent', flow(), before.revision);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))._).toEqual({ note: 'keep me' });
  });
});

describe('node design review', () => {
  const proposal = (): NodeProposal => ({
    kind: 'threshold',
    description: 'Turn a number into an on-or-off gate.',
    behavior: 'Emit one above the cutoff and zero below it.',
    whyNode: 'Its inlet contract differs from the existing arithmetic modes.',
    runtime: 'expression',
    inlets: [
      { name: 'n', signal: 'n', description: 'The number to compare.', default: 0.5 },
      { name: 'at', signal: 'n', description: 'The cutoff.', default: 0.5 },
    ],
    outlets: [{ name: 'n', signal: 'n', description: 'The resulting gate.' }],
    modes: [],
  });

  it('returns the complete implementation boundary for a documented proposal', () => {
    const review = reviewNodeDesign(proposal());
    expect(review.ready).toBe(true);
    expect(review.implementationPlan).toEqual(
      expect.arrayContaining([
        expect.stringContaining('client/nodes/<kind>/node.ts'),
        expect.stringContaining('NodeSpec'),
        expect.stringContaining('docs/flows.md'),
      ]),
    );
  });

  it('refuses undocumented ports and DAW vocabulary', () => {
    const review = reviewNodeDesign({
      ...proposal(),
      kind: 'clip',
      inlets: [{ name: 'n', signal: 'n', description: '' }],
    });
    expect(review.ready).toBe(false);
    expect(review.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['node.name.daw', 'node.port.description']),
    );
  });
});
