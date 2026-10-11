import { useEffect, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import { useNotice, useTauriEvent } from './hooks.ts';
import { movesOn } from './home.ts';
import * as link from './link.ts';
import * as pl from './playlists.ts';
import { SwitchRow } from './Switch.tsx';
import { NoticeBanner } from './views.tsx';
import { say, Say } from './words.ts';
import './link.css';

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
  const trouble = notice && <NoticeBanner className="link-problem" notice={notice} onDismiss={dismiss} />;
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
 * Link in ⚙ Settings: keeping in time with Ableton on or off, who is in the
 * session, and the bar start — a beat earlier or later, set to the nearest bar
 * line, or back to Link's own.
 */
export function LinkSettings() {
  const { frame, run, trouble } = useLink();
  if (!frame)
    return (
      <div className="link-settings">
        {trouble ?? (
          <p className="link-quiet" role="status">
            Starting…
          </p>
        )}
      </div>
    );
  const start = say('the one');
  return (
    <div className="wdg link-settings">
      <SwitchRow
        name={Say('Ableton Link')}
        on={frame.enabled}
        onChange={(on) => run(link.enable(on), on ? 'join the Link session' : 'leave the Link session')}
        title="Join the Link session on the network, to follow its tempo and bars"
      />
      <p className="link-status" data-on={frame.enabled && frame.peers > 0 ? '' : undefined}>
        <b>{frame.tempo.toFixed(1)}</b> bpm · {link.statusText(frame)}
      </p>
      <div className="link-one" role="group" aria-label={Say('the one')}>
        <span className="link-one-name">{Say('the one')}</span>
        <Button onPress={() => run(link.nudge(-1), `move the ${start}`)} label={`Move the ${start} a beat earlier`} title={`The ${start} a beat earlier`}>
          −
        </Button>
        <Button onPress={() => run(link.setOne(), `set the ${start}`)} label={`Set the ${start} to the nearest bar line`} title="The nearest bar line (the coming one, late in a bar)">
          set
        </Button>
        <Button onPress={() => run(link.nudge(1), `move the ${start}`)} label={`Move the ${start} a beat later`} title={`The ${start} a beat later`}>
          +
        </Button>
        <Button onPress={() => run(link.resetOne(), `reset the ${start}`)} label={`Reset the ${start}`} title="Back to Link's own bar lines">
          reset
        </Button>
      </div>
      {trouble}
    </div>
  );
}

/**
 * Ableton Link and the one: who is in the session and at what tempo, the bar counted
 * from the one with a light per beat, "set one" (with a beat's nudge either way), and
 * how often the preset changes on the beat. Visuals follow the session; nothing here
 * sets its tempo or transport. The picker shows the timing in effect and whose it is:
 * outside playlists it is theirs (the welcome's choice, kept); while a playlist plays
 * a change is a live one, said so, with Put back to the playlist's own.
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
      <section className="link-panel" aria-label="Ableton Link">
        <h2>Link</h2>
        {trouble ?? <p className="link-quiet">Starting…</p>}
      </section>
    );
  }

  const { bar, phase } = link.runOn(frame, now);
  const lit = Math.min(frame.quantum - 1, Math.floor(phase));
  const choices = link.choicesFor(frame.every);
  const at = choices.findIndex((c) => c.every === frame.every.every && c.unit === frame.every.unit);
  const toNext = link.beatsToNext(frame, now);
  const whose = link.timingSays(lists);

  return (
    <section className="link-panel" aria-label="Ableton Link">
      <div className="link-head">
        <h2>Link</h2>
        <Toggle
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
      <p className="link-status" data-on={frame.enabled && frame.peers > 0 ? '' : undefined}>
        <b>{frame.tempo.toFixed(1)}</b> bpm · {link.statusText(frame)}
      </p>
      <div className="link-beat" aria-label={`bar ${bar}, beat ${lit + 1} of ${frame.quantum}`} role="img">
        <span className="link-bar" title="The bar, counted from the one">
          {bar}
        </span>
        <span className="link-lights" aria-hidden="true">
          {Array.from({ length: frame.quantum }, (_, i) => (
            <span key={i} className="link-light" data-lit={i === lit ? '' : undefined} data-one={i === 0 ? '' : undefined} />
          ))}
        </span>
      </div>
      <div className="link-one">
        <Button onPress={() => run(link.nudge(-1), 'move the one')} label="Move the one a beat earlier" title="The one a beat earlier">
          −
        </Button>
        <Button onPress={() => run(link.setOne(), 'set the one')} title="The one is the nearest bar line (the coming one, late in a bar)">
          set one
        </Button>
        <Button onPress={() => run(link.nudge(1), 'move the one')} label="Move the one a beat later" title="The one a beat later">
          +
        </Button>
        <Button onPress={() => run(link.resetOne(), 'reset the one')} title="Back to Link's own bar lines">
          reset
        </Button>
      </div>
      <div className="link-every">
        <Select
          className="link-every-pick"
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
        {toNext !== null && <span className="link-quiet">in {Math.max(0, Math.ceil(toNext))} beats</span>}
      </div>
      <p className="link-quiet link-whose" role="status">
        {whose.kind === 'outside' ? (
          'Outside playlists. A playlist plays by its own timing.'
        ) : whose.kind === 'playlist' ? (
          `${whose.name}’s own timing.`
        ) : (
          <>
            Changed live: {whose.name} {movesOn(whose.own)} on its own.{' '}
            <Button onPress={() => run(pl.act({ kind: 'put_back' }).then(link.state), `put back ${whose.name}’s timing`)} title={`Back to ${whose.name}’s own timing`}>
              Put back
            </Button>
          </>
        )}
      </p>
      {trouble}
    </section>
  );
}
