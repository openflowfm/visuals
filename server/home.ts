import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the scheme lives: `~/.openflow/visuals/scheme.json`.
 *
 * A home directory rather than a path beside the code, because the scheme is
 * runtime state — rewritten on every gesture, wrong to commit, and yours rather
 * than the repository's. Namespaced under `visuals/` from the start so the other
 * open[flow] modules have somewhere to keep state without a rename when they
 * arrive.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** The `~/.openflow` root, movable wholesale with `OPENFLOW_HOME`. */
export function openflowHome(): string {
  return process.env.OPENFLOW_HOME ?? path.join(os.homedir(), '.openflow');
}

/**
 * Where the scheme is read and written, with the place made ready.
 *
 * Most specific wins. `OPENFLOW_VISUALS_SCHEME` names an exact file and is
 * returned untouched — tests point it at scratch directories and expect no
 * side effects. Otherwise the file sits under the home root, and the directory
 * is created here rather than at first write, because the watcher in
 * `openScheme` watches the *directory* and a directory that does not exist yet
 * would silently cost the hot reload.
 *
 * A scheme still sitting at the old address — `visuals/scheme.json`, beside the
 * code — is adopted on the way: copied rather than re-serialised, so a
 * hand-written `_` block survives byte for byte, and copied rather than moved,
 * because deleting a file of yours is not this function's call. Once the home
 * file exists the old one is never read again.
 *
 * Logged to stderr, never stdout: the MCP server resolves the same path, and
 * one ordinary log line on stdout corrupts a stdio MCP session.
 */
export function schemeFile(legacy = path.resolve(here, '../scheme.json')): string {
  const exact = process.env.OPENFLOW_VISUALS_SCHEME;
  if (exact) return exact;
  const file = path.join(openflowHome(), 'visuals', 'scheme.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) && fs.existsSync(legacy)) {
    fs.copyFileSync(legacy, file);
    console.error(`visuals: adopted ${shown(legacy)} into ${shown(file)}`);
  }
  return file;
}

/** A path with the home directory spelled `~`, for logs meant to be read. */
export function shown(file: string): string {
  const home = os.homedir();
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}
