// Builds the Ableton Link native addon.
//
// `@ktamas77/abletonlink` vendors Ableton's own C++ Link library and wraps it
// with node-addon-api, which is the right dependency to have — reimplementing
// Link's protocol from the reverse-engineering notes would be a liability on
// stage. But its `binding.gyp` pins C++14, and the node-addon-api it resolves
// against needs C++17, so a plain `npm install` fails to compile with
// "constexpr if is a C++17 extension" and six template errors after it.
//
// So the package installs with `--ignore-scripts` and this repairs the one
// wrong flag and builds it. Idempotent: it rewrites nothing already correct,
// and skips the build entirely when the binary is newer than the gyp.
//
// This is the whole reason `visuals/` has a `node_modules` of its own, the way
// `bridge/` does for `ws`.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const addon = path.resolve(here, '../node_modules/@ktamas77/abletonlink');
const gyp = path.join(addon, 'binding.gyp');
const built = path.join(addon, 'build/Release/abletonlink.node');

if (!fs.existsSync(gyp)) {
  console.error(
    `link: ${path.relative(process.cwd(), addon)} is not installed.\n` +
      `      run: cd visuals && npm install --ignore-scripts`,
  );
  process.exit(1);
}

const before = fs.readFileSync(gyp, 'utf8');
let after = before.replaceAll('c++14', 'c++17');

// The second repair, and the one that is this repo's fault rather than the
// package's: `binding.gyp` asks node for node-addon-api's absolute include
// path, and node-gyp writes it into the Makefile unquoted. Any space in the
// checkout's path splits it into two arguments and clang reports half of it as
// a missing directory. This checkout lives under "The Source".
//
// Relative paths have no absolute prefix to split, and gyp resolves them
// against the .gyp file, so they are correct wherever the repo sits.
const api = path.dirname(
  createRequire(import.meta.url).resolve('node-addon-api/package.json', { paths: [addon] }),
);
const toApi = path.relative(addon, api).replaceAll(path.sep, '/');
after = after
  .replace(/"<!@?\(node -p \\?"require\('node-addon-api'\)\.include\\?"\)"/, `"${toApi}"`)
  .replace(
    /"<!@?\(node -p \\?"require\('node-addon-api'\)\.gyp\\?"\)"/,
    `"${toApi}/node_api.gyp:nothing"`,
  );

if (after !== before) {
  fs.writeFileSync(gyp, after);
  console.log('link: binding.gyp repaired (C++17, and paths that survive a space)');
}

if (fs.existsSync(built) && fs.statSync(built).mtimeMs > fs.statSync(gyp).mtimeMs) {
  console.log('link: addon already built');
  process.exit(0);
}

console.log('link: compiling the addon, which takes a minute the first time');
try {
  execFileSync('npx', ['node-gyp', 'rebuild'], { cwd: addon, stdio: 'inherit' });
} catch {
  console.error(
    '\nlink: the addon did not build.\n' +
      '      On macOS this usually means the Command Line Tools are missing:\n' +
      '        xcode-select --install\n' +
      '      Everything except the clock still runs without it — see visuals/docs/link.md.',
  );
  process.exit(1);
}
console.log('link: built', path.relative(process.cwd(), built));
