import { useState } from 'react';
import type { Layer, LayerSpec, Scheme, Show } from '../../protocol.ts';
import { BLENDS, SOURCE_KINDS } from '../../protocol.ts';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Slider } from '../../../widgets/src/controls/Slider.tsx';
import { Toggle } from '../../../widgets/src/controls/Toggle.tsx';
import { Row } from '../../../widgets/src/chrome/Row.tsx';
import { EffectPicks } from './EffectPicks.tsx';
import { effectLabel, setLayer } from './edits.ts';
import { BIAS, FLOOR, PERCENT } from './param.ts';

/**
 * Layers, bound to the tracks the set actually has.
 *
 * This pane replaced a list of regular expressions, and the trade is worth
 * stating. A pattern could catch a track that did not exist yet; a binding
 * cannot. What a binding gets in return is that **every layer is on screen**,
 * each showing what it resolved to, in the order they are composited — so the
 * question "why is that one drawing like that" has an answer you can point at
 * rather than one you have to simulate in your head. The flexible thing was
 * unreadable, and a show is configured once and read a hundred times.
 *
 * A track with no binding still draws: `server/scheme.ts` keeps the old patterns
 * as **name hints**, demoted from rules to a guess at a track nobody has
 * decided about. Binding one field leaves the rest to the hint, so saying "this
 * one is calmer" does not throw away "this one is a drum".
 */
