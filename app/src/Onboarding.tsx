import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import { setMotion, useMotion } from './access.ts';
import * as api from './api.ts';
import { useFocusTrap } from './focusTrap.ts';
import { plural } from './controls.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import * as link from './link.ts';
import * as pack from './pack.ts';
import * as pl from './playlists.ts';
import { notice, type Notice } from './shell.ts';
import { SourcePicker } from './SourcePicker.tsx';
import { Mark, NoticeBanner, Preview } from './views.tsx';
import { Say, say } from './words.ts';
import './onboarding.css';

/*
 * The first run: a minute that gets the app hearing music, keeping in time and
 * holding presets, and then plays. Welcome → listen to → keep in time with
 * Ableton (only when Ableton is on the network) → the full library → the
 * flashing-light warning → pick a vibe → live. Shown once (`api.firstRun`), and
 * again when the menu asks (`showWelcome`). Live mode's `SilenceBanner` lives
 * here too: the same question, asked again when the music stops.
 */

export type Step = 'welcome' | 'listen' | 'link' | 'library' | 'warning' | 'vibe';

/** Every step, in order; `link` only shows when Ableton is there to keep time with. */
export const STEPS: readonly Step[] = ['welcome', 'listen', 'link', 'library', 'warning', 'vibe'];

/** The steps shown, given how many Link peers are on the network. */
export const stepsFor = (peers: number): Step[] => STEPS.filter((s) => s !== 'link' || peers > 0);

/** The step after `step`, or null after the last. */
export function after(step: Step, peers: number): Step | null {
  const steps = stepsFor(peers);
  const at = steps.indexOf(step);
  return at < 0 ? (steps.find((s) => STEPS.indexOf(s) > STEPS.indexOf(step)) ?? null) : (steps[at + 1] ?? null);
}

/** The step before `step`, or null on the first. */
export function before(step: Step, peers: number): Step | null {
  const steps = stepsFor(peers);
  const at = steps.indexOf(step);
  return at > 0 ? steps[at - 1] : null;
}

