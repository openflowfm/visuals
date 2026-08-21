import { useMemo, useState } from 'react';
import type { Circuit, Scheme, Show } from '../../protocol.ts';
import { wouldLoop } from '../../protocol.ts';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { NumberField } from '../../../widgets/src/controls/NumberField.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Toggle } from '../../../widgets/src/controls/Toggle.tsx';
import { CircuitEditor } from './Circuit.tsx';
import { addLook, dropLook, forkLook, lookList, renameLook, setCircuit } from './edits.ts';
import { drop, matching, palette, type Entry, type Pick } from './nodes.ts';
import { NodePictures } from './NodePictures.tsx';
import { FloatingBench } from './Preview.tsx';
import { BPM, ENERGY, PERCENT } from './param.ts';
import { KEYS, useRoom, type Room } from '../state/useRoom.ts';
import { useTransport, type Transport } from '../state/useTransport.ts';
import type { Clock } from '../state/useShow.ts';
import './circuit.css';
import './console.css';

/**
 * The look builder, which is the whole product.
 *
 * Everything else this app does is arrangements of what gets made here. There
 * used to be three views and a four-level cascade above them, and all of it
 * existed to answer one question — how two pictures combine — which a graph
 * answers by being a graph. So the console is this, and a small page for the
 * wheel that turns through what you built.
 *
 * ## Two browsers, and the second one is the change
 *
 * The left side is **looks** and **nodes**, and the nodes browser is what makes
 * the vocabulary reachable. A canvas whose only way to add anything is a
 * dropdown of nineteen node kinds — two of which secretly contain another
 * twenty-three between them — is a canvas where nobody finds `sparks`. So it is
 * a device browser: the **node** is the row, its **presets** open under it, and
 * the search box reaches either. `track` and `look` are the exception and stay
 * flat, because those name a track in the set and a look in the library rather
 * than a way of being a node. See [`nodes.ts`](./nodes.ts).
 *
 * ## The picture floats, and there is no third column
 *
 * The bench used to be a fixed column on the right, which spent the widest part
 * of the screen on the thing you look at least and gave the thing you are
 * actually judging 236 pixels. It is a panel over the canvas now — drag it by
 * its header, stretch it by its corner, park it where the graph is empty. See
 * [`Preview.tsx`](./Preview.tsx).
 *
 * ## It runs on its own room
 *
 * Everything here used to read Link through the show, which is right on stage
 * and exactly wrong at a desk: it made *Ableton running* a precondition for
 * drawing a picture. That argument did not stop at the clock, and neither does
 * this — tempo, energy, section, colourway and key are all conditions a look
 * behaves differently under, and all of them are now dialled rather than waited
 * for. [`useRoom`](../state/useRoom.ts) hands back the `Show` that comes out.
 * **Follow the room** turns the lot off and reads the real one; following is
 * the option, not the fallback.
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
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<string | null>(null);
  /**
   * Which nodes have their presets open, by kind.
   *
   * Kept here rather than in the browser so that typing in the search box and
   * clearing it again leaves the drawers as they were — a list that reshuffled
   * itself shut every time you looked something up would be a list you stop
   * opening.
   */
  const [opened, setOpened] = useState<readonly string[]>([]);

  const canFollow = show.clock && show.connected;
  const transport = useTransport(clock, canFollow);
  const room = useRoom(show, scheme, transport);

  const id = look && scheme.looks[look] ? look : (list[0]?.id ?? null);
  const def = id ? scheme.looks[id] : null;

  const trackNames = useMemo(
    () => [...show.tracks.map((t) => t.name), 'master'],
    [show.tracks],
  );
  const all = useMemo(() => palette(scheme, trackNames), [scheme, trackNames]);
  const found = useMemo(() => matching(all, typed), [all, typed]);

  const wire = (next: Circuit) => {
    if (!id) return;
    save(setCircuit(scheme, id, next));
  };

  /**
   * Which node the bench is showing, resolved rather than remembered.
   *
   * Deriving it from the graph every render is what makes switching looks and
   * deleting nodes need no handling at all: an id the open look does not contain
   * simply is not promoted, so the panel falls back to the whole look instead of
   * going blank on a node that no longer exists.
   */
  const probing = def?.circuit.nodes.find((node) => node.id === promoted) ?? null;

  /**
   * `out`'s picture *is* the finished look, so promoting it means clearing.
   *
   * `probeAt` says the same thing by returning the circuit unchanged. Reading it
   * as a node preview would put "one node" over a picture of the whole look,
   * which is the one caption this panel must never show.
   */
  const promote = (nodeId: string) => {
    const node = def?.circuit.nodes.find((each) => each.id === nodeId);
    setPromoted(!node || node.kind === 'out' || nodeId === promoted ? null : nodeId);
  };

  /**
   * A look node is refused before it is dropped, not when it fails to compile.
   *
   * At compile time the honest message is "one of these seven looks contains
   * itself", which nobody can act on. At the moment of dropping, the message is
   * about the thing you just clicked.
   */
  const add = (pick: Pick) => {
    if (!def || !id) return;
    if (pick.kind === 'look' && pick.op && wouldLoop(scheme.looks, id, pick.op)) {
      setError(`${pick.label} already contains ${def.name} — a look cannot hold itself`);
      return;
    }
    setError(null);
    wire(drop(def.circuit, pick));
  };

  return (
    <div className="designer wdg">
      <TheRoom room={room} transport={transport} canFollow={canFollow} />

      <div className="body">
        <aside className="library">
          <h4>looks</h4>
          <div className="looks">
            {list.map((each) => (
              <div key={each.id} className="entry" data-on={each.id === id ? '' : undefined}>
                <button type="button" className="pick" onClick={() => setLook(each.id)}>
                  {each.def.name || each.id}
                  {each.def.rolled && <i title="wired by a roll — the next roll replaces it">◇</i>}
                </button>
              </div>
            ))}
          </div>
          <div className="acts">
            <Button
              onPress={() => {
                const made = addLook(scheme);
                save(made.scheme);
                setLook(made.id);
              }}
            >
              + look
            </Button>
            {id && (
              <Button
                title="A copy, to take apart without losing this one"
                onPress={() => {
                  const made = forkLook(scheme, id);
                  save(made.scheme);
                  setLook(made.id);
                }}
              >
                fork
              </Button>
            )}
            {id && list.length > 1 && (
              <Button
                tone="danger"
                onPress={() => {
                  save(dropLook(scheme, id));
                  setLook(null);
                }}
              >
                delete
              </Button>
            )}
          </div>

          <h4>nodes</h4>
          <input
            className="field find"
            value={typed}
            spellCheck={false}
            placeholder="find a node"
            aria-label="Find a node"
            onChange={(e) => setTyped(e.target.value)}
          />
          <NodeBrowser
            entries={found}
            // Everything a search turned up is drawn open, because a preset
            // found behind a closed drawer has not been found.
            opened={typed.trim() ? null : opened}
            onOpen={(kind) =>
              setOpened((was) =>
                was.includes(kind) ? was.filter((each) => each !== kind) : [...was, kind],
              )
            }
            onAdd={add}
          />
        </aside>

        <div className="canvas-wrap">
          {def && id && (
            <div className="naming">
              <input
                className="field"
                value={def.name}
                spellCheck={false}
                aria-label="Look name"
                onChange={(e) => save(renameLook(scheme, id, e.target.value))}
              />
              <span className="cap">{describe(scheme, id)}</span>
              <Uses scheme={scheme} show={show} id={id} />
              <span className="gap" />
              {error && <span className="bad">{error}</span>}
            </div>
          )}

          {def && (
            <NodePictures
              circuit={def.circuit}
              looks={scheme.looks}
              transport={transport}
              energy={room.show.master}
            >
              {(picture) => (
                <CircuitEditor
                  circuit={def.circuit}
                  onChange={wire}
                  tracks={trackNames}
                  looks={list}
                  // The picture stays a picture and the click is wrapped round
                  // it, because which node is promoted is a fact about *this*
                  // page rather than about drawing a node. `NodePictures` hands
                  // its faces over through a child function precisely so the
                  // page can put something round them.
                  picture={(nodeId) => (
                    <button
                      type="button"
                      className="promote"
                      data-on={nodeId === promoted ? '' : undefined}
                      aria-pressed={nodeId === promoted}
                      title="Show this node in the picture"
                      onClick={() => promote(nodeId)}
                    >
                      {picture(nodeId)}
                    </button>
                  )}
                />
              )}
            </NodePictures>
          )}

          {id && (
            <FloatingBench
              show={room.show}
              scheme={scheme}
              look={id}
              clock={transport}
              onError={setError}
              aside={room.following ? 'from the room' : 'from the desk'}
              probing={probing}
              onProbe={setPromoted}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Every condition a look behaves differently under, in one group.
 *
 * The energy knob arrived on its own and made the case for the rest: if you can
 * dial the room's energy without a band in it, there is no reason to wait for a
 * rehearsal to reach a chorus, or for the wheel to land on the third colourway,
 * or for the one song in F# minor. Each of those is a `song` or `paint` node
 * reading a number, and each was previously unreachable at a desk.
 *
 * Grouped rather than scattered because they are one idea — *pretend it is like
 * this* — and because the switch that turns them off has to be visibly attached
 * to all of them. `follow the room` is that switch, and it is the transport's
 * own `following` widened from the clock to everything beside it; the reasoning
 * for one switch rather than six is in [`useRoom`](../state/useRoom.ts).
 */
function TheRoom({
  room,
  transport,
  canFollow,
}: {
  room: Room;
  transport: Transport;
  canFollow: boolean;
}) {
  const following = room.following;
  return (
    <div className="bar room">
      <span className="cap">the room</span>
      <Toggle
        on={transport.playing}
        onChange={transport.setPlaying}
        disabled={following}
        width={46}
      >
        {transport.playing ? 'playing' : 'stopped'}
      </Toggle>
      <NumberField
        param={BPM}
        value={transport.bpm}
        onChange={transport.setBpm}
        name="bpm"
        disabled={following}
      />
      <Button onPress={transport.restart} disabled={following}>
        to the top
      </Button>
      <Knob
        param={ENERGY}
        value={PERCENT.to(room.energy)}
        onChange={(v) => room.setEnergy(PERCENT.from(v))}
        name="energy"
        disabled={following}
      />
      <Select
        items={room.sections}
        index={Math.max(0, room.sections.indexOf(room.section))}
        onChange={(at) => room.setSection(room.sections[at])}
        name="section"
        width={104}
        disabled={following || room.sections.length === 0}
        title="What a `song section` node reports"
      />
      <Select
        items={room.colorways}
        index={Math.max(0, room.colorways.indexOf(room.colorway))}
        onChange={(at) => room.setColorway(room.colorways[at])}
        name="colourway"
        width={110}
        disabled={following || room.colorways.length === 0}
        title="What `paint` and the set's own tracks draw from"
      />
      <Select
        items={KEYS}
        index={room.keyAt}
        onChange={room.setKeyAt}
        name="key"
        width={58}
        disabled={following}
        title="What a `song key` node reports"
      />
      <span className="gap" />
      <Toggle
        on={following}
        onChange={transport.setFollowing}
        disabled={!canFollow}
        width={96}
        title={
          canFollow
            ? 'Draw the real show instead — its beat, its energy, its section, its colourway and its key'
            : 'Nothing to follow — no bridge is connected'
        }
      >
        follow the room
      </Toggle>
      <span className="cap">{following ? 'the real show' : 'made up · no set needed'}</span>
    </div>
  );
}

/**
 * The vocabulary, grouped and searchable — a device browser, not a list of modes.
 *
 * Grouped by family rather than by node kind, and the families are declared in
 * `protocol.ts` rather than here — two editors listing these differently would
 * be two different vocabularies, and the one thing a browser must not do is
 * disagree with the compiler about what exists.
 *
 * A row is a node. Its chip drops a default one; the count beside it opens its
 * presets, each of which drops that node already configured. A row with nothing
 * under it — `hue`, a track's meter, a look — is just the chip, which is what
 * makes a target and a preset read differently without either being labelled.
 */
function NodeBrowser({
  entries,
  opened,
  onOpen,
  onAdd,
}: {
  entries: readonly Entry[];
  /** Which kinds are open, or null for "everything shown is open". */
  opened: readonly string[] | null;
  onOpen(kind: string): void;
  onAdd(pick: Pick): void;
}) {
  const families = [...new Set(entries.map((each) => each.node.family))];
  return (
    <div className="palette">
      {entries.length === 0 && <p className="cap flat">nothing by that name</p>}
      {families.map((family) => (
        <div key={family} className="group">
          <h5>{family}</h5>
          {entries
            .filter((each) => each.node.family === family)
            .map((entry) => {
              const on = opened === null || opened.includes(entry.node.kind);
              return (
                <div
                  key={`${entry.node.kind}:${entry.node.op ?? ''}`}
                  className="node-entry"
                  // Open, it takes the width and its presets sit under it.
                  // Closed, it flows into the row with its neighbours — which
                  // is what keeps a column 214px wide readable with a hundred
                  // rows in it.
                  data-open={on && entry.presets.length > 0 ? '' : undefined}
                >
                  <div className="chips">
                    <button
                      type="button"
                      className="chip"
                      data-kind={entry.node.kind}
                      title={entry.node.about}
                      onClick={() => onAdd(entry.node)}
                    >
                      {entry.node.label}
                    </button>
                    {entry.presets.length > 0 && (
                      <Button
                        tone="quiet"
                        className="more"
                        label={`${on ? 'Hide' : 'Show'} the presets of ${entry.node.label}`}
                        title={`${entry.presets.length} presets`}
                        onPress={() => onOpen(entry.node.kind)}
                      >
                        {on ? '–' : `+${entry.presets.length}`}
                      </Button>
                    )}
                  </div>
                  {on && entry.presets.length > 0 && (
                    <div className="chips under">
                      {entry.presets.map((preset) => (
                        <button
                          key={preset.op}
                          type="button"
                          className="chip"
                          data-kind={preset.kind}
                          title={preset.about}
                          onClick={() => onAdd(preset)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/**
 * Where this look is reachable from, which is the question the designer used to
 * have no answer to.
 *
 * Deliberately not an editor. The wheel and the song pins live on the set page,
 * and putting a second way to change them here would mean two places that could
 * disagree. What this answers is "if I make this good, will anyone see it" —
 * and the honest answer is usually yes, because an empty pool means everything.
 *
 * One line beside the look's name rather than a pane of its own. It was a list
 * in the bench's sidebar, which is a lot of furniture for a sentence you read
 * once a session — and the sidebar it was in was costing the picture the width
 * it wanted.
 */
function Uses({ scheme, show, id }: { scheme: Scheme; show: Show; id: string | null }) {
  if (!id) return null;
  const pool = scheme.rotation.looks;
  const turning = pool.length === 0 || pool.includes(id);
  const pinned = Object.entries(scheme.songs).filter(([, spec]) => spec.looks?.includes(id));
  const inside = Object.entries(scheme.looks).filter(
    ([other, def]) => other !== id && def.circuit.nodes.some((n) => n.kind === 'look' && n.op === id),
  );
  const parts = [
    turning
      ? pool.length === 0
        ? 'in the wheel — nothing narrowed'
        : 'in the wheel'
      : 'not in the wheel',
    pinned.length > 0
      ? `pinned by ${pinned.length} song${pinned.length === 1 ? '' : 's'}`
      : null,
    inside.length > 0 ? `inside ${inside.map(([, def]) => def.name).join(', ')}` : null,
  ].filter(Boolean);
  return (
    <span className="cap uses">
      {parts.join(' · ')}
      {show.look === id && <em>on screen now</em>}
    </span>
  );
}

/** One line about what a look is made of, which is more useful than its id. */
function describe(scheme: Scheme, id: string): string {
  const circuit = scheme.looks[id]?.circuit;
  if (!circuit) return '';
  const nodes = circuit.nodes.length;
  const set = circuit.nodes.some((n) => n.kind === 'tracks');
  const nested = circuit.nodes.filter((n) => n.kind === 'look').length;
  return [
    `${nodes} node${nodes === 1 ? '' : 's'}`,
    set ? 'reads the set' : 'ignores the set',
    nested > 0 ? `${nested} look${nested === 1 ? '' : 's'} inside` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
