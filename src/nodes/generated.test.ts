import { describe, expect, it } from 'vitest';
import { generateNodes } from '../../tools/generate-nodes.ts';
import {
  BROWSABLE_NODE_DEFINITIONS,
  NODE_BY_KIND,
  NODE_DEFINITIONS,
  NODE_FAMILIES,
  NODE_KINDS,
} from './generated.ts';

describe('generated node manifest', () => {
  it('matches every node folder on disk', () => {
    expect(() => generateNodes(true)).not.toThrow();
  });

  it('has one definition, family, and lookup entry per kind', () => {
    expect(new Set(NODE_KINDS).size).toBe(NODE_DEFINITIONS.length);
    expect(NODE_FAMILIES.flatMap((family) => family.kinds)).toHaveLength(
      NODE_DEFINITIONS.length,
    );
    for (const definition of NODE_DEFINITIONS) {
      expect(NODE_BY_KIND[definition.kind]).toBe(definition);
    }
  });

  it('only offers folders that declare themselves addable', () => {
    expect(BROWSABLE_NODE_DEFINITIONS.every((node) => ['node', 'modes'].includes(node.browser))).toBe(
      true,
    );
    const browsableKinds: readonly string[] = BROWSABLE_NODE_DEFINITIONS.map((node) => node.kind);
    expect(browsableKinds).not.toContain('flow');
    expect(browsableKinds).not.toContain('out');
  });
});