/** A download's size, as someone deciding whether to start it reads it. */
export function sizeText(bytes: number): string {
  if (!(bytes > 0)) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

const count = (n: number) => n.toLocaleString('en-US');

/** What the library step says the app has now, and what the full library adds. */
export function libraryLine(s: pack.PackStatus): string {
  const have = Math.max(s.installed, s.starter);
  const size = sizeText(s.size);
  const full = `The ${say('pack')} is ${count(s.total)} ${s.total === 1 ? 'preset' : 'presets'}${size ? ` (${size})` : ''}`;
  return have > 0 ? `You have ${count(have)} to start with. ${full}.` : `${full}.`;
}

/** The full library is already here: nothing to download. */
export const haveAll = (s: pack.PackStatus): boolean => s.total > 0 && s.installed >= s.total;

/** Where the download is, in a few words. */
export function downloadText(s: pack.PackStatus): string {
  if (s.state === 'downloading') {
    const f = pack.fraction(s);
    return f > 0 ? `Downloading — ${Math.round(f * 100)}%. It carries on while you play.` : 'Downloading — it carries on while you play.';
  }
  if (s.state === 'failed') return 'The download stopped. You can try again, or later from the library.';
  return haveAll(s) ? `You have the ${say('pack')}.` : '';
}

/**
 * Below this peak the input counts as silent: −30 dB, over a room's hum in a
 * laptop or webcam microphone (−35 to −40 dB), well under any music.
 */
export const QUIET_PEAK = 0.03;
/** How long the input is silent before live mode says so. */
export const QUIET_MS = 5000;

/**
 * Watches a stream of peaks for silence: `hear(peak, now)` is true once nothing
 * louder than `QUIET_PEAK` has come for `QUIET_MS`. The first reading starts the
 * clock, so a fresh watch never says quiet at once.
 */
export function silenceWatch(quietMs = QUIET_MS, floor = QUIET_PEAK) {
  let since: number | null = null;
  return {
    hear(peak: number, now: number): boolean {
      if (!(peak < floor)) {
        since = null;
        return false;
      }
      since ??= now;
      return now - since >= quietMs;
    },
  };
}

/** A starter playlist to pick, with something in it. */
export interface Vibe {
  /** Its place in `lists.playlists`, which `pl.act({ kind: 'load' })` takes. */
  index: number;
  name: string;
  size: number;
}

/** The playlists worth offering as vibes: the ones with presets in them. */
export const vibes = (lists: pl.Lists | null): Vibe[] =>
  (lists?.playlists ?? []).map((p, index) => ({ index, name: p.name, size: p.items.filter((i) => !i.missing).length })).filter((v) => v.size > 0);

/** Tauri's event, for a menu item: open the welcome flow again. */
export const WELCOME = 'welcome';

/** Open the welcome flow again, from the page (a menu in the header, say). */
export const showWelcome = () => window.dispatchEvent(new Event(WELCOME));

/**
 * Whether the welcome flow is showing: on the first run (`api.firstRun`), and
 * again whenever `showWelcome` or the app's `welcome` event asks. Null until
 * the app has said whether this is the first run; a failure to ask reads as no.
 * `close` puts it away (`Onboarding` has marked the first run done).
 */
export function useWelcome(): { shown: boolean | null; close(): void } {
  const [shown, setShown] = useState<boolean | null>(null);
  useEffect(() => {
    api.firstRun().then(
      (first) => setShown((s) => s || first),
      () => setShown((s) => s ?? false),
    );
    const open = () => setShown(true);
    window.addEventListener(WELCOME, open);
    const off = listen(WELCOME, open).catch(() => () => {});
    return () => {
      window.removeEventListener(WELCOME, open);
      off.then((f) => f());
    };
  }, []);
  const close = useCallback(() => setShown(false), []);
  return { shown, close };
}

/** How the welcome flow ended: into live mode, windowed (the last step), or skipped. */
export type Ending = 'live' | 'skipped';

/**
 * The welcome flow, filling the window, from `start` (the welcome). `onDone`
 * hears how it ended, finished or skipped; either way the first run is marked
 * done, so it doesn't come back by itself.
 */
export function Onboarding({ onDone: done, start = 'welcome' }: { onDone(ending: Ending): void; start?: Step }) {
  const [step, setStep] = useState<Step>(start);
  const [peers, setPeers] = useState(0);
  const onDone = (ending: Ending) => {
    api.firstRunDone().catch(() => {});
    done(ending);
  };

  // Ableton on the network decides whether its step shows; Link is on by default.
  useEffect(() => {
    link.state().then(
      (f) => setPeers(f.enabled ? f.peers : 0),
      () => {},
    );
  }, []);
  useTauriEvent(link.onFrame, (f) => setPeers(f.enabled ? f.peers : 0));

  const next = () => {
    const to = after(step, peers);
    if (to) setStep(to);
    else onDone('live');
  };
  const back = before(step, peers);
  const shown = stepsFor(peers);

  // A new step replaces the button that was pressed: focus goes to the step, so
  // the keyboard and VoiceOver carry on from its top rather than from nowhere.
  const body = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    body.current?.focus();
  }, [step]);

  return (
    <div className="ob" data-step={step}>
      <header className="ob-head">
        <Mark />
        <ol className="ob-dots" aria-label="setup steps">
          {shown.map((s) => (
            <li key={s} data-at={s === step ? '' : undefined} aria-current={s === step ? 'step' : undefined} data-done={shown.indexOf(s) < shown.indexOf(step) ? '' : undefined}>
              <span>{TITLES[s]}</span>
            </li>
          ))}
        </ol>
        <span className="vf-fill" />
        {step !== 'welcome' && (
          <Button tone="quiet" onPress={() => onDone('skipped')} title="Skip the rest of the setup; it's in the menu if you want it again">
            Skip setup
          </Button>
        )}
      </header>
      <main className="ob-body" ref={body} tabIndex={-1} aria-label={TITLES[step]}>
        {step === 'welcome' && <Welcome onStart={next} onSkip={() => onDone('skipped')} />}
        {step === 'listen' && <Listen onNext={next} />}
        {step === 'link' && <KeepTime onNext={next} />}
        {step === 'library' && <FullLibrary onNext={next} />}
        {step === 'warning' && <Warning onNext={next} />}
        {step === 'vibe' && <PickVibe onPicked={() => onDone('live')} />}
      </main>
      {back && (
        <footer className="ob-foot">
          <Button tone="quiet" label="Back" onPress={() => setStep(back)}>
            ← back
          </Button>
        </footer>
      )}
    </div>
  );
}

