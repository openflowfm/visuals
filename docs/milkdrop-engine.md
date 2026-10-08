# The MilkDrop engine

A plan and its status. It replaced the old visual[flow] — a Node server and a WebGL2
renderer with its own colour-at-a-point engine, which drew MilkDrop through Butterchurn —
and that app is deleted (see "Where it lives").

## The north star

**The node library is MilkDrop complete.** Anything a `.milk` preset can say, a flow can
say. Then the Cream of the Crop pack is imported as flows, and each one draws what the
same preset draws in the BlackHole visualizer — on our engine, not Butterchurn's.

- **Identical is Ryan's call**, by ear and eye: a preset played here beside the same
  preset in the BlackHole visualizer.
- **The reference is Butterchurn 2.6.7**, because that is what the BlackHole visualizer
  is. Where Butterchurn is wrong — the shaders that fall back to its default — Ryan
  decides which one is right.
- **Export to `.milk` is out of scope.** Imports keep the original text so it stays
  possible.
- **The old engine and its flows are abandoned**, not migrated. Versions of them may be
  rebuilt on the new nodes later.
- **Audio is a node.** The MVP source is an audio interface or BlackHole. The Live bridge
  stays, as a node that provides sound and set facts; identical output needs the same
  samples, so a signal synthesised from meters can never be the reference.

## Where it is: the proof of concept

`engine/` is a Rust crate that reads `.milk` files and draws them on wgpu — Metal on a
Mac — with no Butterchurn and no browser in the path.

```sh
cd engine
cargo test --lib                                    # unit tests, including one GPU render
cargo run --release --bin play -- [folder|files] [--input BlackHole] [--channels 1,2] [--every 30]
cargo run --release --bin snapshot -- preset.milk 240 out.png 1280x720
cargo run --release --bin check                     # every preset: equations and shaders compile
cargo run --release --bin gpucheck                  # a 250-preset sample loads and draws on the GPU (--all: every one)
cargo run --release --bin explain -- preset.milk comp   # why one shader does not compile
```

`play` opens a window, listens to any input — BlackHole is one — and plays the library:
→/space next, ← previous, R random, F fullscreen.

### The editor app

```sh
npm run app          # cargo tauri dev in app/src-tauri; the page's vite on $PORT, or a free port
```

`app/` is the Tauri shell. The page (`app/src`, React and the widgets' `Graph`) is the
editor: the library on the left, the preset as MilkDrop's stage graph, and the selected
stage's EEL/HLSL and numbers on the right. Every edit reloads the preset on the bench
within a quarter second, and problems come back per stage and line — a broken equation
leaves the last good preset drawing, a broken shader draws MilkDrop's default.

**Stage pictures.** Each node shows its stage's picture, rendered by the engine
(`Renderer::set_previews(wanted, size)`, `read_previews`) and polled by the page about
fifteen times a second (`app/src/previews.ts`). The page asks only for the pictures whose
canvases are on screen in the graph pane (a layer's also needs the warp's, which it is
drawn over), and at a size from the device pixels they cover — CSS width × the nodes'
`--wdg-node-zoom` × the graph's zoom (read from its `viewRef` at each poll) × the display's
pixel ratio — in three 16:9 steps: 192×108 (`PREVIEW`, the base), 384×216 and 768×432
(`PREVIEW_MAX`, which the engine clamps to). With the graph at 1× or zoomed out it is
always the base, so the graph as it opens costs what it always did. A step is taken up
when the current one would be stretched more than 1.25×, and down only once the smaller
one covers the picture with 10% to spare, so a zoom between two steps never flips; a new
step is asked for once it has held for 250 ms, when zooming has settled; and more pictures
on screen than fit 6 MB at a step (four at 768×432) take the step below. A layer's 32:9
face shows the middle of the same 16:9 picture, so it has no size of its own. The engine
keeps targets for the pictures asked for only, made afresh when the size changes. The
`previews` command's bytes are a 12-byte header — width, height and a mask of the stages
in it (bit `i` for `PREVIEWS[i]`), little-endian u32s — then those pictures' RGBA rows in
`PREVIEWS` order (`bench::packed`), so a read taken before the page's last ask is still
read right. Measured on a 2× display (one preset, 1377×774 bench): at 1× the six pictures
on screen are 0.50 MB a poll (all fifteen were 1.24 MB) in a 2.1 ms round trip (1.6 ms
before); zoomed in to 3×, the two on screen are 2.65 MB at 768×432 in 2.3 ms (1.5 ms for
the blurry 1.24 MB before). At the budget a poll is at most 6 MB, about 90 MB a second.

**Playlists and live actions.** A playlist is a named, ordered list of presets, kept in
`~/.openflow/visuals/playlists.json` (`OPENFLOW_VISUALS_PLAYLISTS` overrides) with paths
relative to the library, so the library can move (`playlists.rs`). The page's
*playlists* tab beside the library creates, renames, deletes and edits them; `+` on a
library row adds to the selected one. Playing a playlist makes it active: ← → and random
step through it instead of the library, and auto-advance moves on every N seconds.

Everything that changes what plays live goes through one layer, `actions.rs`: an
`Action` enum — `next`, `previous`, `random`, `go {index}`, `load {playlist, index}`
(playlists by their position in the file), `unload`, `auto {on}` (null toggles),
`seconds {seconds}` — and `actions::dispatch(&AppHandle, Action)`, callable from any
thread. It moves the live state (the pure `decide`), opens the preset on the bench and
emits a `live` event (`{deck, opened, path, error}`) that the page follows, whoever sent
the action: the page (`act` command), the auto-advance thread, or a controller. A MIDI or
CC mapping only translates messages into actions and calls `dispatch`. Without an active
playlist, `next`/`previous` step through the whole library; the page's own ← → keep
stepping through its search results.

The bench is not drawn by the page. `app/src-tauri/src/bench.rs` puts a native `NSView`
under the webview's content, makes a wgpu surface on it and draws on its own thread,
paced by the display; the page leaves a transparent hole and reports its rectangle
(`place_bench`). The engine and the app share one Cargo workspace at the repository
root, so the engine's tests also run from there as `cargo test -p visuals-engine`.

**Live mode and the output.** The page's switch is *editor | live*. Live mode is the show: entering it
opens the output, leaving it closes it — there is no output while editing. In live mode
the editor isn't rendered (no graph, no inspector) and stage previews are off
(`set_previews` with none); the page shows a small preview of the bench, what's playing and
what's next in the playing playlist, previous / random / next (all through
`actions::act`, as a controller would), the playlists panel with play/stop and
auto-advance, the audio input, and the output's display picker and status. Keys: ← ↑
previous, → ↓ next, R random. Esc, ⌘⇧L or the switch leaves live mode (Esc not while
typing in a field). The output never becomes the key window, so Esc after a click on it
lands on the main window's page, or on no window, which a local `NSEvent` monitor
(`output::native::watch_escape`) turns into the page's `output-escape` event.

