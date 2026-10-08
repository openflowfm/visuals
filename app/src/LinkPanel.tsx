import { useEffect, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import { useNotice, useTauriEvent } from './hooks.ts';
import * as link from './link.ts';
import { NoticeBanner } from './views.tsx';
import './link.css';

/**
 * Ableton Link and the one: who is in the session and at what tempo, the bar counted
 * from the one with a light per beat, "set one" (with a beat's nudge either way), and
 * how often the preset changes on the beat. Visuals follow the session; nothing here
 * sets its tempo or transport.
 */
export function LinkPanel() {
  const [frame, setFrame] = useState<link.Frame | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { notice, dismiss, fail } = useNotice();

  useEffect(() => {
    link.state().then(setFrame, fail("Couldn't start Link."));
  }, [fail]);
  useTauriEvent(link.onFrame, setFrame);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const run = (p: Promise<link.Frame>, what: string) =>
    p.then(
      (f) => {
        setFrame(f);
        dismiss();
      },
      fail(`Couldn't ${what}.`),
    );

  const trouble = notice && <NoticeBanner className="link-problem" notice={notice} onDismiss={dismiss} />;

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
          title="Change the preset on the beat; turns auto-advance off"
        />
        {toNext !== null && <span className="link-quiet">in {Math.max(0, Math.ceil(toNext))} beats</span>}
      </div>
      {trouble}
    </section>
  );
}
