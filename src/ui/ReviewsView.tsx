import { useEffect, useMemo, useState } from 'react';
import type { FlowDef, LabReviewRow, LabScore, Scheme, Show } from '../../protocol.ts';
import { SCORES, promoteCandidate, promotedCandidateId } from '../../lab.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { RESTING } from '../state/useShow.ts';
import { useTransport } from '../state/useTransport.ts';
import { Bench } from './Preview.tsx';
import { CANDIDATE_FLOW, parkedScheme, stagedShow } from './stage.ts';
import { TagPicker } from './TagPicker.tsx';

/**
 * The review tab: the detailed corpus, browsable — every anchored judgment
 * preserved from the slower review workflow, newest first, re-staged on the
 * bench exactly as it was seen. Binary train decisions live beside rather than
 * inside this rubric and do not manufacture rows here.
 *
 * The split this tab lives on: the **judgment** — candidate, room, score,
 * when — is immutable, and nothing here can touch it. The **description** —
 * tags and note — is living, because a reviewer's vocabulary arrives after
 * their taste does: a score given quickly tonight gets its tags on a slower
 * pass tomorrow, through the same picker the train view uses. An edit goes to
 * the server and comes back as the changed row to every console; the list is
 * never locally right and remotely wrong.
 *
 * Re-staging works because a judgment freezes everything it needs: the room
 * rides the row by value, and the candidate's graph is fetched by id — dealt
 * rooms restage the exact conditions, live rooms restage the sampled moment.
 */
