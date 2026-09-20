import { useEffect, useMemo, useRef, useState } from 'react';
import { paletteOf, type Circuit, type Scheme } from '../../protocol.ts';
import { createNumberEvaluator } from '../../client/render/evaluateNumber.ts';
import { readingsOf, sameDisplayedReadings } from '../../client/ui/Designer.tsx';
import { CircuitEditor, type NumberReading } from '../../client/ui/Circuit.tsx';
import { NodePictures } from '../../client/ui/NodePictures.tsx';
import { Bench } from '../../client/ui/Preview.tsx';
import { packColor } from '../../client/state/useRoom.ts';
import type { Clock } from '../../client/state/useShow.ts';
import { SCHEME, SHOW } from '../fixtures.ts';
import { FLOW } from './fixture.ts';
import './node-harness.css';

export interface GraphExample {
  title: string;
  description: string;
  circuit: Circuit;
  track?: boolean;
}

/** A story owns the example; this wrapper supplies the same editor and renderer as the console. */
export function NodeHarness({ example }: { example: GraphExample }) {
  const [generation, setGeneration] = useState(0);
  return <Session key={`${JSON.stringify(example)}/${generation}`} example={example} reset={() => setGeneration(n => n + 1)} />;
}

function Session({ example, reset }: { example: GraphExample; reset(): void }) {
  const [circuit, setCircuit] = useState(() => structuredClone(example.circuit));
  const [seconds, setSeconds] = useState(2);
  const [animated, setAnimated] = useState(false);
  const [tempo, setTempo] = useState(120);
  const [level, setLevel] = useState(0.7);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const transport = useRef({ seconds: 2, beat: 4, started: 0, animated: false, tempo: 120 });
  const clock = useMemo<Clock>(() => {
    const elapsed = () => transport.current.animated ? (performance.now() - transport.current.started) / 1000 : 0;
    return {
      seconds: () => transport.current.seconds + elapsed(),
      beat: () => transport.current.beat + elapsed() * transport.current.tempo / 60,
      advance: () => {},
    };
  }, []);
  const anchor = (running: boolean, bpm = tempo) => {
    const at = clock.seconds();
    transport.current = { seconds: at, beat: clock.beat(), started: performance.now(), animated: running, tempo: bpm };
    setSeconds(at);
  };
  const show = useMemo(() => ({
    ...SHOW.resting, connected: true, playing, master: 0.5, tempo, colorway: 'dawn',
    colors: paletteOf(SCHEME.colorways.dawn).map(packColor),
    // A local fixture marked connected prevents the renderer replacing it with its own stand-ins.
    // This is data only: no connection hooks or clients are mounted by the harness.
    tracks: [{ t: 0, name: 'Drums', color: 0xffb347, opacity: 1, level: playing ? level : 0,
      playing: playing ? 0 : -1, clipName: 'Story meter' }],
  }), [tempo, level, playing]);
  const scheme = useMemo<Scheme>(() => ({ ...SCHEME, flows: {
    [FLOW]: { name: example.title, circuit },
  } }), [circuit, example.title]);

  const [numberReadings, setNumberReadings] = useState<Readonly<Record<string, NumberReading>>>({});
  const current = useRef({ circuit, show });
  current.current = { circuit, show };
  useEffect(() => {
    const evaluator = createNumberEvaluator();
    let last = clock.seconds();
    const latch = () => {
      const seconds = clock.seconds();
      const sample = evaluator.sample(current.current.circuit, {
        show: current.current.show, beat: clock.beat(), seconds,
        dt: Math.max(0, Math.min(seconds - last, 0.25)), pace: SCHEME.defaults.pace,
      });
      last = seconds;
      const next = readingsOf(current.current.circuit, sample);
      setNumberReadings(was => sameDisplayedReadings(was, next) ? was : next);
    };
    latch();
    const timer = window.setInterval(latch, 100);
    return () => window.clearInterval(timer);
  }, [clock]);

  return <section className="node-harness" aria-label="Node graph example">
    <header><h2>{example.title}</h2><p>{example.description}</p></header>
    <div className="node-harness-toolbar">
      <label>Seconds <input aria-label="Seconds" type="number" min="0" step="0.25" value={seconds} disabled={animated}
        onChange={e => {
          const value = e.target.valueAsNumber;
          if (!Number.isFinite(value)) return;
          const next = Math.max(0, value);
          transport.current = { ...transport.current, seconds: next, beat: next * tempo / 60 };
          setSeconds(next);
        }} /></label>
      <label>Tempo <input aria-label="Tempo" type="number" min="20" max="300" value={tempo} onChange={e => {
        const value = e.target.valueAsNumber;
        if (!Number.isFinite(value)) return;
        const next = Math.max(20, Math.min(300, value));
        anchor(animated, next); setTempo(next);
      }} /></label>
      <button onClick={() => { anchor(!animated); setAnimated(!animated); }}>{animated ? 'Freeze' : 'Animate'}</button>
      <button onClick={reset}>Reset example</button>
      <span>{animated ? 'Time is running.' : 'Time is frozen.'} Local simulation · no Ableton required</span>
      {example.track && <>
        <label>Drums level <input aria-label="Drums level" type="range" min="0" max="1" step="0.01" value={level}
          onChange={e => setLevel(Number(e.target.value))} /></label>
        <label><input type="checkbox" checked={playing} onChange={e => setPlaying(e.target.checked)} />Simulated playback</label>
      </>}
    </div>
    <div className="node-harness-body">
      <div className="node-harness-graph" aria-label="Example graph">
        <NodePictures circuit={circuit} show={show} scheme={scheme} transport={clock} transportDelta>
          {picture => <CircuitEditor circuit={circuit} onChange={setCircuit} tracks={['Drums']}
            energy={show.master} beat={clock.beat} picture={picture} numberReadings={numberReadings} />}
        </NodePictures>
      </div>
      <aside><h3>Graph output</h3><div className="node-harness-picture" data-testid="node-preview">
        <Bench show={show} scheme={scheme} flow={FLOW} clock={clock} onError={setError} transportDelta />
      </div><p>Move nodes, connect ports and change their controls. Pan the canvas or scroll to zoom. Reset restores this graph, its inputs and the frozen clock.</p>
      <p role={error ? 'alert' : 'status'}>{error ? `Renderer: ${error}` : 'Production renderer'}</p></aside>
    </div>
    <details><summary>Example circuit</summary><pre>{JSON.stringify(circuit, null, 2)}</pre></details>
  </section>;
}
