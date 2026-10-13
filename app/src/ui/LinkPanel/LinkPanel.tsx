import { useEffect, useState } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Select } from '@satoramoto/zen';
import { Switch, Toggle } from '@satoramoto/zen';
import { useNotice, useTauriEvent } from '../model/hooks';
import { movesOn } from '../model/home';
import * as link from '../model/link';
import * as pl from '../model/playlists';
import { say, Say } from '../model/words';
import { NoticeBanner } from '../Views/Views';
import { Text } from '@satoramoto/zen';
import './LinkPanel.css';

// A port of visual[flow]'s `app/src/LinkPanel.tsx` (and link.css): the same exports
// (`LinkSettings`, `LinkPanel`), behaviour and words.

/** The session's tempo: a tabular numeral in the readout face, at the sheet title's size (LinkPanel.css). */
function Tempo({ bpm }: { bpm: number }) {
  return (
    <Text as="b" role="numeral" leading="normal" className="vs-link-tempo">
      {bpm.toFixed(1)}
    </Text>
  );
}

/** The panel's heading: a strong sentence-case caption (LinkPanel.css sets its size). */
function Title() {
  return (
    <Text as="h2" weight="strong" leading="normal" case="none" className="vs-link-title">
      Link
    </Text>
  );
}

/**
 * Link's state for a panel or a sheet: read once, then followed (`link.onFrame`).
 * `run` sends a change and shows the frame it answers with, or a failure saying
 * what couldn't be done; `trouble` is that failure's banner, if any.
 */
function useLink() {
  const [frame, setFrame] = useState<link.Frame | null>(null);
  const { notice, dismiss, fail } = useNotice();

  useEffect(() => {
    link.state().then(setFrame, fail("Couldn't start Link."));
  }, [fail]);
  useTauriEvent(link.onFrame, setFrame);

  const run = (p: Promise<link.Frame>, what: string) =>
    p.then(
      (f) => {
        setFrame(f);
        dismiss();
      },
      fail(`Couldn't ${what}.`),
    );
  const trouble = notice && <NoticeBanner className="vs-link-problem" notice={notice} onDismiss={dismiss} />;
  return { frame, run, trouble };
}

/** The playlists and the deck, read once and then followed: whose timing the "change preset" picker shows. */
function useLists() {
  const [lists, setLists] = useState<pl.Lists | null>(null);
  useEffect(() => {
    pl.lists().then(setLists, () => {});
  }, []);
  useTauriEvent(pl.onLists, setLists);
  useTauriEvent(pl.onLive, (now: pl.Now) => setLists((l) => l && { ...l, deck: now.deck }));
  return lists;
}

/**
 * **Job.** Link in ⚙ Settings: keeping in time with Ableton on or off, who is in the session, and
 * the bar start — a beat earlier or later, set to the nearest bar line, or back to Link's own.
 *
 * **Changed.** The on/off row is the core `Switch` with its name (the app's `SwitchRow`); the bar
 * start's keys are core `ActionButton`s; the session line is a caption whose tempo is a tabular
 * numeral, green only while someone else is in the session (the signal).
 *
 * **Kept.** The reads and the changes (`link.enable`, `nudge`, `setOne`, `resetOne`), the failure
 * banner, the group's accessible name, every label and tooltip.
 */
export function LinkSettings() {
  const { frame, run, trouble } = useLink();
  if (!frame)
    return (
      <Text as="div" leading="normal" className="vs-link-settings">
        {trouble ?? (
          <p className="vs-link-quiet" role="status">
            Starting…
          </p>
        )}
      </Text>
    );
  const start = say('the one');
  return (
    <Text as="div" leading="normal" className="vs-link-settings">
      <Switch
        checked={frame.enabled}
        onChange={(on) => run(link.enable(on), on ? 'join the Link session' : 'leave the Link session')}
        title="Join the Link session on the network, to follow its tempo and bars"
      >
        {Say('Ableton Link')}
      </Switch>
      <p className="vs-link-status" data-on={frame.enabled && frame.peers > 0 ? '' : undefined}>
        <Tempo bpm={frame.tempo} /> bpm · {link.statusText(frame)}
      </p>
      <div className="vs-link-one" role="group" aria-label={Say('the one')}>
        <span className="vs-link-one-name">{Say('the one')}</span>
        <ActionButton onPress={() => run(link.nudge(-1), `move the ${start}`)} label={`Move the ${start} a beat earlier`} title={`The ${start} a beat earlier`}>
          −
        </ActionButton>
        <ActionButton onPress={() => run(link.setOne(), `set the ${start}`)} label={`Set the ${start} to the nearest bar line`} title="The nearest bar line (the coming one, late in a bar)">
          set
        </ActionButton>
        <ActionButton onPress={() => run(link.nudge(1), `move the ${start}`)} label={`Move the ${start} a beat later`} title={`The ${start} a beat later`}>
          +
        </ActionButton>
        <ActionButton onPress={() => run(link.resetOne(), `reset the ${start}`)} label={`Reset the ${start}`} title="Back to Link's own bar lines">
          reset
        </ActionButton>
      </div>
      {trouble}
    </Text>
  );
}

