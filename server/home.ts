import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the schemes live: `~/.openflow/visuals/schemes/<id>.json`.
 *
 * A home directory rather than a path beside the code, because a scheme is
 * yours rather than the repository's. Namespaced under `visuals/` so the other
 * open[flow] modules have somewhere to keep state without a rename when they
 * arrive. Beside the library sits `state.json`, which remembers nothing but
 * which scheme is open — so a restart reopens the show you were in.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** The `~/.openflow` root, movable wholesale with `OPENFLOW_HOME`. */
export function openflowHome(): string {
  return process.env.OPENFLOW_HOME ?? path.join(os.homedir(), '.openflow');
}

/**
 * What a scheme may be called: a filename that needs no quoting anywhere.
 * The same shape as a flow id, and for the same reason — ids are addresses.
 */
export const SCHEME_ID = /^[a-z][a-z0-9_-]*$/;

export interface SchemePlace {
  /** The open scheme's file. */
  file: string;
  /** Its id, which is the filename without `.json`. */
  id: string;
  /** The library directory, or null when `OPENFLOW_VISUALS_SCHEME` pins one file. */
  dir: string | null;
  /** Where which-scheme-is-open is remembered, or null when pinned. */
  stateFile: string | null;
}

/**
 * Where the open scheme is, with the place made ready.
 *
 * `OPENFLOW_VISUALS_SCHEME` still means what it always has — exactly this one
 * file — and it turns the library off: no directory is made, nothing is
 * adopted, and save-as has nowhere to go. Tests and one-file MCP setups point
 * it at scratch paths and expect no company.
 *
 * Otherwise the library directory is created here rather than at first write,
 * because the watcher in `library.ts` watches the *directory*, and a directory
 * that does not exist yet would silently cost the hot reload. `state.json`
 * says which scheme is open; an id it holds that is not a plain filename is
 * ignored rather than resolved, because this path is joined onto.
 *
 * A scheme from before the library is adopted into it as `main` — the single
 * `~/.openflow/visuals/scheme.json` an earlier version kept, or the
 * `visuals/scheme.json` beside the code before that. Copied rather than
 * re-serialised, so a hand-written `_` block survives byte for byte, and
 * copied rather than moved, because deleting a file of yours is not this
 * function's call.
 *
 * Logged to stderr, never stdout: the MCP server resolves the same path, and
 * one ordinary log line on stdout corrupts a stdio MCP session.
 */
export function schemePlace(legacy = path.resolve(here, '../scheme.json')): SchemePlace {
  const exact = process.env.OPENFLOW_VISUALS_SCHEME;
  if (exact) {
    return { file: exact, id: idOf(exact), dir: null, stateFile: null };
  }
  const home = path.join(openflowHome(), 'visuals');
  const dir = path.join(home, 'schemes');
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(home, 'state.json');
  let id = 'main';
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { scheme?: string };
    if (typeof state.scheme === 'string' && SCHEME_ID.test(state.scheme)) id = state.scheme;
  } catch {
    // No state yet, or an unreadable one: `main` is where every library starts.
  }
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) {
    for (const old of [path.join(home, 'scheme.json'), legacy]) {
      if (!fs.existsSync(old)) continue;
      fs.copyFileSync(old, file);
      console.error(`visuals: adopted ${shown(old)} into ${shown(file)}`);
      break;
    }
  }
  return { file, id, dir, stateFile };
}

/** The open scheme's file alone, which is all the MCP entry needs. */
export function schemeFile(legacy?: string): string {
  return schemePlace(legacy).file;
}

export interface LabPlace {
  /** The evidence database. */
  file: string;
  /** Content-addressed render artifacts, beside it. */
  artifacts: string;
}

/**
 * Where the lab's evidence lives, made ready.
 *
 * Under `OPENFLOW_HOME` and deliberately *not* under `OPENFLOW_VISUALS_SCHEME`:
 * that variable pins one scheme file, and a judgment corpus is not a scheme —
 * pointing the rig at a scratch scheme must not orphan months of reviews.
 */
export function labPlace(): LabPlace {
  const home = path.join(openflowHome(), 'visuals');
  const artifacts = path.join(home, 'lab-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  return { file: path.join(home, 'lab.sqlite3'), artifacts };
}

/** A path with the home directory spelled `~`, for logs meant to be read. */
export function shown(file: string): string {
  const home = os.homedir();
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}

function idOf(file: string): string {
  const name = path.basename(file);
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
}
