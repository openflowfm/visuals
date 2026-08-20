import { useEffect, useState } from 'react';
import type { Circuit, LookDef, Scheme, Show } from '../../protocol.ts';
import { SIGNAL_NAMES } from '../../protocol.ts';
import { isGenerator } from '../../resolve.ts';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { Meter } from '../../../widgets/src/controls/Meter.tsx';
import { NumberField } from '../../../widgets/src/controls/NumberField.tsx';
import { Segmented } from '../../../widgets/src/controls/Segmented.tsx';
import { Slider } from '../../../widgets/src/controls/Slider.tsx';
import { Toggle } from '../../../widgets/src/controls/Toggle.tsx';
import { BUILTIN_PARAMS } from '../render/shaders.ts';
import { CircuitEditor } from './Circuit.tsx';
import { addCircuit, dropLook, freeNodeId, lookList } from './edits.ts';
import { NodePictures } from './NodePictures.tsx';
import { stackFor, toggleIn } from './stack.ts';
import { Preview } from './Preview.tsx';
import { AMOUNT, BPM, ENERGY, lookParam, PERCENT } from './param.ts';
import { useTransport, type Transport } from '../state/useTransport.ts';
import type { Clock } from '../state/useShow.ts';
import './circuit.css';
import './console.css';

/**
 * Where looks get made, before anything is bound to anything.
 *
 * The order this app was first built in was backwards. Binding came first, so a
 * look only existed in relation to a track, and the only way to see one was to
 * have Ableton running and the right clip playing. You cannot build a library
 * that way — you can only ever tweak the thing that happens to be on screen.
 *
 * So this runs on [its own clock](../state/useTransport.ts) and needs no bridge,
 * no set and no Link. Make things that look good; decide what drives them later.
 *
 * ## The bench draws a stack, and it has to
 *
 * Not a nicety. Once source and effect became one noun, **a transformer previewed
 * on its own shows nothing** — it mixes against the black frame underneath it and
 * comes back black. It is only ever legible over something. So the bench holds a
 * *stack*, a base plus whatever is on top, which is the same thing a composition
 * is: the stack is not a preview of the composition, it *is* one, drawn by the
 * renderer the stage uses.
 *
 * That falls out of the collapse rather than being designed alongside it, which
 * is usually the sign the collapse was right.
 */
