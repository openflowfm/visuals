import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openflowHome, schemeFile, shown } from './home.ts';

/**
 * The path the scheme lives at, and the one-time adoption of a file from the
 * old address. These run against a scratch `OPENFLOW_HOME` because the real
 * one belongs to whoever is running the tests.
 */
describe('schemeFile', () => {
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

  it('is the exact file when OPENFLOW_VISUALS_SCHEME names one', () => {
    // Untouched, not resolved against the home root: the smoke-test recipe
    // and the MCP tests point this at scratch files and expect no company.
    process.env.OPENFLOW_VISUALS_SCHEME = path.join(scratch, 'elsewhere.json');
    expect(schemeFile()).toBe(path.join(scratch, 'elsewhere.json'));
    expect(fs.existsSync(path.join(scratch, 'visuals'))).toBe(false);
  });

  it('sits under the home root, with the directory made ready', () => {
    // The directory has to exist before openScheme runs, because the watcher
    // watches the directory — created lazily at first write, the hot reload
    // would silently be missing until a restart.
    const file = schemeFile(path.join(scratch, 'no-legacy.json'));
    expect(file).toBe(path.join(scratch, 'visuals', 'scheme.json'));
    expect(fs.existsSync(path.dirname(file))).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('adopts a scheme from the old address, byte for byte', () => {
    const legacy = path.join(scratch, 'legacy.json');
    fs.writeFileSync(legacy, '{\n  "_": "kept verbatim",\n  "seed": "old"\n}\n');
    const file = schemeFile(legacy);
    expect(fs.readFileSync(file, 'utf8')).toBe(fs.readFileSync(legacy, 'utf8'));
    // Copied, not moved: deleting a file of yours is not this function's call.
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it('never adopts over a home file that already exists', () => {
    const legacy = path.join(scratch, 'legacy.json');
    fs.writeFileSync(legacy, '{"seed":"old"}\n');
    const file = path.join(scratch, 'visuals', 'scheme.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"seed":"newer"}\n');
    schemeFile(legacy);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"seed":"newer"}\n');
  });

  it('defaults the root to ~/.openflow', () => {
    delete process.env.OPENFLOW_HOME;
    expect(openflowHome()).toBe(path.join(os.homedir(), '.openflow'));
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
