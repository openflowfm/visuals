import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ModelLibrary } from '../../model.ts';
import type { Scheme } from '../../protocol.ts';
import { ModelLibraryView } from './ModelLibrary.tsx';

describe('the first-class model library', () => {
  it('browses immutable assets separately from reusable setups and reports flow reuse', () => {
    const hash = 'a'.repeat(64);
    const library = {
      assets: [{
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
      }],
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
});
