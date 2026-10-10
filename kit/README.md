# kit

Draws the symbols of a Sketch UI kit (Apple's macOS 27 kit) into PNGs, so the
page's own controls can be built against the kit and checked beside it. It is
the first step of turning the kit into Storybook stories: read the kit, draw
its components as a reference, write our components and stories, compare.

```sh
cd kit && npm ci && npx playwright install chromium
npm run render -- "/path/to/Apple macOS 27 UI Kit" "Toggles - Switches/Light/Content Area/" --out out
```

The kit is an unpacked `.sketch` file: `document.json`, `meta.json`, `pages/`,
`images/` and `fonts/`. Symbol names are paths (`component / appearance /
context / size / state`), and a prefix picks a family, an appearance or a single
symbol. Output goes to `out/<name path>.png`, with `out/sheet.png` and
`sheet.html` laying them all out.

**Nothing from the kit goes in the repo.** Apple's design resources licence
doesn't allow redistributing the kit, its fonts, or pictures made from it, and
this repo is public. Keep the kit outside the repo and the output in `kit/out/`
(ignored by git). Only this code, and the CSS and measurements we write
ourselves, are committed.

## How it draws

- `scene.ts` reads the document and turns one symbol into a plain tree:
  instances expanded into their masters (overrides of text and nested symbols
  applied), outlines as SVG paths (`geometry.ts`: Sketch's smooth corners
  follow Figma's published squircle), paints, shadows and blurs, and each text
  run's face (`fonts.ts`: the embedded variable SF Pro's named instances, and
  its `trak` table, which Core Text applies to every size and the browser
  doesn't).
- `draw.ts` runs in headless Chromium and composites the tree on canvases.
  Groups pass blending through, as in Sketch, so plus darker and plus lighter
  reach the layers under a group; the symbol as a whole blends on its own and
  then sits on the window background (white, or `#1e1e1e` for dark).
  Plus darker isn't in canvas and is done per pixel.
- `render.ts` is the command.

## What it doesn't draw exactly

Each run lists these with a count:

- **Glass** (Sketch's Liquid Glass blur) is drawn as a plain background blur:
  no refraction, highlights or chromatic aberration. Shadows on a layer that
  draws nothing are skipped, as glass layers carry them for their lighting.
- Instances whose size differs from their master are scaled, not resized by
  their constraints.
- Corner radii on individual path points, shape groups' boolean operations,
  image fills, fills on text, and corner styles other than rounded and smooth.

The reference is Apple's own pictures of the controls; the renderer is checked
against those by eye.
