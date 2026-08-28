import { useEffect, useMemo, useState } from 'react';
import type {
  LabCandidate,
  LabArchiveSubmission,
  LabComparisonChoice,
  LabComparisonSubmission,
  LabFinalsSubmission,
  LabLineageFinalistSubmission,
  LabState,
  Scheme,
  Show,
} from '../../protocol.ts';
import { promoteCandidate, promotedCandidateId } from '../../lab.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Clock } from '../state/useShow.ts';
import { useTransport, type Transport } from '../state/useTransport.ts';
import { KEYS } from '../state/useRoom.ts';
import { Bench } from './Preview.tsx';
import { CANDIDATE_FLOW, parkedScheme, stagedShow } from './stage.ts';
import { FinalsView } from './FinalsView.tsx';
import { ArchiveView } from './ArchiveView.tsx';

const operationName = (operation: string): string =>
  operation === 'random'
    ? 'new family'
    : operation === 'explore:leap'
      ? 'exploratory leap'
      : operation.replace(/^mutate:/, 'one change · ');

/** Search discovers visual languages; Finals chooses a show-ready collection. */
interface TrainViewProps {
  clock: Clock;
  scheme: Scheme;
  lab: LabState | null;
  labOpen(): void;
  labCompare(comparison: LabComparisonSubmission): void;
  labSkipEncounter(encounterId: number): void;
  labArchiveOpen(): void;
  labArchiveSelect(candidateId: string): void;
  labArchiveDecide(decision: LabArchiveSubmission): void;
  labLineageFinalist(decision: LabLineageFinalistSubmission): void;
  labFinalsOpen(): void;
  labFinalsNew(): void;
  labFinalsCompare(comparison: LabFinalsSubmission): void;
  labFinalsSkip(encounterId: number): void;
  edit(next: Scheme): void;
}

export function TrainView(props: TrainViewProps) {
  const [mode, setMode] = useState<'search' | 'archive' | 'finals'>('search');
  return (
    <div className="train-workspace">
      <nav className="train-mode" aria-label="Training stage">
        <button type="button" aria-pressed={mode === 'search'} onClick={() => setMode('search')}>
          search
        </button>
        <button type="button" aria-pressed={mode === 'archive'} onClick={() => setMode('archive')}>
          archive
        </button>
        <button type="button" aria-pressed={mode === 'finals'} onClick={() => setMode('finals')}>
          finals
        </button>
        <span>
          {mode === 'search'
            ? 'discover visual languages'
            : mode === 'archive'
              ? 'remember finished works'
              : 'choose the show-ready collection'}
        </span>
      </nav>
      <div className="train-workspace-body">
        {mode === 'search' ? (
          <SearchView
            clock={props.clock}
            scheme={props.scheme}
            lab={props.lab}
            labOpen={props.labOpen}
            labCompare={props.labCompare}
            labSkipEncounter={props.labSkipEncounter}
            labArchiveDecide={props.labArchiveDecide}
            edit={props.edit}
          />
        ) : mode === 'archive' ? (
          <ArchiveView
            clock={props.clock}
            scheme={props.scheme}
            archive={props.lab?.archive ?? null}
            open={props.labArchiveOpen}
            select={props.labArchiveSelect}
            decide={props.labArchiveDecide}
            finalist={props.labLineageFinalist}
            edit={props.edit}
          />
        ) : (
          <FinalsView
            clock={props.clock}
            scheme={props.scheme}
            finals={props.lab?.finals ?? null}
            open={props.labFinalsOpen}
            newEdition={props.labFinalsNew}
            compare={props.labFinalsCompare}
            skip={props.labFinalsSkip}
            edit={props.edit}
          />
        )}
      </div>
    </div>
  );
}

