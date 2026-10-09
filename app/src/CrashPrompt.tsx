import { useCallback, useEffect, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Modal } from '@openflow/widgets/chrome/Modal.tsx';
import * as api from './api.ts';
import { say } from './words.ts';
import './crash.css';

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
    <Modal
      title="visual[flow] crashed last time"
      onClose={close}
      actions={
        <>
          <Button onPress={send}>Send report</Button>
          <Button tone="quiet" onPress={close}>
            Don't send
          </Button>
        </>
      }
    >
      <p>{said.intro}</p>
      <p className="crash-check">{said.check}</p>
      <pre className="crash-text">{shown(report)}</pre>
      {said.earlier && <p>{said.earlier}</p>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
