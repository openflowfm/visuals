import { useEffect, useMemo, useState } from 'react';
import type {
  LabEffect,
  LabRoom,
  LabScore,
  LabState,
  LabSubmission,
  Scheme,
  Show,
} from '../../protocol.ts';
import {
  SCORES,
  TAG_CATEGORIES,
  TAGS,
  dealRoom,
  promoteCandidate,
  submissionProblems,
} from '../../lab.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { KEYS, packColor } from '../state/useRoom.ts';
import { RESTING } from '../state/useShow.ts';
import { useTransport } from '../state/useTransport.ts';
import { BPM, ENERGY, PERCENT } from './param.ts';
import { Bench } from './Preview.tsx';

/**
 * The review view: one candidate at a time, judged like a dive.
 *
 * Not a second launcher and not an arena — candidates do not compete, because
 * a library whose owner likes many kinds of thing has no use for a single
 * ladder. The candidate gets the wall, the judge gives it an anchored score
 * and a useful account of the score, and the next candidate follows.
 *
 * Everything here draws through the same `Bench` the designer judges flows on,
 * against a **frozen** scheme built from the candidate and its dependency
 * bundle — never the open one, so editing the library later cannot change what
 * an old judgment was looking at. The room is invented, dealt from a seed,
 * adjustable before scoring; whatever room is actually on screen rides the
 * submission, palette by value.
 *
 * Closing the view unmounts the `Bench`, which frees its compositor — the one
 * GL context this view owns. Nothing renders, and nothing is dealt, while the
 * view is closed.
 */