function SearchView({
  clock,
  scheme,
  lab,
  labOpen,
  labCompare,
  labSkipEncounter,
  labArchiveDecide,
  edit,
}: {
  clock: Clock;
  scheme: Scheme;
  lab: LabState | null;
  labOpen(): void;
  labCompare(comparison: LabComparisonSubmission): void;
  labSkipEncounter(encounterId: number): void;
  labArchiveDecide(decision: LabArchiveSubmission): void;
  edit(next: Scheme): void;
}) {
  const encounter = lab?.encounter ?? null;
  const [errors, setErrors] = useState<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  });
  const transport = useTransport(clock, false);
  const kept = new Set(lab?.archive?.keptCandidateIds ?? []);

  useEffect(() => labOpen(), [labOpen]);

  const encounterId = encounter?.id ?? null;
  useEffect(() => {
    if (!encounter) return;
    setErrors({ left: null, right: null });
    transport.setBpm(encounter.room.tempo);
    transport.restart();
  }, [encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (choice: LabComparisonChoice) => {
    if (encounter) labCompare({ encounterId: encounter.id, choice });
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
          : event.key === 'ArrowRight' || pressed === 'd' || pressed === 'b'
            ? 'right'
            : event.key === 'ArrowUp' || pressed === 'w'
              ? 'both'
              : event.key === 'ArrowDown' || pressed === 'x'
                ? 'neither'
                : null;
      if (choice) {
        event.preventDefault();
        choose(choice);
      } else if (pressed === 's' && encounter) {
        event.preventDefault();
        labSkipEncounter(encounter.id);
      } else if (pressed === 'r') {
        event.preventDefault();
        transport.restart();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [encounterId, labCompare, labSkipEncounter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!encounter) {
    return (
      <div className="train train-empty">
        <p>{lab?.notice ?? 'building a distinct pair that compiles…'}</p>
        <Button onPress={labOpen}>ask again</Button>
      </div>
    );
  }

  // One seed for both sides. A song node must not receive candidate A's hash on
  // the left and candidate B's on the right or the room is not actually held.
  const show = stagedShow(encounter.room, `encounter:${encounter.id}`);
  const refining = encounter.phase === 'refine';
  const leftLabel = refining ? 'current' : 'direction A';
  const rightLabel = refining ? 'variation' : 'direction B';
  const room = encounter.room;
  const keyName = room.key === null ? 'no key' : KEYS[room.key] ?? 'no key';

  return (
    <div className="train train-comparison" data-phase={encounter.phase}>
      <section className="train-pair">
        <CandidatePane
          side="left"
          label={leftLabel}
          candidate={encounter.left}
          show={show}
          transport={transport}
          scheme={scheme}
          edit={edit}
          error={errors.left}
          setError={(error) => setErrors((held) => ({ ...held, left: error }))}
          kept={kept.has(encounter.left.id)}
          mark={(verdict) => labArchiveDecide({
            candidateId: encounter.left.id,
            verdict,
            source: 'search',
          })}
        />
        <CandidatePane
          side="right"
          label={rightLabel}
          candidate={encounter.right}
          show={show}
          transport={transport}
          scheme={scheme}
          edit={edit}
          error={errors.right}
          setError={(error) => setErrors((held) => ({ ...held, right: error }))}
          kept={kept.has(encounter.right.id)}
          mark={(verdict) => labArchiveDecide({
            candidateId: encounter.right.id,
            verdict,
            source: 'search',
          })}
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
          <span>{Number.isInteger(room.tempo) ? room.tempo.toFixed(0) : room.tempo.toFixed(1)} bpm</span>
          <span>{Math.round(room.energy * 100)}% energy</span>
          <span>{room.section.toLowerCase()}</span>
          <span>{keyName}</span>
          <span className="train-palette" title={`comparison room ${room.seed}`}>
            {room.colors.map((hex, at) => (
              <i key={`${hex}${at}`} style={{ background: hex }} />
            ))}
          </span>
          <span className="train-cohort">one clock · one room · one question</span>
        </div>
      </section>

      <aside className="train-choice train-compare-choice wdg">
        <header>
          <span className="train-phase">{encounter.phase}</span>
          <span>depth {encounter.depth}</span>
        </header>
        <div>
          <h2>
            {refining ? 'Did the one change improve this family?' : 'Which direction deserves a future?'}
          </h2>
          <p>
            {refining
              ? 'Current and variation differ by one recorded intervention. Choose what should survive.'
              : encounter.anchorId
                ? 'Both are visible leaps from the same parent. Keep either, both, or neither.'
                : 'These are deliberately distant immigrants. This chooses where search begins.'}
          </p>
          {encounter.anchorId && (
            <p className="train-anchor">from {encounter.anchorId.slice(0, 10)}</p>
          )}
        </div>

        <div className="train-comparison-verbs" role="group" aria-label="Choose between the pair">
          <Choice
            choice="left"
            keyName="← / A"
            title={refining ? 'keep current' : 'choose A'}
            detail={encounter.left.flow.name}
            choose={choose}
          />
          <Choice
            choice="both"
            keyName="↑ / W"
            title="keep both"
            detail="preserve two branches"
            choose={choose}
          />
          <Choice
            choice="neither"
            keyName="↓ / X"
            title="neither"
            detail="no winner manufactured"
            choose={choose}
          />
          <Choice
            choice="right"
            keyName="→ / D"
            title={refining ? 'take variation' : 'choose B'}
            detail={encounter.right.flow.name}
            choose={choose}
          />
        </div>

        <dl className="train-tally train-search-tally">
          <div>
            <dt>compared</dt>
            <dd>{lab?.comparisons ?? 0}</dd>
          </div>
          <div>
            <dt>explore / refine</dt>
            <dd>{lab?.explores ?? 0} / {lab?.refines ?? 0}</dd>
          </div>
          <div>
            <dt>frontier</dt>
            <dd>{lab?.frontier ?? 0}</dd>
          </div>
          <div>
            <dt>deepest</dt>
            <dd>{lab?.maxGeneration ?? 0}</dd>
          </div>
        </dl>

        {lab?.notice && <p className="train-notice">{lab.notice}</p>}
        <div className="train-verbs">
          <Button
            tone="quiet"
            onPress={() => labSkipEncounter(encounter.id)}
            title="No comparison was formed — shortcut S"
          >
            skip this pair
          </Button>
          <span className="gap" />
          <span className="train-restart-hint">R restarts both</span>
        </div>
      </aside>
    </div>
  );
}

function CandidatePane({
  side,
  label,
  candidate,
  show,
  transport,
  scheme,
  edit,
  error,
  setError,
  kept,
  mark,
}: {
  side: 'left' | 'right';
  label: string;
  candidate: LabCandidate;
  show: Show;
  transport: Transport;
  scheme: Scheme;
  edit(next: Scheme): void;
  error: string | null;
  setError(error: string | null): void;
  kept: boolean;
  mark(verdict: 'keep' | 'clear'): void;
}) {
  const parked = useMemo(
    () => parkedScheme(candidate.flow, candidate.bundle),
    [candidate],
  );
  const promoted = useMemo(
    () => promotedCandidateId(scheme, candidate) !== null,
    [scheme, candidate],
  );
  const nodes = candidate.flow.circuit.nodes.length;
  const copy = () => {
    if (!promoted) edit(promoteCandidate(scheme, candidate).scheme);
  };
  return (
    <article className="train-candidate" data-side={side}>
      <header>
        <span className="train-side">{label}</span>
        <strong>{candidate.flow.name}</strong>
        <button
          type="button"
          className="archive-star"
          aria-pressed={kept}
          onClick={() => mark(kept ? 'clear' : 'keep')}
          title="Preserve this finished work independently of which direction wins"
        >
          {kept ? '★ kept' : '☆ keep'}
        </button>
        <Button tone="quiet" onPress={copy} disabled={promoted}>
          {promoted ? 'copied ✓' : 'copy'}
        </Button>
      </header>
      <div className="train-frame">
        <Bench
          show={show}
          scheme={parked}
          flow={CANDIDATE_FLOW}
          clock={transport}
          onError={setError}
        />
      </div>
      <footer>
        <span>
          {nodes} nodes · generation {candidate.generation} · {operationName(candidate.operation)}
        </span>
        {error && <span className="train-error">{error}</span>}
      </footer>
    </article>
  );
}

function Choice({
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
