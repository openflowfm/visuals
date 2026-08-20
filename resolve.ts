import { hint } from './hints.ts';
import type { Blend, LayerSpec, Scheme, SourceKind } from './protocol.ts';

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

export interface Resolution {
  source: SourceKind;
  blend: Blend;
  /** The section energy at which this layer joins the picture. */
  floor: number;
  /** Added to the section's energy. Accumulates from track to clip. */
  bias: number;
  hidden: boolean;
  /** Every effect id the cascade offered, in the order it offered them. */
  offers: string[];
  /** Which level last set each scalar. `default` means nobody did. */
  said: Record<'source' | 'blend' | 'floor' | 'bias' | 'hide', Said>;
  /** The effect ids each level contributed, kept apart so an editor can say. */
  gave: { section: string[]; track: string[]; clip: string[] };
}

export interface Asked {
  /** The track's exact name, which is what `Scheme.layers` is keyed by. */
  name: string;
  /** Position in the composite stack, which is what the defaults cycle on. */
  depth: number;
  /** How many layers there are, for the derived floor. */
  count: number;
  /** The section's effects, which are the first thing on the pile. */
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
    source: defaults.sources[asked.depth % defaults.sources.length],
    blend: defaults.blend[asked.depth % defaults.blend.length],
    // Derived so the bottom layer is always in and a tall stack's top needs a
    // fairly loud section to appear. Any level may say otherwise.
    floor: asked.count > 1 ? (asked.depth / (asked.count - 1)) * 0.45 : 0,
    bias: 0,
    hidden: false,
    offers: [...(asked.section ?? [])],
    said: { source: 'default', blend: 'default', floor: 'default', bias: 'default', hide: 'default' },
    gave: { section: [...(asked.section ?? [])], track: [], clip: [] },
  };

  const apply = (spec: LayerSpec, level: Said, into: 'track' | 'clip' | null) => {
    if (spec.source) {
      out.source = spec.source;
      out.said.source = level;
    }
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
    for (const id of spec.effects ?? []) {
      if (!out.offers.includes(id)) {
        out.offers.push(id);
        if (into) out.gave[into].push(id);
      }
    }
  };

  // The name hint first, so an explicit entry can say one thing without having
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

  return out;
}

/**
 * The offers that name an effect the scheme still has.
 *
 * An id naming a deleted effect is dropped here rather than in the renderer, so
 * a stale reference costs a missing effect and never a failed compile.
 */
export function liveOffers(scheme: Scheme, offers: readonly string[]): string[] {
  return offers.filter((id) => scheme.effects[id]);
}