export function ReviewView({
  scheme,
  lab,
  labOpen,
  labReview,
  labSkip,
  edit,
}: {
  scheme: Scheme;
  lab: LabState | null;
  labOpen(): void;
  labReview(review: LabSubmission): void;
  labSkip(candidateId: string): void;
  edit(next: Scheme): void;
}) {
  const candidate = lab?.candidate ?? null;

  // Everything judged is keyed to the candidate on the wall: a new deal resets
  // the room, the score, the tags and the note in one place, so a judgment can
  // never be half about the previous candidate.
  const [judging, setJudging] = useState<{
    id: string | null;
    room: LabRoom | null;
    rooms: number;
    score: LabScore | null;
    tags: { id: string; effect: LabEffect }[];
    note: string;
    promoted: boolean;
  }>({ id: null, room: null, rooms: 0, score: null, tags: [], note: '', promoted: false });
  const [search, setSearch] = useState('');
  const [benchError, setBenchError] = useState<string | null>(null);

  const transport = useTransport(null, false);

  useEffect(() => {
    labOpen();
  }, [labOpen]);

  // A new deal resets the judgment whole and re-tunes the clock to the dealt
  // room, from the top of a bar — so every candidate is met the same way.
  const dealtId = candidate?.id ?? null;
  const dealtRoom = lab?.room ?? null;
  useEffect(() => {
    if (!dealtId) return;
    const room = dealtRoom ?? dealRoom(`room:${dealtId}`);
    setJudging({ id: dealtId, room, rooms: 0, score: null, tags: [], note: '', promoted: false });
    transport.setBpm(room.tempo);
    transport.restart();
  }, [dealtId]); // eslint-disable-line react-hooks/exhaustive-deps

  const room = judging.id === dealtId ? judging.room : null;

  /** The frozen candidate as a scheme of its own, for the bench to draw. */
  const parked = useMemo((): Scheme | null => {
    if (!candidate) return null;
    return {
      flows: { ...candidate.bundle, '~candidate': candidate.flow },
      colorways: {},
      rotation: { flows: [], colorways: [], bars: 0, onClip: false, colorEvery: 0 },
      songs: {},
      defaults: { colorway: '', flow: '~candidate', pace: 0, draws: 'by name' },
    };
  }, [candidate]);

  /** The invented room as a `Show`, which is all the renderer understands. */
  const staged = useMemo((): Show => {
    if (!room || !candidate) return RESTING;
    const colors = (room.colors.length ? room.colors : ['#ffffff']).map(packColor);
    return {
      ...RESTING,
      playing: true,
      tempo: room.tempo,
      quantum: room.quantum,
      master: room.energy,
      colors,
      // The candidate id, so a `song seed` node reads a number that is stable
      // for this candidate and different for the next one.
      song: candidate.id,
      key: room.key === null ? null : room.key / 12,
      role: room.section,
      roles: [...room.sections],
    };
  }, [room, candidate]);

  const reroom = () => {
    if (!candidate) return;
    const next = dealRoom(`room:${candidate.id}~${judging.rooms + 1}`);
    setJudging((held) => ({ ...held, room: next, rooms: held.rooms + 1 }));
    transport.setBpm(next.tempo);
  };

  const setRoom = (patch: Partial<LabRoom>) => {
    setJudging((held) => (held.room ? { ...held, room: { ...held.room, ...patch } } : held));
  };

  const toggleTag = (id: string) => {
    setJudging((held) => ({
      ...held,
      tags: held.tags.some((each) => each.id === id)
        ? held.tags.filter((each) => each.id !== id)
        : [...held.tags, { id, effect: 'neutral' as LabEffect }],
    }));
  };

  const setEffect = (id: string, effect: LabEffect) => {
    setJudging((held) => ({
      ...held,
      tags: held.tags.map((each) => (each.id === id ? { ...each, effect } : each)),
    }));
  };

  const problems = submissionProblems({ score: judging.score, tags: judging.tags });

  const submit = () => {
    if (!candidate || !room || judging.score === null || problems.length > 0) return;
    labReview({
      candidateId: candidate.id,
      room,
      score: judging.score,
      tags: judging.tags,
      note: judging.note.trim() || undefined,
    });
  };

  const promote = () => {
    if (!candidate || judging.promoted) return;
    edit(promoteCandidate(scheme, candidate).scheme);
    setJudging((held) => ({ ...held, promoted: true }));
  };

  if (!candidate || !room) {
    return (
      <div className="review review-empty">
        <p>{lab?.notice ?? 'waiting for the lab to deal a candidate…'}</p>
        <Button onPress={labOpen}>ask again</Button>
      </div>
    );
  }

  const chosen = new Set(judging.tags.map((each) => each.id));
  const looking = search.trim().toLowerCase();
  const nodes = candidate.flow.circuit.nodes.length;

  return (
    <div className="review">
      <div className="review-stage">
        <div className="review-frame">
          <Bench
            show={staged}
            scheme={parked!}
            flow="~candidate"
            clock={transport}
            onError={setBenchError}
          />
        </div>
        <div className="review-under">
          <span className="review-name">{candidate.flow.name}</span>
          <span className="review-provenance">
            {nodes} node{nodes === 1 ? '' : 's'} · {candidate.method} v{candidate.methodVersion}
            {candidate.seed ? ` · ${candidate.seed}` : ''} · {candidate.id.slice(0, 12)}
          </span>
          {benchError && <span className="review-error">{benchError}</span>}
        </div>
        <div className="review-room wdg">
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
          <NumberField
            param={BPM}
            value={room.tempo}
            onChange={(bpm) => {
              setRoom({ tempo: bpm });
              transport.setBpm(bpm);
            }}
            name="tempo"
            label="Room tempo"
            display={`${room.tempo.toFixed(0)} bpm`}
            width={62}
          />
          <NumberField
            param={ENERGY}
            value={PERCENT.to(room.energy)}
            onChange={(value) => setRoom({ energy: PERCENT.from(value) })}
            name="energy"
            width={48}
          />
          <Select
            items={[...room.sections]}
            index={Math.max(0, room.sections.indexOf(room.section))}
            onChange={(at) => setRoom({ section: room.sections[at] })}
            name="section"
            width={104}
          />
          <Select
            items={['—', ...KEYS]}
            index={room.key === null ? 0 : room.key + 1}
            onChange={(at) => setRoom({ key: at === 0 ? null : at - 1 })}
            name="key"
            width={58}
            title="What a `song key` node reports; — states none"
          />
          <span className="review-palette" title={`room ${room.seed}`}>
            {room.colors.map((hex, at) => (
              <i key={`${hex}${at}`} style={{ background: hex }} />
            ))}
          </span>
          <Button tone="quiet" onPress={reroom} title="Deal a different room for the same candidate">
            another room
          </Button>
        </div>
      </div>

      <div className="review-judgment wdg">
        <section className="review-scores">
          <h3>score</h3>
          {SCORES.map(({ score, means }) => (
            <button
              key={score}
              type="button"
              className="review-score"
              data-on={judging.score === score ? '' : undefined}
              onClick={() => setJudging((held) => ({ ...held, score }))}
            >
              <b>{score}</b>
              <span>{means}</span>
            </button>
          ))}
        </section>

        {judging.tags.length > 0 && (
          <section className="review-chosen">
            <h3>this review says</h3>
            {judging.tags.map((each) => {
              const tag = TAGS.find((held) => held.id === each.id)!;
              return (
                <div key={each.id} className="review-said">
                  <span className="review-said-label">{tag.label}</span>
                  <span className="review-effect" role="radiogroup" aria-label={`${tag.label} effect`}>
                    {(['hurt', 'neutral', 'helped'] as const).map((effect) => (
                      <button
                        key={effect}
                        type="button"
                        role="radio"
                        aria-checked={each.effect === effect}
                        data-on={each.effect === effect ? '' : undefined}
                        title={effect}
                        onClick={() => setEffect(each.id, effect)}
                      >
                        {effect === 'hurt' ? '−' : effect === 'helped' ? '+' : '·'}
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
          </section>
        )}

        <section className="review-tags">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="find a tag…"
            aria-label="Filter tags"
          />
          {TAG_CATEGORIES.map(({ category, about }) => {
            const rows = TAGS.filter(
              (tag) =>
                tag.active &&
                tag.category === category &&
                (!looking ||
                  tag.label.toLowerCase().includes(looking) ||
                  tag.description.toLowerCase().includes(looking)),
            );
            if (rows.length === 0) return null;
            return (
              <div key={category} className="review-shelf">
                <h4 title={about}>{category}</h4>
                <div className="review-chips">
                  {rows.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className="review-chip"
                      data-on={chosen.has(tag.id) ? '' : undefined}
                      title={tag.description}
                      onClick={() => toggleTag(tag.id)}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <textarea
          className="review-note"
          value={judging.note}
          onChange={(event) => setJudging((held) => ({ ...held, note: event.target.value }))}
          placeholder="a note, if one is worth keeping…"
          aria-label="Review note"
        />

        {lab?.notice && <p className="review-notice">{lab.notice}</p>}
        {problems.length > 0 && judging.score !== null && (
          <p className="review-gate">{problems.join(' · ')}</p>
        )}

        <div className="review-verbs">
          <Button onPress={submit} disabled={judging.score === null || problems.length > 0}>
            submit · next
          </Button>
          <Button tone="quiet" onPress={() => labSkip(candidate.id)} title="Not a judgment — never a score">
            skip
          </Button>
          <span className="gap" />
          <Button
            tone="quiet"
            onPress={promote}
            disabled={judging.promoted}
            title="Copy this candidate into the open scheme — saved by the ordinary save"
          >
            {judging.promoted ? 'promoted ✓' : 'promote to library'}
          </Button>
        </div>
      </div>
    </div>
  );
}