The output (`output.rs`) is a borderless native `NSWindow` with no webview, the size of
the chosen display (`NSScreen`), at the status window level so neither the menu bar nor
the Dock covers it. Its content is black with a layer-hosting view on a `CAMetalLayer`
placed at the preset's 16:9 fitted into the display (`output::place`), so the bars are the
window's own black, and its surface is that rectangle in the display's pixels. On a
portrait display (one rotated 90°) the view fills it, and while the output is open the
presets draw at the display's aspect (`bench::draw_size`: about `bench::DRAW`'s pixel
count, 932×2226 on a rotated 3440×1440 ultrawide; `Renderer::resize` carries the picture
over), so the picture fills the screen; the bench shows it pillarboxed
(`Renderer::present` fits the picture to each surface). The bench's
render thread presents every frame to both surfaces (`bench::Cmd::Output`): while the
output is open it presents with vsync and paces the loop, and the bench is reconfigured to
present without waiting (`AutoNoVsync`), so the picture is drawn at every refresh of the
output's display (see "The preset clock"). A bench hole of zero size hides the bench and it
isn't presented at all. The display is chosen in live mode and remembered in
`~/.openflow/visuals/output.json` (by id, then by name); with nothing chosen it is the first
display without the menu bar, else the main one. A display reconfiguration
(`CGDisplayRegisterReconfigurationCallback`) refits the output, or closes it cleanly when
its display has gone; the page shows "not showing" with a button to show it again.

