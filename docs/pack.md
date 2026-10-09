# The preset pack bundle

The app ships with a starter set of 250 presets and downloads the full library on request
(`app/src-tauri/src/pack.rs`). The download is our own bundle: projectM's
[cream-of-the-crop](https://github.com/projectM-visualizer/presets-cream-of-the-crop)
(9,795 presets) at a pinned commit, with the `index.json` and `thumbnails/` the `index` bin
draws for it (see "The preset index" in `docs/milkdrop-engine.md`). The library arrives
grouped, with its pictures, colours and levels, and nothing is drawn on the user's Mac.

## What's in it

The bundle lives in its own repo, [openflowfm/visual-presets](https://github.com/openflowfm/visual-presets),
as projectM keeps its packs: one repo per pack, downloaded as GitHub's archive of a pinned
commit, with no releases. Its `main` holds, at the top:

```
README.md                  what it is, credits, takedown requests
LICENSE.md                 projectM's, as it is
<Style>/…/*.milk           the presets, in projectM's folders
index.json                 engine::index::Index
thumbnails/<hash>.webp     one per distinct preset, named by its content hash
```

GitHub's archive puts all of it under one top folder, `visual-presets-<commit>/`. The app
leaves that folder out and unpacks the rest into `<presets folder>/cream-of-the-crop/`,
where `crate::catalog` looks for each pack's `index.json` and `thumbnails/`.

## How the app downloads it

- **Where from.** `BUNDLE` in `pack.rs`:
  `https://github.com/openflowfm/visual-presets/archive/<commit>.tar.gz`, pinned to one
  commit, so a later push to visual-presets changes nothing for apps already out.
  When that can't be reached (no answer, or an error from the server), the app downloads
  projectM's bare pack at its pinned commit instead (`PROJECTM`): the same presets, without
  the index or thumbnails. A download that breaks off part-way isn't taken up from the
  fallback; trying again carries on from the bundle, keeping what's already in place.
- **What it keeps.** Only `.milk` and `.md` files, the top-level `index.json` and the `.webp`
  files directly in `thumbnails/`; nothing outside the pack's folder, and no `._*` files
  (macOS's tar metadata). A preset or thumbnail already there is kept (the user may have
  edited the preset). The index is always replaced, and only once the whole archive has
  arrived, so the library regroups once, with every thumbnail in place.
- **The size shown.** The server's `Content-Length` when it sends one; GitHub makes large
  archives as it sends them, without one, so the bar runs on `BUNDLE.size`, the archive's
  size when it was pinned (53,005,539 bytes for `fd71ac2`). It's only for the progress
  bar: nothing checks the download against it, and the bar stops at full if the archive
  comes out a little larger.

## Building it

Build it on a Mac, on Apple Silicon: the `index` bin draws every preset on the GPU.
(GitHub's macOS runner was too slow: a full run spent over an hour drawing the presets
without finishing, run 37882595758.)

### The index and thumbnails

From the repo root. `PACK` is the folder it's built in (anywhere outside the repo).
`caffeinate -i` keeps the Mac awake and `timeout` (GNU `timeout`, from Homebrew's
coreutils) ends a run after a fixed time. On an M1 Max with 8 jobs the whole pack takes
about 20 minutes of drawing with a warm Metal shader cache, 40 cold.

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
ends by itself:

```sh
caffeinate -i timeout 110 "$PACK/bin/index" "$PACK/cream-of-the-crop" --out "$PACK/cream-of-the-crop" --jobs 8 --retry
```

The index bin ends with exit status 1, keeping what it drew, if its child processes can't
start (no GPU); run it again to go on.

### Trying it before it's pushed

The test downloads a bundle the way the app does and checks all 9,795 presets arrive with
the index and its thumbnails. To try a local build, pack it and serve it:

```sh
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf "$PACK/try.tar.gz" -C "$PACK" cream-of-the-crop
python3 -m http.server --bind 127.0.0.1 --directory "$PACK" 8765 & server=$!
VISUALS_PACK_URL=http://127.0.0.1:8765/try.tar.gz cargo test -p visuals-app the_real_pack -- --ignored
kill $server; rm "$PACK/try.tar.gz"
```

To look at it in the app as well, add `VISUALS_PACK_INTO=<the app's presets folder>` to
the test: it leaves the pack there instead of removing it. Or let the app download it: in a
debug build (`npm run app`), `VISUALS_PACK_URL=<url>` takes the place of `BUNDLE` (still
falling back to projectM's pack); a release build ignores it. `VISUALS_PACK_DOWNLOAD=1` starts
the download as the app starts, so a headless run with a capture shows the library with its
thumbnails without anyone pressing the button. Point the app at an empty home so it doesn't
touch your own presets (the capture lands after the welcome, which `first_run.json` skips);
leave out `VISUALS_PACK_URL` to download the pinned `BUNDLE` itself:

```sh
TRY=$PWD/../pack-try; mkdir -p "$TRY/visuals" && echo '{"done":true}' > "$TRY/visuals/first_run.json"
OPENFLOW_HOME=$TRY OPENFLOW_VISUALS_PRESETS=$TRY/visuals/presets OPENFLOW_VISUALS_PLAYLISTS=$TRY/visuals/playlists.json \
  OPENFLOW_VISUALS_LIBRARY=$TRY/visuals/library.json VISUALS_PACK_URL=http://127.0.0.1:8765/try.tar.gz \
  VISUALS_PACK_DOWNLOAD=1 VISUALS_HEADLESS=1 VISUALS_CAPTURE=$TRY/library.png VISUALS_CAPTURE_AFTER=40 npm run app
rm -rf "$TRY"
```

### Publishing

Copy the build into a clone of visual-presets (`--delete` drops presets projectM removed
and thumbnails no longer in the index; it leaves the repo's own `README.md` and `.git`
alone, since projectM's README isn't copied), then commit and push:

```sh
git clone https://github.com/openflowfm/visual-presets.git ../visual-presets
rsync -a --delete --exclude .git --exclude README.md "$PACK/cream-of-the-crop/" ../visual-presets/
cd ../visual-presets && git add -A && git commit -m "…" && git push
```

A first push of the whole pack (about 250 MB of files, 67 MB packed) went up in a few
seconds as three commits: six style folders, the other five, then the index and
thumbnails.

Then pin the new commit in `pack.rs`: put its SHA in `BUNDLE.url` and the archive's size in
`BUNDLE.size`:

```sh
curl -fsSL https://github.com/openflowfm/visual-presets/archive/<commit>.tar.gz | wc -c
```

and check the real download, which also checks `BUNDLE.size` is within 5% of it:
`cargo test -p visuals-app the_real_pack -- --ignored`.

## A new bundle

A new index analysis (`index::ANALYSIS`), a newer projectM commit or new thumbnails make a
new bundle: a new commit in visual-presets, pinned in `BUNDLE` as above. Apps already out
keep downloading the commit they know, which stays in the repo's history. A new projectM
commit also changes `PROJECTM` in `pack.rs` (its URL and size) and the curl above, and
`TOTAL` in `pack.rs` if the count changes. An app that already has the pack doesn't
download it again.

Takedown requests come in as issues on visual-presets
(<https://github.com/openflowfm/visual-presets/issues/new?title=Preset%20takedown>, the
link in CREDITS.md and the Credits view): remove the preset there, with its row in
`index.json` and its thumbnail, push, and pin the new commit. The removal applies from
that commit on, so to new app builds and fresh downloads; a pack already downloaded keeps it.
