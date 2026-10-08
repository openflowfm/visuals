import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.ts';
import type { Entry, Owner, Preset, Report } from './api.ts';
import { searchLibrary } from './librarySearch.ts';
import { nameOf } from './shell.ts';
import { setValue as setValueIn } from './stages.ts';

/**
 * Apply edits with `apply`, newest first: each edit waits `ms` for the next one,
 * one apply runs at a time, and while one is running only the latest edit waits
 * behind it. Every result, or a failure as an equations problem, goes to `onReport`.
 */
export function makeApplier(apply: (p: Preset) => Promise<Report>, onReport: (r: Report) => void, ms = 250) {
  let running = false;
  let waiting: Preset | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async (p: Preset) => {
    if (running) {
      waiting = p;
      return;
    }
    running = true;
    try {
      onReport(await apply(p));
    } catch (e) {
      onReport({ equations: [{ stage: 'equations', message: String(e), line: null }], shaders: [] });
    }
    running = false;
    const next = waiting;
    waiting = null;
    if (next) run(next);
  };
  return (p: Preset) => {
    clearTimeout(timer);
    timer = setTimeout(() => run(p), ms);
  };
}

/** Apply edits to the bench through `makeApplier`. */
export function useApply(onReport: (r: Report) => void) {
  return useMemo(() => makeApplier(api.apply, onReport), [onReport]);
}

/**
 * The preset folder and its search. Once the folder is read it loads `start`, or
 * a random preset when there's none.
 */
export function useLibrary(start: string | null, load: (e: Entry) => void, fail: (message: string) => (e: unknown) => void) {
  const [library, setLibrary] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const found = useMemo(() => searchLibrary(library, search), [library, search]);

  useEffect(() => {
    api.presets().then(
      (l) => {
        setLibrary(l);
        setLoaded(true);
        const first = start ? (l.find((e) => e.path === start) ?? { path: start, name: nameOf(start), group: '' }) : null;
        if (first) load(first);
        else if (l.length) load(l[Math.floor(Math.random() * l.length)]);
      },
      (e) => {
        setLoaded(true);
        fail('couldn’t read the preset folder')(e);
      },
    );
  }, [load, fail]);

  return { library, loaded, search, setSearch, found };
}

/**
 * Edits to the open preset. `edit` replaces it and applies it to the bench;
 * `set` changes one setting, which goes to the bench live.
 */
export function usePresetEdits(preset: Preset | null, setPreset: (p: Preset) => void, apply: (p: Preset) => void) {
  // The preset as of the latest edit, for edits that land between renders.
  const latest = useRef<Preset | null>(null);
  latest.current = preset;

  const edit = (next: Preset) => {
    latest.current = next;
    setPreset(next);
    apply(next);
  };

  // Settings go to the bench live, at most once a display frame per setting.
  const pending = useRef(new Map<string, { owner: Owner; key: string; value: number }>());
  const flushing = useRef(0);
  const set = useCallback(
    (owner: Owner, key: string, value: number) => {
      if (!latest.current) return;
      const [next, written] = setValueIn(latest.current, owner, key, value);
      latest.current = next;
      setPreset(next);
      pending.current.set(`${JSON.stringify(owner)}:${written}`, { owner, key: written, value });
      if (flushing.current) return;
      flushing.current = requestAnimationFrame(() => {
        flushing.current = 0;
        const changes = [...pending.current.values()];
        pending.current.clear();
        for (const c of changes) {
          api.setValue(c.owner, c.key, c.value).then((live) => {
            if (!live && latest.current) apply(latest.current);
          });
        }
      });
    },
    [apply],
  );

  return { edit, set };
}
