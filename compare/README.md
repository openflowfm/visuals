# The compare bench

Development only: nothing in `app/` or `engine/` depends on it. It draws presets with
Butterchurn 2.6.7 (the reference: what the BlackHole visualizer runs) and with our engine
from the same inputs, and says, section by section, where ours differs by more than
Butterchurn differs from itself. Its readers are agents; a person can open the same
report as a page.

```sh
cd compare
npm ci && npx playwright install chromium     # once
npm run compare -- <presets or folders> [--sample N] [--frames 240] [--captures 8] \
                   [--size 640x360] [--refresh 60] [--seed 1] [--min-score N]
npm run compare -- --serve                     # the last report as a page, with approve / reject / note
npm run calibrate [-- --seed N --count N --rerender]
npm test && npm run typecheck                  # the bench's own tests and types
```

Presets are paths in the pack (`~/.openflow/visuals/presets`, `OPENFLOW_VISUALS_PRESETS`
moves it), or files and folders; with none, a fixed sample of 30 across the pack. The run
builds the engine's half (`cargo build --release -p visuals-compare`, the crate in
`src/`), draws Butterchurn in headless Chromium while ours draws, and writes `out/`
(gitignored):

- **stdout**: one line per preset — status, score, the drift floor, the worst capture and
  its composite, why it may drift (`rand`, `rand_frame`, `rand_start`, `rand_preset`,
  `strong-feedback`), the id, a plain-language line, and any fallback, failure or note —
  then a summary.
- **`out/report.json`**: per preset and per capture, every number: the score, the
  similarity of ours and of the floor, each section's distance per feature, the whole
  frame of each side (colour, brightness, hue, edges, motion since the previous capture),
  the preset's random sources and feedback, and why a shader fell back.
- **`out/frames/<preset>/f<frame>.png`**: one composite per capture. Top: Butterchurn |
  ours | ours beyond the drift floor. Bottom: Butterchurn re-seeded (what normal drift
  looks like) | the floor's section grid | ours' section grid on the same scale. Grids
  are 8×4 sections, black (same) through red and yellow to white (far apart).
- **Exit code**: 0 when every preset ran; 1 when ours failed to load or draw one, or one
  scored under `--min-score`; 2 on a usage error. A preset Butterchurn can't draw is
  reported (`ref?`) but doesn't fail the run; neither does a fallback to MilkDrop's
  default shader, nor a preset that's not comparable.

## Reading the score

Pixel differences mislead here: MilkDrop presets drift apart by nature. After the init
equations Butterchurn draws `rand_frame`, shapes', waves' and every frame's `rand()` from
one global stream where the engine has a stream each, and a preset that feeds back
strongly turns float-level differences between WebGL and wgpu into different pictures
within seconds. So the bench:

