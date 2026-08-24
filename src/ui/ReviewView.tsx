import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type {
  LabRoom,
  LabScore,
  LabState,
  LabSubmission,
  Scheme,
  Show,
} from '../../protocol.ts';
import {
  SCORES,
  TAG_BY_ID,
  TAG_CATEGORIES,
  TAGS,
  dealRoom,
  promoteCandidate,
  submissionProblems,
  type LabTag,
} from '../../lab.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { KEYS, packColor } from '../state/useRoom.ts';
import { RESTING, type Clock } from '../state/useShow.ts';
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
 * **Or the room is the set.** The dealt room proves a candidate under
 * conditions nobody has to stage, but the litmus test is the real music — so
 * when a bridge is connected the source switch hands the stage to the live
 * show: the Link beat, the real meters riding the anchors, the section, the
 * key, the colourway that is actually up. The same rule as always decides
 * what a judgment freezes — the room on screen rides the submission — which
 * for the set means a sample taken at the moment of submit, palette by value,
 * with `live` where a dealt room carries its seed.
 *
 * Closing the view unmounts the `Bench`, which frees its compositor — the one
 * GL context this view owns. Nothing renders, and nothing is dealt, while the
 * view is closed.
 */
/** The renderer's packed colour back to the `#rrggbb` a `LabRoom` stores. */
const hexOf = (packed: number) => `#${(packed & 0xffffff).toString(16).padStart(6, '0')}`;

/**
 * The set as a room, sampled at one moment — what a live judgment freezes.
 *
 * Everything by value, the way a dealt room already rides the submission: the
 * challenge this lands in must stay legible years after tonight's set is gone.
 * `seed: 'live'` where a dealt room carries its seed, which is honest — this
 * room cannot be re-dealt, only re-staged from the values stored here.
 */
const heardRoom = (heard: Show): LabRoom => ({
  tempo: Math.round(heard.tempo * 10) / 10,
  quantum: heard.quantum,
  energy: Math.round(heard.master * 100) / 100,
  section: heard.role ?? '',
  sections: [...heard.roles],
  key: heard.key === null ? null : Math.round(heard.key * 12) % 12,
  colors: heard.colors.map(hexOf),
  seed: 'live',
});