Commands: `displays`, `output_open {id | null}`, `output_close`, `output_status`, and the
`output` event; `live_start` reads `VISUALS_LIVE`. Development: `VISUALS_LIVE=1` starts in
live mode (with `VISUALS_PRESET`, on that preset), `VISUALS_DISPLAY=<n>` sends the output
to display `n` (from 0, the system's order), and `VISUALS_CAPTURE_OUTPUT=<png>` saves the
output window beside `VISUALS_CAPTURE`'s main window.

**Link and the one.** `link.rs` is an Ableton Link peer (the `rusty_link` crate: the
official Link SDK through its C wrapper, built with cmake), the port of the old engine's
clock (`server/link.ts` and its docs `docs/clock.md` and `docs/wheel.md`, all deleted with
the old app) with its rules kept.
**Visuals follow; they never drive**: the session state is only captured, never committed,
so nothing can set the tempo, the beat or the transport. Link is on at startup
(`VISUALS_LINK=0` starts it off) with start/stop sync listening, quantum 4. Bars are counted
from **the one**, a Link beat the app holds (Link's beat has no bar 1): *set one* takes the
nearest bar line by Link's *phase* (the coming one past half a bar), *nudge* moves it a beat
either way, *reset* puts it back on Link's own lines (beat 0). A Link transport start takes
the one from the bar line the music starts on (at or after the start time, as `show.ts`
waits for the phase to drop); the first read never counts, because a peer joining a session
already playing is not told so, and `playing` reads false until the next start or stop.

Preset changes on the beat: every 1 or 2 beats or 1–32 bars from the one, through
`actions::dispatch(Next)` (the playing playlist's next, or the library's). The scheduler
turns the next boundary's beat into Link's host time (`time_at_beat`) and sleeps to it, so a
change lands on the line; a boundary missed (a long load, the machine asleep) is skipped,
never made late. With no peers Link runs its own timeline at the last tempo, and the changes
carry on at that; Link off only leaves the network. Turning changes on turns time-based
auto-advance off. Not yet: the next preset is loaded *at* the boundary, so a slow compile
shows late — preloading it a beat early is the follow-up.

Commands: `link_state`, `link_enable {on}`, `link_set_one`, `link_nudge {beats}`,
`link_reset_one`, `link_sync {every, unit: "bars" | "beats"}` (0 is off), each returning the
frame; the `link` event carries it ten times a second (tempo, peers, playing, beat, phase,
one, bar, beatInBar, barPhase, every, next, at). The page's panel is `app/src/LinkPanel.tsx`.
Development: `VISUALS_LINK_EVERY=<bars>` starts with changes on, `VISUALS_LINK_LOG=1` prints
the frame every second and each change's beat.

Not yet: one output only (no mirroring to several displays); the presets still draw at
about `bench::DRAW`'s 1920×1080 pixels and are scaled to the display, so a 4K projector
gets an upscaled picture, and a landscape display that isn't 16:9 (an ultrawide) gets
bars; on a single display the output covers the editor window, and only the keys (Esc,
⌘⇧L) get back out. The mouse cursor is hidden while it is over the output (a check
ten times a second on the main thread, as the output never becomes the key window; macOS
only hides it while the app is the active one).

**Live effects.** In live mode the page is a performance panel: big hits, a tempo, and
controls for the picture and time. Every effect is an `actions::Action` like `next`, sent
through `act` and `actions::dispatch`, so a MIDI mapping reaches them the same way; `on:
null` toggles, and momentary hits are `on: true` while held and `on: false` on release.
The state is `fx.rs` (`Fx`), shared with the render thread and sent to the page as the
`fx` event (`fx_state` to start). Values are clamped; nothing but the tempo is kept across
restarts (`~/.openflow/visuals/tempo.json`). Leaving live mode puts every picture and time
effect back to normal (`fx_reset`), keeping the tempo, sensitivity and settings.

| action | does | key |
|---|---|---|
| `speed {speed}` | a scale on the preset clock, ¼×–4× (a log slider, 1× at its centre): the preset makes 30 × speed steps a second, its motion, decay and `time` with them, while the picture is still drawn at every refresh | |
| `freeze {on}` | no frames are made, the picture holds; let go, it comes back up to speed over 0.4 s | F (hold), ⇧F latches |
| `transition {seconds}` | while the output is open, a new preset crossfades from a snapshot of the last one's picture over 0–10 s (2 by default; 0 cuts) | |
| `strobe {on}`, `strobe_rate {rate}`, `strobe_intensity {value}`, `strobe_style {style}` | flashes on the beat, 0.25–4 a beat: `white` over the picture, or `black` between flashes so the picture itself strobes | S (hold), ⇧S latches |
| `sync {source}` | what strobe and punch-on-beat follow: `tempo` or `audio` (beats heard in the bass: `bass` over 1.3 and 15% over `bass_att`, rising, at least 0.22 s apart) | |
| `blackout {on}`, `blackout_fade {seconds}` | to black and back, at once or over 0–10 s; a fade turned round mid-way goes back from where it is | B |
| `punch {on}`, `punch_on_beat {on}` | a kick: 12% zoom and 35% brighter, held while pressed and dying away over 0.15 s; on every beat too | P (hold) |
| `brightness {value}`, `hue {value}`, `invert {on}`, `mirror {mode}` | 0–2 ×; a hue turn 0–1; invert; `off`, `x`, `y`, `quad` (null steps through) | I, M |
| `trails {value}` | an echo on the finished picture: max(new, before × k), k 0.75–0.98 per 1/60 s of preset time (so the same at any refresh rate), kept in half floats | |
| `sensitivity {value}` | a gain of ¼×–4× (a log slider, 1× at its centre) on the samples the presets hear (waves and spectrum; `bass`/`mid`/`treb` are relative to their own average and settle back). At 1× a waveform is the size Butterchurn draws for the same input: samples become bytes as a browser's `AnalyserNode` makes them (`audio::to_byte`) | |
| `tap`, `bpm {bpm}` | the tempo: the mean gap of the last taps (a 2 s pause starts afresh), the beat on the last tap; or typed, 40–240 | T |
| `hold {on}` | locks the preset: next, previous, random, go, load and auto-advance do nothing (the page says so) | H |
| `bars {bars}` | auto-advance every N bars of four beats at the tempo instead of its seconds; 0 off | |
| `fx_reset` | everything above back to normal but the tempo, sensitivity, transition and strobe settings | 0 |

The engine draws them (`engine/src/fx.rs`): one **master pass** replaces the blit to the
window, so the bench and the output show the same thing. In order: mirror, punch zoom,
the outgoing snapshot by the transition's share, hue, invert, brightness and punch, flash
to white, then black. With nothing on it is a plain blit. Trails are a pass after comp,
only while on. Speed and freeze are the preset clock's (`bench.rs` passes the time since the
last refresh, evened out by `runtime::Pacer`, × the speed to `Renderer::render`); frozen, the clock stands still and the thread still
listens, so beats keep driving the strobe. Development: `VISUALS_FX='[{"kind":"mirror","mode":"quad"}, …]'` sends
those actions 5 s after start (`VISUALS_FX_AFTER`), for checking effects in a capture.

Not yet: auto-advance by bars is not aligned to the downbeat (it counts from the last
change); a transition started during another snapshots the incoming preset alone, not the
mix on screen; trails are an echo of the picture, not a change to the preset's own decay
(most presets' warp shaders never read `decay`).

| module | is |
|---|---|
| `preset` | the `.milk` reader, code kept as written |
| `shader` | MilkDrop HLSL → glslang → SPIR-V → naga, with the rewrites below |
| `eel` | the equation language: MilkDrop's grammar, Butterchurn's arithmetic |
| `runtime` | Butterchurn's equation runner — which variables carry, which reset — the clock and the warp mesh |
| `audio`, `noise` | Butterchurn's FFT and levels, and its noise textures, quirks included |
| `draw` | motion vectors, shapes, waves, the basic waveform, darken centre, borders |
| `render` | the frame: warp, blur pyramid, draw, comp, blit |

**On the whole Cream of the Crop pack (9,795 presets), 9,744 (99.48%) load and draw on
Metal with their own shaders** (`gpucheck`). Metal accepted every module naga validated.
The rest are punted for now: 45 draw with MilkDrop's default for one shader — vector-size
mismatches D3D9 truncated silently, user functions called with the wrong vector size,
functions missing a `return`, one naga bug in a helper — and 6 have equations too garbled
to parse (an undefined `_aboeq()`, `0 = …`, stray prose).

Not yet: MilkDrop's own blend patterns from one preset to the next (live mode crossfades,
see "Live effects"), mipmaps on the feedback and blur textures
(Butterchurn samples them mipmapped), the song-title text, and per-pass GPU timings.

## The preset clock

MilkDrop presets move by a fixed amount per *frame*: zoom, rotation, the warp mesh, decay
and the feedback itself compound once a frame, so the frame rate is a preset's speed.
Winamp's MilkDrop 2 caps it at **30** by default (`m_max_fps_fs`, `m_max_fps_dm`,
`m_max_fps_w` in `vis_milk2/pluginshell.cpp`), which is the pace the presets were written
and are remembered at. The engine used to pin presets to 60, so everything ran twice that,
and slowing it down meant making fewer frames and mixing the last two.

