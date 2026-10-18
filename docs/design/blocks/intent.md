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

## No code, nothing lost, the same picture

Code is never shown, and nothing typed is code. An imported `.milk` reads into the graph
losslessly and plays exactly as MilkDrop draws it (superseded in part on October 9: our
own format, not the `.milk`, is the truth; see "Our own format; MilkDrop is an import").

| In the file | In the graph |
| --- | --- |
| a built-in variable a line sets (`zoom`, `rot`) | an inlet on its block (Zoom, Spin) |
| a variable the author named (`ray`) | a named wire |
| a built-in it reads (`rad`, `bass`, `time`) | an ingredient |
| a number | a knob you drag; any knob can take a wire (an inlet) |
| an expression | a formula drawn as maths, with variables as wire ends; open it and it is maths blocks (×, +, sin, bigger of…) |
| a recognised shape (wobble, rainbow cycle) | one block with knobs, folding the exact maths blocks it stands for |
| `if`, `?:`, `above` | a Choose block |
| `x = x + …` across frames | a Remember block: last frame's value comes back in |
| per-frame, per-pixel, per-point | how often a wire changes, shown on the wire; a per-pixel wire can't feed a per-frame inlet |
| `rand`, `megabuf` writes, `loop` | blocks that keep their order, because the result depends on it |

**Same picture, checked.** Folding a pattern into a block never rewrites the maths: the
block keeps the exact expression tree it was read from, numbers keep their original text,
and an unedited preset saves byte for byte. A `roundtrip` bin reads every preset in the
pack into the graph, writes it back, and requires the same compiled programs (and, for
shaders, the same pixels from a fixed run).

**Where it gets hard**, measured over the pack:

- EEL is small (operators, 33 functions, `if`, `loop`, `while`, memory), so all of it maps
  to blocks. `loop` is in 217 presets (2%), `megabuf`/`gmegabuf` in 435 (4%), `reg00`–`reg99`
  in 193, `exec2`/`exec3` in 80.
- HLSL is a real language. `if` is in 2,591 presets, `while` in 625, `for` in 310, its own
  functions in 403, `#define` in 213. Straight-line shader maths becomes blocks the same
  way, with pictures (texture reads) as their own kind of wire. Loops and functions become
  containers that open into their own graph. Until a construct has blocks, its part of the
  shader shows as one sealed block that still runs exactly and keeps its wires: honest
  about what it can't open yet, never wrong.

## The graph: typed wires and one feedback connection

Agreed October 9, 2026, from the mock at <https://claude.ai/artifact/EpPrAGEwFUmPsSup168qm9>
(Kick Bloom, a preset made from blocks in six moves, and three pack presets).

The preset is a left-to-right node graph, not a stack of stages. Movement blocks (Zoom,
Spin, Ripple…) output movement into **Move the picture**; drawing blocks plug into
**Paint on top**, whose numbered inlets are the paint order; Look blocks chain picture to
picture into the screen. **Feedback** is the one connection that goes backwards: Paint's
picture into Move's "last frame" inlet. Code that does nothing is a dashed block with no
wire out.

### Primitives

Three kinds of value, each at one of four speeds:

| | once | every frame | every point of a drawing | every spot of the screen |
| --- | --- | --- | --- | --- |
| **number** | Dice | Bass, Clock, an LFO | Sound | Distance from centre |
| **colour** | a picked colour | Rainbow cycle | a line changing colour along it | = a **picture** |
| **point** | a shape's position | a drifting shape | the points of a line | = **movement** |

A picture is a colour at every spot, and movement is a point at every spot (where that
spot reads the picture from), so the same nodes work at every speed. Three more things
have wires of their own: **sound** (the wave or spectrum, read by drawings), **drawing**
(painted on top, in order) and **trigger** (a kick, a beat, a bar). Feedback is not a
type: it is a picture, one frame late. In an imported `.milk` the speeds are MilkDrop's sections
(init, per-frame, per-point, per-pixel and the shaders).

### Every knob is an inlet

