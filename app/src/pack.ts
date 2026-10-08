import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { say } from './words.ts';

// The presets the app has: the bundled starter set and the full pack's download.
// A stub for now: issue #86 fills in the download (`pack::pack_download`).

/** `pack::State`: where the full pack's download is. */
export type PackState = 'idle' | 'downloading' | 'failed';

/** `pack::PackStatus`. */
export interface PackStatus {
  /** Presets in the bundled starter set. */
  starter: number;
  /** Presets in the presets folder. */
  installed: number;
  /** Presets in the full pack. */
  total: number;
  /** The full pack's download, in bytes. */
  size: number;
  state: PackState;
  /** Bytes downloaded so far. */
  received: number;
  /** Why the last download failed. */
  error: string | null;
}

/** `pack::PROGRESS`. */
export const PROGRESS = 'pack-progress';

export const status = () => invoke<PackStatus>('pack_status');
/** Start downloading the full pack into the presets folder; progress comes on `onProgress`. */
export const download = () => invoke<void>('pack_download');
/** Each step of the download. */
export const onProgress = (f: (s: PackStatus) => void): Promise<UnlistenFn> => listen<PackStatus>(PROGRESS, (e) => f(e.payload));

/** The download's progress, 0–1; 0 before it knows the size. */
export const fraction = (s: PackStatus): number => (s.size > 0 ? Math.min(1, s.received / s.size) : 0);

/** `pack::CHANGED`: the presets folder changed (a download, an add, a file moved in by hand). */
export const CHANGED = 'presets-changed';
/** Each change to the presets folder. */
export const onChanged = (f: () => void): Promise<UnlistenFn> => listen(CHANGED, () => f());

/** The app menu's Credits item. */
export const CREDITS = 'credits';
/** The Credits menu item was chosen. */
export const onCredits = (f: () => void): Promise<UnlistenFn> => listen(CREDITS, () => f());

/** `pack::Added`: a dropped file or folder by its path, or a picked file by its folder-relative name and its text. */
export type Added = { path: string } | { name: string; text: string };
/** Copy presets into the presets folder; resolves with how many files were added, rejects with why when there was nothing to add. */
export const add = (items: Added[]) => invoke<number>('pack_add', { items });

/** projectM's "Cream of the Crop", the pack the full library comes from. */
export const PACK_PAGE = 'https://github.com/projectM-visualizer/presets-cream-of-the-crop';
/** Where an author asks for their presets to be taken out. */
export const TAKEDOWN = 'https://github.com/openflowfm/visuals/issues/new?title=Preset%20takedown';

const count = (n: number) => n.toLocaleString('en-US');

/** A size in whole megabytes, as people read them: 10,847,153 bytes is "11 MB". */
export const megabytes = (bytes: number): string => `${bytes > 0 ? Math.max(1, Math.round(bytes / 1e6)) : 0} MB`;

/** What the pack bar's button says and shows. */
export interface PackAction {
  state: PackState;
  /** The button's words. */
  label: string;
  /** The download's progress, 0–1, while it runs; null otherwise. */
  progress: number | null;
  /** Why the last download failed, shown beside the retry. */
  error: string | null;
}

/** What the pack bar offers for `s`; null once every preset of the full library is in. */
export const packAction = (s: PackStatus): PackAction | null => {
  if (s.total > 0 && s.installed >= s.total) return null;
  const pack = say('pack');
  if (s.state === 'downloading') {
    const f = fraction(s);
    return { state: s.state, label: `Getting the ${pack}… ${Math.floor(f * 100)}%`, progress: f, error: null };
  }
  if (s.state === 'failed') {
    return { state: s.state, label: `Try getting the ${pack} again`, progress: null, error: s.error ?? 'The download stopped.' };
  }
  const size = s.size > 0 ? ` (${megabytes(s.size)})` : '';
  return { state: s.state, label: `Get the ${pack}: ${count(s.total)} presets${size}`, progress: null, error: null };
};

/** Splits an author part on the ways MilkDrop names join collaborators. */
const JOINS = /\s+\+\s+|\s*&\s*|\s*,\s*|\s+vs\.?\s+|\s+n\s+|\s+and\s+/i;
/** A trailing "--- X edit" (sometimes "edit17"): X edited the preset. */
const EDIT = /\s*---\s*(.+?)\s+edit\w*\s*$/i;

/**
 * The authors a MilkDrop file name credits: in each "===" segment (a mash-up of
 * presets) the part before the first " - ", split where collaborators are joined
 * (+, &, comma, vs, n, and), plus the X of a trailing "--- X edit". Counts such as
 * "goody(4)" lose their brackets; pure numbers and anything over three words (a
 * title, not a name) are dropped; repeats are dropped case-insensitively, keeping
 * the first spelling. A name with no " - " credits nobody.
 */
export const authorsOf = (name: string): string[] => {
  const found: string[] = [];
  for (const segment of name.split('===')) {
    let rest = segment;
    const edit = EDIT.exec(rest);
    if (edit) rest = rest.slice(0, edit.index);
    const dash = rest.indexOf(' - ');
    if (dash >= 0) found.push(...rest.slice(0, dash).split(JOINS));
    if (edit) found.push(edit[1]);
  }
  const seen = new Set<string>();
  const authors: string[] = [];
  for (const raw of found) {
    const a = raw
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = a.toLowerCase();
    if (!a || /^\d+$/.test(a) || a.split(' ').length > 3 || seen.has(key)) continue;
    seen.add(key);
    authors.push(a);
  }
  return authors;
};

/** One author in the credits, with how many presets in the library name them. */
export interface Credit {
  author: string;
  count: number;
}

/** Every author the library's file names credit, most presets first, then by name; spelled as first seen. */
export const credits = (entries: { name: string }[]): Credit[] => {
  const by = new Map<string, Credit>();
  for (const e of entries) {
    for (const author of authorsOf(e.name)) {
      const key = author.toLowerCase();
      const c = by.get(key);
      if (c) c.count++;
      else by.set(key, { author, count: 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.author.localeCompare(b.author, 'en', { sensitivity: 'base' }));
};
