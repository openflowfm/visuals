import { useMemo, useRef, useState } from 'react';
import type { NodeKind, Scheme } from '../../protocol.ts';
import { inletsOf, NODE_SPECS } from '../../client/render/circuit.ts';
import { Bench } from '../../client/ui/Preview.tsx';
import type { Clock } from '../../client/state/useShow.ts';
import { SCHEME, SHOW } from '../fixtures.ts';
import { FLOW, HARNESS_KINDS, harnessFixture } from './fixture.ts';
import './node-harness.css';

/** Story args reset local edits as one unit, including the compositor's resources. */
export function NodeHarness({ kind = 'source', mode = 'plasma' }: { kind?: NodeKind; mode?: string }) {
  return <Session key={`${kind}/${mode}`} initialKind={kind} initialMode={mode} />;
}

function Session({ initialKind, initialMode }: { initialKind: NodeKind; initialMode: string }) {
  const [kind, setKind] = useState(initialKind);
  const [mode, setMode] = useState(initialMode);
  const [outlet, setOutlet] = useState<string>();
  const [values, setValues] = useState<Record<string, number>>({});
  const [seconds, setSeconds] = useState(2);
  const [animated, setAnimated] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const transport = useRef({ seconds: 2, started: 0, animated: false });
  const clock = useMemo<Clock>(() => {
    const seconds = () => transport.current.seconds + (transport.current.animated
      ? (performance.now() - transport.current.started) / 1000 : 0);
    return { seconds, beat: () => seconds() * 2, advance: () => {} };
  }, []);
  const seek = (value: number) => {
    transport.current = { seconds: value, started: performance.now(), animated };
    setSeconds(value);
  };
  const restart = () => { setError(null); setGeneration((n) => n + 1); };
  const fixture = useMemo(() => harnessFixture(kind, mode, values, outlet), [kind, mode, values, outlet]);
  const scheme = useMemo<Scheme>(() => ({ ...SCHEME, flows: fixture ? {
    [FLOW]: { name: `${kind} · ${fixture.node.op ?? 'default'}`, circuit: fixture.circuit },
  } : {} as Scheme['flows'] }), [fixture, kind]);
  const spec = NODE_SPECS[kind];
  const numeric = fixture ? inletsOf(fixture.node).filter((port) => port.kind === 'n' && port.control !== 'modes') : [];
  const signal = spec.outlets.find((port) => port.name === fixture?.node.previewOutlet)?.kind;

  return <section className="node-harness" aria-label="Node development harness">
    <h2>Node / shader harness</h2>
    <p>Production renderer, seeded palette, 120 BPM. Colour inputs use checker / plasma fixtures; point inputs use the frame position. No server or Link.</p>
    <div className="node-harness-toolbar">
      <label>Node <select aria-label="Node" value={kind} onChange={(e) => {
        setKind(e.target.value as NodeKind); setMode(''); setOutlet(undefined); setValues({}); restart();
      }}>
        {!HARNESS_KINDS.includes(kind) && <option value={kind}>{kind} (unsupported)</option>}
        {HARNESS_KINDS.map((kind) => <option key={kind}>{kind}</option>)}
      </select></label>
      {!!spec.modes?.length && <label>Mode <select aria-label="Mode" value={fixture?.node.op ?? mode} onChange={(e) => {
        setMode(e.target.value); setValues({}); restart();
      }}>{spec.modes.map((mode) => <option key={mode.name}>{mode.name}</option>)}</select></label>}
      {!!spec.outlets.length && <label>Outlet <select aria-label="Outlet" value={fixture?.node.previewOutlet ?? ''} onChange={(e) => { setOutlet(e.target.value); restart(); }}>
        {spec.outlets.map((port) => <option key={port.name} value={port.name}>{port.name} ({port.kind})</option>)}
      </select></label>}
      <label>Seconds <input aria-label="Seconds" type="number" min="0" step="0.25" value={seconds} disabled={animated}
        onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) seek(Math.max(0, e.target.valueAsNumber)); }} /></label>
      <button onClick={() => {
        const next = !animated;
        const at = clock.seconds();
        transport.current = { seconds: at, started: performance.now(), animated: next };
        setSeconds(at); setAnimated(next);
      }}>{animated ? 'Freeze' : 'Animate'}</button>
      <button onClick={() => {
        transport.current = { seconds: 2, started: 0, animated: false };
        setSeconds(2); setAnimated(false); setValues({}); restart();
      }}>Reset</button>
    </div>
    <p>{spec.description} {spec.modes?.find((each) => each.name === fixture?.node.op)?.description}</p>
    {!fixture ? <p role="status">No isolated fixture for {kind}. Asset, Live, flow-interface and history nodes need dedicated fixtures before they can run here.</p> : <>
      <p>{signal === 'n' ? 'Number outlet: visualized through colorway brightness.' : signal === 'p' ? 'Point outlet: visualized by sampling plasma.' : 'Colour outlet: rendered directly.'} {animated ? 'Time is running.' : 'Time is frozen.'}</p>
      <div className="node-harness-body">
        <div className="node-harness-picture" data-testid="node-preview">
          <Bench key={generation} show={{ ...SHOW.resting, master: 0.5, tempo: 120, colorway: 'dawn' }}
            scheme={scheme} flow={FLOW} clock={clock} onError={setError} />
        </div>
        <div className="node-harness-controls">
          {numeric.map((port) => <label key={port.name} title={port.description}>
            <span>{port.label ?? port.name}</span>
            <input aria-label={port.name} type="range" min="0" max="1" step={port.control === 'toggle' ? '1' : '0.01'}
              value={values[port.name] ?? port.at ?? 0.5}
              onChange={(e) => setValues((held) => ({ ...held, [port.name]: Number(e.target.value) }))} />
            <output>{values[port.name] !== undefined ? values[port.name].toFixed(2) : port.at !== undefined ? `${port.at} (default)` : 'live fallback'}</output>
            <button disabled={values[port.name] === undefined} aria-label={`Reset ${port.name}`} onClick={() => setValues((held) => {
              const next = { ...held }; delete next[port.name]; return next;
            })}>↺</button>
          </label>)}
          {!numeric.length && <p>No numeric inlets for this node.</p>}
        </div>
      </div>
      <p role={error ? 'alert' : 'status'}>{error ? `Renderer: ${error}` : 'Compiler / renderer errors appear here.'}</p>
      <details><summary>Fixture circuit</summary><pre>{JSON.stringify(fixture.circuit, null, 2)}</pre></details>
    </>}
  </section>;
}
