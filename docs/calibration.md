# Parameter response calibration

`response.ts`, `calibration.ts`, `server/calibration.ts`,
`src/ui/CalibrationView.tsx`. Internal development tooling for deciding how a
normalized inlet should feel before that decision becomes product behaviour.

## It is not the lab

The lab is a user-facing corpus of judgments about generated flows. Calibration
is temporary development work about the response of one number inlet. They use
the same useful shape — one server-side SQLite writer, frozen evidence,
versioned migrations, reproducible rooms, JSONL export — but not the same data
or interface.

```
~/.openflow/visuals/lab.sqlite3          user flow judgments
~/.openflow/visuals/calibration.sqlite3  development parameter decisions
```

The server advertises the calibration tab only when it starts with
`OPENFLOW_CALIBRATION=1`. With the flag absent there is no tab, the calibration
database is never opened, and none of its state is part of the user-facing lab.

The shortest way in is the ordinary desktop app with the flag inherited by its
server:

```sh
OPENFLOW_CALIBRATION=1 npm run visuals
```

For HMR, run the server and UI in two terminals:

```sh
OPENFLOW_CALIBRATION=1 npm run dev:visuals
npm run dev:visuals-ui
```

Press `e`, then choose **calibrate** in the console.

## What is being calibrated

A graph still stores, combines, and carries numbers as 0–1. A parameter
response is the last step at the consuming inlet:

```
held value + depth × signal
              ↓ clamp
       normalized 0–1
              ↓ response
 turn/beat, turn/radius, pixels, count, frequency…
```

Applying the response after modulation preserves free wiring: every number
outlet can still drive every number inlet. A response may live on the
`PortSpec` or in the source-controlled production registry; either way the
consumer owns it. `response.ts` evaluates the same data-defined response in
TypeScript for CPU number chains and readouts and emits it as GLSL for the
renderer. The supported primitives are linear, exponential, centered power,
and discrete steps; a new primitive needs parity tests for both halves.

The first production definitions were `lens/swirl/turn`,
`lens/kaleido/spin`, and `lens/twist/turn`. Response-set version 3 adds the 82
valid decisions in the second export: 46 of all 85 completed questions are
linear, 25 square, and 14 root, with seven deliberate maximum-reach changes.
Forty questions remain pending. The first three still say kaleidoscope spin is
square at 150% maximum reach, swirl is linear at 100%, and twist is linear at
150%.
The version-one questions keep their original ranges in `calibration.ts`, so a
new development database still reproduces the exact comparison that produced
that evidence rather than silently rebuilding history from production values.

## The parameter matrix

The active manifest contains 125 questions. It is derived from the renderer's
own node and inlet specifications, then narrowed to controls whose useful visual
range is a matter of taste: sources, fields, fractals, lights, feedback, paint,
lenses, displacement, grades, spreads, halftones, blends, and LFO rate. Each
mode gets its own target because the same word can have a different useful feel
on two pictures; `energy` on a lamp is not assumed to be `energy` on a ripple.

Exact number plumbing is deliberately absent. Math operands, a wave's phase,
positions, producer values, toggles, and a scrub position are normalized by
contract rather than by taste. Video pace also waits for a source-controlled
development clip: calibrating a decoder against whatever happens to be in one
person's media folder would not be reproducible evidence.

The **device** and **parameter** selectors open any question directly. Completed
parameters carry a checkmark, **next pending** returns to the queue, and a
completed question can be opened and judged again. A later judgment is appended
as a revision; it never overwrites the decision that came before it.

## One trial

A trial in `calibration.ts` freezes:

- a stable id and version;
- the exact node kind, mode, inlet, and fixture node being tested;
- a small flow that makes the effect legible;
- a deterministic room with transport running and no Live set required;
- three response options in their presented order; and
- the control position the trial opens at.

The historic rotation batch compares exponent one, two, and three at the same
semantic reach. Generated unipolar trials compare a root curve, linear, and a
square curve; centred trials compare linear, square, and cube. A root is the
log-like candidate that spends more travel near the low end, while square and
cube spend progressively more travel near zero or the neutral middle. Their
order differs by target and the UI calls them only A, B, and C.

Curve shape and range are separate decisions: the A/B/C buttons change shape,
while **maximum reach** scales the cap for all three. That avoids a result where
it is impossible to tell whether the curve or its range won. Until a legacy
parameter is promoted to a semantic `PRODUCTION_RESPONSES` entry, its readout
calls the cap `current range`: the accepted curve is composed with that node's
existing shader mapping during promotion.