export function Designer({
  show,
  scheme,
  save,
  clock,
  look,
  setLook,
}: {
  show: Show;
  scheme: Scheme;
  save(next: Scheme): void;
  /** The room's clock, when there is a room. The transport may follow it. */
  clock: Clock;
  /** Which look is open, held above so the tab bar can name it. */
  look: string | null;
  setLook(id: string | null): void;
}) {
  const list = lookList(scheme);
  const editing = look;
  const setEditing = setLook;
  const [stack, setStack] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [energy, setEnergy] = useState(0.7);
  const [drive, setDrive] = useState<'pulse' | 'hold'>('pulse');
  const [held, setHeld] = useState(0.6);
  const [error, setError] = useState<string | null>(null);

  const transport = useTransport(clock, show.clock && show.connected);

  const id = editing && scheme.looks[editing] ? editing : (list[0]?.id ?? null);
  const def = id ? scheme.looks[id] : null;

  // A look you are editing is always in the picture. Anything else is a stack
  // you cannot see the point of.
  useEffect(() => {
    if (!id) return;
    if (id !== look) setLook(id);
    setStack((was) => stackFor(scheme, was, id, scheme.defaults.looks[0] ?? 'bars'));
  }, [id, scheme]);

  const setDef = (next: Partial<LookDef>) => {
    if (!id || !def) return;
    save({ ...scheme, looks: { ...scheme.looks, [id]: { ...def, ...next } } });
  };
  const setCircuit = (next: Circuit) => setDef({ circuit: next });

  const passes = stack
    .filter((each) => scheme.looks[each])
    .map((each, i) => ({
      id: each,
      def: scheme.looks[each],
      amount: i === 0 ? 1 : (amounts[each] ?? 0.85),
    }));

  return (
    <div className="designer wdg">
      <div className="bar">
        <span className="cap">transport</span>
        <Toggle on={transport.playing} onChange={transport.setPlaying} width={46}>
          {transport.playing ? 'playing' : 'stopped'}
        </Toggle>
        <NumberField
          param={BPM}
          value={transport.bpm}
          onChange={transport.setBpm}
          name="bpm"
          disabled={transport.following}
        />
        <Button onPress={transport.restart}>to the top</Button>
        <Toggle
          on={transport.following}
          onChange={transport.setFollowing}
          disabled={!(show.clock && show.connected)}
          width={58}
          title={
            show.connected
              ? 'Take the beat from the room instead of running one here'
              : 'Nothing to follow — no bridge is connected'
          }
        >
          follow
        </Toggle>
        <span className="gap" />
        <span className="cap">
          {transport.following ? 'on the room\'s clock' : 'on its own clock · no set needed'}
        </span>
      </div>

      <div className="body">
        <aside className="library">
          <h4>looks</h4>
          <Library
            scheme={scheme}
            list={list}
            editing={id}
            stack={stack}
            onEdit={setEditing}
            onStack={(each) => setStack((was) => toggleIn(scheme, was, each))}
          />
          <div className="acts">
            <Button
              onPress={() => {
                const made = addCircuit(scheme);
                save(made.scheme);
                setEditing(made.id);
              }}
            >
              + look
            </Button>
            {def?.circuit && id && (
              <Button
                tone="danger"
                onPress={() => {
                  save(dropLook(scheme, id));
                  setStack((was) => was.filter((each) => each !== id));
                  setEditing(null);
                }}
              >
                delete
              </Button>
            )}
          </div>
        </aside>

        <div className="canvas-wrap">
          {def && (
            <div className="naming">
              <input
                className="field"
                value={def.name}
                spellCheck={false}
                aria-label="Look name"
                onChange={(e) => setDef({ name: e.target.value })}
              />
              <span className="cap">
                {def.circuit ? 'circuit' : 'built in'} ·{' '}
                {id && isGenerator(scheme, id) ? 'draws its own picture' : 'works on what is under it'}
              </span>
            </div>
          )}

          {def?.builtin && (BUILTIN_PARAMS[def.builtin] ?? []).length > 0 && (
            <div className="knobs">
              {(BUILTIN_PARAMS[def.builtin] ?? []).map((spec) => (
                <Knob
                  key={spec.name}
                  param={lookParam(spec)}
                  value={def.params?.[spec.name] ?? spec.value}
                  onChange={(v) => setDef({ params: { ...def.params, [spec.name]: v } })}
                  name={spec.name}
                />
              ))}
              <p className="cap flat">
                energy still moves underneath these. This is where it starts from, everywhere
                the look is used.
              </p>
            </div>
          )}

          {def?.circuit && (
            <div className="drawers">
              <span className="cap mine">my track</span>
              {SIGNAL_NAMES.map((name) => (
                <Button
                  key={name}
                  tone="quiet"
                  className="round"
                  title={`${DRAWER[name]} — travels with the look`}
                  onPress={() => setCircuit(dropNode(def.circuit!, 'signal', name))}
                >
                  {name === 'level' ? 'meter' : name}
                </Button>
              ))}
              {show.layers.length > 0 && (
                <>
                  <span className="cap named">a named track</span>
                  {[...show.layers.map((l) => l.name), 'master'].map((name) => (
                    <Button
                      key={name}
                      tone="quiet"
                      className="square"
                      title={`${name} meter — absolute, breaks if the look moves`}
                      onPress={() => setCircuit(dropNode(def.circuit!, 'track', name))}
                    >
                      {name}
                    </Button>
                  ))}
                </>
              )}
              <span className="gap" />
              <span className="cap flat">rounded travels · squared names something and stays put</span>
            </div>
          )}

          {def?.circuit ? (
            <NodePictures
              def={def}
              transport={transport}
              energy={energy}
              level={drive === 'hold' ? held : undefined}
            >
              {(picture) => (
                <CircuitEditor
                  circuit={def.circuit!}
                  onChange={setCircuit}
                  tracks={[...show.layers.map((l) => l.name), 'master']}
                  picture={picture}
                />
              )}
            </NodePictures>
          ) : (
            def && (
              <p className="cap flat pad">
                {def.name} is one of the built-ins — handwritten GLSL rather than a canvas.
                They are what a rig draws before anyone has wired anything. Make a look to
                build one out of nodes.
              </p>
            )
          )}
        </div>

        <aside className="bench">
          <h4>the picture</h4>
          <Preview
            stack={passes}
            energy={energy}
            color={0xffb347}
            pace={scheme.defaults.pace}
            quantum={transport.quantum}
            clock={transport}
            meters={(name) =>
              name === 'master' ? show.master : (show.layers.find((l) => l.name === name)?.level ?? 0)
            }
            onError={setError}
          />
          {error && <p className="bad">{error}</p>}

          <h4>the stack, bottom first</h4>
          {passes.length === 0 && <p className="cap flat">nothing in it — pick a look</p>}
          <ul className="stack">
            {passes.map((pass, i) => (
              <li key={pass.id} data-on={pass.id === id ? '' : undefined}>
                <span className="who">{pass.def.name || pass.id}</span>
                {i === 0 ? (
                  <span className="cap">base</span>
                ) : (
                  <Slider
                    param={AMOUNT}
                    value={PERCENT.to(pass.amount)}
                    onChange={(v) =>
                      setAmounts((was) => ({ ...was, [pass.id]: PERCENT.from(v) }))
                    }
                    orientation="horizontal"
                    label={`${pass.def.name} amount`}
                  />
                )}
                <Button
                  tone="quiet"
                  label={`Take ${pass.def.name} out of the stack`}
                  onPress={() => setStack((was) => was.filter((each) => each !== pass.id))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>

          <h4>what is driving it</h4>
          <div className="drive">
            <Knob
              param={ENERGY}
              value={PERCENT.to(energy)}
              onChange={(v) => setEnergy(PERCENT.from(v))}
              name="energy"
            />
            <div className="lane">
              <Segmented
                items={['pulse', 'hold']}
                index={drive === 'pulse' ? 0 : 1}
                onChange={(i) => setDrive(i === 0 ? 'pulse' : 'hold')}
                name="meter"
              />
              {drive === 'hold' ? (
                <Slider
                  param={ENERGY}
                  value={PERCENT.to(held)}
                  onChange={(v) => setHeld(PERCENT.from(v))}
                  orientation="horizontal"
                  label="Held meter"
                />
              ) : (
                <DriveMeter transport={transport} />
              )}
            </div>
          </div>
          <p className="cap flat">
            a hand-driven signal can be a slider, because you can see where you put it. A
            generated one cannot, which is what the meter is for.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** The library, split by what a look does rather than by how it was made. */
function Library({
  scheme,
  list,
  editing,
  stack,
  onEdit,
  onStack,
}: {
  scheme: Scheme;
  list: { id: string; def: LookDef }[];
  editing: string | null;
  stack: string[];
  onEdit(id: string): void;
  onStack(id: string): void;
}) {
  const bases = list.filter((each) => isGenerator(scheme, each.id));
  const overs = list.filter((each) => !isGenerator(scheme, each.id));
  const group = (title: string, note: string, entries: typeof list) => (
    <div className="group">
      <h5>
        {title} <em>{note}</em>
      </h5>
      {entries.map((each) => (
        <div key={each.id} className="entry" data-on={each.id === editing ? '' : undefined}>
          <button type="button" className="pick" onClick={() => onEdit(each.id)}>
            {each.def.name || each.id}
            {each.def.circuit && <i title="built out of nodes">◇</i>}
          </button>
          <Button
            tone="quiet"
            label={`${stack.includes(each.id) ? 'Take out of' : 'Put in'} the stack`}
            title={stack.includes(each.id) ? 'in the stack' : 'add to the stack'}
            onPress={() => onStack(each.id)}
          >
            {stack.includes(each.id) ? '−' : '+'}
          </Button>
        </div>
      ))}
    </div>
  );
  return (
    <div className="looks">
      {group('bases', 'draw their own picture', bases)}
      {group('over the top', 'work on what is under them', overs)}
    </div>
  );
}

/**
 * What the beat envelope is doing, at a rate a person can read.
 *
 * Its own component because it re-renders on a timer, and the canvas beside it
 * must not. Twenty a second is far below the frame rate and far above what the
 * eye needs to see a pulse — the picture is the accurate readout, this is the
 * one you can put a number on.
 */
function DriveMeter({ transport }: { transport: Transport }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const beat = transport.beat();
      setLevel(0.25 + 0.75 * (1 - (beat % 1)) ** 3);
    }, 50);
    return () => window.clearInterval(timer);
  }, [transport]);
  return <Meter value={level} name="level" />;
}

/** What each relative signal means, for the drawer's tooltips. */
const DRAWER: Record<string, string> = {
  level: "this layer's own meter",
  energy: "the section's energy",
  beat: 'continuous beats',
  phase: 'position in the bar',
  pulse: 'one on the beat, decaying',
  time: 'seconds — for drift that should not be in time',
  amount: 'how far this look is dialled in',
  random: 'a new number each beat',
};

/** Drop a node somewhere free-ish. A layout algorithm would fight the hand. */
function dropNode(circuit: Circuit, kind: 'signal' | 'track', op: string): Circuit {
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