1. **Controls what it can.** Same audio bytes (a synthetic track, as the three byte
   windows Butterchurn reads), same clock (Butterchurn one frame per 1/30 s step; ours at
   `--refresh`, captured at the refreshes that land on Butterchurn's frames), and
   Butterchurn's `Math.random` replaced by the engine's xorshift64*, seeded with the
   engine's noise seed and re-seeded with the preset seed as the preset loads, so the
   noise textures, `rand_start`, `rand_preset` and the init `rand()`s start from the same
   numbers.
2. **Measures the drift floor.** Butterchurn draws each preset twice more, once with
   another rand seed and once with another seed and the track's noise seeded differently.
   Per section, the floor is the furthest of those re-runs from Butterchurn.
3. **Compares coarse sections, never pixels.** Each picture becomes a 32×16 grid of cells,
   an 8×4 grid of sections and one whole-frame summary. Per section: mean colour and
   brightness, hue (weighted by how coloured it is), edge/texture energy at 128×64, and
   how much it changed since the previous capture. The score per capture is how far ours'
   sections are beyond the floor (80%) and the whole frame's (20%): 100 when ours is no
   further from Butterchurn than Butterchurn is from itself.
4. **Weights early captures.** Captures are spaced geometrically (1, 2, 5, 10, 23, 50, 110,
   240 by default), and weighted 1 / (1 + log2 frame): the first seconds, before streams
   part, say the most.
5. **Says when it can't tell.** A preset whose floor is under 80% similar is `n/c`, not
   comparable (random or chaotic), with no score claim and exempt from `--min-score`.

So read the score as "how far beyond normal drift". On the calibration below, every
Butterchurn-against-itself pair scored 95 or more. Ours against Butterchurn scored 76–96
on presets Ryan approved; WebGL and wgpu differ a little everywhere. A score under about
75, or a capture under 70, is worth opening; the line says which feature and where, and
the composite shows whether it's a real difference or drift the floor didn't catch.

## Calibration

`npm run calibrate` checks that the score separates "the same picture" from "a different
one", without hand labels. `calibration.json` holds only its settings: how many presets
(`count`, 20), the seed that picks them (`seed`), the size, frames, captures, and which
perturbations to use. From the sampled presets, all drawn by Butterchurn:

- **similar**: another rand seed (`reseed`); the track's noise seeded differently (`hiss`);
- **different**: another sampled preset (`otherPreset`); the clock shifted by 1.5 s
  (`shiftedClock`); another song (`swappedAudio`); another preset's per-frame and
  per-pixel equations (`otherEquations`).

A different pair whose perturbation changed nothing (the preset ignores that input), or
moved the pixels no more than re-seeding does (checked at the pixel level, independent of
the metric), isn't evidence either way and is listed apart; so are pairs on presets the
bench calls not comparable. It prints every pair's score, the mean per kind, the lowest
similar and highest different score and how many pairs overlap, and exits 1 when any
similar pair scores at or below any different one. With `approvals` set it also scores
ours against Butterchurn for the verdicts in `~/.openflow/visuals/compare/approvals.json`
(an extra check, outside the exit code: those were given against an older engine).
Renders are cached in `out/calibrate/renders`, so a metric change re-scores in seconds;
`--rerender` starts over.

With the defaults (20 presets, seed 1): before tuning (one re-run as the floor, 0.25 as
the scale, 70 as the comparable floor) 272 of 3,200 pairs overlapped, the lowest similar
pair scoring 58.9 and the highest different one 100. After (two re-runs, the furthest as
the floor; 0.15; 80; the label checks above) none of 2,124 overlap: similar 95.3 and up,
different 94.1 and down. The margin is thin, so treat the score as a pointer to the
composites, not a verdict.

## What can't match Butterchurn

None of these is an engine bug when a preset looks different:

- **`rand_frame` and later `rand()`.** Butterchurn draws everything from one global stream
  — the blend pattern, `rand_frame` each pass, shapes', waves' and every frame's `rand()` —
  where the engine has a stream per preset, per shape, per wave and one for `rand_frame`.
  They agree up to the init equations and part after that.
- **`rand(n)` itself.** Butterchurn returns `Math.random() * floor(n)`, not floored; the
  engine floors. Presets that use it differ until the engine copies the quirk.
- **Shaders Butterchurn cannot link.** It draws black where MilkDrop draws its default;
  the bench compares against the default instead and says so, and Ryan judges which is right.
- **Unknown textures.** Butterchurn samples its `clouds2` image for any sampler it has no
  picture for.
- **Chaotic feedback.** A preset that feeds back strongly turns float-level differences
  between WebGL and wgpu into different pictures within seconds; its first seconds are
  the ones to judge.

## Files

- `harness/compare.ts`: the bench; `harness/calibrate.ts`: its calibration.
- `harness/bench.ts`: the shared inputs, Butterchurn in Chromium, the engine's bin, the
  composites, and the cleanup: the engine's bin, Chromium and the page server all stop on
  every exit path (the bin also ends when the bench's end closes its stdin).
- `harness/grid.ts`: the section pyramid, the drift-relative score and the plain-language line.
- `harness/hlsl.ts`, `harness/convertWorker.ts`: `.milk` to Butterchurn's JSON, as the
  old app converted it (`milkdrop-preset-converter` 0.1.2 with its HLSL repaired), cached
  in the pack's `.converted` folder.
- `harness/report.ts`: report.json's shape and the page.
- `src/main.rs`: the engine's half; reads the plan the bench writes, draws each preset on
  a fresh renderer, writes the captures as RGBA.
