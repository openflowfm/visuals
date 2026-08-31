import { describe, expect, it } from 'vitest';
import { hint } from '../hints.ts';
import { NODE_FAMILIES, flowsUsedBy } from '../protocol.ts';
import { compileFlow, inletsOf, portId, reachesOut, repaired, splitPort } from '../client/render/circuit.ts';
import { NODE_DEFINITIONS } from '../client/nodes/generated.ts';
import { EXAMPLES, merge } from './scheme.ts';

/**
 * The name hints, against the names of a real set.
 *
 * These exist because a mis-routed track does not look like a bad regular
 * expression — it looks like a rendering bug. A pad drawing as a strobe is one
 * wrong thing among twenty-six right ones, on screen, at a gig, and nothing
 * about it points back at a missing `\b`.
 *
 * The names below are taken from an actual set rather than invented, which is
 * the whole point: the failures were all in names nobody would think to make up.
 *
 * They survived the cascade because what they were always good at is the thing
 * that is left: guessing what an instrument looks like from what it is called.
 * That is now one node's `by name` mode, and it is what a `tracks` node draws
 * before anyone has wired anything else.
 */
const baseFor = (name: string) => hint(name);

describe('name hints', () => {
  it('does not match a word inside a longer one', () => {
    // The bug this file was written for. "beat" is inside "Beating", so without
    // a word boundary a pad track drew as a drum — and it was the drum hint
    // that won, because it is first.
    expect(baseFor('Beating Pad')).toBe('noise');
    expect(baseFor('Subtle Keys')).toBe('grid');
  });

  it('is strict in both directions, which is the price of the fix', () => {
    // The same boundary that saves "Beating Pad" means "Padded" is not a pad
    // and "Drumming" is not a drum. They fall through to the neutral picture
    // instead, which is the safe half of being wrong: an unremarkable track
    // rather than a confidently misrouted one.
    expect(baseFor('Padded Cell')).toBe('plasma');
    expect(baseFor('Drumming')).toBe('plasma');
  });

  it('reads an arp as a sequence rather than a chord', () => {
    // Four of these in one set, and the arp rule is tested before the keys one
    // so `Pluck Arp` is a sequence rather than a pluck. What matters is that all
    // four agree and that none of them lands on the keys picture — scattered,
    // they read as four unrelated things when they are one family.
    const drawn = ['Space Arp', 'Retro Arp', 'Pluck Arp', '13-Felixian Pluck Arp'].map(baseFor);
    expect(new Set(drawn).size).toBe(1);
    expect(drawn[0]).not.toBe(baseFor('Keys'));
  });

  it('routes the ordinary instrument names', () => {
    expect(baseFor('Drums')).toBe('strobe');
    expect(baseFor('Bass')).toBe('bars');
    expect(baseFor('Sub Bass')).toBe('bars');
    expect(baseFor('303 EXT')).toBe('bars');
    expect(baseFor('Guitar')).toBe('rings');
    expect(baseFor('Vox')).toBe('rings');
    expect(baseFor('Sparkle Pad')).toBe('noise');
    expect(baseFor('Texture')).toBe('noise');
  });

  it('gives a name that says nothing something to draw anyway', () => {
    // Never null. A track nobody named usefully still has to draw, or a set
    // where half the names are "MIDI" is a set that is half black — and that is
    // the state every set is in on its first evening.
    for (const name of ['MIDI', 'Uppers', 'Downers', 'Song', 'Sample', '29-Kontakt 8']) {
      expect(hint(name), name).toBe('plasma');
    }
  });

  it('is case-insensitive, because nobody is consistent', () => {
    expect(baseFor('DRUMS')).toBe('strobe');
    expect(baseFor('drum bus')).toBe('strobe');
  });
});

