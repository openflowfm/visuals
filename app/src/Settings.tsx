import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import * as api from './api.ts';
import { EffectSettings, useFx } from './Effects.tsx';
import { REDUCE_WHAT, setMotion, useMotion } from './access.ts';
import { isTopTrap, leavesKeys, useFocusTrap } from './focusTrap.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import { LinkSettings } from './LinkPanel.tsx';
import * as output from './output.ts';
import { OutputSettings } from './OutputPanel.tsx';
import { SourcePicker } from './SourcePicker.tsx';
import { NoticeBanner } from './views.tsx';
import { say, Say } from './words.ts';
import './settings.css';

/**
 * Whether a key press closes the sheet: Esc, unless an open menu inside it
 * (a control with `aria-expanded="true"`) takes it to close itself first.
 */
export function closesSheet(e: { key: string; target: EventTarget | null }): boolean {
  if (e.key !== 'Escape') return false;
  const t = e.target as { closest?: (selector: string) => unknown } | null;
  return !(typeof t?.closest === 'function' && t.closest('[aria-expanded="true"]') != null);
}

/**
 * A sheet over whatever view is showing, with its name and a close button. Esc
 * closes it, before live mode's own Esc (leave) can hear it; keyboard focus
 * moves into it on open, Tab goes round its controls (`useFocusTrap`), and
 * focus goes back to the opener on close. `scrim` lays a see-through layer
 * behind it that closes it when tapped; `modal` tells VoiceOver the page
 * behind can't be used while it is open (not so for a drawer that leaves live
 * usable behind it).
 */
export function Sheet({
  title,
  className,
  scrim = false,
  modal = false,
  onClose,
  children,
}: {
  title: string;
  className: string;
  scrim?: boolean;
  modal?: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // A dialog over the sheet (the flashing lights warning), or a popover beside a drawer, takes Esc for itself.
      const root = ref.current;
      if (!root || leavesKeys(root, e.target instanceof Element ? e.target : null, isTopTrap(root))) return;
      if (!closesSheet(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    // Capturing, so the sheet hears Esc before anything else on the page does.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <>
      {scrim && <div className="vf-scrim" aria-hidden="true" onClick={onClose} />}
      <div ref={ref} tabIndex={-1} className={`vf-sheet ${className}`} role="dialog" aria-label={title} aria-modal={modal ? 'true' : undefined}>
        <div className="vf-sheet-head">
          <h2>{title}</h2>
          <Button tone="quiet" label={`Close ${title.toLowerCase()}`} title="Close (Esc)" onPress={onClose}>
            ✕
          </Button>
        </div>
        {children}
      </div>
    </>
  );
}

/** One of the settings' sections, named by its heading. */
function Section({ name, children }: { name: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h3 id={id}>{name}</h3>
      {children}
    </section>
  );
}

/** The quality levels in the order the picker lists them, and what it says. */
export const QUALITY_LEVELS: readonly api.QualityLevel[] = ['auto', 'low', 'medium', 'high'];
export const QUALITY_NAMES = ['Auto', 'Low', 'Medium', 'High'];

/** What the quality section says under the picker: the app's reason, or, when it gives none, what auto picked or what is drawn. */
export function qualityLine(q: api.Quality): string {
  if (q.reason) return q.reason;
  return q.chosen === 'auto' ? `Auto picked ${q.effective}.` : `Drawing at ${q.effective}.`;
}

/**
 * Shows only the reply to the latest of the requests it is handed: one that
 * comes back after a later one was asked for is dropped, so a slow read never
 * puts back an older level and reason over a newer one. Failures always show.
 */
export function latestOnly<T>(show: (value: T) => void) {
  let asked = 0;
  return (request: Promise<T>): Promise<void> => {
    const mine = ++asked;
    return request.then((value) => {
      if (mine === asked) show(value);
    });
  };
}

/** Auto, Low, Medium or High, kept for next launch; auto's pick is read again when the output moves, as it can change with it. */
export function QualitySettings() {
  const [quality, setQuality] = useState<api.Quality | null>(null);
  const { notice, fail, dismiss } = useNotice();
  const [show] = useState(() => latestOnly(setQuality));
  const read = useCallback(() => show(api.qualityGet()).catch(fail(`Couldn't read the ${say('render quality')}.`)), [show, fail]);
  useEffect(() => {
    read();
  }, [read]);
  useTauriEvent(output.onStatus, () => read());
  return (
    <div className="wdg settings-quality">
      {quality && (
        <>
          <Segmented
            name={say('render quality')}
            items={QUALITY_NAMES}
            index={Math.max(0, QUALITY_LEVELS.indexOf(quality.chosen))}
            onChange={(i) => show(api.qualitySet(QUALITY_LEVELS[i])).catch(fail(`Couldn't change the ${say('render quality')}.`))}
            title="How much detail the picture is drawn with: Auto picks for this Mac; Low is lightest on it"
          />
          <p className="settings-line" role="status">
            {qualityLine(quality)}
          </p>
        </>
      )}
      <NoticeBanner notice={notice} onDismiss={dismiss} />
    </div>
  );
}

/**
 * Ask the app to keep a switch at `on`. Resolves to null when it did, or to
 * why it didn't (its own words), for the switch to go back and say so.
 */
export const keep = (write: (on: boolean) => Promise<unknown>, on: boolean): Promise<string | null> =>
  write(on).then(
    () => null,
    (e) => (e instanceof Error ? e.message : String(e)),
  );

/**
 * Read a kept switch. Resolves to its state, or to why it couldn't be read
 * (its own words), so the switch says so rather than showing a false "off".
 */
export const readKept = (read: () => Promise<boolean>): Promise<{ on: boolean | null; problem: string | null }> =>
  read().then(
    (on) => ({ on, problem: null }),
    (e) => ({ on: null, problem: e instanceof Error ? e.message : String(e) }),
  );

/** A switch the app keeps: read once, shown at once when flipped, and put back, with why, if the app refuses it. */
function KeptToggle({ read, write, name, title }: { read(): Promise<boolean>; write(on: boolean): Promise<unknown>; name: string; title: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    readKept(read).then((r) => {
      setOn(r.on);
      setProblem(r.problem);
    });
  }, [read]);
  const change = (next: boolean) => {
    setOn(next);
    setProblem(null);
    keep(write, next).then((why) => {
      if (why === null) return;
      setOn(!next);
      setProblem(why);
    });
  };
  return (
    <div className="settings-switch">
      <span>{name}</span>
      <Toggle on={on === true} onChange={change} disabled={on === null} layout="inside" name={name.toLowerCase()} label={name} title={title}>
        {on ? 'on' : 'off'}
      </Toggle>
      {problem && (
        <p className="settings-line settings-problem" role="status">
          {problem}
        </p>
      )}
    </div>
  );
}

/** The words a failed change resolves to: the app's own. */
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The reduce-flashing switch as drawn: `motion` is the app's setting (null
 * until it has said, and the switch waits), `shown` what the switch shows
 * while a change is on its way. Under it, that macOS's Reduce motion decides,
 * or, once a choice was made here, a button to hand it back to macOS.
 */
