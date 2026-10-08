import { useEffect, useMemo, useState } from 'react';
import * as api from './api.ts';
import type { Entry } from './api.ts';
import { searchLibrary } from './librarySearch.ts';
import { nameOf } from './shell.ts';

/**
 * The preset to open once the library is read: `start` (found in the library,
 * or as a bare path when it isn't there), else the one at `pick` (0–1) through
 * the library, else none for an empty library.
 */
export function firstToOpen(library: Entry[], start: string | null, pick: number): Entry | null {
  if (start) return library.find((e) => e.path === start) ?? { path: start, name: nameOf(start), group: '' };
  if (!library.length) return null;
  return library[Math.min(library.length - 1, Math.floor(pick * library.length))];
}

/**
 * The preset library and its search. Once the folders are read it opens `start`,
 * or a random preset when there's none.
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
        const first = firstToOpen(l, start, Math.random());
        if (first) load(first);
      },
      (e) => {
        setLoaded(true);
        fail("Couldn't read the preset folder.")(e);
      },
    );
  }, [load, fail]);

  return { library, loaded, search, setSearch, found };
}
