import { useEffect, useMemo, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type {
  LabBatchSubmission,
  LabBookmarkSubmission,
  LabCandidate,
  LabComparisonChoice,
  LabDevelopRequest,
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
  deal,
  sizes,
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
  deal(request: LabDevelopRequest): void;
  sizes: readonly number[];
  bookmark(decision: LabBookmarkSubmission): void;
  bookmarkedIds: ReadonlySet<string>;
  edit(next: Scheme): void;
}) {
  const transport = useTransport(clock, false);
  const [errors, setErrors] = useState<{
    left: string | null;
    right: string | null;
    // The results screen draws one entrant at a time and outlives the matches,
    // so a compile error there is its own: reusing a pane's slot would print
    // the last match's failure under a winner that draws perfectly well.
    shown: string | null;
  }>({ left: null, right: null, shown: null });
  const [shownId, setShownId] = useState<string | null>(null);
  const [colorway, setColorway] = useState<string>('');
  const encounter = develop.encounter;
  const encounterId = encounter?.id ?? null;

  /**
   * The batch's room, re-lit if somebody asked for a different colourway.
   *
   * A dealt palette is a fair test and not always a useful one: three rounds
   * spent deciding between variations you would never light that way answers a
   * question nobody asked. Both sides always take the same room, so this cannot
   * favour a side — and every comparison carries the room it was answered
   * under, so the record says which light the choice was made in rather than
   * assuming the dealt one.
   *
   * Only the colours. Tempo, energy, section and key are the controlled part of
   * the field, and a knob for those would be a way to keep re-asking a question
   * until the answer is the one you wanted.
   */
  const room = useMemo(() => {
    const hex = scheme.colorways[colorway];
    return colorway && hex?.length ? { ...develop.room, colors: [...hex] } : develop.room;
  }, [develop.room, scheme.colorways, colorway]);
  const colorways = Object.keys(scheme.colorways);

  useEffect(() => {
    transport.setBpm(room.tempo);
  }, [room.tempo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!encounter) return;
    setErrors((was) => ({ ...was, left: null, right: null }));
    transport.restart();
  }, [encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (choice: LabComparisonChoice) => {
    if (encounter) compare({ encounterId: encounter.id, choice, room });
  };

  const leader = develop.standings[0] ?? null;
  const complete = develop.status === 'complete' || !encounter;
  // Looked up rather than held, so a standing that moves under the viewer —
  // the last match answered re-ranks the field — leaves it pointing at the
  // same work, and an id that is no longer in the field falls back to the top
  // instead of showing nothing.
  const shown = develop.standings.find((row) => row.candidate.id === shownId) ?? leader;
  // The field this batch actually had, when that is still an offered size. A
  // batch can come up short — a draft that would have rendered a picture
  // already in the corpus is refused rather than staged — and asking for a
  // size the engine does not offer would come back as a notice instead of a
  // batch.
  const again = sizes.includes(develop.size) ? develop.size : (sizes[1] ?? sizes[0]);
  const keyName = room.key === null ? 'no key' : (KEYS[room.key] ?? 'no key');

  useEffect(() => {
    setErrors((was) => ({ ...was, shown: null }));
  }, [shown?.candidate.id]);

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
      if (pressed === 'r') {
        event.preventDefault();
        transport.restart();
        return;
      }
      // The same arrows mean different things either side of the last match,
      // because the screen is asking a different question: while judging they
      // answer it, and afterwards they walk the field.
      if (complete) {
        const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!step || develop.standings.length === 0) return;
        event.preventDefault();
        const at = develop.standings.findIndex((row) => row.candidate.id === shown?.candidate.id);
        const next = develop.standings[
          Math.min(Math.max(at + step, 0), develop.standings.length - 1)
        ];
        if (next) setShownId(next.candidate.id);
        return;
      }
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
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [encounterId, compare, skip, complete, shown?.candidate.id, develop.standings]); // eslint-disable-line react-hooks/exhaustive-deps

  if (complete) {
    return (
      <div className="develop develop-done">
        <header className="develop-head">
          <div>
            <span className="finals-kicker">batch complete</span>
            <strong>{develop.parent.flow.name}</strong>
          </div>
          <span>
            {develop.compared} of {develop.total} matches answered · ↑↓ walks the field
          </span>
          {shown && (
            <Button
              onPress={() => {
                // Closed first because the engine deals one batch at a time,
                // and both ride the same socket in order — so this is exactly
                // the two gestures it replaces, not a new path into the store.
                close();
                deal({ candidateId: shown.candidate.id, size: again });
              }}
            >
              {shown.rank === 1 ? 'develop the winner' : 'develop this one'}
            </Button>
          )}
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

        <section className="develop-result">
          <div className="develop-stage">
            {shown && (
              <Pane
                side="only"
                candidate={shown.candidate}
                parentId={develop.parent.id}
                standing={shown}
                // One seed for the whole field, so stepping through entrants
                // changes the picture and nothing else. A seed per candidate
                // would hand each one a different song underneath, which is the
                // one difference nobody in this batch was judging.
                show={stagedShow(room, `batch:${develop.batchId}`)}
                transport={transport}
                scheme={scheme}
                edit={edit}
                error={errors.shown}
                setError={(error) => setErrors((was) => ({ ...was, shown: error }))}
                bookmarked={bookmarkedIds.has(shown.candidate.id)}
                bookmark={bookmark}
              />
            )}

            <div className="train-room train-room-frozen wdg">
              <Button
                tone="quiet"
                label={transport.playing ? 'Hold the clock' : 'Run the clock'}
                onPress={() => transport.setPlaying(!transport.playing)}
              >
                {transport.playing ? '■' : '▶'}
              </Button>
              <Button tone="quiet" label="Restart at the bar" onPress={transport.restart}>
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
              <Colorway colorway={colorway} colorways={colorways} set={setColorway} />
              <span className="train-cohort">
                {colorway ? 'the batch room, re-lit' : 'the room this batch was judged in'}
              </span>
            </div>
          </div>

          <Standings
            standings={develop.standings}
            shownId={shown?.candidate.id ?? null}
            show={setShownId}
            scheme={scheme}
            bookmarkedIds={bookmarkedIds}
            bookmark={bookmark}
            edit={edit}
          />
        </section>
        {develop.notice && <p className="train-notice">{develop.notice}</p>}
      </div>
    );
  }

  // One seed for both sides: a `song` node must not read a different hash on
  // each side, or the room is not actually held between them.
  const show = stagedShow(room, `batch:${develop.batchId}:${encounter.id}`);

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
          <Colorway colorway={colorway} colorways={colorways} set={setColorway} />
          <span className="train-cohort">
            {colorway ? `one room for the whole batch, lit as ${colorway}` : 'one room for the whole batch'}
          </span>
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

