# Growing connectors with actual nodes

These are proposed interactions built around ports verified at revision 5f17a3ba016923c980aaa40ba168648f67d37e69. Generated pictures illustrate intent, not actual renderer output. Image generation used the built-in tool; manifest.json preserves every prompt and source image. The superseded Neon draft is retained and clearly marked.

## Five concrete arrangements

| Arrangement | Exact routes | Useful result |
|---|---|---|
| One rhythm, several controls | LFO.n → Form/Rosette.spread, tumble, flare | Coordinate opening, tumbling and light response while giving each its own base and signed depth. |
| Two outlets, two controls | Polar.radius → Shade.n; Polar.angle → Shade.amount | Radial palette position and angular brightness/opacity. These are spatial fields, not LFOs. |
| Mixed signal bundle | Array/Ring.p → Figure/Star.p; Array/Ring.which → Figure/Star.spike | Repeat the shape and vary valley depth per copy. Position stays a typed coordinate route; only spike gets a numeric depth control. |
| Several sources, one parameter | LFO A.n and B.n → proposed mix at Lens/Ripple.depth | Add, Multiply or Average contributions, with independent weights and one overall target range. Lens.c can still receive a picture. |
| Explicit oscillator chain | LFO A.n → LFO B.rate; LFO B.n → Glow/Neon.halo; Figure/Star.d → Glow/Neon.d | One source changes another's speed, which drives halo variation. Neon takes numeric distance, not a picture input. |

## Proposed interaction

1. Drag the flow outlet onto a node to preview a useful arrangement. For an obvious match, release applies its routes and sensible depths together. For multiple meaningful matches, show a few previews of the actual result.
2. At rest, collapse the arrangement to a small attached connector with a route count. Keep numeric, position and picture cues distinct.
3. Hover or focus expands around the fixed connector anchor. Select a route to grow its socket into the dual knob: center sets base, outer arc sets signed depth. A group amount can scale the selected numeric depths together while preserving their relative signs; this is a proposal, not current behavior.
4. One-to-many expansion reveals destination controls. Many-to-many expansion reveals paired source and destination routes. Bundling never silently adds their values.
5. Dropping another source onto an occupied numeric socket offers a visible combination preview. Accepting retains both sources. Keep an explicit Replace action for correcting a mismatch, so adding and replacing cannot be confused.
6. A multi-source socket shows source contributions, selected combination, and the destination's total range. Add/Multiply/Average combine values; Rate/Phase routes modify an oscillator and must reveal order. With three sources, show the actual ordered chain rather than an unexplained FM badge.
7. Removing or bypassing one route preserves the other routes, their bases, and their amounts. Opening controls must not move the node or cable anchor. Keep controls open while adjusting; focus/click equivalents need a prototype.

## Existing behavior versus proposed work

Already represented in the engine: one output can feed different inputs; every numeric input uses base plus signed depth and clamps the result to 0–1. A second connection to the same input currently replaces the first.

New UI/behavior: bundled routing, connector expansion, local multi-source combination, group depth, live arrangement choice, per-source bypass and local combination controls. The existing Math node supplies explicit Add/Multiply/etc. equivalents, but a local mix requires a defined stored representation.

For a local mix, define signal centering, normalization, ordering and clamping before implementation. Otherwise adding normalized 0–1 sources may saturate rather than produce richer movement. Define whether rate modulation creates a connection-local oscillator or modifies a shared source: it must not silently alter that source's other destinations. Mutual FM adds feedback and is a separate engine question.

Current LFO rate is multiplied by time rather than integrated as changing phase. Varying it can jump. Smooth FM needs further engine design; the rate-chain sketch deliberately does not claim smooth FM.

## Evidence

- Form/Rosette parameters: ../../../../client/nodes/form/spec.ts lines 88 and 147.
- Polar outlets: ../../../../client/render/circuit.ts line 1385.
- Shade inputs: ../../../../client/nodes/shade/spec.ts line 19.
- Array and Figure: ../../../../client/nodes/array/spec.ts line 27; ../../../../client/nodes/figure/spec.ts lines 29 and 55.
- Lens inputs and outputs: ../../../../client/render/circuit.ts line 1299; ripple parameters line 353.
- LFO ports: ../../../../client/nodes/lfo/spec.ts line 31; rate evaluation: ../../../../client/nodes/lfo/algorithm.ts line 91.
- Glow/Neon inputs and output: ../../../../client/nodes/glow/spec.ts lines 21 and 37.
- Math modes and ports: ../../../../client/render/circuit.ts lines 255 and 1498.
- Fan-in replacement: ../../../../client/ui/edits.ts line 291.
- Numeric inlet mapping: ../../../../client/render/circuit.ts lines 2165 and 2593.

## Visual assessment

The expanded drawings make routing legible but do not yet resolve the compact resting state. The Rosette study drifts into a permanent parameter strip; the Ripple attachment is oversized. Polar/Shade best shows two routes retained within one arrangement; Array/Star best shows why different signal types need different controls. The corrected Neon study distinguishes rate modulation from ordinary value mixing.

No application code or runtime changed. Research completed read-only; no implementation tests were run.