Now the preset's clock and the picture's are separate (`runtime::PRESET_RATE`,
`Renderer::render(audio, seconds)`):

- **A step is MilkDrop's frame.** The preset advances `speed × 30 × dt` steps a refresh,
  fractional. Each whole step runs the per-frame and per-vertex equations once (their
  state accumulates per step, as in MilkDrop), the clock ticks 1/30 s of preset time (the
  preset's `time`, `frame` and `fps`, which reads 30), the audio levels move on once, and
  the feedback is fed back once: warp, blur, motion vectors, shapes, waves, borders. That
  loop never sees the refresh rate, so **a second of a preset is the same picture, to the
  bit, at 30, 60, 120 or 144 Hz**, and speed is a plain scale on it
  (`render::tests::a_second_is_thirty_steps_at_any_refresh_rate`,
  `speed_scales_the_preset_clock`). Decay, trails' density and brightness, zoom and
  rotation per second are the step loop's, so none of them depends on the display.
- **The picture is drawn at every refresh.** A refresh between steps draws, and never
  feeds back, the last step's feedback carried `f` of the way into the next step (`show`):
  1. the last step's warp before its waves and shapes (kept as `bare` when a step draws
     anything), moved by the next step's warp mesh at fraction `f`;
  2. the preset's warp shader on the feedback, drawing and all, through the same mesh,
     mixed over (1) by `f` (a blend constant), so its colour work (decay, sharpening,
     `ret -= 0.004`…) comes in in proportion. Both ends are linear in `f`: at 0 it is
     the last step's warp, which with the drawing (4) over it is the feedback; at 1 the
     next step's warp of the feedback. The last step's drawing comes in by `f`, as the
     trail it leaves, while its copy (4) moves on;
  3. the mesh (`runtime::Mesh::between`). Where the step's map is a flow — each vertex
     moved about as far, and the same way, as its neighbours — it is the map at
     fraction `f` (`Mesh::uvs`): each vertex's zoom and stretch to the power `f`, its
     rotation, translation and warp wobble times `f`, so the parts compose back to the
     whole — two half steps land within a quarter pixel of a whole one at 512 px on a
     preset that moves ~10 px a step
     (`runtime::tests::parts_of_a_step_compose_to_the_whole`). Where the map folds or
     tears the picture — a kaleidoscope's mirror (`dx = x - ox`), a jump elsewhere —
     there is no motion to take a part of, and a part of a fold is a smear, so (1)
     stays put and (2) takes the whole step: the refresh cross-fades to exactly what
     the next step draws. How far a vertex is from a flow is how much the step
     stretches the grid around it: a change in displacement under a quarter of the
     distance to a neighbour slides, over a half cross-fades, in between mixes
     (`between_steps_a_flow_slides_and_a_fold_cross_fades`);
  4. its own blur of that picture, then the drawing between the two steps'
     (`draw::between`): every wave, shape, motion vector and border both steps drew —
     the same stage, kind and number of points, in the same place in the list — with
     each vertex's position, colour and texture coordinate `f` of the way from the last
     step's to the next's, so it slides; a command only one of them drew fades, out by
     `1 − f` or in by `f`. A textured shape samples the picture before the feedback
     mixed with the feedback by `f`: the last step's shape sampled the one, the
     next step's will sample the other;
  5. comp. The warp and comp shaders read every uniform `f` of the way from the last
     step's value to the next's (`values_at`): `time`, the audio levels, the `q`s, the
     roam values, the blur ranges; and comp's hue colours follow that `time`.
     `rand_frame` is the next step's: it is noise, drawn afresh each step.

  Each part is the step's own picture at `f = 1` and the last step's at `f = 0`, so a
  step lands without a jump (`between_steps_the_picture_moves_on_without_a_jump`), and
  moves on by its share of the step at every refresh in between
  (`between_steps_motion_is_even_at_every_refresh_rate_and_speed`: a sliding square and
  a comp shader brightening with `time`, at 60 and 120 Hz and ¼×, 1× and 4×, each
  refresh moves within 1.5 px or 1.5 levels of the mean, where a step that landed at
  one refresh would be 6 px or 4 levels off).
- **The display's time is evened out.** The bench's loop is paced by the display, but it
  wakes a little early or late each refresh: 0.6–0.7 ms sd at 60 Hz, 15% of a refresh
  at the 99th percentile. The pictures reach the screen exactly a refresh apart, so the
  clock moves by whole refreshes of the display's period (`runtime::Pacer`, learnt from
  the loop, a dropped refresh counted as two), with the difference from the real time
  paid back a little at a time so a second still adds up to a second. Measured on the
  bench: each refresh moved the clock 1.7% off even on average, 14.9% at the 99th
  percentile; paced, 0.3% and 2.4% (`runtime::tests::the_pacer_evens_out_a_display_loop`).
