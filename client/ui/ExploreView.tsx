import { useEffect, useMemo, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { LabExploreState, LabSeedSubmission, Scheme } from '../../protocol.ts';
import { promoteCandidate, promotedCandidateId } from '../../lab.ts';
import type { Clock } from '../state/useShow.ts';
import { useTransport } from '../state/useTransport.ts';
import { KEYS } from '../state/useRoom.ts';
import { Bench } from './Preview.tsx';
import { CANDIDATE_FLOW, parkedScheme, stagedShow } from './stage.ts';

/**
 * Explore: one fresh root, judged alone.
 *
 * There is nothing to compare it to, and that is the point. A pair always
 * manufactures a relative question — is this better than that — when the thing
 * actually being decided is absolute: is there anything here worth developing.
 * Pairing also cost ten of every twelve sampled roots, discarded unseen so two
 * distant ones could be staged together. One at a time is cheaper per look, so
 * more material reaches a person, and the answer stays the answer to the
 * question being asked.
 *
 * Yes bookmarks the root, because "worth developing" and "come back to this"
 * are one intention. No records a decline and nothing else — it is not a
 * verdict the work carries around, and the seed stays in the forest where it
 * can be reconsidered. Skip says no judgment was formed at all, and must never
 * quietly become a no.
 */
export function ExploreView({
  clock,
  scheme,
  explore,
  open,
  judge,
  skip,
  edit,
}: {
  clock: Clock;
  scheme: Scheme;
  explore: LabExploreState | null;
  open(): void;
  judge(submission: LabSeedSubmission): void;
  skip(encounterId: number): void;
  edit(next: Scheme): void;
}) {
  const transport = useTransport(clock, false);
  const [error, setError] = useState<string | null>(null);
  const encounter = explore?.encounter ?? null;
  const candidate = encounter?.candidate ?? null;

  const parked = useMemo(
    () => (candidate ? parkedScheme(candidate.flow, candidate.bundle) : null),
    [candidate],
  );
  const copied = useMemo(
    () => (candidate ? promotedCandidateId(scheme, candidate) !== null : false),
    [scheme, candidate],
  );

  useEffect(() => open(), [open]);

  const encounterId = encounter?.id ?? null;
  useEffect(() => {
    if (!encounter) return;
    setError(null);
    transport.setBpm(encounter.room.tempo);
    transport.restart();
  }, [encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (!encounterId) return;
      if (event.key === 'ArrowUp' || pressed === 'w' || pressed === 'y') {
        event.preventDefault();
        judge({ encounterId, verdict: 'yes' });
      } else if (event.key === 'ArrowDown' || pressed === 'x' || pressed === 'n') {
        event.preventDefault();
        judge({ encounterId, verdict: 'no' });
      } else if (pressed === 's') {
        event.preventDefault();
        skip(encounterId);
      } else if (pressed === 'r') {
        event.preventDefault();
        transport.restart();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [encounterId, judge, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!encounter || !candidate || !parked) {
    return (
      <div className="train train-empty">
        <p>{explore?.notice ?? 'dealing a fresh root…'}</p>
        <Button onPress={open}>ask again</Button>
      </div>
    );
  }

  const room = encounter.room;
  const show = stagedShow(room, `seed:${encounter.id}`);
  const keyName = room.key === null ? 'no key' : (KEYS[room.key] ?? 'no key');
  const rate = explore && explore.seen > 0 ? Math.round((explore.admitted / explore.seen) * 100) : null;

  return (
    <div className="train train-explore">
      <section className="explore-stage">
        <article className="train-candidate" data-side="only">
          <header>
            <span className="train-side">fresh root</span>
            <strong>{candidate.flow.name}</strong>
            <Button
              tone="quiet"
              disabled={copied}
              onPress={() => !copied && edit(promoteCandidate(scheme, candidate).scheme)}
            >
              {copied ? 'copied ✓' : 'copy'}
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
            <span>{candidate.flow.circuit.nodes.length} nodes · generation 0</span>
            {error && <span className="train-error">{error}</span>}
          </footer>
        </article>

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
          <span className="train-palette" title={`room ${room.seed}`}>
            {room.colors.map((hex, at) => (
              <i key={`${hex}${at}`} style={{ background: hex }} />
            ))}
          </span>
        </div>
      </section>

      <aside className="train-choice wdg">
        <header>
          <span className="train-phase">explore</span>
          <span>acquiring stock</span>
        </header>
        <div>
          <h2>Is there anything here worth developing?</h2>
          <p>
            Not whether it is finished, and not whether it beats anything. Yes bookmarks it in the
            forest, where it can be developed whenever you want to spend a batch on it.
          </p>
        </div>

        <div className="train-comparison-verbs" role="group" aria-label="Judge this root">
          <button
            type="button"
            data-choice="left"
            onClick={() => judge({ encounterId: encounter.id, verdict: 'yes' })}
          >
            <kbd>↑ / Y</kbd>
            <b>yes</b>
            <small>bookmark and keep going</small>
          </button>
          <button
            type="button"
            data-choice="neither"
            onClick={() => judge({ encounterId: encounter.id, verdict: 'no' })}
          >
            <kbd>↓ / N</kbd>
            <b>no</b>
            <small>nothing here</small>
          </button>
        </div>

        {/*
          Admitted over seen is the first honest measurement of the dealer this
          lab has been able to take. If it is dismal, no amount of developing
          downstream will help and the work belongs in the generator.
        */}
        <dl className="train-tally">
          <div>
            <dt>seen</dt>
            <dd>{explore?.seen ?? 0}</dd>
          </div>
          <div>
            <dt>admitted</dt>
            <dd>{explore?.admitted ?? 0}</dd>
          </div>
          <div>
            <dt>hit rate</dt>
            <dd>{rate === null ? '—' : `${rate}%`}</dd>
          </div>
          <div>
            <dt>skipped</dt>
            <dd>{explore?.skipped ?? 0}</dd>
          </div>
        </dl>

        {explore?.notice && <p className="train-notice">{explore.notice}</p>}
        <div className="train-verbs">
          <Button
            tone="quiet"
            onPress={() => skip(encounter.id)}
            title="No judgment was formed — shortcut S"
          >
            skip this one
          </Button>
          <span className="gap" />
          <span className="train-restart-hint">R restarts</span>
        </div>
      </aside>
    </div>
  );
}
