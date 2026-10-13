import { useCallback, useEffect, useState } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Modal } from '@satoramoto/zen';
import { Opaque } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import { Text, type TextProps } from '@satoramoto/zen';
import * as api from '../model/api';
import { say } from '../model/words';
import './CrashPrompt.css';

/**
 * Crash reports (#102): on launch, when "Send crash reports" is on (⚙ ›
 * Privacy; off by default), the newest crash kept on this Mac that hasn't been
 * offered yet is shown with its text. "Send report" opens it as a prefilled
 * GitHub issue for the user to look over and submit (`api.crashReportOpen`);
 * nothing reaches a server otherwise. With reports off, crashes are still kept
 * (in `~/.openflow/visuals/crashes`) but
 * never offered, then or later.
 */

export type Report = api.CrashReport;

/** Where the crashes already offered (or passed over while reports were off) are kept. */
export const SEEN_KEY = 'visuals.crashes.seen';

/**
 * The reports already offered, by id, so an older one not yet offered still
 * shows. `when` is the high-water mark kept before ids were (every report
 * before that second counts as seen); it's carried over, never moved on.
 */
export interface Seen {
  when: number;
  ids: string[];
}

export const NONE_SEEN: Seen = { when: 0, ids: [] };

/** Whether `report` was offered already. */
export function wasSeen(report: Report, seen: Seen): boolean {
  return report.when < seen.when || seen.ids.includes(report.id);
}

/** The reports to offer: unsent and not seen, newest first. */
export function toOffer(reports: Report[], seen: Seen): Report[] {
  return reports.filter((r) => !r.sent && !wasSeen(r, seen)).sort((a, b) => b.when - a.when);
}

/**
 * `seen` with `reports` added, keeping only the ids of reports still kept
 * (`kept`, every report listed), so the list doesn't grow past the reports the
 * app keeps; ids are kept as they were when `kept` is empty.
 */
export function markSeen(reports: Report[], seen: Seen, kept: Report[] = []): Seen {
  const ids = [...new Set([...seen.ids, ...reports.map((r) => r.id)])];
  const still = new Set(kept.map((r) => r.id));
  return { when: seen.when, ids: kept.length > 0 ? ids.filter((id) => still.has(id)) : ids };
}

/** The text to show for `report`: the whole of it, or its summary when there's no more. */
export function shown(report: Report): string {
  return report.text?.trim() || report.summary;
}

/**
 * What the prompt says around the report: what Send report does, a reminder to
 * read the text first (the scrub can't catch every name; decision 54), and how
 * many `earlier` crashes are kept too.
 */
export function notes(earlier: number): { intro: string; check: string; earlier: string | null } {
  return {
    intro: 'Send report opens a GitHub issue with this text, for you to look over and submit. Nothing is sent otherwise, and the app collects nothing else.',
    check: say('crash report check'),
    earlier: earlier > 0 ? `${earlier === 1 ? 'One earlier crash is' : `${earlier} earlier crashes are`} kept on this Mac too, in ~/.openflow/visuals/crashes.` : null,
  };
}

/** The stored `seen`; nothing seen when there's none or storage is out of reach. */
export function readSeen(store?: Pick<Storage, 'getItem'>): Seen {
  try {
    const raw = (store ?? globalThis.localStorage)?.getItem(SEEN_KEY);
    if (!raw) return NONE_SEEN;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return { when: parsed, ids: [] };
    if (parsed && typeof parsed === 'object') {
      const { when, ids } = parsed as Partial<Seen>;
      if (typeof when === 'number' && Number.isFinite(when)) return { when, ids: Array.isArray(ids) ? ids.filter((i) => typeof i === 'string') : [] };
    }
    return NONE_SEEN;
  } catch {
    return NONE_SEEN;
  }
}

export function writeSeen(seen: Seen, store?: Pick<Storage, 'setItem'>) {
  try {
    (store ?? globalThis.localStorage)?.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Not kept: the same report may be offered again next launch.
  }
}

/** The report's text: a `pre` in the code role (the mono face, proportional figures as before),
 *  rendered by the screen Surface around it so one element is both. */
function ReportText(props: TextProps) {
  return <Text as="pre" role="code" tabular={false} {...props} />;
}

/**
 * **Job.** The crash prompt on launch: the newest unoffered crash, as it would be sent, with
 * Send report and Don't send.
 *
 * **Changed.** The core `Modal` (an `overlay` layer) in an `Opaque` scope, since it may open over
 * the native preview; its buttons are core `ActionButton`s. The report's text sits on the theme's
 * `screen` material (a readout window) instead of a 1px border (near borderless), in the faces'
 * monospace, the one place a monospace belongs (real text the app wrote). The Modal adds a ✕,
 * which closes as Don't send does.
 *
 * **Kept.** Every export (`Report`, `SEEN_KEY`, `Seen`, `NONE_SEEN`, `wasSeen`, `toOffer`,
 * `markSeen`, `shown`, `notes`, `readSeen`, `writeSeen`, `CrashPrompt`), the data flow, the
 * storage key, the copy and the dialog's name.
 */
export function CrashPrompt() {
  const [offer, setOffer] = useState<Report[]>([]);
  const [kept, setKept] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.crashReportsEnabled(), api.crashReports()])
      .then(([on, reports]: [boolean, Report[]]) => {
        const seen = readSeen();
        if (!on) {
          // Off: nothing is offered, and turning reports on later doesn't bring these back.
          writeSeen(markSeen(reports, seen, reports));
          return;
        }
        if (!live) return;
        setKept(reports);
        setOffer(toOffer(reports, seen));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const close = useCallback(() => {
    writeSeen(markSeen(offer, readSeen(), kept));
    setOffer([]);
    setError(null);
  }, [offer, kept]);

  const send = useCallback(() => {
    const report = offer[0];
    if (!report) return;
    api.crashReportOpen(report.id).then(close, (e: unknown) => setError(String(e)));
  }, [offer, close]);

  const report = offer[0];
  if (!report) return null;
  const said = notes(offer.length - 1);
  return (
    <Opaque className="vs-crash">
      <Modal
        title="visual[flow] crashed last time"
        onClose={close}
        width={520}
        actions={
          <>
            <ActionButton onPress={send}>Send report</ActionButton>
            <ActionButton tone="quiet" onPress={close}>
              Don't send
            </ActionButton>
          </>
        }
      >
        <p className="vs-crash-p">{said.intro}</p>
        <Text as="p" weight="strong" className="vs-crash-p vs-crash-check">
          {said.check}
        </Text>
        <Surface as={ReportText} material="screen" radius="input" className="vs-crash-text">
          {shown(report)}
        </Surface>
        {said.earlier && <p className="vs-crash-p">{said.earlier}</p>}
        {error && (
          <p className="vs-crash-p vs-crash-error" role="alert">
            {error}
          </p>
        )}
      </Modal>
    </Opaque>
  );
}
