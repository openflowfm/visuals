import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Sheet as CoreSheet, type SheetSide } from '@satoramoto/zen';
import { closesOnKey } from '@satoramoto/zen';
import { Segmented } from '@satoramoto/zen';
import { Switch } from '@satoramoto/zen';
import { Group } from '@satoramoto/zen';
import { Opaque } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { Credits } from '../Credits/Credits';
import { EffectSettings, useFx } from '../Effects/Effects';
import { LinkSettings } from '../LinkPanel/LinkPanel';
import { OutputSettings } from '../OutputPanel/OutputPanel';
import { PackBar } from '../Pack/Pack';
import { SourcePicker } from '../SourcePicker/SourcePicker';
import { NoticeBanner } from '../Views/Views';
import * as api from '../model/api';
import { REDUCE_WHAT, setMotion, useMotion } from '../model/access';
import { useNotice, useTauriEvent } from '../model/hooks';
import { emit } from '../model/ipc';
import * as output from '../model/output';
import * as pack from '../model/pack';
import { say, Say } from '../model/words';
import './Settings.css';

/**
 * Whether a key press closes the sheet: Esc, unless an open menu inside it
 * (a control with `aria-expanded="true"`) takes it to close itself first.
 * The core sheet's own rule (`closesOnKey`), under the original's name.
 */
export function closesSheet(e: { key: string; target: EventTarget | null }): boolean {
  return closesOnKey(e);
}

/**
 * **Job.** A sheet over whatever view is showing, with its name and a close button. Esc closes
 * it, before live mode's own Esc (leave) can hear it; keyboard focus moves into it on open, Tab
 * goes round its controls, and focus goes back to the opener on close. `scrim` lays a see-through
 * layer behind it that closes it when tapped; `modal` tells VoiceOver the page behind can't be
 * used while it is open (not so for a drawer that leaves live usable behind it).
 *
 * **Changed.** The core `Sheet` (an `overlay` layer; its head, ×, focus trap and Esc), in an
 * `Opaque` scope: sheets sit over the native preview, so they draw the layer's solid and blur
 * nothing. The core sheet ties the scrim to `aria-modal`, so either prop makes it modal (the
 * original never set one without the other). `side` is new: `right` (Settings, the default) or
 * `bottom` (More effects); the original placed each in CSS.
 *
 * **Kept.** The props, the name, "Close <title>" and its "Close (Esc)" tooltip.
 *
 * **Tuning knobs.** `--vs-sheet-target`: the sheets' finger-sized target, which their
 * `--control-h` takes (`calc(var(--space-6) + var(--space-3))`, the original's 44px).
 */
export function Sheet({
  title,
  className,
  scrim = false,
  modal = false,
  side = 'right',
  onClose,
  children,
}: {
  title: string;
  className: string;
  scrim?: boolean;
  modal?: boolean;
  side?: SheetSide;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <Opaque className="vs-sheet-scope">
      <CoreSheet title={title} className={`vs-sheet ${className}`} side={side} modal={scrim || modal} onClose={onClose}>
        {children}
      </CoreSheet>
    </Opaque>
  );
}

/** A quiet note under a setting: a caption `Text` paragraph (Settings.css sets its leading and ink). */
function Line({ className, ariaRole, children }: { className?: string; ariaRole?: 'status'; children: ReactNode }) {
  return (
    <Text as="p" role="caption" ariaRole={ariaRole} className={className ? `vs-settings-line ${className}` : 'vs-settings-line'}>
      {children}
    </Text>
  );
}

/** A switch's name, strong. */
function SwitchName({ children }: { children: ReactNode }) {
  return <Text weight="strong">{children}</Text>;
}

/** One of the settings' sections, named by its heading: a `Group`, its label a heading. */
function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Group
      name={name}
      direction="column"
      gap={2}
      className="vs-settings-section"
      label={
        <span role="heading" aria-level={3}>
          {name}
        </span>
      }
    >
      {children}
    </Group>
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
    <div className="vs-settings-quality">
      {quality && (
        <>
          <Segmented
            label={say('render quality')}
            items={QUALITY_NAMES}
            index={Math.max(0, QUALITY_LEVELS.indexOf(quality.chosen))}
            onChange={(i) => show(api.qualitySet(QUALITY_LEVELS[i])).catch(fail(`Couldn't change the ${say('render quality')}.`))}
            title="How much detail the picture is drawn with: Auto picks for this Mac; Low is lightest on it"
          />
          <Line ariaRole="status">{qualityLine(quality)}</Line>
        </>
      )}
      <NoticeBanner notice={notice} onDismiss={dismiss} />
    </div>
  );
}

/** The update channels in the order the picker lists them, and what it says. */
export const UPDATE_CHANNELS: readonly api.UpdateChannelName[] = ['release', 'latest'];
const CHANNEL_NAMES: Record<api.UpdateChannelName, string> = { release: 'Release', latest: 'Latest' };

/** The picker's words, the default marked. */
export const channelNames = (fallback: api.UpdateChannelName): string[] => UPDATE_CHANNELS.map((c) => (c === fallback ? `${CHANNEL_NAMES[c]} (default)` : CHANNEL_NAMES[c]));