const TITLES: Record<Step, string> = {
  welcome: 'welcome',
  listen: say('audio input'),
  link: 'Ableton',
  library: say('pack'),
  warning: 'flashing lights',
  vibe: 'vibe',
};

/** The step's main button: the one thing to do next. */
function Main({ onPress, children, disabled }: { onPress(): void; children: string; disabled?: boolean }) {
  return (
    <Button className="ob-main" onPress={onPress} disabled={disabled}>
      {children}
    </Button>
  );
}

function Welcome({ onStart, onSkip }: { onStart(): void; onSkip(): void }) {
  return (
    <section className="ob-step ob-welcome">
      <h1>
        Welcome to <Mark />
      </h1>
      <p className="ob-lead">Visuals that move with your music. Three things to set up first: sound, sync, presets — about a minute.</p>
      <div className="ob-actions">
        <Main onPress={onStart}>Start</Main>
        <Button tone="quiet" onPress={onSkip} title="Go straight to the library; the setup is in the menu if you want it later">
          Skip setup
        </Button>
      </div>
    </section>
  );
}

/** Tauri's event when the test sound stops by itself, after a minute. */
export const TEST_SOUND_ENDED = 'test-sound-ended';

/**
 * Keeps track of the test sound for leaving the step: once a start has been
 * asked for, `leave` stops it, whether or not the start has answered yet, so a
 * quick Continue never leaves the beat playing. A stop that has answered, or
 * the sound ending by itself, means there is nothing left to stop.
 */
export function testSoundGuard(send: (on: boolean) => Promise<void>) {
  let asked = false;
  return {
    send(on: boolean): Promise<void> {
      if (on) asked = true;
      return send(on).then(() => {
        if (!on) asked = false;
      });
    },
    ended() {
      asked = false;
    },
    leave() {
      if (asked) {
        asked = false;
        send(false).catch(() => {});
      }
    },
  };
}

