import { useEffect, useState } from 'react';
import type {
  CalibrationState,
  CalibrationSubmission,
  FlowDef,
  LabComparisonSubmission,
  LabArchiveSubmission,
  LabFinalsSubmission,
  LabLineageFinalistSubmission,
  LabReviewRow,
  LabScore,
  LabState,
  Library,
  MediaAsset,
  Scheme,
  SetGrid,
  Show,
} from '../../protocol.ts';
import { EXAMPLES_SCHEME_ID, schemeLabel } from '../../protocol.ts';
import '@openflow/widgets/tokens.css';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Designer } from './Designer.tsx';
import { ReviewsView } from './ReviewsView.tsx';
import { SetView } from './SetView.tsx';
import { TrainView } from './TrainView.tsx';
import { CalibrationView } from './CalibrationView.tsx';
import { flowList, renameFlow } from './edits.ts';
import { BPM, ENERGY, PERCENT } from './param.ts';
import { KEYS, useRoom, type Room } from '../state/useRoom.ts';
import { useTransport, type Transport } from '../state/useTransport.ts';
import type { Clock } from '../state/useShow.ts';
import './console.css';

/**
 * One app, four product tabs, and a fifth development tab only when the server
 * advertises calibration. It started as three views.
 *
 * **Build** is the product: a canvas, a library of flows, and a browser of
 * every node there is. **Set** is the small remainder — the wheel that turns
 * through what you built, and the handful of songs that want to say otherwise.
 * **Train** and **review** are the lab's two faces: fast recursive comparisons,
 * and the detailed score/tag corpus preserved for slower judgment.
 *
 * What went was coverage and bind, and both went for the same reason. Coverage
 * drew every song against every track and asked which cell nobody had decided
 * about; bind held a four-level address and asked how far a fix should reach.
 * Both were navigation for a cascade, and the cascade existed to answer how two
 * pictures combine. A graph answers that, so there are no cells to be missing
 * and no scope to choose — what a track draws is something you wire.
 *
 * Deleting them rather than leaving them was the whole point. Keeping them would
 * have meant keeping the cascade alive underneath, which is exactly the
 * complexity the collapse was for.
 */
export interface ConsoleProps {
  show: Show;
  scheme: Scheme;
  library: Library | null;
  media: readonly MediaAsset[];
  grid: SetGrid | null;
  /** Publish an edit to every screen. Disk is `saveScheme`'s business. */
  edit(next: Scheme): void;
  saveScheme(): void;
  saveSchemeAs(id: string): void;
  loadScheme(id: string): void;
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
  labOffer(flowId: string): void;
  labLog: { reviews: LabReviewRow[]; more: boolean } | null;
  labLogOpen(before?: number): void;
  labRescore(reviewId: number, score: LabScore): void;
  labRetag(reviewId: number, tags: string[]): void;
  labRenote(reviewId: number, note: string): void;
  labStage: { id: string; flow: FlowDef; bundle: Record<string, FlowDef> } | null;
  labCandidate(candidateId: string): void;
  calibrationAvailable: boolean;
  calibration: CalibrationState | null;
  calibrationOpen(trialId?: string, trialVersion?: number): void;
  calibrationDecide(decision: CalibrationSubmission): void;
  clock: Clock;
  onClose(): void;
}

/**
 * Four product tabs. **Build** is the editor and the product; **train** compares
 * generated directions through recursive Explore and Refine turns; **review**
 * browses detailed anchored judgments and revises their tags and notes; **set**
 * is the wheel and the songs. The lab under train and review is `lab.ts` and
 * `server/lab.ts`; neither tab touches the scheme except when a candidate is
 * explicitly copied into it, through the same `edit` the designer uses.
 */
const VIEWS = ['build', 'train', 'review', 'set', 'calibrate'] as const;
export type View = (typeof VIEWS)[number];