/** Updates: Release or Latest; after a change the app looks for an update on the new channel. */
function UpdateSettings() {
  const [channel, setChannel] = useState<api.UpdateChannel | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    api.updateChannel().then(setChannel, (e) => setProblem(why(e)));
  }, []);
  const change = (i: number) => {
    const next = UPDATE_CHANNELS[i];
    if (!channel || next === channel.channel) return;
    setChannel({ ...channel, channel: next });
    setProblem(null);
    api
      .updateChannelSet(next)
      .then(setChannel, (e) => setProblem(why(e)))
      .finally(() => void emit(api.UPDATE_CHECK_EVENT));
  };
  return (
    <div className="vs-settings-updates">
      {channel && (
        <>
          <Segmented
            label="Updates"
            items={channelNames(channel.default)}
            index={Math.max(0, UPDATE_CHANNELS.indexOf(channel.channel))}
            onChange={change}
            title="Release: each published version. Latest: every build from main, untested beyond building"
          />
          <Line>{channel.channel === 'latest' ? 'Every build from main, untested beyond building.' : 'Each published version.'}</Line>
        </>
      )}
      {problem && (
        <Line className="vs-settings-problem" ariaRole="status">
          {problem}
        </Line>
      )}
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
function KeptToggle({ read, write, name, title, note }: { read(): Promise<boolean>; write(on: boolean): Promise<unknown>; name: string; title: string; note?: ReactNode }) {
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
    <div className="vs-settings-switch">
      <Switch checked={on === true} onChange={change} disabled={on === null} title={title}>
        <SwitchName>{name}</SwitchName>
      </Switch>
      {note && <Line>{note}</Line>}
      {problem && (
        <Line className="vs-settings-problem" ariaRole="status">
          {problem}
        </Line>
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
    <div className="vs-settings-switch">
      <Switch checked={shown} onChange={onChange} disabled={motion === null} title={REDUCE_WHAT}>
        <SwitchName>{name}</SwitchName>
      </Switch>
      {motion &&
        (motion.system ? (
          <Line className="vs-settings-follow">Following macOS's Reduce motion.</Line>
        ) : (
          <ActionButton tone="quiet" className="vs-settings-follow" label="Follow macOS's Reduce motion" title="Let macOS's Reduce motion decide again" onPress={onFollow}>
            Follow macOS
          </ActionButton>
        ))}
      {problem && (
        <Line className="vs-settings-problem" ariaRole="status">
          {problem}
        </Line>
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
      {state ? <EffectSettings state={state} set={set} /> : !notice && <Line ariaRole="status">Reading the effects…</Line>}
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
      <SourcePicker onError={failed} channels="shown" />
      <NoticeBanner notice={notice} onDismiss={dismiss} />
    </>
  );
}

/**
 * The presets section: the pack bar that used to sit at the foot of the
 * library (how many presets there are, getting the full library, adding a
 * folder), and the credits shown in its place until "← Presets".
 */
function PresetsSection() {
  const [entries, setEntries] = useState<api.Entry[]>([]);
  const [credits, setCredits] = useState(false);
  const read = useCallback(() => {
    api.presets().then(setEntries, () => {});
  }, []);
  useEffect(read, [read]);
  useTauriEvent<void>(pack.onChanged, read);
  if (credits) return <Credits entries={entries} onBack={() => setCredits(false)} />;
  return <PackBar presets={entries.length} dropped={null} credits={false} onCredits={() => setCredits(true)} />;
}

/** The sections, in the order the sheet shows them. */
export const SECTIONS = ['Sound', 'Presets', 'Output', 'Link', 'Effects', Say('render quality'), 'Accessibility', 'Privacy', 'Updates'] as const;

/**
 * **Job.** ⚙ Settings (#98), a sheet over any view: opened with `openSheet('settings')` from
 * Views, mounted by the app. Sound (what the app listens to, and its left and right channels),
 * Presets (how many, getting the full library, adding a folder, the credits), Output (display and
 * fit), Link (on or off and the bar start), Effects (strobe, fade to black, fine brightness and
 * sensitivity), the picture quality, Accessibility (reduce flashing) and Privacy (crash reports,
 * off unless turned on; no usage tracking at all).
 *
 * **Changed.** The core `Sheet` down the window's right (an `overlay` layer over a scrim, in an
 * `Opaque` scope since it covers the native preview). Each section is a layout `Group` (named,
 * its label a level-3 heading) rather than a `<section>`; sections are told apart by space
 * (`--mat-plate-gap`), never lines. Settings rows are type, not boxes: switches are the core
 * `Switch` as a labelled row; word switches the core `Segmented`, which the visuals tabs material
 * draws as words, the chosen one underlined in the accent. The focus ring and reduced-motion rules
 * of the original's `access.css` come with it (Settings.css), on the visuals tokens.
 *
 * **Kept.** `open`/`onClose`, the sections and their order, every line, name, tooltip and role,
 * Esc and the × ("Close settings"), and the 44px targets the original sized its sheets for.
 */
export function Settings({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;
  const [sound, presets, out, linked, effects, quality, access, privacy, updates] = SECTIONS;
  return (
    <Sheet title="Settings" className="vs-settings" scrim modal onClose={onClose}>
      <Section name={sound}>
        <SoundSection />
      </Section>
      <Section name={presets}>
        <PresetsSection />
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
          note={`No ${say('telemetry')}: nothing about you or how you use the app leaves this Mac. A crash report only goes anywhere if you send it yourself.`}
        />
      </Section>
      <Section name={updates}>
        <UpdateSettings />
      </Section>
    </Sheet>
  );
}
