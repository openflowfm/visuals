import fs from 'node:fs';
import path from 'node:path';
import type { Library, Scheme } from '../protocol.ts';
import { SCHEME_ID, schemePlace, shown, type SchemePlace } from './home.ts';
import { BUILT_IN, merge, type SchemeSource } from './scheme.ts';

/**
 * The scheme library: what is open, what is saved, and the distance between.
 *
 * **An edit is not a save.** The editor publishes every gesture so the picture
 * follows the pointer, and all of it lands here in memory only — nothing
 * reaches disk until someone says so. That is what makes it safe to tear a
 * scheme apart during a set: the show on screen is yours to wreck, and the
 * saved one is exactly as good as it was when you last meant it.
 *
 * The cost is honest too: unsaved edits live in this process, and a server
 * that stops takes them with it.
 *
 * A parse failure on load **keeps the scheme that was already working** and
 * reports the message — losing the show because of a trailing comma is the
 * wrong answer at any time and an unthinkable one during a set.
 */
export interface SchemeStore extends SchemeSource {
  /** Take an edit: published everywhere, held in memory, written nowhere. */
  replace(next: Scheme): void;
  /** Write the open scheme to its file — the one way memory reaches disk. */
  save(): void;
  /** Write it under a new id, and be on that id from now on. */
  saveAs(id: string): void;
  /** Open a saved scheme. Unsaved edits are dropped, which is the point. */
  load(id: string): void;
  /** What the console's scheme shelf shows. */
  library(): Library;
  /** Bumped whenever `current()` starts answering differently. */
  revision(): number;
  stop(): void;
}

export function openLibrary(place: SchemePlace = schemePlace()): SchemeStore {
  let at = place;
  let working: Scheme = BUILT_IN;
  let dirty = false;
  let rev = 0;
  let error: string | null = null;
  let notice: string | null = null;
  let watcher: fs.FSWatcher | null = null;
  let debounce: NodeJS.Timeout | null = null;
  /**
   * The last thing we wrote ourselves, so the watcher can tell a save it made
   * from a hand on the file. Re-reading our own save would land a render or
   * two later and yank a control out from under a drag.
   */
  let written: string | null = null;

  /** The open file into memory, replacing what was there. */
  const read = () => {
    if (!fs.existsSync(at.file)) {
      // A library with nothing in it draws the built-in show. Saving is what
      // creates the file, so a fresh machine stays clean until someone means it.
      working = BUILT_IN;
      error = null;
      rev += 1;
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(at.file, 'utf8');
    } catch {
      return;
    }
    try {
      working = merge(JSON.parse(text) as Partial<Scheme>);
      error = null;
      rev += 1;
      console.log(`visuals: scheme loaded from ${shown(at.file)}`);
    } catch (err) {
      error = (err as Error).message;
      console.warn(`visuals: scheme not reloaded — ${error}`);
    }
  };

  /**
   * The open file changed under us — a hand, an editor, the MCP server.
   *
   * Clean, it reloads: the whole point of a file is that you can edit it with
   * the picture on screen beside you. Dirty, it does not — reloading would
   * throw away what is on screen, and silently keeping either side is how work
   * disappears. The screen keeps its edits, the console says the file moved,
   * and the person holding both decides: save overwrites the file's version,
   * load takes it.
   */
  const changed = () => {
    let text: string | null = null;
    try {
      text = fs.readFileSync(at.file, 'utf8');
    } catch {
      // Deleted or unreadable: fall through, read() decides what that means.
    }
    if (written !== null && text !== null && text.trim() === written.trim()) return;
    written = null;
    if (dirty) {
      notice = `${at.id}.json changed on disk — save overwrites it, load takes it`;
      return;
    }
    read();
  };

  read();

  try {
    // The directory, not the file: editors and this module both write by
    // renaming a temp file over the target, which breaks a watch on the inode
    // and would silently stop reloading after the first save.
    watcher = fs.watch(path.dirname(at.file), (_event, name) => {
      if (name && name !== path.basename(at.file)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(changed, 120);
    });
  } catch {
    // A platform without directory watching still runs; it just needs a restart.
  }

  /** Which scheme is open, remembered, so a restart reopens it. */
  const remember = () => {
    if (!at.stateFile) return;
    try {
      fs.writeFileSync(at.stateFile, `${JSON.stringify({ scheme: at.id }, null, 2)}\n`);
    } catch {
      // Not worth failing the open for; the next boot starts on `main`.
    }
  };

  const write = () => {
    // Written over whatever the file already held rather than in place of it:
    // a hand-written top-level `_` block explaining the keys survives a save.
    let held: Record<string, unknown> = {};
    try {
      held = JSON.parse(fs.readFileSync(at.file, 'utf8')) as Record<string, unknown>;
    } catch {
      // No file yet, or one we are about to replace anyway.
    }
    written = JSON.stringify({ ...held, ...working }, null, 2);
    // A temporary file renamed over the target, never a write in place: the
    // file is the record of the show, and a crash mid-write must not be able
    // to leave half of one.
    const temporary = `${at.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, `${written}\n`);
      fs.renameSync(temporary, at.file);
      dirty = false;
      notice = null;
      error = null;
    } catch (err) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      error = `could not write ${path.basename(at.file)}: ${(err as Error).message}`;
    }
  };

  return {
    current: () => working,
    error: () => error,
    revision: () => rev,
    replace(next) {
      working = merge(next);
      dirty = true;
      rev += 1;
    },
    save: write,
    saveAs(id) {
      if (!at.dir) {
        notice = 'pinned to one file by OPENFLOW_VISUALS_SCHEME — save as has nowhere to go';
        return;
      }
      if (!SCHEME_ID.test(id)) {
        notice = 'a scheme id is a-z, 0-9, _ or -, starting with a letter';
        return;
      }
      at = { ...at, id, file: path.join(at.dir, `${id}.json`) };
      write();
      remember();
    },
    load(id) {
      if (id === at.id) {
        // Reopening the open scheme is how unsaved edits are thrown away.
        dirty = false;
        notice = null;
        read();
        return;
      }
      if (!at.dir) {
        notice = 'pinned to one file by OPENFLOW_VISUALS_SCHEME — there is nothing else to open';
        return;
      }
      if (!SCHEME_ID.test(id) || !fs.existsSync(path.join(at.dir, `${id}.json`))) {
        notice = `no scheme named ${id}`;
        return;
      }
      at = { ...at, id, file: path.join(at.dir, `${id}.json`) };
      dirty = false;
      notice = null;
      read();
      remember();
    },
    library() {
      let schemes = [at.id];
      if (at.dir) {
        try {
          schemes = fs
            .readdirSync(at.dir)
            .filter((name) => name.endsWith('.json'))
            .map((name) => name.slice(0, -'.json'.length));
        } catch {
          schemes = [];
        }
        // The open scheme may not have a file yet — a fresh library, or a
        // save-as that failed to write. It is still the one that is open.
        if (!schemes.includes(at.id)) schemes.push(at.id);
        schemes.sort();
      }
      return { schemes, current: at.id, dirty, notice };
    },
    stop() {
      if (debounce) clearTimeout(debounce);
      watcher?.close();
    },
  };
}