export function ReviewsView({
  labLog,
  labLogOpen,
  labRescore,
  labRetag,
  labRenote,
  labStage,
  labCandidate,
  scheme,
  edit,
}: {
  labLog: { reviews: LabReviewRow[]; more: boolean } | null;
  labLogOpen(before?: number): void;
  labRescore(reviewId: number, score: LabScore): void;
  labRetag(reviewId: number, tags: string[]): void;
  labRenote(reviewId: number, note: string): void;
  labStage: { id: string; flow: FlowDef; bundle: Record<string, FlowDef> } | null;
  labCandidate(candidateId: string): void;
  scheme: Scheme;
  /** Copy through the ordinary in-memory scheme edit path; Save stays separate. */
  edit(next: Scheme): void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [benchError, setBenchError] = useState<string | null>(null);
  const transport = useTransport(null, false);

  useEffect(() => {
    labLogOpen();
  }, [labLogOpen]);

  const reviews = labLog?.reviews ?? [];
  const selected = reviews.find((row) => row.id === selectedId) ?? reviews[0] ?? null;

  // Selection changes reset what belongs to the selection: the note draft,
  // the staged graph, and the clock, re-tuned to the judged room's tempo.
  const selectedKey = selected?.id ?? null;
  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setNote(selected.note ?? '');
    labCandidate(selected.candidateId);
    transport.setBpm(selected.room.tempo);
    transport.restart();
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The stage draws only when the fetched graph is the selected row's: a slow
  // answer must not leave the previous candidate under the new row's room.
  const graph = labStage && selected && labStage.id === selected.candidateId ? labStage : null;
  const parked = useMemo(
    (): Scheme | null => (graph ? parkedScheme(graph.flow, graph.bundle) : null),
    [graph],
  );
  const staged = useMemo(
    (): Show => (selected ? stagedShow(selected.room, selected.candidateId) : RESTING),
    [selected],
  );

  const toggleTag = (id: string) => {
    if (!selected) return;
    labRetag(
      selected.id,
      selected.tags.includes(id)
        ? selected.tags.filter((each) => each !== id)
        : [...selected.tags, id],
    );
  };

  const saveNote = () => {
    if (selected && note.trim() !== (selected.note ?? '')) labRenote(selected.id, note);
  };

  const copied = useMemo(
    () => (graph ? promotedCandidateId(scheme, graph) !== null : false),
    [scheme, graph],
  );
  const copy = () => {
    if (!graph || copied) return;
    edit(promoteCandidate(scheme, graph).scheme);
  };

  const when = (iso: string) => {
    const at = new Date(iso);
    return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${at
      .getHours()
      .toString()
      .padStart(2, '0')}:${at.getMinutes().toString().padStart(2, '0')}`;
  };

  if (reviews.length === 0) {
    return (
      <div className="reviews reviews-empty">
        <p>{labLog ? 'no detailed reviews yet' : 'asking the lab…'}</p>
      </div>
    );
  }

  return (
    <div className="reviews">
      <div className="reviews-list" role="listbox" aria-label="Past reviews">
        {reviews.map((row) => (
          <button
            key={row.id}
            type="button"
            role="option"
            className="reviews-row"
            aria-selected={selected?.id === row.id}
            data-on={selected?.id === row.id ? '' : undefined}
            onClick={() => setSelectedId(row.id)}
          >
            <b>{row.score}</b>
            <span className="reviews-row-name">{row.flowName}</span>
            <span className="reviews-row-facts">
              {row.tags.length > 0 && `${row.tags.length} tag${row.tags.length === 1 ? '' : 's'} · `}
              {row.note && '✎ · '}
              {row.room.seed === 'live' && 'live · '}
              {when(row.createdAt)}
            </span>
          </button>
        ))}
        {labLog?.more && (
          <Button
            tone="quiet"
            onPress={() => labLogOpen(reviews[reviews.length - 1]?.id)}
          >
            older…
          </Button>
        )}
      </div>

      {selected && (
        <div className="reviews-detail">
          <div className="reviews-stage">
            <div className="train-frame">
              {parked ? (
                <Bench
                  show={staged}
                  scheme={parked}
                  flow={CANDIDATE_FLOW}
                  clock={transport}
                  onError={setBenchError}
                />
              ) : (
                <p className="reviews-fetching">fetching the candidate…</p>
              )}
            </div>
            <div className="train-under">
              <span className="train-name">{selected.flowName}</span>
              <span className="train-provenance">
                {selected.room.seed === 'live'
                  ? 'judged against the live set'
                  : `room ${selected.room.seed}`}
                {` · ${Number.isInteger(selected.room.tempo) ? selected.room.tempo.toFixed(0) : selected.room.tempo.toFixed(1)} bpm`}
                {selected.room.section ? ` · ${selected.room.section}` : ''}
                {` · ${selected.candidateId.slice(0, 12)}`}
              </span>
              <span className="train-palette">
                {selected.room.colors.map((hex, at) => (
                  <i key={`${hex}${at}`} style={{ background: hex }} />
                ))}
              </span>
              {benchError && <span className="train-error">{benchError}</span>}
            </div>
          </div>

          <div className="reviews-judgment wdg">
            <div className="reviews-score">
              <span className="reviews-rescore" role="radiogroup" aria-label="Score">
                {SCORES.map(({ score, means }) => (
                  <button
                    key={score}
                    type="button"
                    role="radio"
                    aria-checked={selected.score === score}
                    data-on={selected.score === score ? '' : undefined}
                    title={means}
                    onClick={() => score !== selected.score && labRescore(selected.id, score)}
                  >
                    {score}
                  </button>
                ))}
              </span>
              <span>{SCORES.find(({ score }) => score === selected.score)?.means}</span>
              <span className="reviews-when">{when(selected.createdAt)}</span>
            </div>

            <TagPicker
              chosen={selected.tags}
              toggle={toggleTag}
              placeholder="find a tag — ⏎ adds"
            />

            <textarea
              className="train-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={saveNote}
              placeholder="a note, if one is worth keeping…"
              aria-label="Review note"
            />

            <div className="train-verbs">
              <span className="gap" />
              <Button
                tone="quiet"
                onPress={copy}
                disabled={!graph || copied}
                title="Copy this frozen flow into the open scheme — saved by the ordinary save"
              >
                {copied ? 'copied ✓' : 'copy to scheme'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