function Listen({ onNext }: { onNext(): void }) {
  const [testing, setTesting] = useState(false);
  const [problem, setProblem] = useState<Notice | null>(null);
  // Remounted after the test sound, so the picker reads the input it gave back.
  const [picker, setPicker] = useState(0);
  const [guard] = useState(() => testSoundGuard(api.testSound));

  const test = (on: boolean) => {
    setProblem(null);
    guard.send(on).then(
      () => {
        setTesting(on);
        if (!on) setPicker((n) => n + 1);
      },
      (e) => {
        setTesting(false);
        setProblem(notice(on ? "The test sound didn't play." : "The test sound didn't stop.", e));
      },
    );
  };
  // Something to watch: a preset in the preview, if none is open yet.
  useEffect(() => {
    pl.lists()
      .then((l) => (l.deck.current ? undefined : pl.act({ kind: 'random' })))
      .catch(() => {});
  }, []);
  // Leaving the step stops the test sound: it is a check, not a source.
  useEffect(() => () => guard.leave(), [guard]);
  // After a minute it stops by itself and gives the input back.
  useEffect(() => {
    const off = listen(TEST_SOUND_ENDED, () => {
      guard.ended();
      setTesting(false);
      setPicker((n) => n + 1);
    }).catch(() => () => {});
    return () => {
      off.then((f) => f());
    };
  }, [guard]);

  return (
    <section className="ob-step ob-listen">
      <div className="ob-text">
        <h1>{Say('audio input')}</h1>
        <p className="ob-lead">Choose what the visuals hear: your DAW, everything this Mac plays, or a microphone or interface.</p>
        <div className="ob-picker" inert={testing} data-off={testing ? '' : undefined}>
          <SourcePicker key={picker} onError={(e) => setProblem(notice("Couldn't read what there is to listen to.", e))} />
        </div>
        {testing && <p className="ob-note">Stop the test sound to choose what to {say('audio input')}.</p>}
        <p className="ob-note">If macOS asks whether visual[flow] may hear audio, allow it — nothing is recorded or sent anywhere.</p>
        <p className="ob-cue">Play something — watch it move.</p>
        <div className="ob-actions">
          <Main onPress={onNext}>Continue</Main>
          <Button onPress={() => test(!testing)} title="Play a test beat straight into the visuals, without sound, to see them move" hint="a test beat straight into the visuals: no sound comes out">
            {testing ? '■ Stop test sound' : '▶ Test sound'}
          </Button>
        </div>
        <NoticeBanner className="ob-problem" notice={problem} onDismiss={() => setProblem(null)} />
      </div>
      <div className="ob-stage">
        <Preview className="ob-preview" />
      </div>
    </section>
  );
}

function KeepTime({ onNext }: { onNext(): void }) {
  const [frame, setFrame] = useState<link.Frame | null>(null);
  const { notice: problem, fail, dismiss } = useNotice();
  useEffect(() => {
    link.state().then(setFrame, fail("Couldn't reach Ableton."));
  }, [fail]);
  useTauriEvent(link.onFrame, setFrame);

  // Every 4 bars unless something else is already set.
  const choices = link.CHOICES;
  const every = frame?.every.every ? frame.every : { every: 4, unit: 'bars' as const };
  const at = Math.max(
    0,
    choices.findIndex((c) => c.every === every.every && c.unit === every.unit),
  );
  const keep = () => link.sync(choices[at].every, choices[at].unit).then(() => onNext(), fail("Couldn't set the preset to change on the beat."));

  return (
    <section className="ob-step">
      <h1>{Say('Ableton Link')}</h1>
      <p className="ob-lead">
        {frame ? `Ableton is on the network: ${plural(frame.peers, 'app')} at ${frame.tempo.toFixed(0)} bpm.` : 'Ableton is on the network.'} The visuals follow its tempo; they never change it.
      </p>
      <div className="ob-row">
        <span>Change the preset</span>
        <Select
          items={choices.slice(1).map((c) => c.name)}
          index={Math.max(0, at - 1)}
          onChange={(i) => link.sync(choices[i + 1].every, choices[i + 1].unit).then(setFrame, fail("Couldn't change that."))}
          label="change the preset"
          width={140}
        />
      </div>
      <div className="ob-actions">
        <Main onPress={keep}>Keep in time</Main>
        <Button tone="quiet" onPress={onNext}>
          Not now
        </Button>
      </div>
      <NoticeBanner className="ob-problem" notice={problem} onDismiss={dismiss} />
    </section>
  );
}

