import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ModelLibrary, ModelSetupDraft } from '../../model.ts';
import type { Scheme, Show } from '../../protocol.ts';
import { ModelLibraryView } from './ModelLibrary.tsx';
import { ModelSetupPreview, modelPreviewDocument } from './ModelSetupPreview.tsx';

const SHOW = {
  flow: null,
  pinned: false,
  tempo: 120,
  colorway: 'electric dusk',
  colors: [0xff3366, 0x33ccff, 0x9966ff, 0xffffff, 0x101018],
} as Show;

describe('the first-class model library', () => {
  it('browses immutable assets separately from reusable setups and reports flow reuse', () => {
    const hash = 'a'.repeat(64);
    const asset = {
        hash,
        name: 'Creature.glb',
        bytes: 4096,
        importedAt: '2026-09-01T00:00:00.000Z',
        capabilities: {
          generator: 'test',
          version: '2.0',
          scenes: [],
          defaultScene: 0,
          nodes: [],
          meshes: [],
          skins: [],
          animations: [],
          materials: [],
          cameras: [],
          lights: [],
          warnings: [],
        },
      };
    const library = {
      assets: [asset],
      setups: [{
        id: 'creature',
        name: 'Creature / stage',
        assetHash: hash,
        revision: 'b'.repeat(64),
        bindings: [],
        materials: [],
        camera: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }],
      notice: null,
    } satisfies ModelLibrary;
    const scheme = {
      flows: {
        first: { name: 'First', circuit: { nodes: [{ id: 'one', kind: 'model', setup: 'creature', x: 0, y: 0 }], cords: [] } },
        second: { name: 'Second', circuit: { nodes: [{ id: 'two', kind: 'model', setup: 'creature', x: 0, y: 0 }], cords: [] } },
      },
    } as unknown as Scheme;

    const html = renderToStaticMarkup(h(ModelLibraryView, {
      library,
      scheme,
      show: SHOW,
      onImport: async () => undefined,
      onSave: () => undefined,
      onReconcile: () => undefined,
    }));

    expect(html).toContain('Reusable GLB setups');
    expect(html).toContain('Creature / stage');
    expect(html).toContain('2 flow instances');
    expect(html).toContain('immutable GLBs');
    expect(html).toContain('Creature.glb');
    expect(html).toContain('1 setup');
  });

  it('previews the unsaved setup through an isolated model-to-output flow', () => {
    const hash = 'a'.repeat(64);
    const asset = {
      hash,
      name: 'Creature.glb',
      bytes: 4096,
      importedAt: '2026-09-01T00:00:00.000Z',
      capabilities: {
        generator: 'test', version: '2.0', scenes: [], defaultScene: 0,
        nodes: [], meshes: [], skins: [], animations: [], materials: [], cameras: [], lights: [], warnings: [],
      },
    } satisfies ModelLibrary['assets'][number];
    const draft = {
      id: 'creature',
      name: 'Creature / stage',
      assetHash: hash,
      bindings: [{
        id: 'turn', label: 'Turn', group: 'pose', default: 0.7, min: -3.14, max: 3.14,
        target: { kind: 'node-transform', node: 0, nodePath: 'Root', property: 'rotation-y' },
      }],
      materials: [{ material: 0, source: 'color-a', amount: 0.8 }],
      camera: null,
    } satisfies ModelSetupDraft;
    const scheme = { flows: { kept: { name: 'Kept', circuit: { nodes: [], cords: [] } } } } as unknown as Scheme;
    const preview = modelPreviewDocument(draft, asset, scheme, SHOW);
    const node = Object.values(preview.scheme.flows)[0]!.circuit.nodes[0]!;

    expect(Object.keys(preview.scheme.flows)).toEqual(['~model-setup-preview']);
    expect(scheme.flows).toHaveProperty('kept');
    expect(node).toMatchObject({ kind: 'model', setup: 'model-setup-preview', values: { turn: 0.7 } });
    expect(preview.library.setups[0]).toMatchObject({
      id: 'model-setup-preview',
      assetHash: hash,
      revision: 'working-copy',
      materials: draft.materials,
    });
    expect(preview.show.flow).toBe('~model-setup-preview');

    const html = renderToStaticMarkup(h(ModelSetupPreview, { draft, asset, scheme, show: SHOW }));
    expect(html).toContain('Preview of Creature / stage');
    expect(html).toContain('loading model…');
    expect(html).toContain('Material mappings, camera, and published start values update here before save.');
  });
});