- **The latency is one step at most.** To draw towards the next step its equations run at
  the first refresh after the step before, with the audio then. At a refresh landing on a
  step (30 Hz) that is exactly MilkDrop's order; at 120 Hz a step's
  equations hear the audio up to 1/30 s × 1/speed before it is fed back.
- **Why not feed back every refresh, a fraction at a time?** Tried on paper and rejected:
  the feedback is 8-bit, as Butterchurn's is, and a fractional decay rounds back to where
  it was (`x × 0.98^¼` loses under half a level below `x ≈ 100`), so trails would stop
  fading at 120 Hz; every pass also resamples the picture bilinearly, so four passes a
  step blur it four times; and a warp shader's own colour work compounds per pass in ways
  a fraction can't undo. Feeding back once a step keeps all of that MilkDrop's.

What can't be split exactly, so is approximate between steps only (the steps themselves
are exact):

- **A warp shader that moves the picture itself** (`uv += …`, sampling at an offset) moves
  it the whole way at every refresh, mixed in by `f`: between steps that reads as a
  cross-fade to the next position rather than a slide. The mesh's own motion slides,
  except where it folds the picture, which cross-fades (above) — on a kaleidoscope the
  folded picture is nearly the same each step, so that reads as still.
- **Colour work is mixed linearly**: a decay `d` shows as `1 − f(1 − d)` between steps
  rather than `d^f` (at `d = 0.98`, `f = ½`: 0.9900 against 0.98995).
- **Waves, shapes and motion vectors slide in straight lines** between where two steps
  drew them, which is right for a step's worth of motion; a wave that changes its
  number of points, or a shape its sides, between two steps cross-fades instead.
  Their trails are the feedback's, so a trail is still made of steps, 30 a second × the
  speed, as in Winamp.
- **The warp shader's uniforms move with `f` as well as its mix**, so its colour work
  between steps is a little off linear in `f`: measured, that makes the motion of
  presets whose warp shader moves the picture by noise more even (block matching) and
  their frame difference a little less (below).
- **Comp's blur** between steps is of the picture between; the warp shader still reads the
  last step's blur, as the next step's warp will.
- **Speed above 1× on a slow display** makes several steps in one refresh, each fed back;
  only the last is shown.

Measured with the side-by-side harness (since removed; see "Comparing with Butterchurn")
on its default 30 presets, 240 frames: before, both
engines at 60 frames a second, the mean score was 75.9; now, Butterchurn at 30 and ours at
`--refresh 30`, `60` and `120`, it is **74.5 at all three, preset for preset** — the
captures land on steps, and the steps don't depend on the refresh rate, so the pace is
Butterchurn's at any display rate. The 1.4 points against before are the clock, not the
drawing: at 30 the same 240 frames cover 8 s of the track instead of 4, and the
strongly chaotic presets move both ways (±12). The harness can't score the pictures between
steps, which have no reference; the unit tests bound them, and the `motion` tool measures
them. Drawing them evenly (below) left the scores where they were: 74.51 at `--refresh 60`
and `120`, preset for preset, before and after.

**Judder, measured.** The first version drew the steps right and the refreshes between
them unevenly: everything that isn't the warp mesh changed at the first refresh after a
step and then held. Comp read the next step's uniforms at once, so anything comp moves
with `time`, the audio or the `q`s jumped a whole step there; and the next step's waves
and shapes were drawn at their new place with their alpha × `f`, which reads as a jump,
not a fade, because comp's gamma (×2 by default) and additive blending saturate a
half-faded wave to nearly full. At 60 Hz that is motion at 30 a second with a hitch every
other refresh; at 120 Hz one refresh in four does it all. The `motion` tool (AGENTS.md)
shows it as frame difference by where a refresh lands in its step, 7 presets from the
pack and the Spiral fixture at 512×384 over 3 s; at 120 Hz and 1×, phase by phase:

| preset | before | after |
| --- | --- | --- |
| fiShbRaiN + geiss - witchcraft (Glow Mix) | 0.22 **0.69** 0.29 0.24 | 0.78 0.64 0.76 0.76 |
| suksma - eternally occulted | 9.75 **11.93** 9.10 9.09 | 12.17 12.37 11.93 12.20 |
| shifter - tumbling cubes (ripples) | 4.21 **4.72** 4.30 4.23 | 4.22 4.40 4.26 4.20 |
| Fixture - Spiral Test | 19.19 **21.19** 19.80 19.36 | 21.07 20.49 20.37 20.77 |

The most-changing phase over the least, worst preset: 3.14 before and 1.47 after at
120 Hz 1×, 1.98 and 1.31 at 60 Hz 1×, 4.14 and 1.70 at 60 Hz ¼×; at 4× every refresh is
a step or more, so 1.00 both. Block-matched motion (px a refresh) agrees where there is
enough motion to match (0.3 px a refresh or more): `cope - drove through ghosts` 0.29
0.55 0.49 0.35 before, 0.41 0.56 0.50 0.43 after; `witchcraft` 0.10 0.20 0.11 0.10, then
0.21 0.17 0.22 0.20. What is left uneven is warp-shader motion (above) and presets that
move under 0.2 px a refresh, below what the measure resolves.

