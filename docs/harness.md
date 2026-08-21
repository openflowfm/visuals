# The harness

`tools/fake-live.ts`. A Session Bridge that isn't one, so this module can be worked on with
no Ableton, no device and no set.

```sh
npm run dev:fake-live                                          # :17801
BSV_BRIDGE_WS=ws://127.0.0.1:17801/ws npm run dev:visuals
```

It speaks enough of the real protocol to be indistinguishable from the device as far as
`server/bridge.ts` is concerned: it answers `snapshot` from a set it invents, accepts the
watch requests, and then behaves like a band — five named tracks, eight scenes with roles
in their names, a scene every eight bars, meters at the 30 Hz the device really pushes, and
one fader riding so opacity is visibly a live value rather than a constant.

Two details are there to exercise cases that are easy to get wrong. **The grid has holes**,
so some layers have nothing playing and must draw nothing. And **each track's meter runs on
its own subdivision**, so the layers don't all pulse together and a per-layer reaction is
visibly per-layer.

Port 17801 and not 17800, deliberately: the real device may well be running, and a harness
that fought it for a port would be a confusing five minutes every time.

## It is not a Link peer, and that is a safety rule

**Link has no private session.** It is every machine on the local network at once. A
harness that set the tempo to prove the clock works would set the tempo of any Live on the
LAN, including the one someone is working in. That is not hypothetical — an early two-peer
test in this repo set the tempo to 120 and a Live on the network followed it.

The clock needs no fake anyway, which is what makes the rule cheap to keep:

- **Link's timeline advances with zero peers.** The server's own peer runs at its default
  tempo and the renderer is driven correctly with nothing else on the network at all.
- **A real Live with Link enabled simply takes over** as the authority when it appears, and
  that is the case worth testing for real.

So the harness fakes the *set* and never the *clock*. If you ever need a second peer, make
it a follower, and think hard before giving anything in this repo the ability to set a
tempo.

## What it cannot tell you

The harness proves the wire, the derivation and the render path. Three things still need a
real machine:

- **Frame rate**, which needs a visible window — Chrome freezes `requestAnimationFrame`
  outright in a background tab, so an automated screenshot reports 0 fps however well it is
  running.
- **Link against Live**, including whether the tempo and the transport actually follow.
- **Whether a real set draws well** — the track-name table in [`hints.ts`](../hints.ts) is a
  guess about how people name things until it meets a set nobody wrote it for.

## It answers `clipNotes` and `clipStatus` too

Both were added for `chart/`, and both are the difference between a client that can be
worked on without Ableton and one that only *looks* implemented. `clipStatus` drives the
loop wheels and the chord chart's timeline; without it a chart connects, shows the song, and
draws neither — indistinguishable from broken.

The note fixture is shaped like a set rather than like a tune: a drum track whose notes have
to be excluded, a bass supplying roots, keys arpeggiating and pads holding the same
progression, and a melody over the top. Between them they exercise every branch of
[`core/src/chords.ts`](../../core/docs/chords.md), including the two that matter most —
that merging drums in misspells every chord, and that a melody's passing tones must not
rename one.

Loop lengths differ per track deliberately. A two-bar bass under a four-bar chord cycle is
exactly the case a chart has to time against the **longest** loop, and equal loops
everywhere would never exercise it.
