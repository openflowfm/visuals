import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import * as api from './api.ts';
import type { SettingsProblem } from './api.ts';

/**
 * What the page shows when something went wrong behind it (#99): settings files
 * that couldn't be read or kept, and presets that failed to open or draw.
 */

/**
 * Reads a list once and then follows the event that sends it whole each time it
 * changes. A read that comes back after an event is dropped, since the event is
 * newer. Returns the function that stops following; nothing is set after it.
 */
export function follow<T>(read: () => Promise<T>, subscribe: (f: (value: T) => void) => Promise<UnlistenFn>, set: (value: T) => void): () => void {
  let live = true;
  let heard = false;
  const off = subscribe((value) => {
    if (!live) return;
    heard = true;
    set(value);
  });
  read().then(
    (value) => live && !heard && set(value),
    () => {},
  );
  return () => {
    live = false;
    off.then(
      (f) => f(),
      () => {},
    );
  };
}

/** One problem's key for dismissing it: the same file with a new message shows again. */
export const problemKey = (p: SettingsProblem): string => `${p.file}\n${p.message}`;

/** The problems still to show: not dismissed, and each once. */
export function shownProblems(problems: readonly SettingsProblem[], dismissed: ReadonlySet<string>): SettingsProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = problemKey(p);
    if (dismissed.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The problems put away this session; kept outside the home so they stay put away when it opens again. */
const dismissedProblems = new Set<string>();

/** The settings problems to show on the home, and `dismiss` to put one away for this session. */
export function useSettingsProblems(): { problems: SettingsProblem[]; dismiss(p: SettingsProblem): void } {
  const [all, setAll] = useState<SettingsProblem[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set(dismissedProblems));
  useEffect(() => follow(api.settingsProblems, api.onSettingsProblems, setAll), []);
  const dismiss = useCallback((p: SettingsProblem) => {
    dismissedProblems.add(problemKey(p));
    setDismissed(new Set(dismissedProblems));
  }, []);
  const problems = useMemo(() => shownProblems(all, dismissed), [all, dismissed]);
  return { problems, dismiss };
}

/** The paths of the presets that failed to open or draw this run, which live mode skips. */
export function useFailedPresets(): ReadonlySet<string> {
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => follow(api.presetsFailed, api.onPresetsFailed, setPaths), []);
  return useMemo(() => new Set(paths), [paths]);
}

/** What a failed preset's tile adds to what it says. */
export const FAILED_SAYS = 'didn’t open — skipped in live';