Automatic trial version one was created against response-set version two. The
bench therefore supplies identity responses for every newly promoted legacy
parameter before it supplies the selected A/B/C candidate. That freezes the
remaining fixtures: accepting a square response for plasma energy cannot
quietly alter the picture underneath a pending grade trial.

The parameter can be scrubbed over its whole normalized range or swept slowly
there and back. The transport can run, hold, or restart without changing phase
when A/B/C is switched. The room can be heard at zero, its representative
energy, or high energy. One `Bench` and one GL context draw all three options;
the compositor's cache signature includes the response override, so switching
rebuilds the program without changing the fixture or clock.

Choosing an option records the exact response after its maximum-reach adjustment.
Rejecting all three requires a note. Slider motion is not stored: it is
ambiguous telemetry, where the chosen definition, judged room, reach, and note
are intentional evidence.

## The evidence store

`server/calibration.ts` owns `calibration.sqlite3`. Browsers send two coarse
gestures, `calibration-open` and `calibration-decide`, and receive the whole
queue state. The store contains:

- `trials`: frozen question, target, flow, room, initial value, renderer
  version, and source order;
- `options`: the three immutable response definitions and display positions;
  and
- `decisions`: choice or reject-all, adjusted response, maximum reach, room, note, and
  time.

Source controls which trial versions are active. A changed generated fixture,
question, or candidate recipe increments `AUTOMATIC_TRIAL_VERSION`; seeding a
version already in SQLite never rewrites the evidence it froze. Decisions are
append-only and the queue treats the latest revision as the active answer.
Opening and every store operation are guarded independently from the show and
from the lab.

`/calibration/export` downloads every table as versioned JSONL while the flag
is enabled. It is the handoff for analysis: review accepted curves, rejection
notes, maximum reaches, revisions, and disagreements before proposing another
batch.

## Promotion is deliberate

The calibration database never configures the renderer. It is evidence, not
product state. Locking a result means:

1. review the exported decisions;
2. add or change the accepted definition in `PRODUCTION_RESPONSES` (the compact
   `NORMALIZED_CALIBRATIONS` table owns legacy normalized mappings);
3. increment `RESPONSE_SET_VERSION`;
4. add parity and visual-contract tests;
5. add an era entry to `responseMigration.ts` for every key whose delivered
   meaning moved; and
6. recheck affected built-in and saved flows.

Keeping that step in source control prevents one developer's local database
from silently changing a show. Endpoints remain endpoints unless maximum reach
explicitly changed, and built-in flows go through the ordinary visual review
with their newly shaped middles.

## Carrying stored values across a version

A response decides what an inlet's 0–1 *means*, so changing one changes every
saved flow holding a number for it — silently, because no file changed and
nothing recompiles differently. Version 3 was promoted without this and the
result was fourteen of twenty-seven flows in a real library looking different
with nobody having touched them, which read from the outside like the compositor
having broken.

So a stored number crosses a version boundary by being **re-solved**: find the
value that, under the new response, delivers what the old one delivered.
`responseMigration.ts` owns both halves — `invertResponse` for the four
primitives, and an era table saying what each key used to deliver, in the units
its current response answers in. Only keys whose meaning actually moved need an
entry; a reshaped range in front of unchanged shader arithmetic delivered the
stored number itself, which is the identity the table falls back to. The three
version-3 entries are there because `fxKaleido`, `fxTwist` and `cSwirl` gave up
their own centring and scaling in the same commit.

Three things are worth knowing before adding an era:

- **It is not idempotent.** Solving twice compounds, so `Scheme.responses` is
  what says a carry has already happened. `merge` writes it, and a file without
  one genuinely is version 1 rather than a default standing in for a missing
  field.
- **A library can span the change.** A scheme is saved whole but authored a flow
  at a time, so flows may sit either side of a promotion with one save date
  between them. `FlowDef.responses` is how a flow says it is already current;
  `merge` consumes those and drops them so the file settles back to one stamp.
- **`EXAMPLES` is source, not a file.** It carries the current version and is
  never carried, or a fresh library would open solved backwards.

`npm run dev:responses` prints what a carry would change before it changes
anything, grouped by how each flow was placed either side of the promotion: the
lab writes down when it made a candidate, so its flows are placed exactly, and
everything else is compared against a reference copy of the same library from
before the change. A flow neither can place is named rather than guessed at.
`-- --write` then records what was placed, as `FlowDef.responses`, moving no
stored value — the carry itself still happens in `merge` on the next load. It is
the honest form of step 6.
