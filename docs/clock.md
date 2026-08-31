# The clock

`server/link.ts`, `client/state/useShow.ts`, `tools/build-link.ts`.

## Link says *when*; the bridge says *what*

The split is the load-bearing decision in this module, and neither half can answer the
other's question.

| | answers | how good it is |
|---|---|---|
| **Ableton Link** | tempo, and a continuous beat position shared across machines | measured at **0.023 beats** worst-case disagreement between peers, ~0.005 typical |
| **the bridge** | which song, scene, clip, track; how loud; whether Live is rolling | coarse-grained, event-driven, no idea what time it is |

Link has never heard of a clip. And the bridge's `songPosition` is quantised to sixteenths
and only crosses the wire on a change, which is nowhere near enough to drive a shader. So
the renderer takes its time from one and its content from the other.

## Three things about Link that look like bugs

**A peer joining a session that is already playing is not told so.** Link shares start/stop
*transitions*, not the standing state. Start the visuals server while Live is already
rolling and Link's `isPlaying()` stays false until the next stop or start. This is why
`Show.playing` is answered from the bridge's `playState` and never from Link — the two
sources exist partly to cover each other, and this is the case where it matters.

**Link's beat is an absolute session timeline with no bar 1.** It started whenever the
first peer in the session did, so connecting to a Live that has been open all afternoon
reads beat 3480. That is not the song's bar and never will be. The *phase* — position
within the quantum — is the part that is shared, exact and meaningful, so it is the part
the panel shows and the part the shaders use.

It is also why the rotation counts bars from a **one** the server holds rather than from
Link's zero, and why that one comes off `phase` rather than off a rounded beat.

**And why pressing play is not the same event as starting.** With a session up Live arms the
transport and waits for the next bar line so every machine starts together, but its transport
flag goes true at the press — up to a whole bar early. Anything that wants the moment the
music began has to wait for the phase to drop, exactly as Live does. See
[the wheel](wheel.md).

**There is no private session.** Link is every machine on the local network at once. A peer
that can set the tempo can yank the tempo of every machine at the show, including the one
playing the set. So `link.ts` has no method to set anything: it exposes `sample()` and
`stop()`, and visuals follow. The same rule governs the [harness](harness.md), and it was
learnt the direct way — an early two-peer test set the tempo to 120 and a Live on the
network followed it.

## Why the browser extrapolates instead of being told

The server pushes an **anchor** ten times a second: a tempo, one beat position, and the
`Date.now()` it was sampled at. The browser free-runs a local clock at that tempo and
corrects toward each new anchor by a fraction of the error.

The two obvious alternatives are both worse. Pushing the beat *position* at 10 Hz and
drawing it steps visibly — at 132 bpm a tenth of a second is a fifth of a beat. Pushing it
at 60 Hz puts the network inside the render loop, so every late packet is a stutter.

The correction has two parts and both are needed:

- **Free-running at the tempo** is what makes the steady-state error zero. Easing toward
  the anchor *without* it settles at a constant lag — the correction only ever supplies a
  fraction of the error, so it comes to rest where that fraction equals one frame of
  travel, which at 132 bpm is about a tenth of a second permanently behind the music.
- **Easing the remainder** at 15% a frame is the same bargain a parameter readback makes:
  the true value wins, but it does not get to yank.

Past half a beat the correction snaps instead, because that is a discontinuity rather than
drift — the transport jumped, it is the first anchor, or the tab was in the background.

**Backgrounded tabs freeze `requestAnimationFrame` entirely** in Chrome, not merely throttle
it, so a hidden renderer stops drawing and its measured fps reads 0. That is honest rather
than broken, and the snap is what makes the picture correct again on the first frame after
it comes back.

### A message the browser does not know is not a show

`useShow.ts` reads the anchor off a chain of `kind` checks, and that chain used to **fall
through** to treating whatever arrived as a full `Show`. So a wall tab left open across a
server that had gained a message kind read `message.tempo` as `undefined` — a NaN clock, a
throw per frame in `drawSet`, and a React unmount to a blank page, from a version skew of
one field.

The last branch names `show` explicitly now, and anything else is logged once per kind and
ignored: a skewed wall keeps drawing the last show it was sent, which is the right answer,
because the show it is drawing is still true. The `JSON.parse` above it is wrapped for the
same reason.

## The native addon, and its three repairs

`@ktamas77/abletonlink` vendors Ableton's own C++ Link library and wraps it with
node-addon-api. That is the right dependency to have — implementing Link's protocol from
the reverse-engineering notes would be a liability on stage — but it does not compile as
shipped, so `npm install` runs it with `--ignore-scripts` and `tools/build-link.ts` repairs
and builds it.

**`binding.gyp` pins C++14** and the node-addon-api it resolves against needs C++17. The
symptom is "constexpr if is a C++17 extension" plus six template errors.

**node-gyp writes node-addon-api's absolute include path into the Makefile unquoted**, so
any space in the checkout's path splits it into two arguments and clang reports half of it
as a missing directory. This repo lives under `The Source`. The fix is to rewrite the
include as a path relative to the `.gyp` file, which has no absolute prefix to split.

**`binding.gyp` defines macOS at the target level as well as in its macOS condition.** On
Linux that leaves both the macOS and Linux platform defines set, Darwin wins in Link's
platform header, and the build asks Ubuntu for `mach/mach_time.h`. The repair removes the
unconditional define and leaves platform selection to the existing macOS, Windows and
Linux conditions.

All three repairs are idempotent, and the build is skipped when the binary is newer than
the gyp.

**Everything except the clock runs without it.** A missing addon logs a warning and
`openLink` returns a peer that answers from the wall clock at a fixed tempo, so the show
still runs — the failure mode a stage rig wants, and the same instinct as the bridge
preferring an empty snapshot to a broken one.
