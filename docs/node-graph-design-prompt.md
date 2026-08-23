# Node graph design prompt

Design a dramatically simpler node-graph experience for Better Session View's visuals
editor.

Your primary goal is not to expose every graph feature. Your goal is:

> A smart musician named Sam, with no node-editor or shader experience, should be able to
> build a simple visual flow in under 60 seconds without reading documentation.

Do not infantilize Sam or turn the editor into a wizard. Use strong defaults, recognition,
immediate feedback, and contextual actions. The graph should teach itself through use.

Produce actual visual mockups—not only a written UX report. Do not change product code.

## Product truth

The product noun is a **flow**. A flow is one node graph that produces one frame for the
projector.

The picture is the product. The graph is only a means of answering:

1. What should appear?
2. What should happen to it?
3. What should make it move?
4. What reaches the wall?

The interface should optimize that sequence rather than foregrounding graph-management
mechanics.

Read these files before designing:

- `visuals/docs/flows.md`
- `visuals/docs/console.md`
- `visuals/protocol.ts`
- `visuals/src/render/circuit.ts`
- `visuals/src/ui/edits.ts`
- `visuals/src/ui/nodes.ts`
- `visuals/src/ui/Designer.tsx`
- `visuals/src/ui/Circuit.tsx`
- `widgets/docs/graph.md`

Treat the model and constraints in those files as authoritative. Treat the current UI as
evidence, not as a layout you must preserve.

## First deliverable: headless capability map

Before drawing mockups, summarize the underlying model in a compact table:

| User intention | Headless operation | Important constraint | Must be visible to a novice? |
|---|---|---|---|

Distinguish three levels:

1. **Supported now:** directly represented by the current model and edit functions.
2. **UI orchestration:** achievable by composing existing operations, such as inserting a
   node into a wire or offering a recipe.
3. **Requires new model/infrastructure:** comments, frames, persisted viewport state, true
   undo history, and similar additions.

Do not quietly represent level-three features as if they already exist.

## What the graph supports today

### The essential graph

- Every flow has exactly one `out`.
- `out` always exists, cannot be deleted, and is not something users add.
- Only nodes that ultimately reach `out` affect compilation or performance.
- An unfinished graph is valid.
- If nothing reaches `out`, the result is transparent black and the UI must plainly explain
  why.
- New flows can start from either:
  - a working `every playing track → out` graph;
  - the more involved starter graph.
- Question whether the simple working graph should be Sam's default.

### Three signal types

There are only three connection types:

- **Colour:** a picture.
- **Number:** a value or live signal.
- **Point:** a place in the frame.

Connections are strictly typed. There are no automatic conversions.

Type must not be communicated by colour alone. Use labels, shape, position, or another
redundant cue.

A connection may be started from either end. It always resolves as outlet → inlet.

Invalid type connections and recursive connections are refused at the gesture that attempts
them. The graph should not break first and explain later.

Each inlet accepts one connection. Connecting a new source replaces the previous connection.

### Node vocabulary

Group nodes by the user's intention, not merely by implementation type:

- **Put something on screen**
  - Every playing track
  - Source: plasma, rings, grid, tunnel, sparks, etc.
  - Another flow
  - Paint with the active colourway

- **Change or combine a picture**
  - Lens: kaleido, zoom, ripple, mirror, pixelate, etc.
  - Grade: levels, hue, posterize, invert
  - Spread: bloom, smear, edge, shift
  - Blend: over, add, screen, multiply

- **Make it respond**
  - Playback: beat, pulse, phase, level, time, random
  - A named track's meter, fader, or playing state
  - Song facts: key, tempo, section, seed
  - Wave and math nodes
  - A reusable value

- **Work with position**
  - Point
  - Place
  - Polar

- **Finish**
  - Out

Do not make Sam learn these categories before achieving a result. They are an information
architecture tool, not onboarding copy.

### Modes, targets, and presets are different

A node kind may have modes. For example:

- `lens → kaleido`
- `grade → posterize`
- `blend → screen`

Changing a mode may change the node's available inlets. Existing connections to inlets that
no longer exist are removed.

Some nodes choose a target rather than a mode:

- A track node chooses a track that actually exists in the set.
- A nested-flow node chooses a flow that actually exists in the library.

