# Starter presets

The presets the app ships with, so it plays something before the full pack is
downloaded: 250 from projectM's "Cream of the Crop", 25 from each of its ten styles
(not `! Transition`), picked for a spread of speed and intensity, each one drawing
with `gpucheck`. `CREDITS.md` says who made them and on what terms.

- `cream-of-the-crop/` mirrors the pack's own layout (`<style>/<kind>/<name>.milk`)
  with its README and LICENSE, so a starter preset and the same preset downloaded
  have the same folder-relative path: playlists keep working once the pack is in,
  and the starter set drops out of the library then (`src/pack.rs`).
- `playlists.json`: three playlists ("Chill", "Warm up", "Peak time") made from the
  starter set on a fresh install (`pack::seed_playlists`).

The app bundles this folder (`tauri.conf.json`, `bundle.resources`) and lists its
`.milk` files next to the presets folder's (`src/pack.rs`).
