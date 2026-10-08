# Blocks: MilkDrop presets without code

Recorded October 8, 2026.

**Goal:** someone with no coding knowledge can make a new MilkDrop preset. The editor is
a graph, and every primitive inside a preset becomes a block a high schooler can follow.

**First slice: explain.** Today's graph is MilkDrop's fixed pipeline (`app/src/stages.ts`):
the nodes are always the same and all the action is in the code inside them. Slice 1 reads
a preset's code back into blocks that say what it does, read-only, with live values.

A worked example of one real preset, in three layout options, is the mock at
<https://claude.ai/artifact/C4Cj6H2Ap2HajVJu1y3CVh> (ShadowHarlequin – Dreaming Of
Fluorescent Things: about 120 lines read back as 14 blocks).

## Rules for turning a preset into blocks

- **Name blocks by what you see.** Spin, Ripple, Fade, Zoom, Drift, Echo, Glow,
  Brightness, Wanderer, Lens. The MilkDrop word (`rot`, `warp`, `decay`) stays in the
  code view.
- **Ingredients feed blocks.** Sound (bass, mids, treble, each optionally smoothed), time
  (the clock, the beat, dice rolled once), and place on the screen (distance and angle from
  the centre, x and y).
- **How an ingredient is used is a few words at the wire's end** ("swings every 6 s",
  "more petals"), not a block of its own. Wobble (`a*sin(time*b)+c`), flicker
  (`sin(audio*large)`), rainbow cycle (three sines a third of a turn apart), count-up
  (`v = v + x`) and only-when (`if(above(…))`) are recognised from the maths.
- **The loop is the backbone.** Every frame: move last frame's picture, fade it, draw on
  top, keep it for the next frame. The Look (comp shader) goes to the screen and is never
  fed back.
- **Nothing is hidden.** Every line of the file belongs to exactly one block. Maths that
  isn't recognised becomes a Maths block showing the formula, still wired to its
  ingredients. The code is always one click away.
- **Say when code does nothing.** Overwritten assignments, `decay` under a custom warp
  shader, per-pixel lines that can only work per frame, steps that cancel: shown dashed,
  with the reason.
- **q1–q32 are plumbing.** They become wires from ingredients into shaders.
- **Per-pixel equations are "where" pictures.** A block set per pixel (zoom stronger at the
  edges) shows the field evaluated over the mesh, as arrows or a heat map.

## Measured on the pack (9,795 presets)

| Where the code is | Presets |
| --- | --- |
| per-frame equations | 9,659 (99%) |
| warp shader | 7,910 (81%) |
| comp shader | 7,956 (81%) |
| per-pixel equations | 6,042 (62%) |
| a shader reads q1–q32 | 4,637 (47%) |
| a shader uses blur (Glow) | 7,161 (73%) |
| a shader uses noise textures (Grain) | 5,016 (51%) |
| converted MilkDrop 1 shader ("sample previous frame") | 2,651 (27%) |

Most-set per frame: `zoom` 4,964, `decay` 3,889, `warp` 3,795, `rot` 2,454, `dx` 2,109,
`dy` 1,925, wave colours ~3,180. Per pixel: `zoom` 4,641, `dy` 4,429, `dx` 4,359, `rot`
3,416. Median sizes: 28 per-frame lines, 24 warp, 25 comp.

## Decisions

- **The recogniser lives in the engine** (Rust, on `eel::Expr`), not the page. The same
  model has to write code back in slices 2 and 3, and a bin can measure it over the pack.
- **Coverage is the measure.** A `blocks` bin reports, over the pack, the share of
  assignments that land in a named block versus Maths, and the most common unrecognised
  shapes, so the vocabulary grows by measurement.
- **Shaders are recognised by pattern in slice 1** (fade, echo, brightness, glow, grain,
  mirror, rainbow, the MilkDrop 1 boilerplate), with q wires in. Reading arbitrary shader
  maths into blocks is later work.
- **Live values come from the running preset**, polled like the stage previews, so wires
  pulse with real energy (the pulse direction in `../flow-outlet/intent.md`).
- **Layout is still open.** The mock shows A, the loop (recommended), B, columns, and C,
  sentences.

## Slices

1. **Explain.** Engine: preset → blocks, plus the coverage bin. App: the block graph with
   live values and the code view. Read-only.
2. **Tune.** Recognised blocks get knobs that rewrite just their numbers in the file.
3. **Build.** Start from an empty loop, add blocks, wire ingredients; the editor writes the
   code.