**Folds, measured.** That version still left some presets jittery, Dancer/Comet
Mirror/448 worst. It looked like trails and a hard fade (`× 0.85 − 0.022` a step), but
the motion tool found a different cause: its per-pixel equations fold the picture into
a kaleidoscope (`dx = x - ox`), and taking a fraction of a fold smears each segment
across the picture and back. Its steps differ by 1.4 levels (at 30 Hz), but each refresh
between them differed by ~50. Folds now cross-fade (`Mesh::between`), and the picture
between steps is linear in `f` (the last step's warp under the drawing between, the
shader on the feedback over it), so a trail's newest piece fades in by `f` while its
copy moves on. Textured shapes sample a mix of the two pictures the steps sampled.
Measured on 448, its sibling 447, Comet/Mig_036_version3, Glowsticks Mirror/412 and
Wake Mirror/417 (all hard fades, drawn trails, blur in comp), most-changing phase over
least, and mean difference a refresh in brackets — main, then the first version, then
now:

| preset, 120 Hz | ¼× | 1× |
| --- | --- | --- |
| 448 | 3.74 (32.6), 3.92 (32.4), **1.08 (0.20)** | 1.52 (45.4), 1.53 (42.6), **1.03 (0.77)** |
| 447 | 4.17 (17.0), 3.04 (14.7), **1.23 (4.17)** | 1.79 (27.9), 1.70 (20.6), **1.11 (5.72)** |
| 412 | 5.41 (7.92), 3.61 (7.41), **1.56 (6.41)** | 2.26 (12.8), 1.79 (10.3), **1.18 (9.73)** |
| Mig_036_version3 | 5.44 (0.32), 1.37 (0.40), **1.32 (0.40)** | 2.13 (1.24), 1.11 (1.37), **1.07 (1.36)** |
| 417 | 2.42 (2.73), 1.21 (3.12), **1.21 (3.11)** | 1.29 (5.14), 1.06 (4.84), **1.07 (4.83)** |

At 60 Hz 448 went from 2.99 (51.1) to 1.06 (0.35) at ¼× and from 1.00 (51.0, even but
all flicker) to 1.04 (0.92) at 1×; at 4× every refresh is a step, unchanged. Over all 13
presets, the worst that moves at least 0.2 levels a refresh is now 1.68 at 60 Hz ¼×,
1.32 at 60 Hz 1×, 1.99 at 120 Hz ¼× and 1.46 at 120 Hz 1× (from 2.99, 1.97, 5.44 and
3.15 on main); the worst is `martin + flexi - lock and release bipolar 04`, untouched by
either version: its motion is a warp shader's noise, which cross-fades (above).
`between_steps_a_folding_fading_trail_changes_evenly` holds a fold with a fading trail
and blur in comp to 1.5 (the first version: 2.1 at 120 Hz). The feedback still steps
once a step, so the side-by-side harness's scores stayed 74.51 at `--refresh 60` and `120`.

Frame times and stage-picture readback were ruled out on the bench (60 Hz, 1377×774,
20 s): a refresh with a step takes 2.3 ms of CPU and one between 0.7 ms, 1 refresh in
1200 went over 20 ms, and reading the stage pictures back every 4 steps takes 0.6 ms
(1.9 ms at most). The loop's wake-up jitter was a small real cause (above, `Pacer`).

## The preset index

The library (0.4) browses the pack by picture, colour, speed and author, from an index
the `index` bin writes: `index.json` (`engine/src/index.rs`) and a folder of thumbnails.

- **What's in a row.** The path and SHA-256 of the file; style and sub-style, its first
  two folders; authors and title from the name, `Author [+ Author] - Title [--- Editor
  edit]` (`engine/src/index/authors.rs`), case-folded and mapped through a hand-checked
  alias table, `engine/authors.tsv`, so one person's spellings count once (editors and
  remixers such as AdamFX follow the originals; a name crediting no one reads `unknown`,
  1,695 of the pack); and, once drawn, its look: up to two dominant hues, brightness,
  speed and intensity, the last three also as low, mid or high.
- **How it's drawn.** Each preset runs to the measuring bins' synthetic music (a kick on
  the beat under a chord), one step a frame, at 384×288, to step 90 (three seconds). The
  thumbnail is step 90 shrunk to 192×144, WebP at quality 75 (about 6 KB). The look is
  measured over steps 45–90 on the shrunk pictures (`engine/src/analyse/`): brightness is
  the mean luma; hues come from a 12-bin histogram weighted by saturation × value
  (none when under 3% of the picture is coloured; a second hue when a colour not next to
  the first carries at least half its weight); intensity is the mean frame difference per
  step; speed is the mean block motion per step, the same block matching as `motion`
  (16 px blocks, ±8 px). A step whose blocks are textured but not found again counts as 8
  px (moving faster than the search); a preset with too little to follow on two thirds of
  its steps (flat colour, soft glows) has no speed, and its speed level is its intensity's.
- **Robustness.** Presets are drawn in child processes; one that doesn't answer within the
  timeout (20 s) is killed, listed under `skipped` with the reason, and its child restarted.
  The run is incremental by content hash: a preset already drawn, or already skipped
  (unless `--retry`), isn't drawn again; names, styles and levels are always recomputed.

**Cut points** (terciles of the full pack, 9,789 presets drawn; in `engine/src/index.rs`):

| Measure | Low below | High from |
| --- | --- | --- |
| brightness (mean luma, 0–1) | 0.186 | 0.434 |
| speed (block motion per step, thumbnail px) | 1.92 | 4.81 |
| intensity (frame difference per step, luma 0–255) | 6.97 | 20.34 |

With these cuts the pack splits 3,258 / 3,264 / 3,267 by brightness, 3,581 / 3,107 /
3,101 by speed (the presets with no measured speed, 564, lean low) and 3,264 / 3,263 /
3,262 by intensity. 2,117 presets have no dominant hue, 5,675 one and 1,997
two.

**Timings** (M1 Max, release build, while another lane was building the app):

