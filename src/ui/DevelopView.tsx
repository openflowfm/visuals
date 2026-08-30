import { useEffect, useMemo, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type {
  LabBatchSubmission,
  LabBookmarkSubmission,
  LabCandidate,
  LabComparisonChoice,
  LabDevelopState,
  Scheme,
  Show,
} from '../../protocol.ts';
import { promoteCandidate, promotedCandidateId } from '../../lab.ts';
import type { Clock } from '../state/useShow.ts';
import { useTransport, type Transport } from '../state/useTransport.ts';
import { KEYS } from '../state/useRoom.ts';
import { Bench } from './Preview.tsx';
import { CANDIDATE_FLOW, parkedScheme, stagedShow } from './stage.ts';

/**
 * Develop: one parent's children, in a tournament somebody asked for.
 *
 * This is where comparison belongs, and the reason it works here and did not
 * work as a global search is context. Every entrant is a mutation of the same
 * parent, under one room, in one sitting — so a preference is a statement about
 * an edit rather than about two unrelated works that happened to be dealt
 * together. The parent is in its own field, which is what lets the result be
 * "nothing here beat it" instead of a winner the shape of the bracket invented.
 */

const operationName = (operation: string): string =>
  operation === 'random'
    ? 'new family'
    : operation === 'explore:leap'
      ? 'leap'
      : operation.replace(/^mutate:/, 'one change · ');

export function DevelopView({
  clock,
  scheme,
  develop,
  compare,
  skip,
  close,
  bookmark,
  bookmarkedIds,
  edit,
}: {
  clock: Clock;
  scheme: Scheme;
  develop: LabDevelopState;
  compare(comparison: LabBatchSubmission): void;
  skip(encounterId: number): void;
  close(): void;
  bookmark(decision: LabBookmarkSubmission): void;
  bookmarkedIds: ReadonlySet<string>;
  edit(next: Scheme): void;
}) {
  const transport = useTransport(clock, false);
  const [errors, setErrors] = useState<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  });
  const encounter = develop.encounter;
  const encounterId = encounter?.id ?? null;

  useEffect(() => {
    if (!encounter) return;
    setErrors({ left: null, right: null });
    transport.setBpm(encounter.room.tempo);
    transport.restart();
  }, [encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (choice: LabComparisonChoice) => {
    if (encounter) compare({ encounterId: encounter.id, choice });
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
      const choice: LabComparisonChoice | null =
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
      } else if (pressed === 's' && encounterId) {
        event.preventDefault();
        skip(encounterId);
      } else if (pressed === 'r') {
        event.preventDefault();
        transport.restart();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [encounterId, compare, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  const leader = develop.standings[0] ?? null;
  const complete = develop.status === 'complete' || !encounter;

  if (complete) {
    return (
      <div className="develop develop-done">
        <header className="develop-head">
          <div>
            <span className="finals-kicker">batch complete</span>
            <strong>{develop.parent.flow.name}</strong>
          </div>
          <span>
            {develop.compared} of {develop.total} matches answered
          </span>
          <Button onPress={close}>back to the forest</Button>
        </header>

        {/*
          The parent leading its own batch is a real result, not a null one.
          It says this node is at a local peak, which is worth knowing before
          another batch is spent on it — and it was unrepresentable under a
          scheduler that only ever recorded which of two things won.
        */}
        <p className="develop-verdict" data-improved={develop.improved ? '' : undefined}>
          {develop.improved
            ? `${leader?.candidate.flow.name} beat the parent.`
            : 'Nothing in this batch beat the parent — this node is at a local peak.'}
        </p>

        <Standings
          standings={develop.standings}
          scheme={scheme}
          bookmarkedIds={bookmarkedIds}
          bookmark={bookmark}
          edit={edit}
        />
        {develop.notice && <p className="train-notice">{develop.notice}</p>}
      </div>
    );
  }

  const room = encounter.room;
  // One seed for both sides: a `song` node must not read a different hash on
  // each side, or the room is not actually held between them.
  const show = stagedShow(room, `batch:${develop.batchId}:${encounter.id}`);
  const keyName = room.key === null ? 'no key' : (KEYS[room.key] ?? 'no key');

  return (
    <div className="train train-comparison develop">
      <section className="train-pair">
        <Pane
          side="left"
          candidate={encounter.left}
          parentId={develop.parent.id}
          show={show}
          transport={transport}
          scheme={scheme}
          edit={edit}
          error={errors.left}
          setError={(error) => setErrors((held) => ({ ...held, left: error }))}
          bookmarked={bookmarkedIds.has(encounter.left.id)}
          bookmark={bookmark}
        />
        <Pane
          side="right"
          candidate={encounter.right}
          parentId={develop.parent.id}
          show={show}
          transport={transport}
          scheme={scheme}
          edit={edit}
          error={errors.right}
          setError={(error) => setErrors((held) => ({ ...held, right: error }))}
          bookmarked={bookmarkedIds.has(encounter.right.id)}
          bookmark={bookmark}
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
          <span>{Math.round(room.tempo)} bpm</span>
          <span>{Math.round(room.energy * 100)}% energy</span>
          <span>{room.section.toLowerCase()}</span>
          <span>{keyName}</span>
          <span className="train-palette" title={`batch room ${room.seed}`}>
            {room.colors.map((hex, at) => (
              <i key={`${hex}${at}`} style={{ background: hex }} />
            ))}
          </span>
          <span className="train-cohort">one room for the whole batch</span>
        </div>
      </section>

      <aside className="train-choice train-compare-choice wdg">
        <header>
          <span className="train-phase">develop</span>
          <span>
            round {encounter.round + 1} of {encounter.rounds}
          </span>
        </header>
        <div>
          <h2>Which of these two?</h2>
          <p>
            {develop.size} variations of <b>{develop.parent.flow.name}</b>, the parent among them,
            all under one room.
          </p>
        </div>

        <div className="train-comparison-verbs" role="group" aria-label="Choose between the pair">
          <Choice choice="left" keyName="← / A" title="this one" detail={encounter.left.flow.name} choose={choose} />
          <Choice choice="both" keyName="↑ / W" title="both" detail="two worth keeping" choose={choose} />
          <Choice choice="neither" keyName="↓ / X" title="neither" detail="no winner manufactured" choose={choose} />
          <Choice choice="right" keyName="→ / D" title="that one" detail={encounter.right.flow.name} choose={choose} />
        </div>

        <dl className="train-tally">
          <div>
            <dt>answered</dt>
            <dd>
              {develop.compared} / {develop.total}
            </dd>
          </div>
          <div>
            <dt>leading</dt>
            <dd>{leader ? (leader.isParent ? 'the parent' : leader.candidate.flow.name) : '—'}</dd>
          </div>
        </dl>

        {develop.notice && <p className="train-notice">{develop.notice}</p>}
        <div className="train-verbs">
          <Button tone="quiet" onPress={() => skip(encounter.id)} title="No comparison was formed — shortcut S">
            skip this pair
          </Button>
          <Button tone="quiet" onPress={close} title="Leave the rest of this batch unanswered">
            discard batch
          </Button>
          <span className="gap" />
          <span className="train-restart-hint">R restarts both</span>
        </div>
      </aside>
    </div>
  );
}

function Standings({
  standings,
  scheme,
  bookmarkedIds,
  bookmark,
  edit,
}: {
  standings: LabDevelopState['standings'];
  scheme: Scheme;
  bookmarkedIds: ReadonlySet<string>;
  bookmark(decision: LabBookmarkSubmission): void;
  edit(next: Scheme): void;
}) {
  return (
    <ol className="develop-standings">
      {standings.map((row) => {
        const marked = bookmarkedIds.has(row.candidate.id);
        const copied = promotedCandidateId(scheme, row.candidate) !== null;
        return (
          <li key={row.candidate.id} data-parent={row.isParent ? '' : undefined}>
            <span className="develop-rank">{row.rank}</span>
            <span className="develop-name">
              {row.candidate.flow.name}
              {row.isParent && <em> · the parent</em>}
            </span>
            <span className="develop-op">{operationName(row.candidate.operation)}</span>
            <span className="develop-score">
              {Math.round(row.preference * 100)}% over {row.matches}
            </span>
            <button
              type="button"
              className="archive-star"
              aria-pressed={marked}
              onClick={() => bookmark({ candidateId: row.candidate.id, marked: !marked })}
            >
              {marked ? '★' : '☆'}
            </button>
            <Button
              tone="quiet"
              disabled={copied}
              onPress={() => !copied && edit(promoteCandidate(scheme, row.candidate).scheme)}
            >
              {copied ? 'copied ✓' : 'copy'}
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

function Pane({
  side,
  candidate,
  parentId,
  show,
  transport,
  scheme,
  edit,
  error,
  setError,
  bookmarked,
  bookmark,
}: {
  side: 'left' | 'right';
  candidate: LabCandidate;
  parentId: string;
  show: Show;
  transport: Transport;
  scheme: Scheme;
  edit(next: Scheme): void;
  error: string | null;
  setError(error: string | null): void;
  bookmarked: boolean;
  bookmark(decision: LabBookmarkSubmission): void;
}) {
  const parked = useMemo(() => parkedScheme(candidate.flow, candidate.bundle), [candidate]);
  const promoted = useMemo(
    () => promotedCandidateId(scheme, candidate) !== null,
    [scheme, candidate],
  );
  const isParent = candidate.id === parentId;
  return (
    <article className="train-candidate" data-side={side} data-parent={isParent ? '' : undefined}>
      <header>
        <span className="train-side">{isParent ? 'the parent' : operationName(candidate.operation)}</span>
        <strong>{candidate.flow.name}</strong>
        <button
          type="button"
          className="archive-star"
          aria-pressed={bookmarked}
          onClick={() => bookmark({ candidateId: candidate.id, marked: !bookmarked })}
          title="Come back to this work, whichever side wins"
        >
          {bookmarked ? '★' : '☆'}
        </button>
        <Button
          tone="quiet"
          onPress={() => !promoted && edit(promoteCandidate(scheme, candidate).scheme)}
          disabled={promoted}
        >
          {promoted ? 'copied ✓' : 'copy'}
        </Button>
      </header>
      <div className="train-frame">
        <Bench show={show} scheme={parked} flow={CANDIDATE_FLOW} clock={transport} onError={setError} />
      </div>
      <footer>
        <span>
          {candidate.flow.circuit.nodes.length} nodes · generation {candidate.generation}
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
