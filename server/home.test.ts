import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calibrationFile, labPlace, openflowHome, schemePlace, shown } from './home.ts';

/**
 * Where the open scheme is, and the one-time adoption of a file from an older
 * address. These run against a scratch `OPENFLOW_HOME` because the real one
 * belongs to whoever is running the tests.
 */
describe('schemePlace', () => {
  let scratch: string;
  const held: Record<string, string | undefined> = {};

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-home-'));
    held.OPENFLOW_HOME = process.env.OPENFLOW_HOME;
    held.OPENFLOW_VISUALS_SCHEME = process.env.OPENFLOW_VISUALS_SCHEME;
    process.env.OPENFLOW_HOME = scratch;
    delete process.env.OPENFLOW_VISUALS_SCHEME;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(held)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('is exactly one file when OPENFLOW_VISUALS_SCHEME names it, library off', () => {
    // Untouched, not resolved against the home root: tests and one-file MCP
    // setups point this at scratch files and expect no company.
    process.env.OPENFLOW_VISUALS_SCHEME = path.join(scratch, 'elsewhere.json');
    const place = schemePlace();
    expect(place.file).toBe(path.join(scratch, 'elsewhere.json'));
    expect(place.id).toBe('elsewhere');
    expect(place.dir).toBeNull();
    expect(place.stateFile).toBeNull();
    expect(fs.existsSync(path.join(scratch, 'visuals'))).toBe(false);
  });

  it('opens main in the library, with the directory made ready', () => {
    // The directory has to exist before the store runs, because its watcher
    // watches the directory — made lazily at first write, the hot reload would
    // silently be missing until a restart.
    const place = schemePlace(path.join(scratch, 'no-legacy.json'));
    expect(place.file).toBe(path.join(scratch, 'visuals', 'schemes', 'main.json'));
    expect(place.id).toBe('main');
    expect(fs.existsSync(place.dir!)).toBe(true);
    expect(fs.existsSync(place.file)).toBe(false);
  });

  it('reopens the scheme state.json remembers', () => {
    const home = path.join(scratch, 'visuals');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'state.json'), '{ "scheme": "night" }\n');
    expect(schemePlace(path.join(scratch, 'no-legacy.json')).id).toBe('night');
  });

  it('ignores a remembered id that is not a plain filename', () => {
    // state.json is joined onto a path, so an id it holds that could walk out
    // of the library is dropped rather than resolved.
    const home = path.join(scratch, 'visuals');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'state.json'), '{ "scheme": "../../etc/passwd" }\n');
    expect(schemePlace(path.join(scratch, 'no-legacy.json')).id).toBe('main');
  });

  it('adopts the single scheme.json an earlier version kept, byte for byte', () => {
    const old = path.join(scratch, 'visuals', 'scheme.json');
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, '{\n  "_": "kept verbatim",\n  "seed": "old"\n}\n');
    const place = schemePlace(path.join(scratch, 'no-legacy.json'));
    expect(fs.readFileSync(place.file, 'utf8')).toBe(fs.readFileSync(old, 'utf8'));
    // Copied, not moved: deleting a file of yours is not this function's call.
    expect(fs.existsSync(old)).toBe(true);
  });

  it('falls back to the file beside the code, oldest address last', () => {
    const legacy = path.join(scratch, 'legacy.json');
    fs.writeFileSync(legacy, '{"seed":"repo"}\n');
    const place = schemePlace(legacy);
    expect(fs.readFileSync(place.file, 'utf8')).toBe('{"seed":"repo"}\n');
  });

  it('never adopts over a scheme the library already has', () => {
    const legacy = path.join(scratch, 'legacy.json');
    fs.writeFileSync(legacy, '{"seed":"old"}\n');
    const file = path.join(scratch, 'visuals', 'schemes', 'main.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"seed":"newer"}\n');
    schemePlace(legacy);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"seed":"newer"}\n');
  });

  it('keeps development calibration evidence beside but outside the user lab', () => {
    expect(labPlace().file).toBe(path.join(scratch, 'visuals', 'lab.sqlite3'));
    expect(calibrationFile()).toBe(path.join(scratch, 'visuals', 'calibration.sqlite3'));
    expect(calibrationFile()).not.toBe(labPlace().file);
  });
});

describe('shown', () => {
  it('spells the home directory as ~ and leaves other paths alone', () => {
    expect(shown(path.join(os.homedir(), '.openflow', 'visuals', 'scheme.json'))).toBe(
      '~/.openflow/visuals/scheme.json',
    );
    expect(shown('/etc/hosts')).toBe('/etc/hosts');
  });
});

describe('openflowHome', () => {
  it('defaults the root to ~/.openflow', () => {
    const held = process.env.OPENFLOW_HOME;
    delete process.env.OPENFLOW_HOME;
    expect(openflowHome()).toBe(path.join(os.homedir(), '.openflow'));
    if (held !== undefined) process.env.OPENFLOW_HOME = held;
  });
});
