# Brief: the visual[flow] preset editor, final interactive mockup

For Claude Design. Reference: the mock at
<https://claude.ai/artifact/EpPrAGEwFUmPsSup168qm9> ("From MilkDrop and beyond"). It is the
agreed direction; your job is to turn it into one polished, interactive editor mockup.
Everything below the reference already decides stays decided; what's open is listed at
the end.

## The product, in three sentences

visual[flow] is a macOS app that plays MilkDrop music visualizer presets live, following
Ableton Link and changing presets on the bar. Its preset editor is being rebuilt as a node
graph so that **someone with no coding knowledge (think a 16-year-old who loves visuals)
can make a new preset**. Our own preset format is that graph: a MilkDrop `.milk` imports
into it and plays back exactly as MilkDrop draws it, and from there a preset can go further
than MilkDrop allows (Link, Ableton Live, MIDI, 3D models).

## What to make

One interactive, desktop-sized mockup of the editor (dark, around 1600 × 1000), clickable
end to end. It should feel like a real tool, not a slide. It must show:

1. **The four cases** from the reference, switchable: an imported MilkDrop preset (Flower
   Blossom, by Geiss), the same preset expanded (added nodes marked), a preset made from
   scratch with only what MilkDrop has (Kick Bloom), and the showcase made from scratch with
   everything (Night Engine). Use the reference's node data and wiring as the content.
2. **The graph, quiet at rest and alive on contact.**
   - Pointing at a node lights its wires and fades the rest.
   - Wires from global sources (Kick, Link, Live, Macros) rest as short stubs at the input
     and draw in full on hover.
   - Values visibly move: the live bar in a wired knob, the glow on a source's port, the
     small moving picture on Move, Draw and Look nodes.
   - Pan and zoom the canvas; drag nodes.
3. **The picture, always in view.** A pinned preview of the output beside the graph. Use
   the reference's engine frames (`frames/*.jpg` in that artifact).
4. **Building, not just reading.** This is the part the reference doesn't have yet and the
   main thing to design. Recreate Kick Bloom's six moves as real interactions:
   - Add a node from a picker that shows previews, not a list of words.
   - Drag a wire from an output: compatible inputs light up by shape and the rest dim.
     Drop it, and a sensible amount is chosen for you.
   - **Flow outlet:** dropping a source on a node (or choosing "use Kick for…") offers
     **three previewed outcomes** ("Kick makes it pump / spin / glow"). One click accepts
     one, with its wires and amounts set.
   - Turn a knob. Change how much a wire moves a knob ("tighten the range") without
     rewiring.
   - Each move updates the preview.
5. **Teaching the loop.** Feedback (the finished picture coming back as next frame's
   start) is the one idea every preset depends on. Show it so a beginner gets it: the
   labelled connection with its moving glow, Trails turned up and down, and a way to see
   what happens with feedback off.

## Already decided (keep)

**Structure**
- Left-to-right graph. Columns run: sources → modulators → movement → **Move the picture**
  → **Trails** → drawings → **Paint on top** → Look nodes → Screen.
- Move the picture, Trails and Paint on top are fixed parts of the loop. They're always
  there, tinted, and can't be deleted.
- **Feedback** is the only connection that goes backwards: from Paint on top's output, over
  the top of the graph, into Move's "last frame" input. It's labelled "feedback · trails".
- Movement nodes (Zoom, Spin, Ripple…) output *movement* into Move the picture.
- Drawings (Waveform, Lenses…) plug into Paint on top, whose numbered inputs are the paint
  order. Paint on top also takes pictures (a 3D model).
- Look nodes chain picture to picture to the Screen. They are never fed back.

**Every knob is an input**
- A knob holds its own value until something is wired in. It then reads held value +
  amount × wire, and several wires add.
- A colour wired into a colour knob replaces it.
- Choices (circle, blob, saw) are knobs too.
- Untouched defaults fold into "+N untouched".

**Types: shape says what a port takes, colour says what a wire carries**

| type | port | line |
|---|---|---|
| number | circle | thin solid, light grey-blue |
| colour | colour-wheel circle (filled with the actual colour when wired) | thick solid, in the colour (light outline on dark colours) |
| trigger (a kick, a downbeat, a section change) | triangle pointing right | short orange ticks |
| sound | the audio mark: a dot inside two rings | wavy |
| movement | diamond | blue beads |
| picture or drawing | square | hollow pipe (pink for drawings) |
| point (a place on screen) | small cross | thin solid |
| feedback | violet square | violet, with a moving glow |

- An **outline** port means nothing is wired in; **filled** means connected.
- Where a value comes from is a tinted label at the knob ("Kick · punch 0.05"), not the
  wire colour.

**Nodes**
- Header: an icon for the station, the title, at most one badge, and the output port on
  the header.
- Badges: green "added" (new in an expanded preset), violet "beyond MilkDrop" (can't be
  exported back to a .milk).
- Number knobs are small sliders with a held mark and a live bar, with the value beside
  them.
- Code that does nothing is hatched, with the reason in a line.

**Words**
- Plain words for what you see: Zoom, Spin, Trails, Paint on top, Glow, Palette, Sway.
- Musical words musicians use: hit, punch, pump, phrase, build, drop, 1/8, 4 bars.
- No code, no "LFO", no "per-frame", no "q1".

**Music**
- Hits (Kick, Snare, Hats) found in the sound are the default way to use it; loudness
  levels are for imports.
- With Link, or a tempo set by hand, times are note values.
- Link carries only tempo, beat and start/stop. Track levels, section, key and clip
  launches come from "the visual[flow] Live device".
- Macros are named, MIDI-learnable faders.

**Look**
- Dark stage, a dotted grid on the canvas.
- Type: Bricolage Grotesque for titles, Atkinson Hyperlegible for text, JetBrains Mono for
  values.
- Use the reference's colour tokens.
- Some gloss is welcome; no literal glass, chrome or product-render styling.
- Motion only where it shows real signal.

## From the product intent (for context)

- The unit of progress is **one taste decision that leaves usable work behind**. Every
  choice can be a stopping point, and later choices never lose earlier work.
- Choices present results. Previews are central, and a choice brings its wiring and
  amounts with it rather than leaving a setup task.
- Detailed control stays one step away and serves a specific intent ("this moves too far;
  tighten the range"). It is never a required refinement phase.
- The graph is quiet at rest. Small breakouts attached to a node, shown on hover, beat a
  full parameter panel.
- Gentle motion means real activity: a number can be a light pulsing with its value.

## Open for you to decide

- Node geometry, the icon set, and how the moving picture sits in a node.
- How the picker and the three previewed outcomes look and behave, and where the
  amount-on-a-wire control lives.
- How "+N untouched" opens, and how a hover breakout differs from a selected node.
- How feedback is taught on first use.
- Empty state: a blank canvas with only the loop, and how the first taste decision is
  offered there.

## Out of scope

The library, playlists and live mode; settings; mobile; the code view (never shown in the
editor); real audio.

## Done when

- Someone can click through Kick Bloom's six moves as real interactions: pick, wire,
  choose an outcome, turn a knob, see the picture change.
- The four cases are switchable.
- Every port type and line style appears at least once and matches the table above.
- At 100% zoom every label is readable and the preview is never hidden.
- A first-time viewer can point at the feedback connection and say what it does.
