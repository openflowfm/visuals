import { useEffect, useRef, useState } from 'react';
import type { Circuit, EffectDef, Scheme, SetGrid, Show, SourceKind } from '../../protocol.ts';
import { SIGNAL_NAMES, SOURCE_KINDS } from '../../protocol.ts';
import { createPreview } from '../render/preview.ts';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { CircuitEditor } from './Circuit.tsx';
import { addCircuit, dropEffect, effectList, freeNodeId } from './edits.ts';
import { usesOf } from './coverage.ts';
import { Preview } from './Preview.tsx';
import { probeDef } from './probe.ts';
import { AMOUNT, ENERGY, PERCENT, effectParam } from './param.ts';
import { BUILTIN_PARAMS } from '../render/shaders.ts';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import type { Clock } from '../state/useShow.ts';
import './circuit.css';

/**
 * One look, opened up.
 *
 * The other two views are lists of decisions; this is the one thing in the app
 * that genuinely *is* a dataflow, and a table has never been able to say what a
 * point moved about and a picture read at it amounts to. So the canvas is here,
 * on one effect at a time, and the rest of the console stays lists.
 *
 * ## Two drawers, and the difference between them is the whole idea
 *
 * A look reads signal from somewhere, and there are exactly two somewheres.
 * **My track** is relative: it means whichever layer is drawing this, so the
 * same look means something correct on the bass and on the pad and travels
 * between songs untouched. **A named track** is absolute: it names one thing and
 * keeps meaning that thing, which is what you want for "crossfade on the bass
 * filter" and is also what breaks the moment the look is used somewhere else.
 *
 * Both are wanted and the design problem was never which to have — it was making
 * which one you are looking at obvious without making anyone think about the
 * word "relative". Hence the shapes: rounded travels, squared stays put.
 */