- A knob holds its own value until something is wired in; then it reads held value +
  amount × wire, several wires add up, and unplugging brings the held value back. This is
  the old build's rule (`node.values` and `node.depths` at `3bcc202`), kept.
- Modes (circle, blob, explosive) are knobs too, so a wire can step through them.
- Wires go to the same speed or faster, never slower; the only way back is Measure,
  inside a Look.
- Conversions are visible nodes: Place, Split, Colour from numbers, Measure.
- Modulators (LFO, Wobble, Drift, Count up, Flicker, Rainbow cycle…) are sources whose own
  knobs are inlets, so Treble can drive how far a Wobble swings.

### Our own format; MilkDrop is an import

Decided October 9, 2026 (Ryan): our format is a graph and it is the source of truth. A
`.milk` imports into it and plays back exactly as MilkDrop draws it; from there it can go
further than MilkDrop allows. An imported preset keeps its `.milk` untouched until the
first change, which saves it in our format with the `.milk` it came from noted. A preset
that only uses what MilkDrop has can also be exported back to a `.milk`; nodes beyond
MilkDrop (Link, Live, video, 3D models, blending presets) carry a badge saying they can't
be. The "same picture as a native player" guarantee is for imports, not a limit on our own
presets.

The four showcase cases in the mock: an imported preset (Geiss, Flower Blossom), the same
preset expanded (palette, an LFO on Link, kaleidoscope, glow on the Drums track), MilkDrop
from scratch (Kick Bloom, exportable), and expanded from scratch (Night Engine: a 3D model,
a downbeat envelope, a step sequence, a palette that changes with the song section).

**Colours are sources.** A Palette is a node whose colours are outlets, wired into
anything with a colour knob (a line, what the trails fade toward, a glow, a model's light),
not a filter over the finished picture. Fade has colour knobs of its own: what the picture
fades toward and the tint it takes as it fades.

The editor brings back the old build's 36 node kinds (LFOs, colourways, lenses, patterns,
fractals, light, grade, spread, halftone, blend, image, video, 3D models, the Ableton
nodes), sorted into these primitives.

### After the design, UX and musician reviews

Recorded October 9, 2026; applied in the mock.

- **The picture is always in view:** a preview pinned beside the graph; the graph scrolls
  rather than shrinking text below 85%.
- **Quiet at rest:** wires from sources rest as short stubs at the input and show whole
  on hover; wires don't pulse. Values move in the knobs (a live bar) and source ports.
- **Colour on a wire means what it carries;** where it comes from is a tinted label. Six
  port shapes (circle, colour wheel, triangle, bar, diamond, square), five line styles
  (thin, thick, ticks, wavy, beads, hollow pipe for pictures and drawings).
- **Nodes:** an icon, the title and one badge in the header, the output port on the header,
  a small moving picture on Move, Draw and Look nodes, untouched defaults folded into
  "+N". Code that does nothing is hatched, with the reason.
- **Trails is part of the loop** (Move the picture → Trails → Paint on top), always there,
  off until turned up; the feedback connection is labelled "feedback · trails".
- **Music:** hits (Kick, Snare, Hats) found in the sound are the default way to use it;
  loudness levels stay for imports. With Link or a tempo set by hand, times are note
  values. Wobble, Drift and LFO are one node, **Sway**. New: Pump, Phrase, Build/Drop,
  Only when, Macros with MIDI learn and snapshots, swing, an output delay.
- **Link carries only tempo, beat and start/stop.** Track levels, section, key and clip or
  scene launches need a visual[flow] device in the Live set; sources say which they come
  from. A section is a trigger (and a name), not a number.

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
- **Layout A, the loop.** Ryan chose it on October 8, 2026.
- **Three depths of one graph:** the block (plain words, a picture), formulas (maths
  notation, variables as wires, numbers as knobs), and maths blocks. The saved text is never
  part of the editor.

## Slices

1. **Explain.** Engine: preset → blocks, plus the coverage bin. App: the block graph with
   live values and the code view. Read-only.
2. **Tune.** Recognised blocks get knobs that rewrite just their numbers in the file.
3. **Build.** Start from an empty loop, add blocks, wire ingredients; the editor writes the
   code.