export function Console({
  show,
  scheme,
  library,
  media,
  grid,
  edit,
  saveScheme,
  saveSchemeAs,
  loadScheme,
  lab,
  labOpen,
  labCompare,
  labSkipEncounter,
  labArchiveOpen,
  labArchiveSelect,
  labArchiveDecide,
  labLineageFinalist,
  labFinalsOpen,
  labFinalsNew,
  labFinalsCompare,
  labFinalsSkip,
  labOffer,
  labLog,
  labLogOpen,
  labRescore,
  labRetag,
  labRenote,
  labStage,
  labCandidate,
  calibrationAvailable,
  calibration,
  calibrationOpen,
  calibrationDecide,
  clock,
  onClose,
}: ConsoleProps) {
  const [view, setView] = useState<View>('build');
  const [flow, setFlow] = useState<string | null>(null);
  const [trail, setTrail] = useState<readonly string[]>([]);
  const views: readonly View[] = calibrationAvailable
    ? VIEWS
    : VIEWS.filter((candidate) => candidate !== 'calibrate');
  useEffect(() => {
    if (!calibrationAvailable && view === 'calibrate') setView('build');
  }, [calibrationAvailable, view]);
  const list = flowList(scheme);
  const id = flow && scheme.flows[flow] ? flow : (list[0]?.id ?? null);
  const def = id ? scheme.flows[id] : null;
  const canFollow = show.clock && show.connected;
  const transport = useTransport(clock, canFollow);
  const room = useRoom(show, scheme, transport);

  const back = (at: number) => {
    const to = trail[at];
    if (!to) return;
    setTrail(trail.slice(0, at));
    setFlow(to);
  };

  return (
    <div className="console wdg">
      <header className="console-head">
        <Segmented
          items={views as unknown as string[]}
          index={Math.max(0, views.indexOf(view))}
          onChange={(i) => setView(views[i] ?? 'build')}
          label="View"
          className="views"
        />
        <Schemes
          library={library}
          saveScheme={saveScheme}
          saveSchemeAs={saveSchemeAs}
          loadScheme={loadScheme}
        />
        {view === 'build' && def && id ? (
          <div className="flow-context">
            {trail.length > 0 && (
              <nav className="flow-trail" aria-label="How you got here">
                {trail.map((each, at) => (
                  <button key={`${each}${at}`} type="button" onClick={() => back(at)}>
                    {scheme.flows[each]?.name || each}
                  </button>
                ))}
              </nav>
            )}
            <input
              className="flow-title"
              value={def.name}
              spellCheck={false}
              aria-label="Flow name"
              onChange={(event) => edit(renameFlow(scheme, id, event.currentTarget.value))}
            />
            <Button
              tone="quiet"
              onPress={() => {
                labOffer(id);
                setView('train');
              }}
              title="Freeze this flow as it is and offer it to the train loop"
            >
              train
            </Button>
          </div>
        ) : view === 'train' ? (
          <span className="train-context">
            {lab
              ? `${lab.method} · ${lab.comparisons} comparisons · ${lab.frontier} frontier · depth ${lab.maxGeneration}`
              : 'opening the lab…'}
          </span>
        ) : view === 'review' ? (
          <span className="train-context">
            {labLog
              ? `${labLog.reviews.length}${labLog.more ? '+' : ''} review${labLog.reviews.length === 1 && !labLog.more ? '' : 's'}`
              : 'opening the lab…'}
          </span>
        ) : view === 'calibrate' ? (
          <span className="train-context">
            {calibration
              ? `${calibration.decided} / ${calibration.total} responses decided`
              : 'opening calibration…'}
          </span>
        ) : (
          <span className="head-space" />
        )}
        {view === 'build' && (
          <PreviewControls room={room} transport={transport} canFollow={canFollow} />
        )}
        <Button tone="quiet" label="Close console" onPress={onClose}>
          ×
        </Button>
      </header>

      {view === 'build' && (
        <Designer
          show={show}
          scheme={scheme}
          media={media}
          edit={edit}
          flow={flow}
          setFlow={setFlow}
          room={room}
          transport={transport}
          trail={trail}
          setTrail={setTrail}
        />
      )}

      {view === 'set' && <SetView show={show} scheme={scheme} grid={grid} edit={edit} />}

      {view === 'train' && (
        <TrainView
          clock={clock}
          scheme={scheme}
          lab={lab}
          labOpen={labOpen}
          labCompare={labCompare}
          labSkipEncounter={labSkipEncounter}
          labArchiveOpen={labArchiveOpen}
          labArchiveSelect={labArchiveSelect}
          labArchiveDecide={labArchiveDecide}
          labLineageFinalist={labLineageFinalist}
          labFinalsOpen={labFinalsOpen}
          labFinalsNew={labFinalsNew}
          labFinalsCompare={labFinalsCompare}
          labFinalsSkip={labFinalsSkip}
          edit={edit}
        />
      )}

      {view === 'review' && (
        <ReviewsView
          labLog={labLog}
          labLogOpen={labLogOpen}
          labRescore={labRescore}
          labRetag={labRetag}
          labRenote={labRenote}
          labStage={labStage}
          labCandidate={labCandidate}
          scheme={scheme}
          edit={edit}
        />
      )}

      {view === 'calibrate' && calibrationAvailable && (
        <CalibrationView
          state={calibration}
          open={calibrationOpen}
          decide={calibrationDecide}
          clock={clock}
        />
      )}
    </div>
  );
}