| Run | Jobs | Time | Rate | Skipped |
| --- | --- | --- | --- | --- |
| sample of 250 (`--sample 250`), Metal shader cache cold | 4 | 71 s | 3.5/s | 0 |
| sample of 250, cache warm | 4 | 33 s | 7.5/s | 0 |
| full pack (9,795), cache mostly cold | 6 | 38 min | 4.3/s | 93 (87 timed out) |
| full pack, cache warm | 6 | 17.4 min | 9.4/s | 6 |
| full pack, nothing changed (hashing and relevelling only) | — | 1.6 s | — | 6 |

The 87 timeouts of the cold run (Sparkle mostly) all drew on a `--retry` (35 s): they were
cold shader compiles queued behind each other under load, not hangs; each draws in about
0.6 s alone. The 6 left are equations the EEL compiler refuses (`_aboeq()`, an assignment
to an expression, two parse errors). The thumbnails for the whole pack take 60 MB.

**Spot check** (30 presets, 10 per speed level spread over the pack, judged from a second
of pictures at 30 Hz): intensity matched what's seen for about 26 of 30; speed for about
22. Speed misses go two ways: sparse flicker and noise read as high speed (textured blocks
that can't be found again count as fast), and soft glows that barely move can come out
mid. Large slow shapes that move visibly can read low, as block motion is per step.

## Performance: 60 fps at 4K

4K is 8.3 megapixels, and MilkDrop touches each of them several times a frame: the warp
pass reads the previous frame, the blur pyramid reads it again, the comp shader reads all
of it, and Butterchurn regenerates mipmaps of the 4K feedback buffer every frame. So at
4K the frame is **GPU bound**, and the language the CPU half is written in is not what
decides 60 fps. What decides it is how many full-resolution passes there are and what
each one costs.

### A native Tauri app, rendering on Metal

**No WebGL anywhere in the product.** visual[flow] becomes a Tauri app — the shape the
BlackHole visualizer already has — with the engine as a Rust crate drawing on Metal.

- **`wgpu` on its Metal backend**, not raw Metal. MilkDrop is about twenty passes a frame,
  so `wgpu`'s overhead over hand-written Metal is noise against a 4K fill-rate budget; what
  it buys is a safe API, `naga` for shader translation, and compute. If a Metal-only
  feature is ever worth it, `wgpu`'s hal interop reaches the raw `MTLDevice` without a
  rewrite.
- **Native surfaces, webview controls.** The wall is a borderless `tao` window per
  display with its own Metal surface — no browser in the path, no throttling, real frame
  pacing. The console's large preview is a Metal surface under a transparent webview
  that draws the controls. Node pictures are rendered small by the engine and sent to the
  webview as raw bytes, the way the BlackHole visualizer sends audio.
- **Audio through CPAL**, the capture code the BlackHole visualizer already has: any Core
  Audio input, any two channels, a lock-free history the renderer reads each frame.
- **Shaders translated once, on import.** MilkDrop's HLSL → SPIR-V (glslang's HLSL front
  end) → `naga` → MSL, with the original text kept. That replaced the Emscripten converter
  the old server worked around.
- **EEL compiled to a register-VM bytecode in Rust**, tested against Butterchurn's
  results for the same inputs; per-vertex and per-point equations that qualify are
  compiled to shader code instead (see below).
- **Link and the Live bridge move to Rust later** — `abl_link` bindings and a WebSocket
  client. The MVP needs neither: it listens to an audio input.

Why native rather than staying on WebGL 2: compute shaders for the blur and the wave
points; explicit passes with no automatic mipmap regeneration of a 4K feedback buffer;
frame pacing a browser does not give; and a shader path that is not broken.

The risk is that this is a rewrite. That is why phase 1 is a measured spike, not the
engine.

### What moves to the GPU, node by node

| node | MilkDrop runs it | here |
|---|---|---|
| per-frame equations | CPU, once a frame | CPU. Scalar and tiny. |
| per-vertex equations | CPU, per mesh vertex | **GPU**, as a vertex/compute shader generated from the EEL — unless the preset writes `regNN` or `megabuf` across vertices, which is sequential and stays on the CPU. Decided per preset at import. |
| custom waves, per point | CPU, up to 512 points × 4 | **GPU compute** when the points do not carry state from one to the next; CPU otherwise. |
| custom shapes | CPU per instance, up to 1024 | per-instance equations on the CPU, **instanced** in one draw. |
| warp shader | GPU, mesh at feedback resolution | GPU. |
| blur 1–3 | GPU, six passes | **compute**, separable, at the reduced sizes MilkDrop itself uses. |
| comp shader | GPU, full resolution | GPU. The only full-resolution pass that must stay one. |
| audio analysis (FFT, `bass`/`mid`/`treb`, `_att`) | CPU | CPU, ported exactly — every preset reads it. |

## Measured so far

**Butterchurn at 4K on the target machine** (M1 Max, 32-core GPU; `npm run
harness:profile`, deleted with the old app). Measured through Chromium, because Butterchurn is a WebGL engine, so
the totals are distorted by Chromium's GPU process — its throughput reading is less than
its own comp pass. The stage shares are the useful part: **comp** is the largest cost
(~2.8 ms median at 4K), then **blur** (~0.8), then the feedback buffer's **mipmaps**
(~0.45); presets with many shape instances add up to 9 ms of CPU. No sampled preset came
near 16.6 ms. The native engine reads Metal's GPU timestamps per pass instead.

**The spike's target is 1080p.** 4K returns once the native engine is measured, with
the feedback loop below output resolution and an upscaler as the likely route.

