#!/usr/bin/env node
// Fetches projectM's Cream of the Crop collection — about 9,800 curated `.milk`
// presets — into the preset library, at a pinned revision checked by hash.
//
// A command you run, not something the app does, and not something the repo or
// the app bundle carries: preset authors keep their rights, and projectM's own
// licence text only *assumes* they are public domain. So the pack is fetched to
// your machine on request and stays there, with that text beside it. See
// docs/milkdrop.md.
//
//   npm run presets:cream
//
// Safe to run again: an existing copy at the same revision is left alone.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { presetsRoot } from '../server/presets.ts';

const REVISION = '0180df21f5e0bd39b9060cc5de420ed2f1f9e509';
const SHA256 = '77ef8e527fb00343afdfb267f5a2e8d3d00430c563ca9f5ab2104fc306f5c674';
const URL = `https://codeload.github.com/projectM-visualizer/presets-cream-of-the-crop/tar.gz/${REVISION}`;

const root = presetsRoot();
const into = path.join(root, 'cream-of-the-crop');
const marker = path.join(into, '.revision');

if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === REVISION) {
  console.log(`presets: Cream of the Crop ${REVISION.slice(0, 7)} is already in ${into}`);
  process.exit(0);
}

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-cream-'));
try {
  const archive = path.join(scratch, 'cream.tar.gz');
  console.log(`presets: fetching Cream of the Crop at ${REVISION.slice(0, 7)}…`);
  run('curl', ['--fail', '--location', '--retry', '2', '--max-time', '300', URL, '--output', archive]);
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (digest !== SHA256) throw new Error(`archive checksum ${digest} is not the pinned ${SHA256}`);
  const unpacked = path.join(scratch, 'unpacked');
  fs.mkdirSync(unpacked);
  run('tar', ['-xzf', archive, '--strip-components=1', '-C', unpacked]);
  fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.renameSync(unpacked, into);
  fs.writeFileSync(marker, `${REVISION}\n`);
  let count = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.toLowerCase().endsWith('.milk')) count++;
    }
  };
  walk(into);
  console.log(`presets: ${count.toLocaleString()} presets in ${into}`);
  console.log('presets: authors keep their rights — see LICENSE.md in that folder.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