export function Looks({
  show,
  scheme,
  grid,
  save,
  clock,
  look,
  setLook,
  onBind,
}: {
  show: Show;
  scheme: Scheme;
  grid: SetGrid | null;
  save(next: Scheme): void;
  clock: Clock;
  look: string | null;
  setLook(id: string | null): void;
  onBind(): void;
}) {
  const list = effectList(scheme);
  const id = look && scheme.effects[look] ? look : (list.find((e) => e.def.circuit)?.id ?? list[0]?.id ?? null);
  const def = id ? scheme.effects[id] : null;

  // The view falls back to the first circuit when nothing has been chosen, and
  // the tab bar reads `look` — so tell it, or the header says "no effect
  // selected" over a canvas that plainly has one open.
  useEffect(() => {
    if (id && id !== look) setLook(id);
  }, [id, look, setLook]);

  const [source, setSource] = useState<SourceKind>('rings');
  const [amount, setAmount] = useState(0.85);
  const [energy, setEnergy] = useState(0.75);
  const [error, setError] = useState<string | null>(null);

  /** Meters by name, read live, so a named track drives the bench for real. */
  const meters = useRef<(name: string) => number>(() => 0);
  meters.current = (name: string) =>
    name === 'master' ? show.master : (show.layers.find((l) => l.name === name)?.level ?? 0);

  const names = [...show.layers.map((l) => l.name), 'master'];
  const pictures = useNodePictures(def, { source, amount, energy, clock, meters });

  const setDef = (next: Partial<EffectDef>) => {
    if (!id || !def) return;
    save({ ...scheme, effects: { ...scheme.effects, [id]: { ...def, ...next } } });
  };
  const setCircuit = (next: Circuit) => setDef({ circuit: next });

  const uses = id ? usesOf(scheme, grid, id) : null;

  return (
    <div className="looks">
      <div className="bar">
        <span className="cap">look</span>
        <div className="picks">
          {list.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.def.circuit ? 'wired' : undefined}
              data-on={entry.id === id ? '' : undefined}
              onClick={() => setLook(entry.id)}
            >
              {entry.def.name || entry.id}
            </button>
          ))}
        </div>
        <span className="gap" />
        <button
          type="button"
          onClick={() => {
            const made = addCircuit(scheme);
            save(made.scheme);
            setLook(made.id);
          }}
        >
          + circuit
        </button>
        {def?.circuit && id && (
          <button
            type="button"
            className="drop"
            onClick={() => {
              save(dropEffect(scheme, id));
              setLook(null);
            }}
          >
            delete
          </button>
        )}
      </div>

      {!def && <p className="cap pad">no effects in this scheme yet</p>}

      {def && (
        <div className="body">
          <aside className="drawers">
            <h4 className="mine">my track</h4>
            <div className="pills round">
              {SIGNAL_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={!def.circuit}
                  title={`${DRAWER[name]} — travels with the look`}
                  onClick={() => def.circuit && setCircuit(drop(def.circuit, 'signal', name))}
                >
                  {name === 'level' ? 'meter' : name}
                </button>
              ))}
            </div>

            <h4 className="named">a named track</h4>
            <div className="pills square">
              {names.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={!def.circuit}
                  title={`${name} meter — absolute, breaks if the look moves`}
                  onClick={() => def.circuit && setCircuit(drop(def.circuit, 'track', name))}
                >
                  {name}
                </button>
              ))}
              {names.length === 1 && <span className="cap">no tracks yet</span>}
            </div>

            <p className="note">
              rounded travels with the look. squared names something and stays put.
            </p>
            <p className="cap absent">
              a device parameter — a filter cutoff — needs the bridge to watch devices, which it
              does not yet. Meters and the clock are what a look can read today.
            </p>
          </aside>

          <div className="canvas-wrap">
            <div className="naming">
              <input
                className="field"
                value={def.name}
                spellCheck={false}
                aria-label="Effect name"
                onChange={(e) => setDef({ name: e.target.value })}
              />
              <span className="cap">{def.circuit ? 'circuit' : 'built in'}</span>
            </div>
            {def.builtin && (
              <div className="knobs">
                {(BUILTIN_PARAMS[def.builtin] ?? []).map((spec) => (
                  <Knob
                    key={spec.name}
                    param={effectParam(spec)}
                    value={def.params?.[spec.name] ?? spec.value}
                    onChange={(v) => setDef({ params: { ...def.params, [spec.name]: v } })}
                    name={spec.name}
                  />
                ))}
                <p className="cap note-flat">
                  energy still moves underneath these — a chorus adds segments to a kaleidoscope
                  whatever the knob says. This is where it starts from, for every layer using it.
                </p>
              </div>
            )}
            {def.circuit ? (
              <CircuitEditor
                circuit={def.circuit}
                onChange={setCircuit}
                tracks={names}
                picture={pictures.picture}
              />
            ) : (
              <div className="builtin">
                <p>{def.name} is a built-in — six lines of handwritten GLSL, not a canvas.</p>
                <p className="cap">
                  A built-in is what a rig draws before anyone has wired anything. Make a circuit to
                  build one out of nodes.
                </p>
              </div>
            )}
          </div>

          <aside className="bench">
            <h4>bench</h4>
            <Preview
              def={def}
              source={source}
              amount={amount}
              energy={energy}
              color={0xffb347}
              pace={scheme.defaults.pace}
              quantum={show.quantum}
              clock={clock}
              meters={(name) => meters.current(name)}
              onError={setError}
            />
            {error && <p className="bad">{error}</p>}

            <label>
              <span>under it</span>
              <Select
                items={SOURCE_KINDS as unknown as string[]}
                index={Math.max(0, SOURCE_KINDS.indexOf(source))}
                onChange={(i) => setSource(SOURCE_KINDS[i])}
                label="Bench source"
                width={104}
              />
            </label>
            <label>
              <span>amount</span>
              <Knob
                param={AMOUNT}
                value={PERCENT.to(amount)}
                onChange={(v) => setAmount(PERCENT.from(v))}
                name=""
              />
            </label>
            <label>
              <span>energy</span>
              <Knob
                param={ENERGY}
                value={PERCENT.to(energy)}
                onChange={(v) => setEnergy(PERCENT.from(v))}
                name=""
              />
            </label>

            <dl>
              <dt>tempo</dt>
              <dd>{show.tempo.toFixed(0)}</dd>
              <dt>section</dt>
              <dd>{show.role ? `[${show.role}]` : String.fromCharCode(8212)}</dd>
            </dl>

            <h4>where it is bound</h4>
            {uses && (uses.layers.length > 0 || uses.sections.length > 0) ? (
              <ul className="bound">
                {uses.layers.map((name) => (
                  <li key={`l:${name}`}>{name}</li>
                ))}
                {uses.sections.map((name) => (
                  <li key={`s:${name}`}>[{name}]</li>
                ))}
              </ul>
            ) : (
              <p className="cap">nothing points at this yet</p>
            )}
            <button type="button" className="go" onClick={onBind}>
              see it in bind {String.fromCharCode(9656)}
            </button>
          </aside>
        </div>
      )}

      <canvas ref={pictures.offscreen} className="probe-canvas" aria-hidden />
    </div>
  );
}

