import { useEffect, useMemo, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type {
  LabCandidate,
  LabComparisonChoice,
  LabFinalsState,
  LabFinalsSubmission,
  Scheme,
  Show,
} from '../../protocol.ts';
import { promoteCandidate, promotedCandidateId } from '../../lab.ts';
import type { Clock } from '../state/useShow.ts';
import { useTransport, type Transport } from '../state/useTransport.ts';
import { KEYS } from '../state/useRoom.ts';
import { Bench } from './Preview.tsx';
import { CANDIDATE_FLOW, parkedScheme, stagedShow } from './stage.ts';

export function FinalsView({
  clock,
  scheme,
  finals,
  open,
  newEdition,
  compare,
  skip,
  edit,
}: {
  clock: Clock;
  scheme: Scheme;
  finals: LabFinalsState | null;
  open(): void;
  newEdition(): void;
  compare(comparison: LabFinalsSubmission): void;
  skip(encounterId: number): void;
  edit(next: Scheme): void;
}) {
  useEffect(() => open(), [open]);

  if (!finals) {
    return (
      <div className="finals finals-empty">
        <span className="finals-kicker">finals</span>
        <h2>Freezing a diverse field from the search…</h2>
        <p>Kept works enter first; historical quality and novelty fill the field.</p>
        <Button onPress={open}>open Finals</Button>
      </div>
    );
  }

  if (finals.status === 'complete') {
    return (
      <FinalResults
        finals={finals}
        scheme={scheme}
        edit={edit}
        newEdition={newEdition}
      />
    );
  }

  return (
    <FinalMatch
      clock={clock}
      scheme={scheme}
      finals={finals}
      compare={compare}
      skip={skip}
      edit={edit}
    />
  );
}

function FinalMatch({
  clock,
  scheme,
  finals,
  compare,
  skip,
  edit,
}: {
  clock: Clock;
  scheme: Scheme;
  finals: LabFinalsState;
  compare(comparison: LabFinalsSubmission): void;
  skip(encounterId: number): void;
  edit(next: Scheme): void;
}) {
  const encounter = finals.encounter;
  const transport = useTransport(clock, false);
  const [ready, setReady] = useState({ left: false, right: false });
  const [errors, setErrors] = useState<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  });

  const encounterId = encounter?.id ?? null;
  useEffect(() => {
    if (!encounter) return;
    setReady({ left: false, right: false });
    setErrors({ left: null, right: null });
    transport.setBpm(encounter.room.tempo);
    transport.restart();
  }, [encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (choice: LabComparisonChoice) => {
    if (!encounter) return;
    compare({
      encounterId: encounter.id,
      choice,
      leftShowReady: ready.left,
      rightShowReady: ready.right,
    });
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof Element && event.target.matches('input, textarea, select'))
      ) {
        return;
      }
      const pressed = event.key.toLowerCase();
      const choice =
        event.key === 'ArrowLeft' || pressed === 'a'
          ? 'left'
          : event.key === 'ArrowRight' || pressed === 'd'
            ? 'right'
            : event.key === 'ArrowUp' || pressed === 'w'
              ? 'both'
              : event.key === 'ArrowDown' || pressed === 'x'
                ? 'neither'
                : null;
      if (choice) {
        event.preventDefault();
        choose(choice);
      } else if (pressed === 'j') {
        setReady((held) => ({ ...held, left: !held.left }));
      } else if (pressed === 'l') {
        setReady((held) => ({ ...held, right: !held.right }));
      } else if (pressed === 's' && encounter) {
        event.preventDefault();
        skip(encounter.id);
      } else if (pressed === 'r') {
        event.preventDefault();
        transport.restart();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [encounterId, compare, skip, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!encounter) {
    return (
      <div className="finals finals-empty">
        <h2>{finals.notice ?? 'Pairing the next finalists…'}</h2>
      </div>
    );
  }

  const show = stagedShow(encounter.room, `finals:${finals.runId}:${encounter.id}`);
  const room = encounter.room;
  const keyName = room.key === null ? 'no key' : KEYS[room.key] ?? 'no key';

  return (
    <div className="train train-comparison finals-match">
      <section className="train-pair">
        <FinalCandidate
          side="left"
          candidate={encounter.left}
          show={show}
          transport={transport}
          scheme={scheme}
          edit={edit}
          ready={ready.left}
          toggleReady={() => setReady((held) => ({ ...held, left: !held.left }))}
          shortcut="J"
          error={errors.left}
          setError={(error) => setErrors((held) => ({ ...held, left: error }))}
        />
        <FinalCandidate
          side="right"
          candidate={encounter.right}
          show={show}
          transport={transport}
          scheme={scheme}
          edit={edit}
          ready={ready.right}
          toggleReady={() => setReady((held) => ({ ...held, right: !held.right }))}
          shortcut="L"
          error={errors.right}
          setError={(error) => setErrors((held) => ({ ...held, right: error }))}
        />

        <div className="train-room train-room-frozen train-shared-room wdg">
          <Button
            tone="quiet"
            label={transport.playing ? 'Hold both clocks' : 'Run both clocks'}
            onPress={() => transport.setPlaying(!transport.playing)}
          >
            {transport.playing ? '■' : '▶'}
          </Button>
          <Button tone="quiet" label="Restart both at the bar" onPress={transport.restart}>
            ↺
          </Button>
          <strong className="finals-room-name">{encounter.roomName}</strong>
          <span>{room.tempo} bpm</span>
          <span>{Math.round(room.energy * 100)}% energy</span>
          <span>{room.section}</span>
          <span>{keyName}</span>
          <span className="train-palette" title={`Finals room ${room.seed}`}>
            {room.colors.map((hex, at) => (
              <i key={`${hex}${at}`} style={{ background: hex }} />
            ))}
          </span>
          <span className="train-cohort">one room · cross-family match</span>
        </div>
      </section>

      <aside className="train-choice train-compare-choice wdg">
        <header>
          <span className="train-phase finals-phase">finals</span>
          <span>{finals.compared} / {finals.total}</span>
        </header>
        <div>
          <h2>Which belongs in the show?</h2>
          <p>
            Preference chooses the stronger work. Mark either side show-ready independently,
            even when the other one wins this match.
          </p>
        </div>

        <div className="train-comparison-verbs" role="group" aria-label="Choose between finalists">
          <FinalChoice choice="left" keyName="← / A" title="choose left" detail={encounter.left.flow.name} choose={choose} />
          <FinalChoice choice="both" keyName="↑ / W" title="both" detail="two works can belong" choose={choose} />
          <FinalChoice choice="neither" keyName="↓ / X" title="neither" detail="protect the final collection" choose={choose} />
          <FinalChoice choice="right" keyName="→ / D" title="choose right" detail={encounter.right.flow.name} choose={choose} />
        </div>

        <dl className="train-tally train-search-tally finals-tally">
          <div><dt>nominees</dt><dd>{finals.nominees}</dd></div>
          <div><dt>room</dt><dd>{encounter.roomIndex + 1} / 4</dd></div>
          <div><dt>left ready</dt><dd>{ready.left ? 'yes' : '—'}</dd></div>
          <div><dt>right ready</dt><dd>{ready.right ? 'yes' : '—'}</dd></div>
        </dl>

        {finals.notice && <p className="train-notice">{finals.notice}</p>}
        <div className="train-verbs">
          <Button tone="quiet" onPress={() => skip(encounter.id)}>skip this match</Button>
          <span className="gap" />
          <span className="train-restart-hint">J/L ready · R restart</span>
        </div>
      </aside>
    </div>
  );
}

function FinalCandidate({
  side,
  candidate,
  show,
  transport,
  scheme,
  edit,
  ready,
  toggleReady,
  shortcut,
  error,
  setError,
}: {
  side: 'left' | 'right';
  candidate: LabCandidate;
  show: Show;
  transport: Transport;
  scheme: Scheme;
  edit(next: Scheme): void;
  ready: boolean;
  toggleReady(): void;
  shortcut: string;
  error: string | null;
  setError(error: string | null): void;
}) {
  const parked = useMemo(() => parkedScheme(candidate.flow, candidate.bundle), [candidate]);
  const copied = useMemo(() => promotedCandidateId(scheme, candidate) !== null, [scheme, candidate]);
  const copy = () => {
    if (!copied) edit(promoteCandidate(scheme, candidate).scheme);
  };
  return (
    <article className="train-candidate finals-candidate" data-side={side} data-ready={ready ? '' : undefined}>
      <header>
        <span className="train-side">finalist</span>
        <strong>{candidate.flow.name}</strong>
        <button type="button" className="finals-ready" aria-pressed={ready} onClick={toggleReady}>
          {ready ? 'show-ready ✓' : `show-ready · ${shortcut}`}
        </button>
        <Button tone="quiet" onPress={copy} disabled={copied}>{copied ? 'copied ✓' : 'copy'}</Button>
      </header>
      <div className="train-frame">
        <Bench show={show} scheme={parked} flow={CANDIDATE_FLOW} clock={transport} onError={setError} />
      </div>
      <footer>
        <span>{candidate.flow.circuit.nodes.length} nodes · generation {candidate.generation}</span>
        {error && <span className="train-error">{error}</span>}
      </footer>
    </article>
  );
}

function FinalResults({
  finals,
  scheme,
  edit,
  newEdition,
}: {
  finals: LabFinalsState;
  scheme: Scheme;
  edit(next: Scheme): void;
  newEdition(): void;
}) {
  const resultCount = finals.leaders.length;
  const copy = (candidate: LabCandidate) => {
    if (!promotedCandidateId(scheme, candidate)) edit(promoteCandidate(scheme, candidate).scheme);
  };
  const copyAll = () => {
    let next = scheme;
    for (const finalist of finals.leaders) {
      if (!promotedCandidateId(next, finalist.candidate)) {
        next = promoteCandidate(next, finalist.candidate).scheme;
      }
    }
    if (next !== scheme) edit(next);
  };
  const allCopied = finals.leaders.every(
    (finalist) => promotedCandidateId(scheme, finalist.candidate) !== null,
  );
  return (
    <div className="finals finals-results">
      <header>
        <div>
          <span className="finals-kicker">final collection</span>
          <h2>{resultCount} works survived four different rooms.</h2>
          <p>Preference chose strength. Show-ready marks kept tomorrow in the decision.</p>
        </div>
        <div className="finals-result-actions">
          <Button tone="quiet" onPress={newEdition}>new edition from Archive</Button>
          <Button onPress={copyAll} disabled={allCopied}>
            {allCopied ? 'collection copied ✓' : `copy all ${resultCount}`}
          </Button>
        </div>
      </header>
      <ol>
        {finals.leaders.map((finalist) => {
          const copied = promotedCandidateId(scheme, finalist.candidate) !== null;
          return (
            <li key={finalist.candidate.id}>
              <span className="finals-rank">{finalist.rank}</span>
              <div>
                <strong>{finalist.candidate.flow.name}</strong>
                <small>
                  {finalist.candidate.flow.circuit.nodes.length} nodes · generation {finalist.candidate.generation}
                </small>
              </div>
              <dl>
                <div><dt>preference</dt><dd>{Math.round(finalist.preference * 100)}%</dd></div>
                <div><dt>show-ready</dt><dd>{finalist.showReady} / {finalist.matches}</dd></div>
              </dl>
              <Button tone="quiet" onPress={() => copy(finalist.candidate)} disabled={copied}>
                {copied ? 'copied ✓' : 'copy'}
              </Button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FinalChoice({
  choice,
  keyName,
  title,
  detail,
  choose,
}: {
  choice: LabComparisonChoice;
  keyName: string;
  title: string;
  detail: string;
  choose(choice: LabComparisonChoice): void;
}) {
  return (
    <button type="button" data-choice={choice} onClick={() => choose(choice)}>
      <kbd>{keyName}</kbd>
      <b>{title}</b>
      <small>{detail}</small>
    </button>
  );
}
