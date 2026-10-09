# The preset pack bundle

The app ships with a starter set of 250 presets and downloads the full library on request
(`app/src-tauri/src/pack.rs`). The download is our own bundle: projectM's
[cream-of-the-crop](https://github.com/projectM-visualizer/presets-cream-of-the-crop)
(9,795 presets) at a pinned commit, with the `index.json` and `thumbnails/` the `index` bin
draws for it (see "The preset index" in `docs/milkdrop-engine.md`). The library arrives
grouped, with its pictures, colours and levels, and nothing is drawn on the user's Mac.

## What's in it

One tar.gz, `cream-of-the-crop.tar.gz`, a release asset under a fixed tag (`pack-v1`):

```
cream-of-the-crop/
  README.md, LICENSE.md      projectM's, as they are
  <Style>/…/*.milk           the presets, in projectM's folders
  index.json                 engine::index::Index
  thumbnails/<hash>.webp     one per distinct preset, named by its content hash
```

The app unpacks it into `<presets folder>/cream-of-the-crop/`, where `crate::catalog` looks
for each pack's `index.json` and `thumbnails/`.

## How the app downloads it

- **Where from.** `BUNDLE` in `pack.rs`:
  `https://github.com/openflowfm/visuals/releases/download/pack-v1/cream-of-the-crop.tar.gz`.
  When that can't be reached (no answer, or an error from the server), the app downloads
  projectM's bare pack at the same commit instead (`PROJECTM`): the same presets, without the
  index or thumbnails. A download that breaks off part-way isn't taken up from the fallback;
  trying again carries on from the bundle, keeping what's already in place.
- **What it keeps.** Only `.milk` and `.md` files, the top-level `index.json` and the `.webp`
  files directly in `thumbnails/`; nothing outside the pack's folder, and no `._*` files
  (macOS's tar metadata). A preset or thumbnail already there is kept (the user may have
  edited the preset). The index is always replaced, and only once the whole archive has
  arrived, so the library regroups once, with every thumbnail in place.
- **The size shown.** `BUNDLE.size` until the server answers, then the server's own
  `Content-Length`.

## Building it

Build it on a Mac; that's the supported path. GitHub's runner is too slow to draw the pack
(see "On GitHub" below).

### On a Mac

From the repo root, on an Apple Silicon Mac. `PACK` is the folder it's built in (anywhere
outside the repo). `caffeinate -i` keeps the Mac awake and `timeout` (GNU `timeout`, from
Homebrew's coreutils) ends a run after a fixed time. On an M1 Max with 8 jobs the whole pack
takes about 20 minutes of drawing with a warm Metal shader cache, 40 cold.

```sh
PACK=../pack-build
mkdir -p "$PACK/cream-of-the-crop" "$PACK/bin"
curl -fsSL https://github.com/projectM-visualizer/presets-cream-of-the-crop/archive/0180df21f5e0bd39b9060cc5de420ed2f1f9e509.tar.gz \
  | tar -xz -C "$PACK/cream-of-the-crop" --strip-components 1
cargo build --release -p visuals-engine --bin index
cp target/release/index "$PACK/bin/index"
```

The index is incremental by content hash and saves itself every few seconds, so it can be
drawn in short runs, each picking up where the last one stopped. Run this until a run ends
by itself (exit 0, "0 to draw" on its first line) rather than being cut off (exit 124):

```sh
caffeinate -i timeout 110 "$PACK/bin/index" "$PACK/cream-of-the-crop" --out "$PACK/cream-of-the-crop" --jobs 8
```

Each run draws about 600 to 1,100 presets (17 or so runs for the pack). If two runs in a
row end at the same count, something is stuck: stop and look. One long run (`timeout 3600`
in place of `timeout 110`) does the same in one go. The copy in `$PACK/bin` keeps a rebuild
of `target/` from changing the program between runs.

Then draw again the presets the runs skipped (mostly cold shader compiles that timed out
under load; the few left are equations the EEL compiler refuses), the same way until a run
ends by itself, and pack it up:

```sh
caffeinate -i timeout 110 "$PACK/bin/index" "$PACK/cream-of-the-crop" --out "$PACK/cream-of-the-crop" --jobs 8 --retry
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf "$PACK/cream-of-the-crop.tar.gz" -C "$PACK" cream-of-the-crop
stat -f %z "$PACK/cream-of-the-crop.tar.gz"
shasum -a 256 "$PACK/cream-of-the-crop.tar.gz"
```

The index bin ends with exit status 1, keeping what it drew, if its child processes can't
start (no GPU); run it again to go on.

Before uploading, try the bundle in the app's download from a local server. The test
downloads it the way the app does and checks all 9,795 presets arrive with the index and
its thumbnails:

```sh
python3 -m http.server --bind 127.0.0.1 --directory "$PACK" 8765 & server=$!
VISUALS_PACK_URL=http://127.0.0.1:8765/cream-of-the-crop.tar.gz cargo test -p visuals-app the_real_pack -- --ignored
kill $server
```

To look at it in the app as well, add `VISUALS_PACK_INTO=<the app's presets folder>` to
the test: it leaves the pack there instead of removing it. Or let the app download it: in a
debug build (`npm run app`), `VISUALS_PACK_URL=<url>` takes the place of `BUNDLE` (still
falling back to projectM's pack); a release build ignores it. `VISUALS_PACK_DOWNLOAD=1` starts
the download as the app starts, so a headless run with a capture shows the library with its
thumbnails without anyone pressing the button. Point the app at an empty home so it doesn't
touch your own presets (the capture lands after the welcome, which `first_run.json` skips):

```sh
TRY=$PWD/../pack-try; mkdir -p "$TRY/visuals" && echo '{"done":true}' > "$TRY/visuals/first_run.json"
OPENFLOW_HOME=$TRY OPENFLOW_VISUALS_PRESETS=$TRY/visuals/presets OPENFLOW_VISUALS_PLAYLISTS=$TRY/visuals/playlists.json \
  OPENFLOW_VISUALS_LIBRARY=$TRY/visuals/library.json VISUALS_PACK_URL=http://127.0.0.1:8765/cream-of-the-crop.tar.gz \
  VISUALS_PACK_DOWNLOAD=1 VISUALS_HEADLESS=1 VISUALS_CAPTURE=$TRY/library.png VISUALS_CAPTURE_AFTER=40 npm run app
```

### Publishing

The tag must not be marked latest: the app's updater reads
`releases/latest/download/latest.json`.

```sh
gh release create pack-v1 --repo openflowfm/visuals --target main --latest=false \
  --title "Preset pack (pack-v1)" \
  --notes "The full preset library the app downloads: projectM's cream-of-the-crop with its index and thumbnails. See docs/pack.md."
gh release upload pack-v1 "$PACK/cream-of-the-crop.tar.gz" --repo openflowfm/visuals --clobber
```

Then set `BUNDLE.size` in `pack.rs` to the uploaded file's size (`stat -f %z`) and check
the real download: `cargo test -p visuals-app the_real_pack -- --ignored`.

### On GitHub (slow, optional)

`.github/workflows/pack.yml`, run by hand only: Actions → pack → Run workflow. It does the
same on a macOS runner and keeps the bundle as a build artifact for a week; "publish"
uploads it to the `pack-v1` release (creating it if needed, never marked latest), and
"sample" indexes only that many presets, to check the runner draws (a sample run is never
published). It is too slow for the whole pack: a full run spent over an hour drawing the
presets without finishing (run 37882595758, cancelled).

## A new bundle

A new index analysis (`index::ANALYSIS`), a newer projectM commit or new thumbnails make a
new bundle. Put it under a new tag (`pack-v2`), so apps already out keep downloading the one
they know, and update `BUNDLE` (its URL and size) in `pack.rs` and `TAG` in `pack.yml`; a
new projectM commit also changes `PROJECTM` in both, and `TOTAL` in `pack.rs` if the count
changes. An app that already has the pack doesn't download it again.