export function ReviewView({
  show,
  showRef,
  clock,
  canFollow,
  scheme,
  lab,
  labOpen,
  labReview,
  labSkip,
  edit,
}: {
  show: Show;
  showRef: { readonly current: Show };
  clock: Clock;
  /** Whether there is a live show to judge against: a Link clock and a set. */
  canFollow: boolean;
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
    tags: string[];
    note: string;
    promoted: boolean;
  }>({ id: null, room: null, rooms: 0, score: null, tags: [], note: '', promoted: false });
  const [search, setSearch] = useState('');
  const [benchError, setBenchError] = useState<string | null>(null);

  const transport = useTransport(clock, canFollow);
  /** Judging against the set rather than the dealt room. Masked by `canFollow`. */
  const live = transport.following;

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
      tags: held.tags.includes(id)
        ? held.tags.filter((each) => each !== id)
        : [...held.tags, id],
    }));
  };

  const problems = submissionProblems({ score: judging.score, tags: judging.tags });

  const submit = () => {
    if (!candidate || !room || judging.score === null || problems.length > 0) return;
    labReview({
      candidateId: candidate.id,
      // The room actually judged: the set as heard right now, or the dealt one.
      room: live ? heardRoom(showRef.current) : room,
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

  const chosen = new Set(judging.tags);
  const looking = search.trim().toLowerCase();
  const nodes = candidate.flow.circuit.nodes.length;

  const seeks = (tag: LabTag) =>
    tag.active &&
    (!looking ||
      tag.label.toLowerCase().includes(looking) ||
      tag.description.toLowerCase().includes(looking));
  /** What ⏎ would add: the first match in shelf order, shown with a focus ring. */
  const topMatch = looking ? (TAGS.find(seeks) ?? null) : null;

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (topMatch) {
        toggleTag(topMatch.id);
        setSearch('');
      }
      return;
    }
    if (event.key === 'Escape') {
      setSearch('');
      return;
    }
    if (search === '' && event.key >= '1' && event.key <= '5') {
      event.preventDefault();
      const score = Number(event.key) as LabScore;
      setJudging((held) => ({ ...held, score }));
    }
  };

  // The row shows the room being judged: the set's own numbers while
  // following — disabled, because the set owns them — and the dealt room's
  // controls otherwise. The same derivation the designer's header makes.
  const tempo = live ? show.tempo : room.tempo;
  const bpm = Number.isInteger(tempo) ? tempo.toFixed(0) : tempo.toFixed(1);
  const energy = live ? show.master : room.energy;
  const sections = live ? (show.roles.length ? show.roles : ['—']) : room.sections;
  const section = live ? (show.role ?? '—') : room.section;
  const keyAt = live
    ? show.key === null
      ? 0
      : (Math.round(show.key * 12) % 12) + 1
    : room.key === null
      ? 0
      : room.key + 1;
  const palette = live ? show.colors.map(hexOf) : room.colors;
  const playing = live ? show.playing : transport.playing;

  return (
    <div className="review">
      <div className="review-stage">
        <div className="review-frame">
          <Bench
            show={staged}
            scheme={parked!}
            flow="~candidate"
            clock={transport}
            live={live ? showRef : null}
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
            label={playing ? 'Hold the clock' : 'Run the clock'}
            title={live ? 'The set owns the clock' : undefined}
            disabled={live}
            onPress={() => transport.setPlaying(!transport.playing)}
          >
            {playing ? '■' : '▶'}
          </Button>
          <Button
            tone="quiet"
            label="Back to the top of the bar"
            onPress={transport.restart}
            disabled={live}
          >
            ↺
          </Button>
          <NumberField
            param={BPM}
            value={tempo}
            onChange={(bpm) => {
              setRoom({ tempo: bpm });
              transport.setBpm(bpm);
            }}
            name="tempo"
            label="Room tempo"
            display={`${bpm} bpm`}
            width={62}
            disabled={live}
          />
          <NumberField
            param={ENERGY}
            value={PERCENT.to(energy)}
            onChange={(value) => setRoom({ energy: PERCENT.from(value) })}
            name="energy"
            width={48}
            disabled={live}
          />
          <Select
            items={[...sections]}
            index={Math.max(0, sections.indexOf(section))}
            onChange={(at) => setRoom({ section: room.sections[at] })}
            name="section"
            width={104}
            disabled={live}
          />
          <Select
            items={['—', ...KEYS]}
            index={keyAt}
            onChange={(at) => setRoom({ key: at === 0 ? null : at - 1 })}
            name="key"
            width={58}
            disabled={live}
            title="What a `song key` node reports; — states none"
          />
          <span
            className="review-palette"
            title={live ? 'the palette that is up' : `room ${room.seed}`}
          >
            {palette.map((hex, at) => (
              <i key={`${hex}${at}`} style={{ background: hex }} />
            ))}
          </span>
          <Button
            tone="quiet"
            onPress={reroom}
            disabled={live}
            title="Deal a different room for the same candidate"
          >
            another room
          </Button>
          <div className="room-source">
            <span className="wdg-caption">source</span>
            <div className="room-source-body" role="radiogroup" aria-label="Judging source">
              <button
                type="button"
                role="radio"
                aria-checked={!live}
                data-on={!live ? '' : undefined}
                onClick={() => transport.setFollowing(false)}
              >
                room
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={live}
                data-on={live ? '' : undefined}
                disabled={!canFollow}
                title={
                  canFollow
                    ? 'The real music, as it plays'
                    : 'Nothing to follow — no bridge is connected'
                }
                onClick={() => transport.setFollowing(true)}
              >
                set
              </button>
            </div>
          </div>
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
            <div className="review-chips">
              {judging.tags.map((id) => {
                const tag = TAG_BY_ID.get(id)!;
                return (
                  <button
                    key={id}
                    type="button"
                    className="review-chip"
                    data-on=""
                    data-polarity={tag.polarity === 'neutral' ? undefined : tag.polarity}
                    title={tag.description}
                    onClick={() => toggleTag(id)}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="review-tags">
          <input
            value={search}
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={keys}
            placeholder="find a tag — ⏎ adds · 1–5 score · ⌘⏎ submits"
            aria-label="Filter tags"
          />
          {TAG_CATEGORIES.map(({ category, about }) => {
            const rows = TAGS.filter((tag) => tag.category === category && seeks(tag));
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
                      data-top={topMatch?.id === tag.id ? '' : undefined}
                      data-polarity={tag.polarity === 'neutral' ? undefined : tag.polarity}
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
