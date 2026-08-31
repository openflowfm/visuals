import { useEffect, useMemo, useState } from 'react';
import type {
  CalibrationState,
  CalibrationSubmission,
  CalibrationTrialSummary,
  LabRoom,
} from '../../protocol.ts';
import {
  CALIBRATION_FLOW,
  calibrationProblems,
  calibrationScheme,
} from '../../calibration.ts';
import {
  CALIBRATION_BASELINE_RESPONSES,
  formatResponse,
  responseKey,
  scaleResponse,
  type ResponseOverrides,
} from '../../response.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Clock } from '../state/useShow.ts';
import { useTransport } from '../state/useTransport.ts';
import { Bench } from './Preview.tsx';
import { stagedShow } from './stage.ts';

const letter = (at: number) => String.fromCharCode('A'.charCodeAt(0) + at);

/**
 * Development-only response calibration. It is not a fifth product view: the
 * server never advertises it unless OPENFLOW_CALIBRATION=1, and the console
 * cannot navigate here without that advertisement.
 */
export function CalibrationView({
  state,
  open,
  decide,
  clock,
}: {
  state: CalibrationState | null;
  open(trialId?: string, trialVersion?: number): void;
  decide(submission: CalibrationSubmission): void;
  clock: Clock;
}) {
  const trial = state?.trial ?? null;
  const [at, setAt] = useState(0);
  const [value, setValue] = useState(0.5);
  const [extent, setExtent] = useState(1);
  const [energy, setEnergy] = useState(0.32);
  const [sweeping, setSweeping] = useState(false);
  const [note, setNote] = useState('');
  const [benchError, setBenchError] = useState<string | null>(null);
  const transport = useTransport(clock, false);

  useEffect(() => open(), [open]);

  const trialKey = trial ? `${trial.id}@${trial.version}` : '';
  const decision = state?.decision ?? null;
  useEffect(() => {
    if (!trial) return;
    const decidedAt = decision?.selectedOptionId
      ? trial.options.findIndex((candidate) => candidate.id === decision.selectedOptionId)
      : -1;
    setAt(decidedAt >= 0 ? decidedAt : 0);
    setValue(trial.initialValue);
    setExtent(decision?.extent ?? 1);
    setEnergy(decision?.room.energy ?? trial.room.energy);
    setSweeping(false);
    setNote(decision?.note ?? '');
    setBenchError(null);
    transport.setBpm(trial.room.tempo);
    transport.restart();
  }, [trialKey, decision?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sweeping) return;
    let raf = 0;
    const began = performance.now();
    const sweep = (stamp: number) => {
      raf = requestAnimationFrame(sweep);
      // Eight seconds there and back: slow enough to see where the curve starts
      // moving rather than merely seeing that its edge can move quickly.
      setValue(0.5 + Math.sin(((stamp - began) / 8000) * Math.PI * 2) * 0.49);
    };
    raf = requestAnimationFrame(sweep);
    return () => cancelAnimationFrame(raf);
  }, [sweeping, trialKey]);

  const option = trial?.options[at] ?? null;
  const adjusted = option ? scaleResponse(option.response, extent) : null;
  const room: LabRoom | null = trial ? { ...trial.room, energy } : null;
  const scheme = useMemo(
    () => (trial ? calibrationScheme(trial, value) : null),
    [trial, value],
  );
  const show = useMemo(
    () => (trial && room ? stagedShow(room, `calibration:${trial.id}`) : null),
    [trial, room],
  );
  const responses = useMemo((): ResponseOverrides | undefined => {
    if (!trial || !adjusted) return undefined;
    return {
      ...CALIBRATION_BASELINE_RESPONSES,
      [responseKey(trial.target)]: adjusted,
    };
  }, [trial, adjusted]);

  const submit = (selected: boolean) => {
    if (!trial || !option || !room) return;
    const submission: CalibrationSubmission = {
      trialId: trial.id,
      trialVersion: trial.version,
      room,
      selectedOptionId: selected ? option.id : null,
      response: selected ? adjusted : null,
      extent,
      note: note.trim() || undefined,
    };
    if (calibrationProblems(submission).length === 0) decide(submission);
  };

  if (!state) {
    return (
      <div className="calibration calibration-empty">
        <p>opening the calibration bench…</p>
      </div>
    );
  }

  if (!trial || !scheme || !show || !room || !option || !adjusted) {
    return (
      <div className="calibration calibration-done">
        <div>
          <h2>{state.notice ?? 'This calibration batch is complete.'}</h2>
          <p>
            {state.decided} of {state.total} decisions are stored. Export the frozen trials and
            judgments for review before changing production responses.
          </p>
          <a className="calibration-export" href="/calibration/export">
            export calibration-results.jsonl
          </a>
        </div>
        <History state={state} />
      </div>
    );
  }

  const problems = calibrationProblems({
    trialId: trial.id,
    trialVersion: trial.version,
    room,
    selectedOptionId: null,
    response: null,
    extent,
    note: note.trim() || undefined,
  });
  const position = state.trials.findIndex(
    (candidate) => candidate.id === trial.id && candidate.version === trial.version,
  );

  return (
    <div className="calibration">
      <div className="calibration-stage">
        <div className="train-frame">
          <Bench
            show={show}
            scheme={scheme}
            flow={CALIBRATION_FLOW}
            clock={transport}
            responses={responses}
            onError={setBenchError}
          />
        </div>
        <div className="train-under">
          <span className="train-name">{trial.name}</span>
          <span className="train-provenance">
            {trial.batch} · {trial.id}@{trial.version}
          </span>
          {benchError && <span className="train-error">{benchError}</span>}
        </div>
        <div className="calibration-transport wdg">
          <Button
            tone="quiet"
            label={transport.playing ? 'Hold the clock' : 'Run the clock'}
            onPress={() => transport.setPlaying(!transport.playing)}
          >
            {transport.playing ? '■' : '▶'}
          </Button>
          <Button tone="quiet" label="Back to the top of the bar" onPress={transport.restart}>
            ↺
          </Button>
          <span className="calibration-caption">energy</span>
          {[0, trial.room.energy, 0.8].map((level, index) => (
            <button
              key={`${level}-${index}`}
              type="button"
              data-on={energy === level ? '' : undefined}
              onClick={() => setEnergy(level)}
            >
              {index === 0 ? 'zero' : index === 1 ? 'room' : 'high'}
            </button>
          ))}
        </div>
      </div>

      <aside className="calibration-controls wdg">
        <header>
          <span>
            {position + 1} / {state.total} · {state.decided} done
          </span>
          <a href="/calibration/export">export</a>
        </header>
        <TrialPicker state={state} open={open} />
        <h2>{trial.name}</h2>
        {decision && <p className="calibration-decided">calibrated · changes append a revision</p>}
        <p className="calibration-question">{trial.question}</p>

        <section>
          <h3>response</h3>
          <div className="calibration-options" role="radiogroup" aria-label="Response candidate">
            {trial.options.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={at === index}
                data-on={at === index ? '' : undefined}
                onClick={() => setAt(index)}
              >
                {letter(index)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>parameter</h3>
          <div className="calibration-reading">
            <b>{Math.round(value * 100)}%</b>
            <span>{formatResponse(adjusted, value)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={value}
            onChange={(event) => {
              setSweeping(false);
              setValue(Number(event.currentTarget.value));
            }}
            aria-label="Normalized parameter value"
          />
          <div className="calibration-small-verbs">
            <button type="button" onClick={() => { setSweeping(false); setValue(0.5); }}>
              centre
            </button>
            <button type="button" data-on={sweeping ? '' : undefined} onClick={() => setSweeping(!sweeping)}>
              {sweeping ? 'stop sweep' : 'sweep'}
            </button>
          </div>
        </section>

        <section>
          <h3>maximum reach</h3>
          <div className="calibration-reading">
            <b>{Math.round(extent * 100)}%</b>
            <span>same cap for A, B, and C</span>
          </div>
          <input
            type="range"
            min={0.05}
            max={1.5}
            step={0.01}
            value={extent}
            onChange={(event) => setExtent(Number(event.currentTarget.value))}
            aria-label="Maximum reach"
          />
        </section>

        <textarea
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          placeholder="what made this one work, or why none do…"
          aria-label="Calibration note"
        />
        {state.notice && <p className="train-notice">{state.notice}</p>}
        <div className="calibration-verbs">
          <Button onPress={() => submit(true)}>
            {decision ? 'revise' : 'choose'} {letter(at)} · next
          </Button>
          <Button
            tone="quiet"
            onPress={() => submit(false)}
            disabled={problems.length > 0}
            title={problems[0]}
          >
            {decision ? 'revise: reject all' : 'reject all'} · next
          </Button>
        </div>
      </aside>
    </div>
  );
}

function deviceKey(trial: CalibrationTrialSummary): string {
  return `${trial.target.kind}/${trial.target.mode}`;
}

function deviceName(trial: CalibrationTrialSummary): string {
  return trial.target.mode ? `${trial.target.kind} · ${trial.target.mode}` : trial.target.kind;
}

function TrialPicker({
  state,
  open,
}: {
  state: CalibrationState;
  open(trialId?: string, trialVersion?: number): void;
}) {
  const selected = state.trials.find(
    (trial) => trial.id === state.trial?.id && trial.version === state.trial?.version,
  );
  if (!selected) return null;

  const devices = state.trials
    .filter(
      (trial, index, all) => all.findIndex((other) => deviceKey(other) === deviceKey(trial)) === index,
    )
    .sort((a, b) => deviceName(a).localeCompare(deviceName(b)));
  const parameters = state.trials.filter((trial) => deviceKey(trial) === deviceKey(selected));
  const choose = (trial: CalibrationTrialSummary | undefined) => {
    if (trial) open(trial.id, trial.version);
  };

  return (
    <section className="calibration-picker" aria-label="Calibration target">
      <label>
        <span>device</span>
        <select
          value={deviceKey(selected)}
          onChange={(event) => {
            const candidates = state.trials.filter(
              (trial) => deviceKey(trial) === event.currentTarget.value,
            );
            choose(candidates.find((trial) => !trial.decided) ?? candidates[0]);
          }}
        >
          {devices.map((device) => (
            <option key={deviceKey(device)} value={deviceKey(device)}>
              {deviceName(device)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>parameter</span>
        <select
          value={`${selected.id}@${selected.version}`}
          onChange={(event) =>
            choose(
              parameters.find(
                (trial) => `${trial.id}@${trial.version}` === event.currentTarget.value,
              ),
            )
          }
        >
          {parameters.map((parameter) => (
            <option
              key={`${parameter.id}@${parameter.version}`}
              value={`${parameter.id}@${parameter.version}`}
            >
              {parameter.target.inlet} {parameter.decided ? '✓' : '· pending'}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => open()}
        disabled={state.decided === state.total}
      >
        next pending
      </button>
    </section>
  );
}

function History({ state }: { state: CalibrationState }) {
  return (
    <div className="calibration-history">
      {state.history.map((row) => (
        <article key={row.id}>
          <b>{row.name}</b>
          <span>
            {row.selectedOptionId ?? 'rejected all'} · maximum reach {Math.round(row.extent * 100)}%
          </span>
          {row.note && <p>{row.note}</p>}
        </article>
      ))}
    </div>
  );
}