export function Layers({
  show,
  scheme,
  patch,
}: {
  show: Show;
  scheme: Scheme;
  patch(next: Partial<Scheme>): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  /**
   * The clip whose exception is being edited, by name rather than by a flag.
   *
   * A flag meant "the clip currently playing here", which quietly stopped being
   * the same clip the moment the scene changed — and the next knob turn wrote to
   * the track instead of to the exception you thought you had open. Holding the
   * name means the target survives the set moving underneath it.
   */
  const [clipTarget, setClipTarget] = useState<string | null>(null);

  const exceptions = Object.keys(scheme.clips);

  return (
    <>
      <section>
        <h3>
          layers
          <em>
            {Object.keys(scheme.layers).length} of {show.layers.length} bound
          </em>
        </h3>

        <div className="layers">
          {show.layers.map((layer) => (
            <LayerRow
              key={layer.t}
              layer={layer}
              scheme={scheme}
              patch={patch}
              open={open === layer.name}
              clipTarget={open === layer.name ? clipTarget : null}
              onOpen={(next) => {
                setOpen(next ? layer.name : null);
                setClipTarget(null);
              }}
              onTarget={setClipTarget}
            />
          ))}
          {show.layers.length === 0 && (
            <p className="note">
              {show.connected ? 'The set has no tracks yet.' : 'Waiting for the bridge.'}
            </p>
          )}
        </div>
        <p className="note">
          Bottom of the list draws first, so the last row is on top. Group tracks are not layers —
          they carry no clips of their own, and drawing one would double every layer inside it.
        </p>
      </section>

      {exceptions.length > 0 && (
        <section>
          <h3>
            clip exceptions
            <em>{exceptions.length}</em>
          </h3>
          <div className="chips">
            {exceptions.map((name) => (
              <span key={name} className="chip">
                {name}
                <button
                  type="button"
                  aria-label={`Remove the exception for ${name}`}
                  onClick={() => {
                    const clips = { ...scheme.clips };
                    delete clips[name];
                    patch({ clips });
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <p className="note">
            The most specific level there is, matched on the clip's own name wherever it plays. Made
            from the clip that is playing rather than from a list, because an exception is something
            you notice on stage and fix there.
          </p>
        </section>
      )}
    </>
  );
}

function LayerRow({
  layer,
  scheme,
  patch,
  open,
  clipTarget,
  onOpen,
  onTarget,
}: {
  layer: Layer;
  scheme: Scheme;
  patch(next: Partial<Scheme>): void;
  open: boolean;
  clipTarget: string | null;
  onOpen(next: boolean): void;
  onTarget(next: string | null): void;
}) {
  // What the clip button offers: the one already being edited, or whatever is
  // playing here now.
  const clip = clipTarget ?? layer.clipName;
  const editingClip = clipTarget !== null;
  const spec: LayerSpec = (editingClip ? scheme.clips[clip] : scheme.layers[layer.name]) ?? {};
  const bound = editingClip ? Boolean(scheme.clips[clip]) : Boolean(scheme.layers[layer.name]);

  const set = (next: Partial<LayerSpec>) => {
    if (editingClip) patch({ clips: setLayer(scheme.clips, clip, next) });
    else patch({ layers: setLayer(scheme.layers, layer.name, next) });
  };

  const clear = () => {
    if (editingClip) {
      const clips = { ...scheme.clips };
      delete clips[clip];
      patch({ clips });
      onTarget(null);
    } else {
      const layers = { ...scheme.layers };
      delete layers[layer.name];
      patch({ layers });
    }
  };

  return (
    <div
      className="layer"
      data-open={open ? '' : undefined}
      data-hidden={layer.hidden ? '' : undefined}
    >
      <button type="button" className="layerhead" onClick={() => onOpen(!open)}>
        <i
          className="dot"
          data-live={layer.playing >= 0 ? '' : undefined}
          style={{ background: hex(layer.color) }}
        />
        <span className="layername">{layer.name}</span>
        <span className="resolved">
          {layer.hidden ? 'hidden' : layer.source}
          {!layer.hidden && layer.offers.length > 0 && (
            <em> + {layer.offers.map((id) => scheme.effects[id]?.name ?? id).join(', ')}</em>
          )}
        </span>
        {bound && <b className="bound" title="bound here" />}
      </button>

      {open && (
        <div className="layerbody">
          <div className="target">
            <button
              type="button"
              data-on={!editingClip ? '' : undefined}
              onClick={() => onTarget(null)}
            >
              this track
            </button>
            <button
              type="button"
              data-on={editingClip ? '' : undefined}
              disabled={!clip}
              title={clip ? `an exception for the clip "${clip}"` : 'nothing playing in this track'}
              onClick={() => onTarget(clip || null)}
            >
              {clip ? `clip: ${clip}` : 'no clip playing'}
            </button>
          </div>

          <Row gap={12}>
            <Select
              items={['auto', ...SOURCE_KINDS]}
              index={spec.source ? SOURCE_KINDS.indexOf(spec.source) + 1 : 0}
              onChange={(i) => set({ source: i === 0 ? undefined : SOURCE_KINDS[i - 1] })}
              name="Source"
            />
            <Select
              items={['auto', ...BLENDS]}
              index={spec.blend ? BLENDS.indexOf(spec.blend) + 1 : 0}
              onChange={(i) => set({ blend: i === 0 ? undefined : BLENDS[i - 1] })}
              name="Blend"
            />
            <Knob
              param={BIAS}
              value={PERCENT.to(spec.bias ?? 0)}
              onChange={(v) => set({ bias: v === 0 ? undefined : PERCENT.from(v) })}
              name="Bias"
            />
            <Slider
              param={FLOOR}
              value={PERCENT.to(spec.floor ?? layer.floor)}
              onChange={(v) => set({ floor: PERCENT.from(v) })}
              name="Floor"
            />
          </Row>

          <div className="line">
            <button
              type="button"
              className="tick"
              data-on={spec.floor === undefined ? '' : undefined}
              title="derive the floor from this layer's depth in the stack"
              onClick={() => set({ floor: undefined })}
            >
              auto floor
            </button>
            <Toggle
              on={spec.hide ?? false}
              width={58}
              onChange={(hide) => set({ hide: hide || undefined })}
            >
              hide
            </Toggle>
            {bound && (
              <button type="button" className="tick warn" onClick={clear}>
                clear {editingClip ? 'exception' : 'binding'}
              </button>
            )}
          </div>

          <EffectPicks
            scheme={scheme}
            chosen={spec.effects}
            onChange={(effects) => set({ effects })}
            width={58}
          />

          <p className="hits">
            drawing {layer.source} at {Math.round(layer.energy * 100)}% on {layer.blend}
            {layer.effects.length > 0
              ? ` · ${layer.effects.map((e) => effectLabel(scheme, e)).join(' + ')}`
              : ' · no effects'}
          </p>
        </div>
      )}
    </div>
  );
}

function hex(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}