Never require users to type track or flow names.

The node browser currently distinguishes:

- the node;
- built-in presets beneath that node;
- real targets such as “Bass meter.”

Preserve that semantic distinction even if you redesign the browser.

### Numbers are useful without wires

Most number inputs already contain an adjustable value. Sam should not need a separate value
node just to set “kaleidoscope segments” or “blend amount.”

When a number is connected, the connection modulates the value rather than replacing it:

`value + depth × signal`

Depth can be positive or negative. The number beneath the connection remains editable, so
wiring and unwiring are non-destructive.

This is powerful but potentially difficult to explain. Design a progressive presentation
where:

- the base value is obvious;
- the current live result is visible;
- modulation depth is discoverable when a number becomes connected;
- signed direction can be understood without requiring algebra.

### Immediate feedback

The system supports:

- A large live preview of the finished flow.
- A preview of an individual node.
- Small live pictures on node faces.
- Visual representations for number and point outputs.
- A simulated “room” for testing tempo, playback, energy, section, colourway, and key without
  Ableton.
- Following the real room when connected.

The user must always be able to tell whether the large preview shows:

- the finished flow; or
- one selected node.

Do not let diagnostic controls compete visually with the picture or the primary construction
path.

### Library operations

Supported operations include:

- Create a flow
- Rename
- Fork
- Delete
- Add/delete/move nodes
- Change node mode
- Change track or nested-flow target
- Connect and disconnect
- Adjust values, smoothing, and modulation depth
- Preview an individual outlet when a node has several
- Pan and zoom the graph

Nested flows are supported, but recursion is refused.

### Current boundaries

Do not present these as existing capabilities:

- Selecting or moving multiple nodes
- Click-selecting cords
- Comments, frames, or graph groups
- Auto-routing around nodes
- Persisted or externally controlled viewport position
- User-created node presets
- Device parameters as signal sources
- MIDI notes or velocity as signal sources
- One track's rendered frame as another node's input
- General point arithmetic
- A full undo/redo history

You may recommend any of these separately, but label the implementation tier and explain why
it materially helps Sam.

## Primary usability benchmark

Design around this exact first-use task:

> “Make every playing track kaleidoscopic.”

The desired conceptual graph is:

`Every playing track → Kaleido → Out`

Sam should be able to complete this in under 60 seconds, ideally by making no more than three
meaningful decisions.

Explore whether the easiest path is:

- starting with `Every playing track → Out` and inserting Kaleido on the wire;
- dragging from a compatible connection and searching “kaleido”;
- choosing an outcome-oriented action such as “Change the picture”;
- another graph-native approach.

Do not prescribe port dragging as the only path merely because it is traditional.

Then test a second task:

> “Make the number of kaleidoscope segments react to the Bass track.”

The result should connect `Bass meter` to `segments`, expose the base value and modulation
range, and show the effect immediately.

Finally test:

> “Blend a plasma behind the playing set.”

This checks whether Sam can introduce a second branch and understand `blend` without first
learning compositing terminology.

## Research principles to carry into the design

Use these as constraints, not as patterns to copy blindly:

- Node-RED supports filtered quick-add at the pointer and inserting a node directly into an
  existing wire. This is strong evidence for contextual construction instead of repeated
  trips to a permanent palette. [Node-RED node editor documentation][node-red]
- Unreal's material editor prioritizes immediate whole-result feedback, supports previewing
  one node, and lets expensive node previews be paused separately.
  [Unreal live-update guidance][unreal-live], [node-preview guidance][unreal-preview]
- Maya offers simple, connected, and full node views rather than forcing every attribute to
  remain visible. Consider whether our nodes need a compact default and contextual expansion.
  [Maya Node Editor][maya]
- Connection validity should be communicated during the gesture, with compatible targets
  becoming more prominent and invalid targets becoming unavailable.
  [React Flow connection validation][react-flow-validation]
- Keyboard users should be able to focus, select, move, connect, delete, escape, and remain
  automatically in view. [React Flow accessibility guidance][react-flow-accessibility]
- Progressive disclosure should preserve context, pair unfamiliar icons with text, and be
  used only where it removes real complexity. [GitHub Primer guidance][primer]
