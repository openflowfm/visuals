import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Modal } from '@satoramoto/zen';
import { Select } from '@satoramoto/zen';
import { Switch } from '@satoramoto/zen';
import { Layer, Opaque } from '@satoramoto/zen';
import { Screen } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { REDUCE_WHAT, setMotion, useMotion } from '../model/access';
import * as api from '../model/api';
import { plural } from '../model/controls';
import { useNotice, useTauriEvent } from '../model/hooks';
import { listen } from '../model/ipc';
import * as link from '../model/link';
import * as pack from '../model/pack';
import * as pl from '../model/playlists';
import { notice, type Notice } from '../model/shell';
import { Say, say } from '../model/words';
import { SourcePicker } from '../SourcePicker/SourcePicker';
import { Mark, NoticeBanner, Preview } from '../Views/Views';
import './Onboarding.css';

/*
 * The first run: a minute that gets the app hearing music, keeping in time and
 * holding presets, and then plays. Welcome → listen to → keep in time with
 * Ableton (only when Ableton is on the network) → the full library → the
 * flashing-light warning → pick a vibe → Home, playing it. Shown once (`api.firstRun`), and
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

/** What the library step says the app has now, and what the full library adds; and, when it came without its pictures, so. */
export function libraryLine(s: pack.PackStatus): string {
  // While downloading, `installed` counts up file by file: what there is to start with is the starter set.
  const have = s.state === 'downloading' ? s.starter : Math.max(s.installed, s.starter);
  const size = sizeText(s.size);
  const full = `The ${say('pack')} is ${count(s.total)} ${s.total === 1 ? 'preset' : 'presets'}${size ? ` (${size})` : ''}`;
  const line = have > 0 ? `You have ${count(have)} to start with. ${full}.` : `${full}.`;
  return s.bare ? `${line} ${pack.bareNote()}` : line;
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
      (first) => {
        // Past the first run, a step kept from a flow opened from the menu and left halfway is stale.
        if (!first) keepStep(null);
        setShown((s) => s || first);
      },
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

/**
 * How the welcome flow ended: finished (`home`: Home, playing the vibe picked,
 * with live a step away) or skipped.
 */
export type Ending = 'home' | 'skipped';

/** Where the page keeps the step the welcome flow was on, so leaving halfway resumes there. */
export const STEP_KEY = 'welcome-step';

type StepStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const pageStorage = (): StepStorage | undefined => globalThis.localStorage;

/**
 * The step the welcome flow was left on at an earlier launch, or the welcome.
 * Ableton's step resumes on the one after it: whether Ableton is on the
 * network isn't known yet, and that step only shows when it is.
 */
export function keptStep(page: () => StepStorage | undefined = pageStorage): Step {
  let at: string | null = null;
  try {
    at = page()?.getItem(STEP_KEY) ?? null;
  } catch {
    // No storage: start at the welcome.
  }
  const step = STEPS.find((s) => s === at);
  if (!step) return 'welcome';
  return step === 'link' ? 'library' : step;
}

/** Keep `step` for the next launch, or forget it (`null`: the flow ended). Never throws. */
export function keepStep(step: Step | null, page: () => StepStorage | undefined = pageStorage): void {
  try {
    if (step && step !== 'welcome') page()?.setItem(STEP_KEY, step);
    else page()?.removeItem(STEP_KEY);
  } catch {
    // Not kept: the next launch starts at the welcome.
  }
}

/**
 * **Job.** The welcome flow, filling the window, from `start` (where it was left at an earlier
 * launch, else the welcome). `onDone` hears how it ended, finished or skipped; either way the
 * first run is marked done, so it doesn't come back by itself. Until then each step is kept, so
 * quitting halfway resumes there.
 *
 * **Changed.** A layout `Screen` ("Setup"): the steps along its fixed header, Back in its fixed
 * footer, the step in its grid. The header paints nothing and has no rule (near borderless): the
 * step you're on is underlined in the accent, as a switch's chosen word is; done steps are in the
 * caption grey. The steps are type on the frost, except the listen step's words, an opaque `base`
 * layer beside the preview (a measured `Hole` via Views' `Preview`), since nothing translucent may
 * sit by the native picture. The one thing to do next is a core `ActionButton` filled in the
 * contract's `--action` (the suite's green was the signal's colour, and colour has one meaning
 * here). Vibes are `raised` tiles. The app's `SwitchRow` is the core `Switch` (labelled), the
 * widgets' Select the core `Select`, Tauri's `listen` the bridge's (`model/ipc`).
 *
 * **Kept.** The whole flow and its order, the kept step, the focus moving to the step on each
 * change, every export, all copy, names and tooltips.
 *
 * **Tuning knobs.** `--vs-onboarding-main-min`: the main button's least width
 * (`calc(var(--space-5) * 5)`, the original's 120px); `--vs-onboarding-step-width`: a step's
 * widest (`calc(var(--space-4) * 35)`, onboarding.css's 560px); `--vs-onboarding-text-width`: the
 * listen step's words' column at its widest (`calc(var(--space-1) * 115)`, onboarding.css's 460px).
 */
export function Onboarding({ onDone: done, start, store = kept }: { onDone(ending: Ending): void; start?: Step; store?: WarningStore }) {
  const [step, setStep] = useState<Step>(() => start ?? keptStep());
  const [peers, setPeers] = useState(0);
  useEffect(() => keepStep(step), [step]);
  const onDone = (ending: Ending) => {
    api.firstRunDone().catch(() => {});
    keepStep(null);
    welcomeEnded();
    done(ending);
  };
  // The warning step's "I understand": kept at once. Skipped before it, the warning is owed.
  const understand = () => {
    store.understand();
    next();
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
    else onDone('home');
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
    <Screen
      name="Setup"
      className="vs-onboarding"
      header={
        <Text as="header" className="vs-onboarding-head" data-tauri-drag-region>
          <Mark />
          <ol className="vs-onboarding-dots" aria-label="setup steps">
            {shown.map((s) => (
              <li key={s} data-at={s === step ? '' : undefined} aria-current={s === step ? 'step' : undefined} data-done={shown.indexOf(s) < shown.indexOf(step) ? '' : undefined}>
                <span>{TITLES[s]}</span>
              </li>
            ))}
          </ol>
          <span className="vs-fill" />
          {step !== 'welcome' && (
            <ActionButton tone="quiet" onPress={() => onDone('skipped')} title="Skip the rest of the setup; it's in the menu if you want it again">
              Skip setup
            </ActionButton>
          )}
        </Text>
      }
      footer={
        back ? (
          <footer className="vs-onboarding-foot">
            <ActionButton tone="quiet" label="Back" onPress={() => setStep(back)}>
              ← back
            </ActionButton>
          </footer>
        ) : undefined
      }
    >
      <main className="vs-onboarding-body" data-step={step} ref={body} tabIndex={-1} aria-label={TITLES[step]}>
        {step === 'welcome' && <Welcome onStart={next} onSkip={() => onDone('skipped')} />}
        {step === 'listen' && <Listen onNext={next} />}
        {step === 'link' && <KeepTime onNext={next} />}
        {step === 'library' && <FullLibrary onNext={next} />}
        {step === 'warning' && <Warning onNext={understand} />}
        {step === 'vibe' && <PickVibe onPicked={() => onDone('home')} />}
      </main>
    </Screen>
  );
}

const TITLES: Record<Step, string> = {
  welcome: 'welcome',
  listen: say('audio input'),
  link: 'Ableton Link',
  library: say('pack'),
  warning: 'flashing lights',
  vibe: 'vibe',
};

/** A step's title: the display face, half again the pane title's size. */
function Title({ children }: { children: ReactNode }) {
  return (
    <Text as="h1" role="display" className="vs-onboarding-title">
      {children}
    </Text>
  );
}

/** A step's lead: what it is for, at the pane title's size. */
function Lead({ children }: { children: ReactNode }) {
  return (
    <Text as="p" className="vs-onboarding-lead">
      {children}
    </Text>
  );
}

/** A note under the lead, in the caption grey; `num` sets its figures in the readout face. */
function Note({ num, children }: { num?: boolean; children: ReactNode }) {
  return (
    <Text as="p" tabular={num || undefined} className={num ? 'vs-onboarding-note vs-num' : 'vs-onboarding-note'}>
      {children}
    </Text>
  );
}

/** The step's main button: the one thing to do next. */
function Main({ onPress, children, disabled }: { onPress(): void; children: string; disabled?: boolean }) {
  return (
    <ActionButton className="vs-onboarding-main" onPress={onPress} disabled={disabled}>
      {children}
    </ActionButton>
  );
}

function Welcome({ onStart, onSkip }: { onStart(): void; onSkip(): void }) {
  return (
    <section className="vs-onboarding-step vs-onboarding-welcome">
      <Title>
        Welcome to <Mark />
      </Title>
      <Lead>Visuals that move with your music. Three things to set up first: sound, sync, presets — about a minute.</Lead>
      <div className="vs-onboarding-actions">
        <Main onPress={onStart}>Start</Main>
        <ActionButton tone="quiet" onPress={onSkip} title="Go straight to the library; the setup is in the menu if you want it later">
          Skip setup
        </ActionButton>
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
    <section className="vs-onboarding-step vs-onboarding-listen">
      <Opaque className="vs-onboarding-text-scope">
        <Layer level="base" className="vs-onboarding-text">
          <Title>{Say('audio input')}</Title>
          <Lead>Choose what the visuals hear: your DAW, everything this Mac plays, or a microphone or interface.</Lead>
          <Text as="div" className="vs-onboarding-picker" inert={testing} data-off={testing ? '' : undefined}>
            <SourcePicker key={picker} onError={(e) => setProblem(notice("Couldn't read what there is to listen to.", e))} />
          </Text>
          {testing && <Note>Stop the test sound to choose what to {say('audio input')}.</Note>}
          <Note>If macOS asks whether visual[flow] may hear audio, allow it — nothing is recorded or sent anywhere.</Note>
          <Text as="p" weight="strong" className="vs-onboarding-cue">
            Play something — watch it move.
          </Text>
          <div className="vs-onboarding-actions">
            <Main onPress={onNext}>Continue</Main>
            <ActionButton
              onPress={() => test(!testing)}
              title="Play a test beat straight into the visuals, without sound, to see them move"
              hint="a test beat straight into the visuals: no sound comes out"
            >
              {testing ? '■ Stop test sound' : '▶ Test sound'}
            </ActionButton>
          </div>
          <NoticeBanner className="vs-onboarding-problem" notice={problem} onDismiss={() => setProblem(null)} />
        </Layer>
      </Opaque>
      <div className="vs-onboarding-stage">
        <Preview className="vs-onboarding-preview" />
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
    <section className="vs-onboarding-step">
      <Title>{Say('Ableton Link')}</Title>
      <Lead>
        {frame ? `Ableton is on the network: ${plural(frame.peers, 'app')} at ${frame.tempo.toFixed(0)} bpm.` : 'Ableton is on the network.'} The visuals follow its tempo over Ableton Link; they never change it. Turn it on or off any time in Settings, under Ableton Link.
      </Lead>
      <Text as="div" className="vs-onboarding-row">
        <span>Change the preset</span>
        <Select
          items={choices.slice(1).map((c) => c.name)}
          index={Math.max(0, at - 1)}
          onChange={(i) => link.sync(choices[i + 1].every, choices[i + 1].unit).then(setFrame, fail("Couldn't change that."))}
          label="change the preset"
          width={140}
        />
      </Text>
      <div className="vs-onboarding-actions">
        <Main onPress={keep}>Keep in time</Main>
        <ActionButton tone="quiet" onPress={onNext}>
          Not now
        </ActionButton>
      </div>
      <NoticeBanner className="vs-onboarding-problem" notice={problem} onDismiss={dismiss} />
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
    <section className="vs-onboarding-step">
      <Title>Get the {say('pack')}</Title>
      <Lead>{status ? libraryLine(status) : `Thousands more presets, downloaded once.`}</Lead>
      {status && downloadText(status) && <Note num>{downloadText(status)}</Note>}
      <div className="vs-onboarding-actions">
        {going || done ? (
          <Main onPress={onNext}>Continue</Main>
        ) : (
          <Main onPress={download} disabled={asked}>
            {problem ? 'Try again' : status?.state === 'failed' ? 'Download again' : 'Download'}
          </Main>
        )}
        {!going && !done && (
          <ActionButton tone="quiet" onPress={onNext}>
            Maybe later
          </ActionButton>
        )}
      </div>
      <NoticeBanner className="vs-onboarding-problem" notice={problem} onDismiss={dismiss} />
    </section>
  );
}

/** The photosensitivity warning, as the first run and the menu's Flashing Lights Warning… both say it. */
export const WARNING_TEXT =
  'Many presets flash, strobe and change colour fast. If you or anyone watching may be sensitive to flashing light (photosensitive epilepsy), take care — on a big screen most of all.';

/** What the reduce-flashing switch says it does, beside the warning. */
export const REDUCE_HINT = `${REDUCE_WHAT} It follows macOS’s Reduce motion until you choose here; it’s in Settings too.`;

/**
 * **Job.** The reduce-flashing switch, shown with the warning: off and disabled until the app has
 * said.
 *
 * **Changed.** The core `Switch`, labelled (the app's `SwitchRow`): the name at the start of a
 * raised row, the switch at its end; a click on the name flips it.
 *
 * **Kept.** Its props, name and tooltip.
 */
export function ReduceFlashing({ motion, onChange }: { motion: api.Motion | null; onChange(on: boolean): void }) {
  const name = Say('reduced motion');
  return (
    <Switch className="vs-onboarding-reduce" aria-label={name} checked={motion?.reduced === true} onChange={onChange} disabled={!motion} title={REDUCE_HINT}>
      <Text size="inherit" weight="strong" className="vs-onboarding-reduce-name">
        {name}
      </Text>
    </Switch>
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
    <div className="vs-onboarding-reduce-setting">
      <ReduceFlashing motion={motion} onChange={change} />
      <Note>{REDUCE_HINT}</Note>
      <NoticeBanner className="vs-onboarding-problem" notice={problem} onDismiss={() => setProblem(null)} />
    </div>
  );
}

function Warning({ onNext }: { onNext(): void }) {
  return (
    <section className="vs-onboarding-step vs-onboarding-warning">
      <Title>Flashing lights</Title>
      <Lead>{WARNING_TEXT}</Lead>
      <ReduceFlashingSetting />
      <div className="vs-onboarding-actions">
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
 * Where the page kept the warning's answer before the app did (`'seen'` once
 * "I understand" was pressed): carried over to the app once, then removed.
 */
export const OLD_KEY = 'flash-warning';

/** Whether the warning's "I understand" was chosen, and keeping that it was. Neither rejects. */
export interface WarningStore {
  /** At this launch or any before. */
  understood(): Promise<boolean>;
  /** Kept for every launch after (and for this one even if it couldn't be). */
  understand(): Promise<void>;
}

/** What the app answers (`api.flashWarningUnderstood` and `api.flashWarningUnderstand`). */
export interface WarningApp {
  understood(): Promise<boolean>;
  understand(): Promise<void>;
}

type PageStorage = Pick<Storage, 'getItem' | 'removeItem'>;

/**
 * The warning's answer, kept by the app in `access.json`, so it holds across
 * launches whatever the page's origin (dev runs and captures included). This
 * run's answer is also held here, so a refusal to keep it still closes the
 * warning until quit. An answer the page kept in its own storage before is
 * carried over to the app once.
 */
export function warningStore(
  app: WarningApp = { understood: api.flashWarningUnderstood, understand: api.flashWarningUnderstand },
  page: () => PageStorage | undefined = () => globalThis.localStorage,
): WarningStore {
  let here = false;
  const old = () => {
    try {
      return page()?.getItem(OLD_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const store: WarningStore = {
    async understood() {
      if (here) return true;
      if (await app.understood().catch(() => false)) return (here = true);
      if (old() !== 'seen') return false;
      await store.understand();
      return true;
    },
    async understand() {
      here = true;
      try {
        await app.understand();
      } catch {
        // Not kept: it holds until quit, and shows again at the next launch.
        return;
      }
      try {
        page()?.removeItem(OLD_KEY);
      } catch {
        // Carried over; the old copy is only read when the app says no.
      }
    },
  };
  return store;
}

const kept = warningStore();

/** The welcome flow ended this run: the first run is done, whatever the app has written yet. */
let welcomeDone = false;

/**
 * The welcome flow ended, finished or skipped. Unless its warning's "I
 * understand" was pressed (then or ever before), the warning is owed:
 * `FlashWarning` shows it before anything else can be done.
 */
export function welcomeEnded(): void {
  welcomeDone = true;
}

/** For tests: forget that the welcome ended this run. */
export function resetWelcomeEnded(): void {
  welcomeDone = false;
}

/** Whether the warning is owed: the first run is done (skipped, or done before the warning existed) and it hasn't been understood. */
export async function warningOwed(store: WarningStore = kept, firstRun: () => Promise<boolean> = api.firstRun): Promise<boolean> {
  const first = welcomeDone ? false : await firstRun().catch(() => false);
  return !first && !(await store.understood());
}

/** Required: nothing but "I understand" answers it. */
const IGNORE = () => {};

/**
 * **Job.** The first run's photosensitivity warning as a dialog over any view, with the
 * reduce-flashing switch: modal, focus kept inside and given back on close. "I understand" closes
 * it (`onUnderstood`, or else `onClose`); so do Esc and a click beside it, unless it is `required`
 * (owed: it must be read and answered).
 *
 * **Changed.** The core `Modal` (an `overlay` layer, its scrim, its focus trap and Esc) in an
 * `Opaque` scope, since it may open over the native preview. Its ✕ closes as Esc does; required,
 * the ✕ is not drawn and Esc and the scrim do nothing. The heading's caution dot is the
 * contract's `--warning`. The Modal names the dialog by its title (`aria-label`), and has no
 * `aria-describedby` for the warning's text.
 *
 * **Kept.** Its props, the copy, the dialog's name, and Esc kept from live mode's own Esc.
 */
export function FlashWarningDialog({ onClose, onUnderstood, required = false }: { onClose(): void; onUnderstood?(): void; required?: boolean }) {
  return (
    <Opaque className="vs-onboarding-dialog-scope">
      <Modal
        title="Flashing lights"
        onClose={required ? IGNORE : onClose}
        width={520}
        className={`vs-onboarding-dialog vs-onboarding-warning${required ? ' vs-onboarding-dialog--required' : ''}`}
        actions={<Main onPress={onUnderstood ?? onClose}>I understand</Main>}
      >
        <Lead>{WARNING_TEXT}</Lead>
        <ReduceFlashingSetting />
      </Modal>
    </Opaque>
  );
}

/** The warning, as `App` holds it (`useFlashWarning`). */
export interface Warning {
  /** Showing: owed (it must be answered), asked for from the menu, or not. */
  open: 'owed' | 'asked' | null;
  /** Whether it is owed; null until known (and while the welcome flow shows). */
  owed: boolean | null;
  close(): void;
  understood(): void;
}

/**
 * The warning, once the welcome flow is away (`away`): open at once when it is
 * owed (the first run was skipped before it, or done before it existed), and
 * whenever the menu (or `showFlashWarning`) asks for it. Its "I understand" is kept.
 */
export function useFlashWarning(away: boolean, store: WarningStore = kept, firstRun: () => Promise<boolean> = api.firstRun): Warning {
  const [open, setOpen] = useState<Warning['open']>(null);
  const [owed, setOwed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!away) return;
    let gone = false;
    warningOwed(store, firstRun).then((owes) => {
      if (gone) return;
      setOwed(owes);
      if (owes) setOpen('owed');
    });
    return () => {
      gone = true;
    };
  }, [away, store, firstRun]);
  useEffect(() => {
    const show = () => setOpen((o) => o ?? 'asked');
    window.addEventListener(FLASH_WARNING, show);
    const off = listen(FLASH_WARNING, show).catch(() => () => {});
    return () => {
      window.removeEventListener(FLASH_WARNING, show);
      off.then((f) => f());
    };
  }, []);
  const close = useCallback(() => setOpen((o) => (o === 'owed' ? o : null)), []);
  const understood = useCallback(() => {
    store.understand();
    setOwed(false);
    setOpen(null);
  }, [store]);
  return { open, owed, close, understood };
}

/**
 * The warning dialog over `children`, while `warning` is open. With `live`,
 * nothing plays behind an owed warning: `children` (live mode) wait for its "I
 * understand", and for the app to say whether it is owed.
 */
export function FlashWarning({ warning, live = false, children }: { warning: Warning; live?: boolean; children?: ReactNode }) {
  const { open, close, understood } = warning;
  const dialog = open ? <FlashWarningDialog onClose={close} onUnderstood={understood} required={open === 'owed'} /> : null;
  if (live && warning.owed !== false) return dialog;
  return (
    <>
      {children}
      {dialog}
    </>
  );
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
    <section className="vs-onboarding-step">
      <Title>Pick a vibe</Title>
      <Lead>Something to start on. It plays on Home; go live from there to send it to a screen of its own.</Lead>
      <ul className="vs-onboarding-vibes">
        {offered.map((v) => (
          <li key={v.index}>
            <button type="button" className="vs-onboarding-vibe" disabled={busy} onClick={() => pick({ kind: 'load', playlist: v.index, index: null }, v.name)}>
              <Text as="b" weight="strong" className="vs-onboarding-vibe-name">
                {v.name}
              </Text>
              <Text tabular className="vs-onboarding-vibe-says vs-num">
                {plural(v.size, 'preset')}
              </Text>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="vs-onboarding-vibe" disabled={busy || !lists} onClick={() => pick({ kind: 'random' }, 'a random preset')}>
            <Text as="b" weight="strong" className="vs-onboarding-vibe-name">
              Surprise me
            </Text>
            <Text className="vs-onboarding-vibe-says">anything, at random</Text>
          </button>
        </li>
      </ul>
      <NoticeBanner className="vs-onboarding-problem" notice={problem} onDismiss={dismiss} />
      {problem && (
        <div className="vs-onboarding-actions">
          <ActionButton tone="quiet" onPress={onPicked}>
            Carry on anyway
          </ActionButton>
        </div>
      )}
    </section>
  );
}

/**
 * **Job.** Live mode, gently: the input has been silent for five seconds, so say so, with the
 * source picker a press away. It goes when sound comes back, or when put away (until the next
 * silence).
 *
 * **Changed.** A strip on a `top` layer (a toast) in an `Opaque` scope, over live's picture; it
 * shows and goes at once. Dismiss is the core `ActionButton` with the icon-free ✕ kept.
 *
 * **Kept.** The polling, the silence watch, `role="status"` and the copy.
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
    <Opaque className="vs-onboarding-silence-scope">
      <Layer level="top" className="vs-onboarding-silence" role="status">
        {picking ? (
          <>
            <span>{Say('audio input')}</span>
            <SourcePicker onError={fail("Couldn't read what there is to listen to.")} />
            <ActionButton tone="quiet" onPress={() => setPicking(false)}>
              Done
            </ActionButton>
          </>
        ) : (
          <>
            <span>Nothing to hear for a few seconds — is the music on?</span>
            <ActionButton onPress={() => setPicking(true)} title="Choose what the visuals hear">
              Choose what to {say('audio input')}
            </ActionButton>
            <ActionButton tone="quiet" label="Dismiss" title="Dismiss" onPress={() => setAway(true)}>
              ✕
            </ActionButton>
          </>
        )}
        <NoticeBanner className="vs-onboarding-problem" notice={problem} onDismiss={dismiss} />
      </Layer>
    </Opaque>
  );
}