/** The whole preview room, one aligned run in the one header. */
function PreviewControls({
  room,
  transport,
  canFollow,
}: {
  room: Room;
  transport: Transport;
  canFollow: boolean;
}) {
  const following = room.following;
  const tempo = following ? room.show.tempo : transport.bpm;
  const energy = following ? room.show.master : room.energy;
  const section = following ? room.show.role : room.section;
  const colorway = following ? room.show.colorway : room.colorway;
  const sectionItems = following && section === null ? ['—'] : room.sections;
  const colorwayItems = following && colorway === null ? ['—'] : room.colorways;
  const keyItems = following && room.show.key === null ? ['—'] : KEYS;
  const keyAt =
    following && room.show.key !== null
      ? Math.round(room.show.key * KEYS.length) % KEYS.length
      : room.keyAt;
  const playing = following ? room.show.playing : transport.playing;
  const bpm = Number.isInteger(tempo) ? tempo.toFixed(0) : tempo.toFixed(1);

  return (
    <div className="preview-controls">
      <div className="clock-actions">
        <Button
          tone="quiet"
          label={playing ? 'Stop the preview clock' : 'Play the preview clock'}
          title={following ? 'Live owns the clock' : undefined}
          onPress={() => transport.setPlaying(!transport.playing)}
          disabled={following}
        >
          {playing ? '■' : '▶'}
        </Button>
        <Button
          tone="quiet"
          label="Back to the top of the bar"
          onPress={transport.restart}
          disabled={following}
        >
          ↺
        </Button>
      </div>
      <NumberField
        param={BPM}
        value={tempo}
        onChange={transport.setBpm}
        name="tempo"
        label="Preview tempo"
        display={`${bpm} bpm`}
        width={62}
        disabled={following}
      />
      <NumberField
        param={ENERGY}
        value={PERCENT.to(energy)}
        onChange={(value) => room.setEnergy(PERCENT.from(value))}
        name="energy"
        width={48}
        disabled={following}
      />
      <Select
        items={sectionItems}
        index={Math.max(0, sectionItems.indexOf(section ?? '—'))}
        onChange={(at) => room.setSection(room.sections[at])}
        name="section"
        width={104}
        disabled={following || room.sections.length === 0}
        title="What a `song section` node reports"
      />
      <Select
        items={colorwayItems}
        index={Math.max(0, colorwayItems.indexOf(colorway ?? '—'))}
        onChange={(at) => room.setColorway(room.colorways[at])}
        name="colourway"
        width={110}
        disabled={following || room.colorways.length === 0}
        title="What `paint` and the set's own tracks draw from"
      />
      <Select
        items={keyItems}
        index={keyAt}
        onChange={room.setKeyAt}
        name="key"
        width={58}
        disabled={following}
        title="What a `song key` node reports"
      />
      <div className="room-source">
        <span className="wdg-caption">source</span>
        <div className="room-source-body" role="radiogroup" aria-label="Preview source">
          <button
            type="button"
            role="radio"
            aria-checked={!following}
            data-on={!following ? '' : undefined}
            title="Invented conditions, controls yours"
            onClick={() => transport.setFollowing(false)}
          >
            preview
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={following}
            data-on={following ? '' : undefined}
            disabled={!canFollow}
            title={canFollow ? 'The real show, as it plays' : 'Nothing to follow — no bridge is connected'}
            onClick={() => transport.setFollowing(true)}
          >
            live
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The scheme shelf: which show this is, whether it is saved, and the way to
 * another one.
 *
 * The name is a button that opens the library; the save sits beside it and is
 * lit only when there is a distance between the screen and the file — that
 * distance is the whole reason the button exists. Anything that would discard
 * unsaved edits asks by arming: the first press turns the row into the
 * question, the second answers it. A dialog would ask harder and be worse —
 * this is furniture inside a console, not an event.
 */
function Schemes({
  library,
  saveScheme,
  saveSchemeAs,
  loadScheme,
}: {
  library: Library | null;
  saveScheme(): void;
  saveSchemeAs(id: string): void;
  loadScheme(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [arming, setArming] = useState<string | null>(null);
  const [naming, setNaming] = useState('');
  if (!library) return null;

  const pick = (id: string) => {
    // Loading the open scheme is a revert, so it asks the same way a switch
    // does: both throw away the edits on screen.
    if (library.dirty && arming !== id) {
      setArming(id);
      return;
    }
    loadScheme(id);
    setOpen(false);
    setArming(null);
  };

  const saveAs = () => {
    const id = naming
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[^a-z]+/, '');
    if (!id) return;
    // Onto a scheme that already exists is an overwrite, and arms like one.
    if (id !== library.current && library.schemes.includes(id) && arming !== `as:${id}`) {
      setArming(`as:${id}`);
      return;
    }
    saveSchemeAs(id);
    setNaming('');
    setOpen(false);
    setArming(null);
  };

  return (
    <div className="schemes">
      <button
        type="button"
        className="which"
        aria-expanded={open}
        onClick={() => {
          setOpen((on) => !on);
          setArming(null);
        }}
      >
        {schemeLabel(library.current)}
        {library.dirty ? <span className="dot" /> : null}
      </button>
      <Button
        tone="quiet"
        label="Save scheme"
        title={library.readOnly ? 'Examples is read-only — use save as' : undefined}
        onPress={saveScheme}
        disabled={library.readOnly || !library.dirty}
      >
        save
      </Button>
      {open && (
        <div className="shelf">
          {library.schemes.map((id) => (
            <button
              key={id}
              type="button"
              className={`row${id === library.current ? ' here' : ''}${arming === id ? ' asking' : ''}`}
              onClick={() => pick(id)}
            >
              {arming === id
                ? id === library.current
                  ? 'discard edits?'
                  : 'discard edits, open?'
                : `${schemeLabel(id)}${id === EXAMPLES_SCHEME_ID ? ' · read only' : ''}`}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveAs();
            }}
          >
            <input
              value={naming}
              onChange={(e) => {
                setNaming(e.target.value);
                setArming(null);
              }}
              placeholder="save as…"
              aria-label="Save the open scheme under a new name"
            />
            {arming?.startsWith('as:') && (
              <span className="asking">overwrites {arming.slice(3)} — again to mean it</span>
            )}
          </form>
        </div>
      )}
      {library.notice && <span className="notice">{library.notice}</span>}
    </div>
  );
}
