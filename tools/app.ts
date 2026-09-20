#!/usr/bin/env node
// visual[flow], driven from one place. `node tools/app.ts <command>`.
//
// The single-app copy of BSV's `tools/app.ts`. That one drove every app in the
// monorepo from a shared registry; this repo has exactly one app, so the
// registry, `every` and `one` machinery are gone and each command just runs.
//
//   build     the renderer, with vite
//   electron  main, preload and the server, with esbuild
//   icons     the .icns, from public/mark.svg
//   run       build, electron, and open it
//   dev       the server, vite and the window, together — the one to type
//   pack      build, electron, icons, and electron-builder
//
// Anything that looks like a flag is handed to electron-builder, which is what
// keeps `npm run pack -- -c.mac.identity="Developer ID Application: …"` working.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { repairBuilder } from '@openflow/desktop/builderPatch.ts';
import { bin, visualsRoot } from './bin.ts';

const root = visualsRoot;
const node = (script: string, args: string[]) =>
  run(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    path.join(root, 'tools', script),
    ...args,
  ]);

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const done = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

const build = () => run(bin('vite'), ['build', '--config', 'vite.config.ts']);
const electron = () => node('electron.ts', []);
const icons = () => node('icons.ts', []);

/**
 * The signed pair, or the ad-hoc bundle QA wants.
 *
 * `OPENFLOW_QA` overrides the disk image and the identity, because
 * `install:apps` in BSV copies the `.app` locally and never opens an image —
 * measured at 4.7s against about three minutes for the signed, notarised pair.
 * The electron version is read off the installed package rather than pinned
 * here, so an upgrade is one `npm install`.
 */
function pack(): void {
  // v26's published package still lacks upstream #10101. Apply the exact
  // three-line backport before any signing; reject unfamiliar package code.
  const signing = createRequire(import.meta.url).resolve(
    'app-builder-lib/out/codeSign/macCodeSign.js',
  );
  const original = fs.readFileSync(signing, 'utf8');
  const repaired = repairBuilder(original);
  if (repaired !== original) fs.writeFileSync(signing, repaired);
  build();
  electron();
  icons();
  const read = "JSON.stringify(require('electron/package.json').version)";
  const version = JSON.parse(
    spawnSync(process.execPath, ['-p', read], { cwd: root, encoding: 'utf8' }).stdout,
  ) as string;
  run(bin('electron-builder'), [
    '--config',
    'electron-builder.yml',
    `-c.electronVersion=${version}`,
    ...(process.env.OPENFLOW_QA ? ['-c.mac.target=dir', '-c.mac.identity=null'] : []),
    // Last, so anything said on the command line wins over what is said here —
    // signing with a named identity on a machine that has one, most of all.
    ...flags,
  ]);
}

/** The window, on what is built. The show-night command, and the slow one. */
function open(): void {
  build();
  electron();
  run(bin('electron'), ['.']);
}

/**
 * Working on it: the server, vite and the window, in one command — the one to
 * type. Twice, in two checkouts or in one, and nothing collides.
 *
 * **Nothing here is assigned; everything is discovered.** The server goes first,
 * on whatever port is free, and says which over the IPC channel it is spawned
 * with — the same contract the packaged app's `supervise()` uses. vite is run in
 * this process rather than as a child so the port *it* settles on can be read
 * off its socket: it prefers the one the registry names, and moves up when that
 * is taken, exactly as the widgets bench does. Only then does the shell start,
 * told both — `OPENFLOW_DEV_URL` to open onto, `OPENFLOW_VISUALS_UI_PORT` to
 * key its profile by. The shell owns no server and takes no instance lock.
 *
 * `OPENFLOW_VISUALS_PORT` still names the server's port outright, for a wall on
 * another machine that has to dial in; `OPENFLOW_PORT_BASE` still moves vite's
 * preference, for a worktree that wants a predictable address.
 *
 * Closing the window ends all three: the shell's exit closes vite and kills the
 * server, and a signal here does the same.
 */
async function dev(): Promise<void> {
  const server = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(root, 'server', 'index.ts')],
    {
      cwd: root,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        OPENFLOW_VISUALS_PORT: process.env.OPENFLOW_VISUALS_PORT ?? '0',
        OPENFLOW_VISUALS_HOST: process.env.OPENFLOW_VISUALS_HOST ?? '127.0.0.1',
      },
    },
  );
  const stopServer = () => server.kill('SIGTERM');
  process.on('exit', stopServer);
  const port = await new Promise<number>((resolve, reject) => {
    server.on('message', (said: { type?: string; port?: number }) => {
      if (said.type === 'listening' && typeof said.port === 'number') resolve(said.port);
    });
    server.on('exit', (code, signal) =>
      reject(new Error(`the server exited (${signal ?? code}) before listening`)),
    );
  }).catch((why: Error) => {
    console.error(`app: ${why.message}`);
    process.exit(1);
  });

  // The config reads this when it loads, which is inside `createServer`.
  process.env.OPENFLOW_VISUALS = `http://127.0.0.1:${port}`;
  const { createServer } = await import('vite');
  const ui = await createServer({ configFile: path.join(root, 'vite.config.ts') });
  await ui.listen();
  const bound = ui.httpServer?.address();
  if (!bound || typeof bound === 'string') throw new Error('vite listened on no port');
  ui.printUrls();

  electron();
  const shell = spawn(bin('electron'), ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENFLOW_DEV: '1',
      OPENFLOW_DEV_URL: `http://localhost:${bound.port}`,
      OPENFLOW_VISUALS_UI_PORT: String(bound.port),
    },
  });
  const end = (code: number) => {
    shell.kill('SIGTERM');
    void ui.close().finally(() => process.exit(code));
  };
  shell.on('exit', (code) => end(code ?? 0));
  process.on('SIGINT', () => end(130));
  process.on('SIGTERM', () => end(143));
}

const [command, ...rest] = process.argv.slice(2);
const flags = rest.filter((arg) => arg.startsWith('-'));

if (flags.length && command !== 'pack') {
  console.error(`app: ${command} takes no options — ${flags.join(' ')} is electron-builder's`);
  process.exit(1);
}

switch (command) {
  case 'build':
    build();
    break;
  case 'electron':
    electron();
    break;
  case 'icons':
    icons();
    break;
  case 'pack':
    pack();
    break;
  case 'run':
    open();
    break;
  case 'dev':
    await dev();
    break;
  default:
    console.error(
      `app: no such command — ${command ?? '(none named)'}.\n` +
        '     Try: build, electron, icons, pack, run, dev',
    );
    process.exit(1);
}