**MilkDrop HLSL → SPIR-V → MSL works.** On 400 presets spread across Cream of the Crop
(662 shaders): glslang's HLSL front end then `naga` produced valid Metal for **635
(95.9%)**, against roughly one in ten that the Emscripten converter produced unpatched.
It takes five rewrites before glslang, each of which becomes a unit test in the engine's
translation module:

1. **MilkDrop's preamble** — its samplers, uniforms, `q1–q32`, `GetBlur1–3`, `lum` —
   declared the way MilkDrop declared them.
2. **Uniforms become mutable.** D3DX9 let a shader assign to a uniform; HLSL now does not.
   The uniforms live in a buffer under other names, with `static` copies under the real
   ones assigned at the top of `main`. A preset's own top-level variables are made
   `static` for the same reason.
3. **Samplers are split.** `naga` does not read DX9's combined `sampler2D`, so each is a
   `Texture2D` and a `SamplerState`, and `tex2D(s, uv)` becomes `s_tex.Sample(s_smp, uv)`.
   A preset declaring a sampler the preamble already has is not declared twice.
4. **Matrices are stored 4×4** in the buffer and cast to MilkDrop's `float4x3`, or the
   buffer's layout overlaps.
5. **Bindings are assigned automatically** (`--auto-map-bindings`), since every DX9
   resource otherwise lands on register 0.

What is left: `double` (to be rewritten as `float`) and a handful of presets with real
syntax errors, which MilkDrop's compiler tolerated and these do not.

## The graph is MilkDrop's pipeline

Nodes are MilkDrop's stages, not arithmetic. Equation and shader nodes hold code, kept
as written; their ports are the variables MilkDrop already names.

- **Sources:** audio input, the Live bridge, time.
- **Equations:** per-frame init, per-frame, per-vertex — EEL code, with `q1–q32` and the
  motion variables as ports, so a Live meter can be wired into `q5` or `zoom`.
- **Picture stages:** warp mesh + warp shader, waves ×4, built-in wave, shapes ×4, motion
  vectors, borders, darken centre, video echo, blur, comp shader, gamma and the output
  switches.
- **Resources:** the preset's own textures, and the fallback Butterchurn uses when a
  texture is missing — matching it means doing the same.

"MilkDrop complete" means what Butterchurn supports: MilkDrop 2 presets with shaders and
MilkDrop 1 presets without them, custom textures, and the title animation. The blend from
one preset to the next belongs to the wheel, not to a flow.

Breaking EEL and HLSL into arithmetic nodes is deliberately not the plan. A Cream preset
would become hundreds of nodes nobody could read, and matching Butterchurn would get
harder rather than easier.

## Comparing with Butterchurn

There was a side-by-side harness: `npm run compare` drew presets with Butterchurn in
headless Chromium and with the engine (`engine/src/bin/compare.rs`) from the same audio,
time and seeds, and scored the pairs; the app had a compare view with Butterchurn live
beside the bench and approve / reject / note per preset. Both were removed in October
2026 as no longer needed: presets are now judged by ear and eye against the BlackHole
visualizer. The last commit with them is `e941049` (the merge of #38), to bring them back
from as a separate development-only module if they are wanted again. The verdicts given
are still in `~/.openflow/visuals/compare/approvals.json`, untouched.

What can't match Butterchurn, and so is not an engine bug when a preset looks different:

- **`rand_frame` and later `rand()`.** Butterchurn draws everything from one global stream
  — the blend pattern, `rand_frame` each pass, shapes', waves' and every frame's `rand()` —
  where the engine has a stream per preset, per shape, per wave and one for `rand_frame`.
  They agree up to the init equations and part after that.
- **`rand(n)` itself.** Butterchurn returns `Math.random() * floor(n)`, not floored; the
  engine floors. Presets that use it differ until the engine copies the quirk.
- **Shaders Butterchurn cannot link.** It draws black where MilkDrop draws its default;
  the engine draws the default, and Ryan judges which is right.
- **Unknown textures.** Butterchurn samples its `clouds2` image for any sampler it has no
  picture for.
- **Chaotic feedback.** A preset that feeds back strongly turns float-level differences
  between WebGL and wgpu into different pictures within seconds; its first seconds are
  the ones to judge.

## Phases

0. **Baseline.** Profile where Butterchurn's frame goes at 4K on Ryan's machine — equations, mesh, each
   pass, mipmaps. The numbers that decide what to optimise.
1. **Spike.** A Tauri app whose Rust crate draws one shader preset — warp, comp, feedback,
   blur — on Metal at 4K, from a CPAL input. Measured against phase 0. **Decision point:**
   confirm `wgpu` over raw Metal, and the frame budget per pass.
2. **Engine.** Every stage, the EEL VM, exact audio analysis, the import-time shader
   translation.
3. **Importer.** `.milk` → flow JSON over the whole pack.
4. **Conformance.** Ryan judges presets beside the BlackHole visualizer; the engine closes
   what he finds.
5. **Editor**, then the Live bridge as a sound node and set facts as ports.

## Questions still open

- **Which machine is the 4K/60 target?** Phase 0 measures on it.
- **The Live bridge's sound.** It carries meters today, not audio. "A node that provides
  sound" means the bridge device sending PCM, which is bridge work in another repo.

## Where it lives

`engine/` (the Rust crate) and `app/` (the Tauri shell and its webview UI, `app/src`) are
the whole product; `teaser/` is the Remotion edit made from the engine's footage. The
Electron app went first; the Node server, the WebGL2 renderer, their MCP server, stories,
tools and docs (`client/`, `server/`, `mcp/`, `stories/`, `tools/`, `harness/`, the root
`*.ts` modules) were deleted in October 2026, with Ryan's go-ahead. The last commit with
them is `3bcc202`, to read or bring something back from.