function FullLibrary({ onNext }: { onNext(): void }) {
  const [status, setStatus] = useState<pack.PackStatus | null>(null);
  const [asked, setAsked] = useState(false);
  const { notice: problem, set: setProblem, fail, dismiss } = useNotice();
  useEffect(() => {
    pack.status().then(setStatus, fail(`Couldn't tell how big the ${say('pack')} is.`));
  }, [fail]);
  useTauriEvent(pack.onProgress, setStatus);

  const download = () => {
    setAsked(true);
    dismiss();
    pack.download().then(
      () => onNext(),
      (e) => {
        setAsked(false);
        setProblem(notice("Couldn't start the download.", e));
      },
    );
  };

  const going = status?.state === 'downloading';
  const done = status ? haveAll(status) : false;
  return (
    <section className="ob-step">
      <h1>Get the {say('pack')}</h1>
      <p className="ob-lead">{status ? libraryLine(status) : `Thousands more presets, downloaded once.`}</p>
      {status && downloadText(status) && <p className="ob-note">{downloadText(status)}</p>}
      <div className="ob-actions">
        {going || done ? (
          <Main onPress={onNext}>Continue</Main>
        ) : (
          <Main onPress={download} disabled={asked}>
            {problem ? 'Try again' : status?.state === 'failed' ? 'Download again' : 'Download'}
          </Main>
        )}
        {!going && !done && (
          <Button tone="quiet" onPress={onNext}>
            Maybe later
          </Button>
        )}
      </div>
      <NoticeBanner className="ob-problem" notice={problem} onDismiss={dismiss} />
    </section>
  );
}

/** The photosensitivity warning, as the first run and the menu's Flashing Lights Warning… both say it. */
export const WARNING_TEXT =
  'Many presets flash, strobe and change colour fast. If you or anyone watching may be sensitive to flashing light (photosensitive epilepsy), take care — on a big screen most of all.';

/** What the reduce-flashing switch says it does, beside the warning. */
export const REDUCE_HINT = 'Calms the strobe and flashes, whatever the effects are set to. It follows macOS’s Reduce motion until you choose here; it’s in Settings too.';

/** The reduce-flashing switch, shown with the warning: off and disabled until the app has said. */
export function ReduceFlashing({ motion, onChange }: { motion: api.Motion | null; onChange(on: boolean): void }) {
  return (
    <div className="ob-reduce">
      <Toggle on={motion?.reduced === true} onChange={onChange} disabled={!motion} layout="inside" name={say('reduced motion')} label={Say('reduced motion')} title={REDUCE_HINT}>
        {motion?.reduced ? 'on' : 'off'}
      </Toggle>
      <span>{Say('reduced motion')}</span>
    </div>
  );
}

/** The switch, wired to the app's setting; a refusal is said under it. */
function ReduceFlashingSetting() {
  const motion = useMotion();
  const [problem, setProblem] = useState<Notice | null>(null);
  const change = (on: boolean) => {
    setProblem(null);
    setMotion(on).catch((e) => setProblem(notice(`Couldn't ${on ? 'turn on' : 'turn off'} ${say('reduced motion')}.`, e)));
  };
  return (
    <>
      <ReduceFlashing motion={motion} onChange={change} />
      <p className="ob-note">{REDUCE_HINT}</p>
      <NoticeBanner className="ob-problem" notice={problem} onDismiss={() => setProblem(null)} />
    </>
  );
}

function Warning({ onNext }: { onNext(): void }) {
  return (
    <section className="ob-step ob-warning">
      <h1>Flashing lights</h1>
      <p className="ob-lead">{WARNING_TEXT}</p>
      <ReduceFlashingSetting />
      <div className="ob-actions">
        <Main onPress={onNext}>I understand</Main>
      </div>
    </section>
  );
}

/** Tauri's event, for the menu's Flashing Lights Warning…: show the first run's warning again. */
export const FLASH_WARNING = 'flash-warning';

/** Show the warning again, from the page. */
export const showFlashWarning = () => window.dispatchEvent(new Event(FLASH_WARNING));

/**
 * The first run's photosensitivity warning as a dialog over any view, with the
 * reduce-flashing switch: modal, focus kept inside and given back on close,
 * Esc or "I understand" closes it.
 */
export function FlashWarningDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const title = useId();
  const text = useId();
  useFocusTrap(ref);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    // Capturing, so live mode's own Esc (leave) doesn't hear it.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <>
      <div className="ob-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="ob-dialog ob-warning" role="dialog" aria-modal="true" aria-labelledby={title} aria-describedby={text}>
        <h2 id={title}>Flashing lights</h2>
        <p id={text} className="ob-lead">
          {WARNING_TEXT}
        </p>
        <ReduceFlashingSetting />
        <div className="ob-actions">
          <Main onPress={onClose}>I understand</Main>
        </div>
      </div>
    </>
  );
}

