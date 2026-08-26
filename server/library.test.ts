import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SchemePlace } from './home.ts';
import { openLibrary, type SchemeStore } from './library.ts';
import { BUILT_IN } from './scheme.ts';

/**
 * The distance between the screen and the disk, which is the store's whole
 * subject: an edit changes what `current()` answers and touches no file, a
 * save is the one way memory reaches disk, and a load is allowed to drop
 * edits because the console asks first.
 *
 * The watcher is not driven here — provoking fs.watch on a schedule is a
 * flake factory — so what these cover is every path a message can take.
 */
describe('the scheme store', () => {
  let scratch: string;
  let store: SchemeStore | null = null;

  const placed = (): SchemePlace => {
    const dir = path.join(scratch, 'visuals', 'schemes');
    fs.mkdirSync(dir, { recursive: true });
    return {
      dir,
      id: 'main',
      file: path.join(dir, 'main.json'),
      stateFile: path.join(scratch, 'visuals', 'state.json'),
    };
  };

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-library-'));
  });

  afterEach(() => {
    store?.stop();
    store = null;
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('draws the built-in show from an empty library, cleanly', () => {
    store = openLibrary(placed());
    expect(store.current()).toBe(BUILT_IN);
    expect(store.library()).toMatchObject({ schemes: ['main'], current: 'main', dirty: false });
    expect(fs.existsSync(placed().file)).toBe(false);
  });

  it('holds an edit in memory and touches no file', () => {
    const place = placed();
    store = openLibrary(place);
    const before = store.revision();
    store.replace({ ...store.current(), seed: 'edited' });
    expect(store.current().seed).toBe('edited');
    expect(store.revision()).toBeGreaterThan(before);
    expect(store.library().dirty).toBe(true);
    expect(fs.existsSync(place.file)).toBe(false);
  });

  it('saves the open scheme to its file and is clean again', () => {
    const place = placed();
    store = openLibrary(place);
    store.replace({ ...store.current(), seed: 'meant' });
    store.save();
    expect(store.library().dirty).toBe(false);
    const written = JSON.parse(fs.readFileSync(place.file, 'utf8')) as { seed?: string };
    expect(written.seed).toBe('meant');
  });

  it('keeps a hand-written top-level block across a save', () => {
    const place = placed();
    fs.writeFileSync(place.file, '{ "_": "what every key means", "seed": "old" }\n');
    store = openLibrary(place);
    store.replace({ ...store.current(), seed: 'new' });
    store.save();
    const written = JSON.parse(fs.readFileSync(place.file, 'utf8')) as Record<string, unknown>;
    expect(written._).toBe('what every key means');
    expect(written.seed).toBe('new');
  });

  it('saves as a new id, switches to it, and remembers across a restart', () => {
    const place = placed();
    store = openLibrary(place);
    store.replace({ ...store.current(), seed: 'night-version' });
    store.saveAs('night');
    // `main` is gone from the shelf: it never had a file, and an unsaved id
    // is only listed while it is the open one.
    expect(store.library()).toMatchObject({
      schemes: ['night'],
      current: 'night',
      dirty: false,
    });
    expect(fs.existsSync(path.join(place.dir!, 'night.json'))).toBe(true);
    // main.json was never written: save-as moved *on*, it did not save behind.
    expect(fs.existsSync(place.file)).toBe(false);
    const state = JSON.parse(fs.readFileSync(place.stateFile!, 'utf8')) as { scheme: string };
    expect(state.scheme).toBe('night');
  });

  it('loads a saved scheme, dropping what was on screen', () => {
    const place = placed();
    fs.writeFileSync(path.join(place.dir!, 'calm.json'), '{ "seed": "calm" }\n');
    store = openLibrary(place);
    store.replace({ ...store.current(), seed: 'wreckage' });
    store.load('calm');
    expect(store.current().seed).toBe('calm');
    expect(store.library()).toMatchObject({ current: 'calm', dirty: false });
  });

  it('reloading the open scheme is the revert gesture', () => {
    const place = placed();
    store = openLibrary(place);
    store.replace({ ...store.current(), seed: 'meant' });
    store.save();
    store.replace({ ...store.current(), seed: 'wreckage' });
    store.load('main');
    expect(store.current().seed).toBe('meant');
    expect(store.library().dirty).toBe(false);
  });

  it('refuses a load of nothing, and says so instead of moving', () => {
    store = openLibrary(placed());
    store.replace({ ...store.current(), seed: 'kept' });
    store.load('nonesuch');
    expect(store.library()).toMatchObject({ current: 'main', dirty: true });
    expect(store.library().notice).toContain('nonesuch');
    expect(store.current().seed).toBe('kept');
  });

  it('refuses a save-as id that is not a plain filename', () => {
    const place = placed();
    store = openLibrary(place);
    store.saveAs('../escape');
    expect(store.library().current).toBe('main');
    expect(store.library().notice).toContain('a-z');
    expect(fs.existsSync(path.join(place.dir!, '..', 'escape.json'))).toBe(false);
  });

  it('pinned to one file, it saves there and goes nowhere else', () => {
    const file = path.join(scratch, 'pinned.json');
    store = openLibrary({ file, id: 'pinned', dir: null, stateFile: null });
    store.replace({ ...store.current(), seed: 'pinned-edit' });
    store.save();
    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as { seed?: string }).seed).toBe(
      'pinned-edit',
    );
    store.saveAs('elsewhere');
    expect(store.library().notice).toContain('OPENFLOW_VISUALS_SCHEME');
    store.load('elsewhere');
    expect(store.library().current).toBe('pinned');
    expect(store.library().schemes).toEqual(['pinned']);
  });

  it('keeps the working scheme when a load hits a broken file', () => {
    const place = placed();
    fs.writeFileSync(path.join(place.dir!, 'torn.json'), '{ "seed": "torn"');
    store = openLibrary(place);
    store.replace({ ...store.current(), seed: 'showing' });
    store.load('torn');
    // The show survives the trailing comma; the panel gets the message.
    expect(store.current().seed).toBe('showing');
    expect(store.error()).not.toBeNull();
  });

  it('keeps the working scheme when a load hits a poisoned value', () => {
    // A value of the wrong shape is a parse failure by another name — nothing
    // can say what `"colorways": {"x": "nope"}` meant — and it used to be worse
    // than a trailing comma, because it parsed and then killed the show tick.
    const place = placed();
    fs.writeFileSync(path.join(place.dir!, 'poison.json'), '{ "colorways": { "x": "nope" } }');
    store = openLibrary(place);
    store.replace({ ...store.current(), seed: 'showing' });
    store.load('poison');
    expect(store.current().seed).toBe('showing');
    expect(store.error()).toContain('colorways');
  });

  it('refuses an edit of the wrong shape and keeps what is on screen', () => {
    // The editor is the other door into `merge`, and a skewed console or a
    // hand-built scheme over MCP reaches it the same way a file does.
    const place = placed();
    store = openLibrary(place);
    store.replace({ ...store.current(), seed: 'showing' });
    const rev = store.revision();
    store.replace({ ...store.current(), songs: { Sandstorm: { flows: 'folded' } } } as never);
    expect(store.current().seed).toBe('showing');
    expect(store.current().songs.Sandstorm).toBeUndefined();
    expect(store.revision()).toBe(rev);
    expect(store.error()).not.toBeNull();
  });
});