/**
 * **Job.** Ableton Link and the one: who is in the session and at what tempo, the bar counted from
 * the one with a light per beat, "set one" (with a beat's nudge either way), and how often the
 * preset changes on the beat. Visuals follow the session; nothing here sets its tempo or
 * transport. The picker shows the timing in effect and whose it is: outside playlists it is
 * theirs (the welcome's choice, kept); while a playlist plays a change is a live one, said so,
 * with Put back to the playlist's own.
 *
 * **Changed.** In Home's look, as the Stage's popover gives it: no panel, background or rule of
 * its own (it sits in a float `Layer`), a sentence-case caption for its heading. The lights are
 * soft dots on `--surface-3`, the lit beat in the ink and the one, lit, in the signal's green
 * (`--vs-playing`), the only green here. The bar and tempo are tabular numerals. The on/off is the
 * core `Toggle` (inside), the keys core `ActionButton`s, the interval the core `Select`.
 *
 * **Kept.** The frame followed every animation frame for the bar and beat, the region's name, the
 * beat's `role="img"` label, every action, label, tooltip and line of copy.
 */
export function LinkPanel() {
  const { frame, run, trouble } = useLink();
  const lists = useLists();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!frame) {
    return (
      <Text as="section" leading="normal" className="vs-link" aria-label="Ableton Link">
        <Title />
        {trouble ?? <p className="vs-link-quiet">Starting…</p>}
      </Text>
    );
  }

  const { bar, phase } = link.runOn(frame, now);
  const lit = Math.min(frame.quantum - 1, Math.floor(phase));
  const choices = link.choicesFor(frame.every);
  const at = choices.findIndex((c) => c.every === frame.every.every && c.unit === frame.every.unit);
  const toNext = link.beatsToNext(frame, now);
  const whose = link.timingSays(lists);

  return (
    <Text as="section" leading="normal" className="vs-link" aria-label="Ableton Link">
      <div className="vs-link-head">
        <Title />
        <Toggle
          className="vs-link-toggle"
          on={frame.enabled}
          onChange={(on) => run(link.enable(on), on ? 'join the Link session' : 'leave the Link session')}
          layout="inside"
          name="link"
          label="Ableton Link"
          title="Join the Link session on the network, to follow its tempo and bars"
        >
          {frame.enabled ? 'on' : 'off'}
        </Toggle>
      </div>
      <p className="vs-link-status" data-on={frame.enabled && frame.peers > 0 ? '' : undefined}>
        <Tempo bpm={frame.tempo} /> bpm · {link.statusText(frame)}
      </p>
      <div className="vs-link-beat" aria-label={`bar ${bar}, beat ${lit + 1} of ${frame.quantum}`} role="img">
        <Text role="numeral" weight="strong" leading="normal" className="vs-link-bar" title="The bar, counted from the one">
          {bar}
        </Text>
        <span className="vs-link-lights" aria-hidden="true">
          {Array.from({ length: frame.quantum }, (_, i) => (
            <span key={i} className="vs-link-light" data-lit={i === lit ? '' : undefined} data-one={i === 0 ? '' : undefined} />
          ))}
        </span>
      </div>
      <div className="vs-link-one">
        <ActionButton onPress={() => run(link.nudge(-1), 'move the one')} label="Move the one a beat earlier" title="The one a beat earlier">
          −
        </ActionButton>
        <ActionButton onPress={() => run(link.setOne(), 'set the one')} title="The one is the nearest bar line (the coming one, late in a bar)">
          set one
        </ActionButton>
        <ActionButton onPress={() => run(link.nudge(1), 'move the one')} label="Move the one a beat later" title="The one a beat later">
          +
        </ActionButton>
        <ActionButton onPress={() => run(link.resetOne(), 'reset the one')} title="Back to Link's own bar lines">
          reset
        </ActionButton>
      </div>
      <div className="vs-link-every">
        <Select
          className="vs-link-every-pick"
          name="change preset"
          items={choices.map((c) => c.name)}
          index={Math.max(0, at)}
          onChange={(i) => run(link.sync(choices[i].every, choices[i].unit), 'change the interval')}
          label="Change the preset"
          title={
            whose.kind === 'outside'
              ? 'Change the preset on the beat outside playlists (kept); turns auto-advance off'
              : `Change the preset on the beat: a live change of ${whose.name}, until another playlist plays`
          }
        />
        {toNext !== null && (
          <Text leading="normal" tabular className="vs-link-quiet vs-link-next">
            in {Math.max(0, Math.ceil(toNext))} beats
          </Text>
        )}
      </div>
      <p className="vs-link-quiet vs-link-whose" role="status">
        {whose.kind === 'outside' ? (
          'Outside playlists. A playlist plays by its own timing.'
        ) : whose.kind === 'playlist' ? (
          `${whose.name}’s own timing.`
        ) : (
          <>
            Changed live: {whose.name} {movesOn(whose.own)} on its own.{' '}
            <ActionButton onPress={() => run(pl.act({ kind: 'put_back' }).then(link.state), `put back ${whose.name}’s timing`)} title={`Back to ${whose.name}’s own timing`}>
              Put back
            </ActionButton>
          </>
        )}
      </p>
      {trouble}
    </Text>
  );
}