describe('the example scheme', () => {
  it('is a show on its own, with nothing configured', () => {
    // The rule the file is designed around. A rig that draws nothing until it
    // has been configured is a rig nobody configures.
    expect(Object.keys(EXAMPLES.flows).length).toBeGreaterThan(1);
    expect(Object.keys(EXAMPLES.colorways).length).toBeGreaterThan(1);
    expect(EXAMPLES.flows[EXAMPLES.defaults.flow]).toBeDefined();
    expect(EXAMPLES.colorways[EXAMPLES.defaults.colorway]).toBeDefined();
  });

  it('ships colourways that are five long, loud, and led by the loudest', () => {
    // Saturation on its own says nothing — a pale tint and a fire engine both
    // read 100% — so chroma is the one that means loud. The first is asserted
    // because a flow that ignores the set draws every generator from `colors[0]`,
    // and one light member is asserted because a set of five loud hues has
    // nothing in it to read an edge against.
    const read = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      return { chroma: max - min, l: (max + min) / 2 };
    };
    for (const [name, hexes] of Object.entries(EXAMPLES.colorways)) {
      expect(hexes, name).toHaveLength(5);
      const each = hexes.map(read);
      expect(each[0].chroma, `${name} leads with the loudest`).toBeGreaterThanOrEqual(0.6);
      expect(each.filter((c) => c.chroma >= 0.6).length, `${name} loud`).toBeGreaterThanOrEqual(2);
      expect(each.filter((c) => c.l >= 0.8).length, `${name} tint`).toBe(1);
    }
  });

  it('turns through everything, because nothing is narrowed', () => {
    expect(EXAMPLES.rotation.flows).toEqual([]);
    expect(EXAMPLES.rotation.colorways).toEqual([]);
    expect(EXAMPLES.rotation.bars).toBeGreaterThan(0);
  });

  it('every flow it ships compiles', () => {
    // The library is the only documentation of the vocabulary anyone will read,
    // so one of them failing to build is four-quarters of the manual gone.
    for (const [id, def] of Object.entries(EXAMPLES.flows)) {
      const built = compileFlow(EXAMPLES.flows, id);
      expect(built.error, `${def.name}: ${built.error}`).toBeNull();
      expect(built.source).toContain('void main()');
    }
  });

  it('keeps values on value nodes and smoothing on track nodes', () => {
    const nodes = Object.values(EXAMPLES.flows).flatMap((def) => def.circuit.nodes);
    const tracks = nodes.filter((node) => node.kind === 'track');
    const values = nodes.filter((node) => node.kind === 'value');
    expect(tracks.length).toBeGreaterThan(0);
    expect(values.length).toBeGreaterThan(0);
    for (const node of tracks) {
      expect(node.smooth).toBeDefined();
      expect(node.value).toBeUndefined();
    }
    for (const node of values) {
      expect(node.value).toBeDefined();
      expect(node.smooth).toBeUndefined();
    }
  });

  it('ships nothing that draws nothing', () => {
    // A shipped flow with a node parked off to one side is fine; a shipped flow
    // with nothing wired to `out` is a black frame with a library entry's name
    // on it, and it is the first thing anyone opens.
    for (const [id, def] of Object.entries(EXAMPLES.flows)) {
      expect(reachesOut(def.circuit), def.name).toBe(true);
      expect(repaired(def.circuit), `${id} needs no repair`).toEqual(def.circuit);
    }
  });

  it('uses every family in the vocabulary between them', () => {
    // The library is the only documentation of the vocabulary anyone actually
    // reads, so a library that only demonstrates pictures and blends leaves the
    // half that makes this model unusual — geometry, and numbers becoming
    // colours — invisible to everyone who learns it by taking these apart.
    const kinds = new Set(
      Object.values(EXAMPLES.flows).flatMap((def) => def.circuit.nodes.map((node) => node.kind)),
    );
    for (const family of NODE_FAMILIES) {
      expect(family.kinds.some((kind) => kinds.has(kind)), family.name).toBe(true);
    }
  });

  it('demonstrates the asset-free modern vocabulary', () => {
    // Media cannot ship without somebody's files, and doors only make sense in
    // a deliberately reusable provider. Everything else added since the first
    // library can teach itself in a general-purpose flow that works on a fresh
    // machine, so keep those examples in the show rather than only in the node
    // browser.
    const kinds = new Set(
      Object.values(EXAMPLES.flows).flatMap((def) => def.circuit.nodes.map((node) => node.kind)),
    );
    for (const kind of ['field', 'fractal', 'lfo', 'light', 'place'] as const) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it('ships one flow built out of the others, and it names flows that exist', () => {
    // A flow inside a flow is the claim the vocabulary makes about itself, and a
    // claim with no example in the library is one nobody believes.
    //
    // The names are the fragile part and the reason this is pinned: a `flow` node
    // holds an **id**, and a shipped flow whose id changed would make the graph
    // that used it go quiet rather than fail — which is right for a flow somebody
    // deleted and wrong for one that ships beside it.
    const nested = Object.entries(EXAMPLES.flows).filter(
      ([, def]) => flowsUsedBy(def.circuit).length > 0,
    );
    expect(nested.length).toBeGreaterThan(0);
    for (const [id, def] of nested) {
      for (const used of flowsUsedBy(def.circuit)) {
        expect(EXAMPLES.flows[used], `${def.name} uses ${used}`).toBeDefined();
      }
      expect(compileFlow(EXAMPLES.flows, id).error, def.name).toBeNull();
    }
  });

  it('draws something with no set playing', () => {
    // Sometimes all that is running is the click. A wheel that turns through
    // seventeen flows and goes black on any of them between songs is a wheel
    // nobody leaves running, so every flow carries a picture of its own
    // underneath whatever the set is doing.
    //
    // There used to be an exemption here for `The set`, which was one `tracks`
    // node and nothing else. It went, and so did the exemption: a flow that is
    // a single node is a node, and the node browser already offers it.
    // **Derived from the vocabulary, not listed here.** A hand-written list of
    // the things that draw is a list that goes stale the first time the draw
    // family grows, and it goes stale *silently* — a flow built entirely out of
    // new drawing nodes passes this test by accident, which is exactly what
    // happened when `form`, `glow` and `shade` arrived.
    const own = new Set<string>(
      NODE_DEFINITIONS.filter((node) => node.family === 'draw').map((node) => node.kind),
    );
    // Four are in that family and cannot be the answer to this question: the
    // set is the thing being drawn without, media depends on files a machine
    // may not have, and the previous frame of a flow that draws nothing is
    // still nothing.
    for (const conditional of ['tracks', 'image', 'video', 'last']) own.delete(conditional);

    for (const [, def] of Object.entries(EXAMPLES.flows)) {
      const kinds = new Set(def.circuit.nodes.map((node) => node.kind));
      const draws = [...kinds].some((kind) => own.has(kind));
      expect(draws, `${def.name} has nothing to draw without the set`).toBe(true);
    }
  });

  it('never draws a figure larger than the cell it is repeated into', () => {
    // The one failure a compiler cannot see and a test can. A figure's size is
    // in plane units and an `array` cell is a fraction of the frame, so a shape
    // dialled to what looks right on its own is drawn entirely *outside* the
    // cell it belongs to — and what comes back is a black frame with nothing in
    // the graph to say why. It happened twice while these were being written.
    //
    // Only the cells that actually bound a radius: `ring` and `mirror` fold by
    // angle and leave the distance from the centre alone, and a row bounds one
    // axis. A grid bounds both, which is where this bites.
    const radius = (size: number) => 0.05 + (0.6 - 0.05) * Math.min(1, Math.max(0, size));
    const halfCell = (op: string | undefined, count: number) =>
      op === 'grid'
        ? 1 / (1 + Math.floor(Math.min(1, Math.max(0, count)) * 7)) / 2
        : op === 'row'
          ? 1.8 / (1 + Math.floor(Math.min(1, Math.max(0, count)) * 11)) / 2
          : null;

    let checked = 0;
    for (const def of Object.values(EXAMPLES.flows)) {
      const byId = new Map(def.circuit.nodes.map((node) => [node.id, node]));
      const feeds = new Map(def.circuit.cords.map((cord) => [cord.to, cord.from]));
      for (const node of def.circuit.nodes) {
        if (node.kind !== 'figure' || node.op === 'line') continue;
        const from = feeds.get(portId(node.id, 'p'));
        const cell = from && byId.get(splitPort(from).node);
        if (!cell || cell.kind !== 'array') continue;
        const bound = halfCell(cell.op, cell.values?.count ?? 0.5);
        if (bound === null) continue;
        checked += 1;
        const drawn = radius(node.values?.size ?? 0.5);
        expect(drawn, `${def.name}: ${node.id} is ${drawn} in a cell of ${bound}`).toBeLessThan(
          bound,
        );
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('never hangs an energy on the meter alone', () => {
    // `master` is zero with no Live attached and close to it with only a click
    // running, so an energy fed by a meter and nothing else holds a generator at
    // its dullest all night: fewest arms, slowest rung on the division ladder,
    // least charge. The fix is in the wiring rather than in the number — every
    // meter that reaches an energy is floored by something on the clock — and
    // this is the assertion that keeps it there.
    const feeding = (def: (typeof EXAMPLES.flows)[string], inlet: string): Set<string> => {
      const byId = new Map(def.circuit.nodes.map((node) => [node.id, node]));
      const feeds = new Map(def.circuit.cords.map((cord) => [cord.to, cord.from]));
      const kinds = new Set<string>();
      const seen = new Set<string>();
      const walk = (at: string) => {
        const from = feeds.get(at);
        if (!from || seen.has(from)) return;
        seen.add(from);
        const node = byId.get(splitPort(from).node);
        if (!node) return;
        kinds.add(node.kind);
        for (const port of inletsOf(node)) walk(portId(node.id, port.name));
      };
      walk(inlet);
      return kinds;
    };

    for (const def of Object.values(EXAMPLES.flows)) {
      for (const node of def.circuit.nodes) {
        for (const port of inletsOf(node)) {
          if (port.name !== 'energy') continue;
          const kinds = feeding(def, portId(node.id, port.name));
          if (!kinds.has('track')) continue;
          const clocked = kinds.has('wave') || kinds.has('lfo') || kinds.has('playback');
          expect(clocked, `${def.name}: ${node.id} energy is only a meter`).toBe(true);
        }
      }
    }
  });

  it('ships a flow that reads the set, and one that does not', () => {
    // Both halves have to exist in the library or half the vocabulary is
    // invisible to anyone who learns it by taking these apart.
    const reads = Object.values(EXAMPLES.flows).filter((def) =>
      def.circuit.nodes.some((n) => n.kind === 'tracks'),
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.length).toBeLessThan(Object.keys(EXAMPLES.flows).length);
  });
});

describe('reading a file', () => {
  it('treats a present colourway section as the complete set', () => {
    const merged = merge({ colorways: { mine: ['#123456'] } });
    expect(merged.colorways.mine).toEqual(Array(5).fill('#123456'));
    expect(Object.keys(merged.colorways)).toEqual(['mine']);
    expect(merged.defaults.colorway).toBe('mine');
  });

  it('treats a present flow section as the complete library', () => {
    const merged = merge({
      flows: { mine: { name: 'Mine', circuit: { nodes: [], cords: [] } } },
    });
    expect(merged.flows.mine).toBeDefined();
    expect(Object.keys(merged.flows)).toEqual(['mine']);
    expect(merged.defaults.flow).toBe('mine');
  });

  it('uses Examples only when an old partial file omits a whole section', () => {
    const merged = merge({ seed: 'before-complete-schemes' });
    expect(merged.flows).toEqual(EXAMPLES.flows);
    expect(merged.colorways).toEqual(EXAMPLES.colorways);
  });

  it('reads a song written as a bare colourway name', () => {
    // A song's whole entry used to be its colourway's name, and a file out
    // there still says so. Refusing it would unstyle every song in it.
    expect(merge({ songs: { one: 'ember' } as never }).songs.one).toEqual({ colorway: 'ember' });
  });

  it('keeps a mood a scheme names, and drops one naming nothing', () => {
    // The moods map is **the one overlay in a scheme** — every other map is
    // complete, so every other map is safe from this. It is keyed by colourway
    // name, which means it is the only thing that can end up holding a key for a
    // row that is not there: a hand edit that deleted a colourway, or an older
    // build that renamed one without knowing moods existed.
    //
    // Pruned at the door rather than tolerated downstream, which is the same
    // argument `paletteOf` is applied here for. An orphan costs nothing today
    // and costs a mystery the day somebody makes a *new* colourway with the old
    // name and it comes back dealt as ice.
    const now = merge({
      colorways: { mine: ['#123456'], yours: ['#654321'] },
      moods: { mine: 'earth', gone: 'neon' },
    } as never);
    expect(now.moods).toEqual({ mine: 'earth' });
  });

  it('drops a mood this build has never heard of rather than refusing the file', () => {
    // A file naming a light we do not have is a *newer* file, not a broken one,
    // and the failure has to be proportionate: refusing the whole scheme at the
    // door would cost somebody every flow in it to save them from one colourway
    // that would have dealt correctly as `any` anyway. So the word is dropped
    // and the row falls back to what it said before anyone pinned it.
    const now = merge({
      colorways: { mine: ['#123456'] },
      moods: { mine: 'thunderstorm' },
    } as never);
    expect(now.moods).toEqual({});
    expect(now.colorways.mine).toHaveLength(5);
  });

  it('says nothing about moods when a file says nothing', () => {
    // Every scheme written before moods existed, which is all of them.
    expect(merge({ colorways: { mine: ['#123456'] } }).moods).toEqual({});
  });

  it('remembers what a randomised show was randomised from', () => {
    expect(merge({ seed: 'oak-ember-12' }).seed).toBe('oak-ember-12');
    expect(merge({}).seed).toBeUndefined();
  });
});

describe('a file with a value of the wrong shape', () => {
  /**
   * Refusing rather than repairing, and the difference matters.
   *
   * Every one of these reached a `.map`, a `.filter` or a `.trim` on something
   * that was not the type it was written for, inside the show heartbeat — so a
   * typo in a file somebody is *meant* to hand-edit was the visuals process
   * gone and the wall black. There is no repair to make: nobody can say what
   * `"colorways": {"x": "nope"}` was supposed to be. So it is a parse failure by
   * another name, and `library.ts` answers it the way it answers a trailing
   * comma — keep the scheme that was working, put the message in the panel.
   */
  it('refuses a colourway that is not a list of colours', () => {
    // `hex.map(packColor)` in show.ts, once per tick.
    expect(() => merge({ colorways: { x: 'nope' } } as never)).toThrow();
    expect(() => merge({ colorways: { x: [1, 2] } } as never)).toThrow();
    // Accepted, not refused — and answered with a neutral five. Every colourway
    // that leaves here has one colour per role, so nothing downstream indexes
    // past the end into black.
    expect(merge({ colorways: { x: [] } }).colorways.x).toHaveLength(5);
  });

  it('refuses a song whose pinned flows are not a list', () => {
    // `song.flows.filter` in resolve.ts, which a string answers with a throw.
    expect(() => merge({ songs: { Sandstorm: { flows: 'folded' } } } as never)).toThrow();
    expect(merge({ songs: { Sandstorm: { flows: ['mine'] } } }).songs.Sandstorm.flows).toEqual([
      'mine',
    ]);
  });

  it('refuses a rotation pool that is not a list', () => {
    expect(() => merge({ rotation: { flows: 'mine' } } as never)).toThrow();
    expect(() => merge({ rotation: { colorways: 3 } } as never)).toThrow();
  });

  it('refuses a graph whose nodes or cords are not arrays', () => {
    // `reword` walks both, and `repaired` walks them again.
    const flow = (circuit: unknown) => ({ flows: { mine: { name: 'Mine', circuit } } });
    expect(() => merge(flow({ nodes: 'none', cords: [] }) as never)).toThrow();
    expect(() => merge(flow({ nodes: [], cords: {} }) as never)).toThrow();
    expect(() => merge(flow({ nodes: [{ id: 'a' }], cords: [] }) as never)).toThrow();
  });

  it('refuses a node kind nothing can draw', () => {
    // `signalOfPort` reads `NODE_SPECS[node.kind].outlets` with no guard, so an
    // unknown kind is a throw rather than a node that draws nothing.
    const withKind = (kind: string) => ({
      flows: { mine: { name: 'Mine', circuit: { nodes: [{ id: 'a', kind, x: 0, y: 0 }], cords: [] } } },
    });
    expect(() => merge(withKind('sparkle') as never)).toThrow();
    // A mode is not a kind: `kaleido` was one of `effect`'s, and `reword` reads
    // it off `op`. As a kind it is a file nothing can draw.
    expect(() => merge(withKind('kaleido') as never)).toThrow();
    // The vocabulary, and every kind `reword` translates.
    expect(() => merge(withKind('lens') as never)).not.toThrow();
    expect(() => merge(withKind('sample') as never)).not.toThrow();
    expect(() => merge(withKind('effect') as never)).not.toThrow();
    expect(() => merge(withKind('fold') as never)).not.toThrow();
  });

  it('leaves a hand-written block it does not know about alone', () => {
    // The file is meant to be read and edited, so a top-level `_` explaining the
    // keys is not an error — and neither is a legacy section on its way out.
    const merged = merge({
      _: 'colourways are #rrggbb',
      layers: { anything: true },
      colorways: { mine: ['#123456'] },
    } as never);
    expect(merged.colorways.mine).toEqual(Array(5).fill('#123456'));
  });
});

describe('a file written when the cascade existed', () => {
  /**
   * Most of a real scheme.json from before the collapse.
   *
   * Spelled the way that file was spelled, which means `looks` throughout — the
   * word this vocabulary used before a graph was called a flow. A fixture
   * updated to the current spelling would be a fixture that stopped testing the
   * thing it is named after.
   */
  const old = {
    colorways: { rust: ['#aa4422'] },
    songs: { sandstorm: { colorway: 'rust', bias: 0.2 } },
    archetypes: { CHORUS: { energy: 0.9, looks: ['kaleido'] } },
    layers: { Drums: { looks: ['strobe'], blend: 'add', bias: 0.1 } },
    clips: { 'quiet one': { bias: -0.3 } },
    looks: {
      strobe: { name: 'Strobe', builtin: 'strobe' },
      mine: {
        name: 'Mine',
        circuit: {
          nodes: [
            { id: 'p', kind: 'point', x: 0, y: 0 },
            { id: 's', kind: 'sample', x: 1, y: 0 },
            { id: 'e', kind: 'signal', op: 'energy', x: 2, y: 0 },
            { id: 'o', kind: 'out', x: 3, y: 0 },
          ],
          cords: [
            { from: 'p/p', to: 's/p' },
            { from: 's/c', to: 'o/c' },
          ],
        },
      },
    },
    defaults: { colorway: 'rust', energy: 0.4, blend: ['over'], looks: ['bars'], maxLooks: 3, pace: 1 },
  };

  it('keeps what a person made and drops what the cascade decided', () => {
    // Inventing a graph out of a layer binding would produce something nobody
    // wrote and nobody wants to debug, so the bindings go. The colourways, the
    // song assignments and any flow that was a graph are work, so they stay.
    const merged = merge(old as never);
    expect(merged.colorways.rust).toEqual(Array(5).fill('#aa4422'));
    expect(merged.songs.sandstorm).toEqual({ colorway: 'rust' });
    expect(merged.flows.mine).toBeDefined();
    expect((merged as unknown as Record<string, unknown>).layers).toBeUndefined();
    expect((merged as unknown as Record<string, unknown>).archetypes).toBeUndefined();
  });

  it('does not carry a flow that was only a built-in', () => {
    // A built-in is a node mode now. A library full of twenty-three entries
    // that are one node each is worse than an empty one.
    expect(merge(old as never).flows.strobe).toBeUndefined();
  });

  it('rewords a graph written against the old vocabulary', () => {
    // `sample` meant "the frame that arrived", which was the layer underneath in
    // a stack. The nearest thing to that now is the set's own picture.
    const kept = merge(old as never).flows.mine.circuit;
    expect(kept.nodes.find((n) => n.id === 's')?.kind).toBe('tracks');
    expect(kept.nodes.find((n) => n.id === 's')?.op).toBe('by name');
    // `energy` and `amount` were signal modes and are not any more.
    expect(kept.nodes.find((n) => n.id === 'e')?.op).toBe('level');
    // And `signal` itself is `playback` — the same node, next to a `song` node
    // that was also, unhelpfully, a signal.
    expect(kept.nodes.find((n) => n.id === 'e')?.kind).toBe('playback');
  });

  it('carries the mark saying the randomiser wired a flow', () => {
    // `rolled` is the flag's old spelling, from when the deal was called a roll,
    // and it is the one field here a *later* gesture reads: clearing "what the
    // last one wired" walks it. A file keeping the old name would have every
    // dealt flow quietly become permanent, the opposite of what it means.
    const merged = merge({
      flows: {
        dealt: { name: 'Dealt', circuit: { nodes: [], cords: [] }, rolled: true },
        mine: { name: 'Mine', circuit: { nodes: [], cords: [] } },
      },
    } as never).flows;
    expect(merged.dealt.randomized).toBe(true);
    expect(merged.mine.randomized).toBeUndefined();
    // And the old spelling does not survive alongside the new one.
    expect(merged.dealt).not.toHaveProperty('rolled');
  });

  it('carries a paint node onto the colourway node, cord and all', () => {
    // `paint` handed out the colourway's first colour through an outlet called
    // `c`, because the first was the only one a graph could reach. The node
    // hands out five now, so the outlet has to name a role — and a cord left
    // addressed to `c` is one `repaired` drops as pointing at a port that is
    // not there, which unwires a flow somebody made without saying so.
    const merged = merge({
      flows: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'p', kind: 'paint', x: 0, y: 0, values: { amount: 0.4 } },
              { id: 'o', kind: 'out', x: 1, y: 0 },
            ],
            cords: [{ from: 'p/c', to: 'o/c' }],
          },
        },
      },
    } as never).flows.mine.circuit;
    expect(merged.nodes.find((n) => n.id === 'p')?.kind).toBe('colorway');
    // The number on its face is untouched: this is a rename, not a re-dial.
    expect(merged.nodes.find((n) => n.id === 'p')?.values).toEqual({ amount: 0.4 });
    expect(merged.cords).toEqual([{ from: 'p/primary', to: 'o/c' }]);
  });

  it('folds an energy node into the track it was following', () => {
    // It was `track` with an envelope on it: same signature, same bank, named
    // the same way. A file full of them has to keep breathing, so an unstated
    // fall is written down at the value it used to mean rather than inheriting
    // the merged node's zero.
    const merged = merge({
      flows: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'e', kind: 'energy', op: 'Bass', x: 0, y: 0 },
              { id: 'p', kind: 'colorway', x: 1, y: 0 },
              { id: 'o', kind: 'out', x: 2, y: 0 },
            ],
            cords: [
              { from: 'e/n', to: 'p/amount' },
              { from: 'p/primary', to: 'o/c' },
            ],
          },
        },
      },
    } as never).flows.mine.circuit;
    const node = merged.nodes.find((n) => n.id === 'e');
    expect(node?.kind).toBe('track');
    expect(node?.of).toBe('Bass');
    expect(node?.op).toBe('level');
    expect(node?.smooth).toBe(0.4);
    expect(node?.value).toBeUndefined();
    // Its outlet was already `n`, so the cord is untouched.
    expect(merged.cords).toContainEqual({ from: 'e/n', to: 'p/amount' });
  });

  it('moves a track smoothing from value to smooth, with the new spelling winning', () => {
    const merged = merge({
      flows: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'old', kind: 'track', of: 'Bass', op: 'level', x: 0, y: 0, value: 0.6 },
              {
                id: 'both',
                kind: 'track',
                of: 'Drums',
                op: 'level',
                x: 0,
                y: 1,
                value: 0.8,
                smooth: 0.25,
              },
              { id: 'dial', kind: 'value', x: 0, y: 2, value: 0.7 },
              { id: 'o', kind: 'out', x: 1, y: 0 },
            ],
            cords: [],
          },
        },
      },
    }).flows.mine.circuit;
    const old = merged.nodes.find((node) => node.id === 'old');
    const both = merged.nodes.find((node) => node.id === 'both');
    const dial = merged.nodes.find((node) => node.id === 'dial');
    expect(old?.smooth).toBe(0.6);
    expect(old?.value).toBeUndefined();
    expect(both?.smooth).toBe(0.25);
    expect(both?.value).toBeUndefined();
    expect(dial?.value).toBe(0.7);
    expect(dial?.smooth).toBeUndefined();
  });

  it('splits effect three ways without moving a single cord', () => {
    // `effect` was one name over three things — six modes that moved the point,
    // two that changed the colour where it was, four that read their input many
    // times. The split could be done to libraries people already have precisely
    // because all twelve kept their `c` inlet and their `c` outlet: only the
    // kind changes, and a cord names ports rather than kinds.
    const kept = merge({
      flows: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
              { id: 'k', kind: 'effect', op: 'kaleido', x: 1, y: 0 },
              { id: 'b', kind: 'effect', op: 'bloom', x: 2, y: 0 },
              { id: 'p', kind: 'effect', op: 'posterize', x: 3, y: 0, knobs: { levels: 0.8 } },
              { id: 's', kind: 'effect', op: 'shift', x: 4, y: 0, knobs: { spread: 0.4 } },
              { id: 'o', kind: 'out', x: 5, y: 0 },
            ],
            cords: [
              { from: 'g/c', to: 'k/c' },
              { from: 'k/c', to: 'b/c' },
              { from: 'b/c', to: 'p/c' },
              { from: 'p/c', to: 's/c' },
              { from: 's/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).flows.mine.circuit;
    const kindOf = (id: string) => kept.nodes.find((n) => n.id === id)?.kind;
    expect(kindOf('k')).toBe('lens');
    expect(kindOf('b')).toBe('spread');
    expect(kindOf('p')).toBe('grade');
    expect(kindOf('s')).toBe('spread');
    expect(kept.cords).toHaveLength(5);
    // Two of them collided with a name beside them once the families existed:
    // posterize's `levels` with the mode next to it, shift's `spread` with the
    // kind it landed in. A number that kept a stale name would be trimmed away by
    // `repaired` and the flow would quietly revert to a default. The file spells
    // the map `knobs`, as a file of that vintage would, so this covers the
    // rename and the split arriving together.
    expect(kept.nodes.find((n) => n.id === 'p')?.values).toEqual({ steps: 0.8 });
    expect(kept.nodes.find((n) => n.id === 's')?.values).toEqual({ split: 0.4 });
  });

  it('reads the numbers on a node whichever of the two names the file uses', () => {
    // `knobs` is what `values` was called. A file written before the word went
    // is every file anybody already has, and a number that failed to come
    // across is not a parse error — it is a flow that opens with its inlets
    // quietly back at their defaults, on the night it mattered.
    const kept = merge({
      flows: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
              {
                id: 'r',
                kind: 'lens',
                op: 'ripple',
                x: 1,
                y: 0,
                knobs: { waves: 0.72, depth: 0.4 },
              },
              { id: 'o', kind: 'out', x: 2, y: 0 },
            ],
            cords: [
              { from: 'g/c', to: 'r/c' },
              { from: 'r/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).flows.mine.circuit;
    const ripple = kept.nodes.find((n) => n.id === 'r');
    // Both numbers arrive under the new name. `waves` is the one that reads
    // back unchanged; `depth` is carried by the response migration, because a
    // file old enough to say `knobs` was also dialled before inlet responses
    // existed — see `responseMigration.test.ts` for what that carry preserves.
    expect(Object.keys(ripple?.values ?? {}).sort()).toEqual(['depth', 'waves']);
    expect(ripple?.values?.waves).toBe(0.72);
    // And the old spelling is gone rather than sitting beside the new one:
    // `scheme.json` is read and diffed by hand, and two names for one map in it
    // is a question nobody should have to answer.
    expect((ripple as { knobs?: unknown }).knobs).toBeUndefined();
  });

  it('makes the five geometry kinds modes of the lens they always were', () => {
    const kept = merge({
      flows: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'pt', kind: 'point', x: 0, y: 0 },
              { id: 'f', kind: 'fold', x: 1, y: 0, knobs: { sides: 0.4 } },
              { id: 'g', kind: 'source', op: 'rings', x: 2, y: 0 },
              { id: 'h', kind: 'hue', x: 3, y: 0, knobs: { shift: 0.7 } },
              { id: 'o', kind: 'out', x: 4, y: 0 },
            ],
            cords: [
              { from: 'pt/p', to: 'f/p' },
              { from: 'f/p', to: 'g/p' },
              { from: 'g/c', to: 'h/c' },
              { from: 'h/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).flows.mine.circuit;
    const fold = kept.nodes.find((n) => n.id === 'f');
    expect(fold?.kind).toBe('lens');
    expect(fold?.op).toBe('fold');
    expect(fold?.values).toEqual({ sides: 0.4 });
    expect(kept.nodes.find((n) => n.id === 'h')?.kind).toBe('grade');
    // `p` in and `p` out on the lens, `c` on the grade — every port kept its
    // name, so every cord survived.
    expect(kept.cords).toHaveLength(4);
  });

  it('moves a track name off op, and its cords off level', () => {
    // The node has to say which track *and* which of its numbers now, so the
    // name moves to `of` and `op` becomes the reading. The outlet goes with it:
    // `level` was the only number outlet in the vocabulary not called `n`, and
    // a cord addressed to a port that is not there is one `repaired` deletes.
    const merged = merge({
      flows: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 't', kind: 'track', op: 'Drums', x: 0, y: 0 },
              { id: 'p', kind: 'colorway', x: 1, y: 0 },
              { id: 'o', kind: 'out', x: 2, y: 0 },
            ],
            cords: [
              { from: 't/level', to: 'p/amount' },
              { from: 'p/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).flows.mine.circuit;
    const node = merged.nodes.find((n) => n.id === 't');
    expect(node?.of).toBe('Drums');
    expect(node?.op).toBe('level');
    expect(merged.cords).toContainEqual({ from: 't/n', to: 'p/amount' });
  });

  it('carries the pace across and forgets the rest of the defaults', () => {
    const merged = merge(old as never);
    expect(merged.defaults.pace).toBe(1);
    expect(merged.defaults.colorway).toBe('rust');
    expect(merged.flows[merged.defaults.flow]).toBeDefined();
  });

  it('leaves a file already written in the new spelling alone', () => {
    const circuit = {
      nodes: [
        { id: 'p', kind: 'polar' as const, previewOutlet: 'angle', x: 0, y: 0 },
        { id: 'o', kind: 'out' as const, x: 200, y: 0 },
      ],
      cords: [],
    };
    const now = merge({
      flows: { mine: { name: 'Mine', circuit } },
      rotation: { flows: ['mine'], colorways: [], bars: 16, onClip: false, colorEvery: 32 },
    });
    expect(now.rotation.bars).toBe(16);
    expect(now.rotation.flows).toEqual(['mine']);
    expect(now.flows.mine.circuit).toEqual(circuit);
  });

  it('collapses two outs to the one that was drawing, and invents none', () => {
    // This is the one door: a scheme reaches the renderer off disk or off the
    // wire and both come through `merge`. A file with two outs is a compile
    // error and a black wall, so it is collapsed here, once. A file with none
    // is left alone — a flow with no out is a provider now, not a mistake.
    const now = merge({
      flows: {
        empty: { name: 'Empty', circuit: { nodes: [], cords: [] } },
        two: {
          name: 'Two',
          circuit: {
            nodes: [
              { id: 'g', kind: 'source' as const, op: 'grid', x: 0, y: 0 },
              { id: 'a', kind: 'out' as const, x: 200, y: 0 },
              { id: 'b', kind: 'out' as const, x: 200, y: 200 },
            ],
            cords: [{ from: 'g/c', to: 'b/c' }],
          },
        },
      },
    });
    for (const id of ['empty', 'two']) {
      expect(compileFlow(now.flows, id).error, id).toBeNull();
    }
    expect(now.flows.empty.circuit.nodes).toHaveLength(0);
    // The one that was drawing survives, not the one that was written first.
    expect(now.flows.two.circuit.nodes.filter((n) => n.kind === 'out').map((n) => n.id)).toEqual([
      'b',
    ]);
  });
});

describe('a file written when a flow was called a look', () => {
  /**
   * The whole of the rename, in one file.
   *
   * Five keys carried the word and every one of them is here, because a file
   * that migrated its library but not its wheel comes back with a rotation
   * pointing at ids nothing has — and the failure of that is a wheel that turns
   * through nothing, at a gig, with no message about why.
   */
  const was = {
    looks: {
      mine: {
        name: 'Mine',
        circuit: {
          nodes: [
            { id: 'inner', kind: 'look', op: 'outline', x: 0, y: 0 },
            { id: 'o', kind: 'out', x: 200, y: 0 },
          ],
          cords: [{ from: 'inner/c', to: 'o/c' }],
        },
      },
    },
    rotation: { looks: ['mine', 'outline'], bars: 4 },
    songs: { sandstorm: { colorway: 'ember', looks: ['mine'] } },
    defaults: { colorway: 'ember', look: 'mine', pace: 1, draws: 'by name' },
  };

  it('reads the library, the wheel, the pins and the default', () => {
    const now = merge(was as never);
    expect(now.flows.mine).toBeDefined();
    expect(now.rotation.flows).toEqual(['mine', 'outline']);
    expect(now.rotation.bars).toBe(4);
    expect(now.songs.sandstorm.flows).toEqual(['mine']);
    expect(now.defaults.flow).toBe('mine');
    // The old spellings leave, or the next save writes a file that says both.
    const bare = now as unknown as Record<string, unknown>;
    expect(bare.looks).toBeUndefined();
    expect((now.rotation as unknown as Record<string, unknown>).looks).toBeUndefined();
  });

  it('renames the node kind without moving a cord', () => {
    // `op` was a flow id under both spellings, so this is the word and nothing
    // else — which is why it can be done to a library people already have.
    const now = merge(was as never);
    const inner = now.flows.mine.circuit.nodes.find((node) => node.id === 'inner');
    expect(inner?.kind).toBe('flow');
    expect(inner?.op).toBe('outline');
    expect(now.flows.mine.circuit.cords).toEqual([{ from: 'inner/c', to: 'o/c' }]);
    expect(compileFlow(now.flows, 'mine').error).toBeNull();
  });

  it('sends a file that defaulted to The set back to the example default', () => {
    // `The set` was one `tracks` node and is gone. A file that named it is a
    // file naming a flow nobody has, and the only honest answer to that is the
    // default the compatibility floor has.
    const now = merge({ defaults: { look: 'live', colorway: 'ember', pace: 0 } } as never);
    expect(now.defaults.flow).toBe(EXAMPLES.defaults.flow);
    expect(now.flows[now.defaults.flow]).toBeDefined();
  });

  it('leaves a file that already says flow alone', () => {
    // The bug this replaced rebuilt `defaults` out of `colorway` and `pace` and
    // dropped the rest, so a default flow set in the editor was reset on the
    // next read. It never showed because the only value anyone had was the
    // example one.
    const now = merge({ defaults: { flow: 'outline', colorway: 'cold', pace: 2, draws: 'by name' } } as never);
    expect(now.defaults.flow).toBe('outline');
    expect(now.defaults.colorway).toBe('cold');
    expect(now.defaults.pace).toBe(2);
  });
});