/** Mounted by `App`: the warning dialog, whenever the menu (or `showFlashWarning`) asks for it. */
export function FlashWarning() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(FLASH_WARNING, show);
    const off = listen(FLASH_WARNING, show).catch(() => () => {});
    return () => {
      window.removeEventListener(FLASH_WARNING, show);
      off.then((f) => f());
    };
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return open ? <FlashWarningDialog onClose={close} /> : null;
}

function PickVibe({ onPicked }: { onPicked(): void }) {
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [busy, setBusy] = useState(false);
  const { notice: problem, set: setProblem, dismiss } = useNotice();
  useEffect(() => {
    pl.lists().then(setLists, () => setLists({ playlists: [], deck: pl.EMPTY_DECK }));
  }, []);

  const pick = (action: pl.Action, what: string) => {
    setBusy(true);
    dismiss();
    pl.act(action).then(onPicked, (e) => {
      setBusy(false);
      setProblem(notice(`Couldn't start ${what}.`, e));
    });
  };
  const offered = vibes(lists);

  return (
    <section className="ob-step">
      <h1>Pick a vibe</h1>
      <p className="ob-lead">Something to start on. It plays in this window; send it to a screen of its own from live mode.</p>
      <ul className="ob-vibes">
        {offered.map((v) => (
          <li key={v.index}>
            <button type="button" className="ob-vibe" disabled={busy} onClick={() => pick({ kind: 'load', playlist: v.index, index: null }, v.name)}>
              <b>{v.name}</b>
              <span>{plural(v.size, 'preset')}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="ob-vibe" disabled={busy || !lists} onClick={() => pick({ kind: 'random' }, 'a random preset')}>
            <b>Surprise me</b>
            <span>anything, at random</span>
          </button>
        </li>
      </ul>
      <NoticeBanner className="ob-problem" notice={problem} onDismiss={dismiss} />
      {problem && (
        <div className="ob-actions">
          <Button tone="quiet" onPress={onPicked}>
            Go live anyway
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Live mode, gently: the input has been silent for five seconds, so say so, with
 * the source picker a press away. It goes when sound comes back, or when put
 * away (until the next silence).
 */
export function SilenceBanner() {
  const [quiet, setQuiet] = useState(false);
  const [away, setAway] = useState(false);
  const [picking, setPicking] = useState(false);
  const { notice: problem, fail, dismiss } = useNotice();

  useEffect(() => {
    const watch = silenceWatch();
    let live = true;
    const tick = async () => {
      while (live) {
        const peak = await api.levels().then(
          ([l, r]) => Math.max(l, r),
          () => 0,
        );
        if (!live) return;
        const now = watch.hear(peak, Date.now());
        setQuiet(now);
        if (!now) setAway(false);
        await new Promise((done) => setTimeout(done, 250));
      }
    };
    tick();
    return () => {
      live = false;
    };
  }, []);

  if (!picking && (!quiet || away)) return null;
  return (
    <div className="ob-silence" role="status">
      {picking ? (
        <>
          <span>{Say('audio input')}</span>
          <SourcePicker onError={fail("Couldn't read what there is to listen to.")} />
          <Button tone="quiet" onPress={() => setPicking(false)}>
            Done
          </Button>
        </>
      ) : (
        <>
          <span>Nothing to hear for a few seconds — is the music on?</span>
          <Button onPress={() => setPicking(true)} title="Choose what the visuals hear">
            Choose what to {say('audio input')}
          </Button>
          <Button tone="quiet" label="Dismiss" title="Dismiss" onPress={() => setAway(true)}>
            ✕
          </Button>
        </>
      )}
      <NoticeBanner className="ob-problem" notice={problem} onDismiss={dismiss} />
    </div>
  );
}
