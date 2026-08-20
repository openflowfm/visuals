import { hint } from './hints.ts';
import { GENERATORS, type Blend, type LayerSpec, type LookDef, type Scheme } from './protocol.ts';

/**
 * One layer, resolved through the cascade — the whole of it, in one place.
 *
 * It lives beside `protocol.ts` rather than in `server/` for the reason
 * `hints.ts` does: **two consumers, one reading.** The server resolves the cell
 * the transport is sitting in, sixty times a minute, and calls it the show. The
 * editor resolves any cell you point at — a song you are not playing, a track
 * that is silent — and calls it the answer. A second implementation of that
 * would drift, and it would drift in the worst possible way: the editor would
 * tell you what a chorus was going to look like and the stage would disagree.
 *
 * ## What it adds over the resolution the show used to do inline
 *
 * **It says who answered.** The old code computed the value and threw away the
 * provenance, which was fine while the only consumer drew pixels. An editor
 * cannot work without it: "said at track level" and "inherited, untouched" are
 * the two sentences that make an override legible, and both are questions about
 * *where* a value came from rather than what it is.
 */
export type Said = 'default' | 'hint' | 'track' | 'clip';

/**
 * Whether a look draws its own picture or works on the one that arrived.
 *
 * The whole difference between the two halves of the old split, asked as a
 * question about one look rather than answered by which list it was in. A
 * built-in is a generator by name; a circuit is one when it never samples the
 * frame, which is exactly what `circuit.md` already said made it a source.
 *
 * The resolver needs this because the two combine differently. A generator is
 * the **base** of a stack and a more specific level *replaces* it — that is what
 * "a clip is an exception" has to mean. A transformer is **added**, because the
 * section's character and the track's own character should both survive.
 */
export function isGenerator(scheme: Scheme, id: string): boolean {
  const def: LookDef | undefined = scheme.looks[id];
  if (!def) return false;
  if (def.builtin) return (GENERATORS as readonly string[]).includes(def.builtin);
  if (!def.circuit) return false;
  return !def.circuit.nodes.some((node) => node.kind === 'sample');
}

export interface Resolution {
  /** The generator the stack starts from. */
  base: string;
  blend: Blend;
  /** The section energy at which this layer joins the picture. */
  floor: number;
  /** Added to the section's energy. Accumulates from track to clip. */
  bias: number;
  hidden: boolean;
  /**
   * The whole stack the cascade offered, base first, in draw order.
   *
   * Not yet capped: `maxLooks` and energy cut it down in `show.ts`, and an
   * editor wants to see what a layer *would* carry, which explains what it
   * carries far better than the survivors do.
   */
  offers: string[];
  /** Which level last set each scalar. `default` means nobody did. */
  said: Record<'base' | 'blend' | 'floor' | 'bias' | 'hide', Said>;
  /** The look ids each level contributed, kept apart so an editor can say. */
  gave: { section: string[]; track: string[]; clip: string[] };
}

export interface Asked {
  /** The track's exact name, which is what `Scheme.layers` is keyed by. */
  name: string;
  /** Position in the composite stack, which is what the defaults cycle on. */
  depth: number;
  /** How many layers there are, for the derived floor. */
  count: number;
  /** The section's looks, which are the first thing on the pile. */
  section?: readonly string[];
  /** The clip playing, or the one an exception is being written against. */
  clip?: string | null;
}

/**
 * The cascade, in the order specificity runs: hint, track, clip.
 *
 * Scalars **override** field by field, so binding one field of a track leaves
 * the rest to the name hint — an entry saying `{ bias: 0.2 }` is asking for one
 * change, not for everything the name implied to be forgotten.
 *
 * Effects **add**, because the archetype contributes the section's character and
 * the track contributes what that instrument always does, and both should
 * survive. Anything else would make a track and a section fight over one slot.
 *
 * `bias` **accumulates** between the track and the clip, and only there. A clip
 * that is the quiet one in a loud track is saying "and also this"; a track that
 * is calmer than the hint suggested is saying "no, this instead".
 */
export function resolveLayer(scheme: Scheme, asked: Asked): Resolution {
  const { defaults } = scheme;
  const out: Resolution = {
    base: defaults.looks[asked.depth % defaults.looks.length],
    blend: defaults.blend[asked.depth % defaults.blend.length],
    // Derived so the bottom layer is always in and a tall stack's top needs a
    // fairly loud section to appear. Any level may say otherwise.
    floor: asked.count > 1 ? (asked.depth / (asked.count - 1)) * 0.45 : 0,
    bias: 0,
    hidden: false,
    offers: [...(asked.section ?? [])],
    said: { base: 'default', blend: 'default', floor: 'default', bias: 'default', hide: 'default' },
    gave: { section: [], track: [], clip: [] },
  };

  /** Transformers, in the order the levels offered them. The base is separate. */
  const transforms: string[] = [];

  const apply = (spec: LayerSpec, level: Said, into: 'track' | 'clip' | null) => {

    if (spec.blend) {
      out.blend = spec.blend;
      out.said.blend = level;
    }
    if (spec.floor !== undefined) {
      out.floor = spec.floor;
      out.said.floor = level;
    }
    if (spec.bias !== undefined) {
      out.bias = spec.bias;
      out.said.bias = level;
    }
    if (spec.hide !== undefined) {
      out.hidden = spec.hide;
      out.said.hide = level;
    }
    take(spec.looks, level, into);
  };

  /**
   * A generator replaces the base; a transformer joins the queue.
   *
   * This is the one place the collapsed noun still has to tell the two apart,
   * and it is the right place: combining is the cascade's job, and drawing —
   * which genuinely does not care — is the compositor's.
   */
  const take = (ids: readonly string[] | undefined, level: Said, into: 'track' | 'clip' | null) => {
    for (const id of ids ?? []) {
      if (isGenerator(scheme, id)) {
        out.base = id;
        out.said.base = level;
        if (into) out.gave[into].push(id);
        continue;
      }
      if (transforms.includes(id)) continue;
      transforms.push(id);
      if (into) out.gave[into].push(id);
    }
  };

  // The section is the first thing on the pile. It usually contributes
  // character, but nothing stops it naming a generator — "in the drop,
  // everything becomes strobe" is a real thing to want, and the rule stays
  // uniform: a generator sets the base wherever it came from.
  take(asked.section, 'default', null);
  out.gave.section = [...transforms];

  // The name hint next, so an explicit entry can say one thing without having
  // to restate everything the name already implied.
  const guessed = hint(asked.name);
  if (guessed) apply(guessed, 'hint', null);
  const bound = scheme.layers[asked.name];
  if (bound) apply(bound, 'track', 'track');

  const byClip = asked.clip ? scheme.clips[asked.clip] : undefined;
  if (byClip) {
    const carried = out.bias;
    apply(byClip, 'clip', 'clip');
    if (byClip.bias !== undefined) out.bias = carried + byClip.bias;
  }

  out.offers = [out.base, ...transforms];
  return out;
}

/**
 * The offers that name a look the scheme still has.
 *
 * An id naming a deleted look is dropped here rather than in the renderer, so
 * a stale reference costs a missing pass and never a failed compile.
 */
export function liveOffers(scheme: Scheme, offers: readonly string[]): string[] {
  return offers.filter((id) => scheme.looks[id]);
}