/** Re-light the field, without touching anything the field controls. */
function Colorway({
  colorway,
  colorways,
  set,
}: {
  colorway: string;
  colorways: readonly string[];
  set(next: string): void;
}) {
  if (colorways.length === 0) return null;
  return (
    <label className="train-colorway">
      light
      <select value={colorway} onChange={(event) => set(event.target.value)}>
        <option value="">as dealt</option>
        {colorways.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The field, and the way back into any of it.
 *
 * A standing is a row you can look at, not just a row you can read. The
 * numbers say which entrant won; only the picture says what winning looked
 * like, and a batch whose result is a name in a list makes the person carry
 * nine variations in their head to know what they chose.
 */
function Standings({
  standings,
  shownId,
  show,
  scheme,
  bookmarkedIds,
  bookmark,
  edit,
}: {
  standings: LabDevelopState['standings'];
  shownId: string | null;
  show(candidateId: string): void;
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
        const isShown = row.candidate.id === shownId;
        return (
          <li
            key={row.candidate.id}
            data-parent={row.isParent ? '' : undefined}
            data-shown={isShown ? '' : undefined}
          >
            <button
              type="button"
              className="develop-pick"
              aria-pressed={isShown}
              onClick={() => show(row.candidate.id)}
            >
              <span className="develop-rank">{row.rank}</span>
              <span className="develop-name">
                {row.candidate.flow.name}
                {row.isParent && <em> · the parent</em>}
              </span>
              <span className="develop-op">{operationName(row.candidate.operation)}</span>
              <span className="develop-score">
                {Math.round(row.preference * 100)}% over {row.matches}
              </span>
            </button>
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
  standing,
  show,
  transport,
  scheme,
  edit,
  error,
  setError,
  bookmarked,
  bookmark,
}: {
  side: 'left' | 'right' | 'only';
  candidate: LabCandidate;
  parentId: string;
  /** Where this one placed, on the results screen. Absent while judging. */
  standing?: LabDevelopState['standings'][number];
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
        {standing && <span className="develop-rank">{standing.rank}</span>}
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
          {standing &&
            ` · won ${Math.round(standing.preference * 100)}% over ${standing.matches} ${
              standing.matches === 1 ? 'match' : 'matches'
            }`}
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
