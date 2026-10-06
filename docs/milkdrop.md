# MilkDrop

`milk.ts`, `server/presets.ts`, `server/presetWorker.ts`, `server/hlsl.ts`,
`client/render/milk.ts`, `client/render/milkAudio.ts`, `client/ui/PresetsView.tsx`.

visual[flow] draws MilkDrop presets. A `.milk` file dropped into the library is on the
wheel within ten seconds, and the rig ships able to fetch about ten thousand of them.

## Compatible means "draws what Butterchurn draws"

There is no MilkDrop spec. There is Ryan Geiss's preset authoring guide, the MilkDrop 2
source, and three players that each define the format by what they accept. The one that
runs where this does — WebGL 2 in a browser engine — is
[Butterchurn](https://github.com/jberg/butterchurn), so that is the reference: a preset is
compatible when it draws here as it draws there. Butterchurn is vendored as a dependency,
pinned at 2.6.7, and does the drawing.

## The `.milk` file is the source of truth

The library is `~/.openflow/visuals/presets/` (`OPENFLOW_VISUALS_PRESETS` moves it), any
depth of folders. What is kept is the `.milk` file as written, because that is what other
players read and what an editor will one day save.

Butterchurn draws JSON, so a preset is converted **the first time it is asked for**, in a
worker the server can terminate, and the JSON is cached in `.converted/` keyed by the
file's content and the converter's version. Nothing converts at startup; ten thousand
presets cost a directory walk. A preset that will not convert answers 422 and is not tried
again until the file changes.

The hundred `butterchurn-presets` favourites are the exception: they ship already
converted and without sources, under `@butterchurn/`. Drawable, not editable.

```sh
npm run presets:cream   # projectM's Cream of the Crop, ~9,800 presets, into the library
```

That pack is fetched to your machine at a pinned revision checked by hash, and is never in
the repository or the app. Preset authors keep their rights; projectM's own licence text,
which sits beside the pack, only *assumes* they are public domain.

## The converter is wrong in two places, and both are repaired

`milkdrop-preset-converter@0.1.2` turns EEL into JavaScript and HLSL into GLSL. Measured
over the Cream of the Crop pack, nine in ten shaders it produced did not compile, for two
reasons that have nothing to do with the presets:

- **Operator chains.** Its HLSL parser loses the operator of any binary expression whose
  left side is another — `a * 2 + b`, `a - b + c`, `a + b + c` all come out as
  `bvec(…) && bvec(…)`. That shape is in nearly every preset, because `GetBlur1(uv)` is
  `tex * scale + bias`. `server/hlsl.ts` brackets every binary expression *before*
  conversion, and expands the blur macros so they are bracketed too. Brackets never change
  what precedence already meant.
- **Hidden inputs.** It moves the shader body into a function above Butterchurn's `main`,
  where `rad`, `ang`, `hue_shader` and the comp shader's `uv_orig` — locals of `main` — are
  out of sight. They are passed in as parameters after conversion. Bare `sampler2D`
  declarations of a preset's own textures are made uniforms.

A shader that still will not compile falls back to MilkDrop's default warp or comp, which
is what MilkDrop itself does: the equations, waves and shapes still run, so the preset
still moves like itself. The first time costs a cut rather than a blend.

On a 120-preset spread across the pack, after both repairs: 117 draw, 11 of them on a
default shader; 3 are refused because the EEL half emits equations that do not parse.

## One GL context, fenced

Butterchurn draws inside the compositor's own context, into its `out` target, so the
output stage — keystone, gain, test grid, the wall — applies to a preset exactly as to a
flow. Butterchurn assumes it owns its canvas, so `client/render/milk.ts` fences it:

- its "screen" is redirected to `out` while it runs;
- it gets a vertex array of its own;
- what it leaves behind is put back — and **sampler objects** are the one that bites:
  it leaves mipmapped samplers bound on units 0–4 and 12, and a sampler outranks a
  texture's own filtering, so the output stage read `out` as black until they were unbound.

## What a preset hears

MilkDrop reads a waveform: 1024 samples a channel, from which it takes `bass`, `mid` and
`treb` and draws its waves. The bridge sends meters, not audio, so there are two sources,
chosen per machine in the MilkDrop tab and shared by every window on it:

- **An audio input** — an interface, or BlackHole carrying the set. What presets were
  written for.
- **The set** (the default). A waveform synthesised from the master meter and the beat:
  a low thump on every beat, mids and highs following the loudest track. Not the song, but
  on the beat, and never silence while the set plays.

Butterchurn's FFT bands assume 44.1 kHz; they are re-cut for the input's actual rate.

## On the wheel

A preset is named `milk:<id>` wherever a flow could be: the rotation, a song pin,
`Show.flow`. `rotation.milk` says whether the wheel turns through presets `only` (the
default), `mix`es them with flows, or leaves them `off`; `rotation.presets` narrows it to
the starred ones, and empty means all of them. **play** in the MilkDrop tab puts one up
until the wheel's next turn — so browsing during a set is safe.

## What is not built

**Editing.** The point of keeping `.milk` sources is that an editor can write them back.
The likely shape is MilkDrop's own fixed pipeline as the graph — equations as code nodes,
warp and comp as shaders this repo's compiler could emit — and that is the next piece.

**Fidelity measurement.** "Draws what Butterchurn draws" is checked by hand and by the
sweep figures above, not by a frame comparison against Butterchurn standalone. The frame
metrics in `frameMetrics.ts` are the obvious tool for it.

**The remaining shader failures** — non-constant global initialisers and `int == float`
comparisons, mostly — and the EEL converter's handful of unparseable equations.