const DRAWER: Record<string, string> = {
  level: 'this layer\'s own meter',
  energy: 'the section\'s energy',
  beat: 'continuous beats',
  phase: 'position in the bar',
  pulse: 'one on the beat, decaying',
  time: 'seconds — for drift that should not be in time',
  amount: 'how far this effect is dialled in',
  random: 'a new number each beat',
};

/** Drop a node somewhere free-ish. A layout algorithm would fight the hand. */
function drop(circuit: Circuit, kind: 'signal' | 'track', op: string): Circuit {
  const at = circuit.nodes.length;
  return {
    ...circuit,
    nodes: [
      ...circuit.nodes,
      {
        id: freeNodeId(circuit, kind),
        kind,
        op,
        x: 40 + (at % 4) * 180,
        y: 30 + Math.floor(at / 4) * 130,
      },
    ],
  };
}

/**
 * A picture per node, out of one GL context.
 *
 * A context each would be the obvious build and is the wrong one: browsers keep
 * about sixteen alive and start evicting the oldest, and this view already
 * shares the page with the stage and the bench. So one offscreen context draws
 * every node in turn and each frame is blitted into that node\'s own small 2D
 * canvas, which costs one texture copy per node and no extra contexts at all.
 *
 * It runs on the show\'s clock like everything else here, so a wave wired to the
 * beat is in time with the room in every thumbnail at once.
 */
function useNodePictures(
  def: EffectDef | null,
  at: {
    source: SourceKind;
    amount: number;
    energy: number;
    clock: Clock;
    meters: { current: (name: string) => number };
  },
) {
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const faces = useRef(new Map<string, HTMLCanvasElement>());
  const now = useRef(at);
  now.current = at;
  const held = useRef(def);
  held.current = def;

  useEffect(() => {
    const canvas = offscreen.current;
    if (!canvas) return;
    const preview = createPreview(canvas);
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const circuit = held.current?.circuit;
      if (!circuit) return;
      const state = now.current;
      const beat = state.clock.beat();
      for (const [id, face] of faces.current) {
        const probed = held.current ? probeDef(held.current, id) : null;
        if (!probed) continue;
        preview.frame({
          source: state.source,
          def: probed,
          amount: state.amount,
          energy: state.energy,
          level: 0.25 + 0.75 * (1 - (beat % 1)) ** 3,
          color: 0xffb347,
          pace: 0,
          quantum: 4,
          beat,
          seconds: state.clock.seconds(),
          meters: state.meters.current,
        });
        const ctx = face.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(canvas, 0, 0, face.width, face.height);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      preview.free();
    };
  }, []);

  const picture = (id: string) => (
    <canvas
      key={id}
      className="nodeshot"
      width={104}
      height={58}
      ref={(el) => {
        if (el) faces.current.set(id, el);
        else faces.current.delete(id);
      }}
    />
  );

  return { offscreen, picture };
}