export function MotionSwitch({
  motion,
  shown = motion?.reduced ?? false,
  problem,
  onChange,
  onFollow,
}: {
  motion: api.Motion | null;
  shown?: boolean;
  problem: string | null;
  onChange(on: boolean): void;
  onFollow(): void;
}) {
  const name = Say('reduced motion');
  return (
    <div className="settings-switch">
      <span>{name}</span>
      <Toggle on={shown} onChange={onChange} disabled={motion === null} layout="inside" name={name.toLowerCase()} label={name} title={REDUCE_WHAT}>
        {shown ? 'on' : 'off'}
      </Toggle>
      {motion &&
        (motion.system ? (
          <p className="settings-line settings-follow">Following macOS's Reduce motion.</p>
        ) : (
          <Button tone="quiet" className="settings-follow" label="Follow macOS's Reduce motion" title="Let macOS's Reduce motion decide again" onPress={onFollow}>
            Follow macOS
          </Button>
        ))}
      {problem && (
        <p className="settings-line settings-problem" role="status">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Accessibility: reduce flashing, following the one setting the whole page
 * follows (`useMotion`). Flipped, it shows at once; if the app refuses, it
 * goes back and says why.
 */
function MotionSettings() {
  const motion = useMotion();
  const [pending, setPending] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ask = (on: boolean | null) => {
    setPending(on);
    setProblem(null);
    setMotion(on).then(
      () => setPending(null),
      (e) => {
        setPending(null);
        setProblem(why(e));
      },
    );
  };
  return <MotionSwitch motion={motion} shown={pending ?? motion?.reduced ?? false} problem={problem} onChange={ask} onFollow={() => ask(null)} />;
}

/** The effects' section: only once they've been read. */
function EffectsSection() {
  const { state, set, notice, dismiss } = useFx();
  return (
    <>
      {state ? (
        <EffectSettings state={state} set={set} />
      ) : (
        !notice && (
          <p className="settings-line" role="status">
            Reading the effects…
          </p>
        )
      )}
      <NoticeBanner notice={notice} onDismiss={dismiss} />
    </>
  );
}

/** What the sound section says when the source can't be used. */
function SoundSection() {
  const { notice, fail, dismiss } = useNotice();
  const failed = useCallback((e: unknown) => fail(`Couldn't use that ${say('audio input')} source.`)(e), [fail]);
  return (
    <>
      <SourcePicker onError={failed} />
      <NoticeBanner notice={notice} onDismiss={dismiss} />
    </>
  );
}

/** The sections, in the order the sheet shows them. */
export const SECTIONS = ['Sound', 'Output', 'Link', 'Effects', Say('render quality'), 'Accessibility', 'Privacy'] as const;

/**
 * ⚙ Settings (#98), a sheet over any view: opened with `openSheet('settings')`
 * from `views.tsx`, mounted by `App`. Sound (what the app listens to, its
 * channels under Advanced), Output (display and fit), Link (on or off and the
 * bar start), Effects (strobe, fade to black, fine brightness and
 * sensitivity), the picture quality, Accessibility (reduce flashing) and
 * Privacy (crash reports, off unless turned on; no usage tracking at all).
 */
export function Settings({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;
  const [sound, out, linked, effects, quality, access, privacy] = SECTIONS;
  return (
    <Sheet title="Settings" className="settings" scrim modal onClose={onClose}>
      <Section name={sound}>
        <SoundSection />
      </Section>
      <Section name={out}>
        <OutputSettings />
      </Section>
      <Section name={linked}>
        <LinkSettings />
      </Section>
      <Section name={effects}>
        <EffectsSection />
      </Section>
      <Section name={quality}>
        <QualitySettings />
      </Section>
      <Section name={access}>
        <MotionSettings />
      </Section>
      <Section name={privacy}>
        <KeptToggle
          read={api.crashReportsEnabled}
          write={api.crashReportsEnable}
          name="Send crash reports"
          title="Keep a note when the app crashes, and offer to send it as a GitHub issue you look over first"
        />
        <p className="settings-line">No {say('telemetry')}: nothing about you or how you use the app leaves this Mac. A crash report only goes anywhere if you send it yourself.</p>
      </Section>
    </Sheet>
  );
}
