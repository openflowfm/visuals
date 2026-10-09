import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import * as api from './api.ts';
import { EffectSettings, useFx } from './Effects.tsx';
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
 * closes it, before live mode's own Esc (leave) can hear it; focus moves into
 * it on open and goes back where it was on close. `scrim` lays a see-through
 * layer behind it that closes it when tapped.
 */
export function Sheet({ title, className, scrim = false, onClose, children }: { title: string; className: string; scrim?: boolean; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const was = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (!closesSheet(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    // Capturing, so the sheet hears Esc before anything else on the page does.
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      was?.focus();
    };
  }, [onClose]);
  return (
    <>
      {scrim && <div className="vf-scrim" aria-hidden="true" onClick={onClose} />}
      <div ref={ref} tabIndex={-1} className={`vf-sheet ${className}`} role="dialog" aria-label={title}>
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

/** Auto, Low, Medium or High, kept for next launch; auto's pick is read again when the output moves, as it can change with it. */
function QualitySettings() {
  const [quality, setQuality] = useState<api.Quality | null>(null);
  const { notice, fail, dismiss } = useNotice();
  const read = useCallback(() => api.qualityGet().then(setQuality, fail(`Couldn't read the ${say('render quality')}.`)), [fail]);
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
            onChange={(i) => api.qualitySet(QUALITY_LEVELS[i]).then(setQuality, fail(`Couldn't change the ${say('render quality')}.`))}
            title="How much detail the picture is drawn with: Auto picks for this Mac; Low is lightest on it"
          />
          <p className="settings-line">{qualityLine(quality)}</p>
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

/** A switch the app keeps: read once, shown at once when flipped, and put back, with why, if the app refuses it. */
function KeptToggle({ read, write, name, title }: { read(): Promise<boolean>; write(on: boolean): Promise<unknown>; name: string; title: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    read().then(setOn, () => setOn(false));
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
      {problem && <p className="settings-line settings-problem">{problem}</p>}
    </div>
  );
}

const readMotion = () => api.reducedMotion().then((m) => m.reduced);
const writeMotion = (on: boolean) => api.reducedMotionSet(on);

/** The effects' section: only once they've been read. */
function EffectsSection() {
  const { state, set, notice, dismiss } = useFx();
  return (
    <>
      {state ? <EffectSettings state={state} set={set} /> : !notice && <p className="settings-line">Reading the effects…</p>}
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
    <Sheet title="Settings" className="settings" scrim onClose={onClose}>
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
        <KeptToggle read={readMotion} write={writeMotion} name={Say('reduced motion')} title="Calm the strobe and flashes, for anyone sensitive to flashing light" />
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