- Ports may look small, but their interactive regions should meet or exceed a 24×24 CSS-pixel
  target or provide sufficient spacing/equivalent controls. [WCAG 2.2 target-size guidance][wcag]
- Generic graph guidelines are topology-dependent. Design for this product's small, directed,
  usually sparse graphs—not enormous network diagrams. [GuidelineExplorer research][guidelines]

[node-red]: https://nodered.org/docs/user-guide/editor/workspace/nodes
[unreal-live]: https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-material-editor-user-guide?lang=en-US
[unreal-preview]: https://dev.epicgames.com/documentation/unreal-engine/previewing-and-applying-your-materials-in-unreal-engine?lang=en-US
[maya]: https://help.autodesk.com/cloudhelp/2026/ENU/Maya-Basics/files/GUID-23277302-6665-465F-8579-9BC734228F69.htm
[react-flow-validation]: https://reactflow.dev/examples/interaction/validation
[react-flow-accessibility]: https://reactflow.dev/learn/advanced-use/accessibility
[primer]: https://primer.github.io/design/ui-patterns/progressive-disclosure/
[wcag]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[guidelines]: https://arxiv.org/abs/2406.05558

## Design principles

- Keep the finished picture visually dominant.
- Prefer recognition over terminology.
- Prefer “insert the thing I searched for here” over “add, place, wire twice.”
- Show only the controls needed for the current task.
- Make nodes read left-to-right: input, operation, output.
- Give compatible connection targets generous active areas.
- Make a valid action feel obvious before it is performed.
- Explain refusals beside the attempted action and provide the recovery.
- Preserve graph context when opening details.
- Avoid modal dialogs for ordinary construction.
- Use real node names and realistic content—no lorem ipsum.
- Preserve the existing dark, stage-oriented visual character without reproducing current
  density.
- Do not create a generic SaaS dashboard or imitate Blender merely because this is a graph.

## Mockups to produce

Create three substantially different low- or medium-fidelity directions. At least:

1. One should explore contextual insertion and search from a wire or port.
2. One should explore a guided but still graph-native simple mode.
3. One should explore progressive node detail—compact until selected, connected, or expanded.

Compare them against the Sam benchmark and choose one direction.

For the chosen direction, create polished desktop mockups at approximately 1440×900 for:

1. A new simple flow before Sam acts.
2. Searching for or inserting Kaleido.
3. The completed `Every playing track → Kaleido → Out` flow.
4. Connecting `Bass meter` to `segments`.
5. The connected number control showing base value, live result, and modulation depth.
6. Adding Plasma and Blend to create a branched graph.
7. Previewing one node, with unmistakable “one node” state and a clear return to the finished
   flow.
8. An invalid type connection and its immediate recovery.
9. A moderately complex flow at zoomed-out scale, demonstrating whether labels and direction
   remain legible.
10. Keyboard focus and connection states.

Include close-ups for ports and number modulation if the full-screen mockup cannot communicate
them clearly.

## Interaction specification

Annotate the recommended design with:

- Add-node entry points
- Search behavior
- Insert-on-wire behavior
- Compatible-target highlighting
- Port labels and type communication
- Connection replacement behavior
- Node selection versus node preview
- Compact/expanded node rules
- Parameter editing
- Modulation-depth editing
- Disconnect behavior
- Delete behavior
- Pan, zoom, keyboard, and focus behavior
- Empty, unfinished, invalid, disconnected, and performance-paused states

Annotations belong outside the production interface.

## Final evaluation

End with:

- Why the recommended design is easier for Sam.
- The number of actions required for each benchmark task.
- What terminology Sam must understand before succeeding.
- What remains hidden until needed.
- A list of features removed or deprioritized from the main path.
- A “supported now / UI orchestration / model change” implementation table.
- Five usability-test observations that would cause you to revise the design.

The design fails if Sam must:

- understand shaders;
- know the `p`, `n`, and `c` abbreviations before connecting anything;
- build constants out of separate value nodes;
- browse the full vocabulary to find Kaleido;
- repeatedly drag long wires across the canvas for a three-node flow;
- diagnose a black preview without a plain explanation;
- confuse a node preview with the finished flow;
- or read documentation before seeing a successful picture.
