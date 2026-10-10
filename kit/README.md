# kit

Exports the symbols of a Sketch UI kit (Apple's macOS 27 kit) as PNGs, drawn
by Sketch itself through `sketchtool`, so the page's own controls can be built
against the kit and checked beside it. It is the first step of turning the kit
into Storybook stories: export the kit's components as a reference, write our
components and stories, compare.

Needs Sketch installed (`sketchtool` ships inside `Sketch.app`; it is free to
use without a licence, which only plugins need).

```sh
cd kit && npm ci
npm run export -- "/path/to/Apple macOS 27 UI Kit" "Toggles - Switches/Light/Content Area/" "Disclosure Buttons/"
```

The kit can be the `.sketch` file or the folder it unpacks to (`document.json`,
`pages/`…); a folder is zipped into `out/kit.sketch` first, as sketchtool reads
only `.sketch` files. Symbol names are paths (`component / appearance / context
/ size / state`), so a prefix picks a family, an appearance or a single symbol.
Each symbol lands as `out/<name path>@2x.png`, the exact picture on a
transparent background with its shadows, and `out/<name path>.svg`, the
outlines and layout to start from (Sketch's smooth corners come out as exact
curves, but blend modes, glass and SF Pro's weights are lost, and text needs SF
Pro installed). `out/sheet.html` lays them all out on their appearance's window
background (white, or `#1e1e1e` for dark). `--formats png` or `--formats svg`
exports just one.

## Tokens

```sh
npm run tokens -- "/path/to/Apple macOS 27 UI Kit"
```

writes [`tokens.css`](tokens.css) from the kit's shared styles, and
`out/tokens.html` showing every token in light and dark:

- **Colours** from the swatches, with AppKit's names where the kit uses them:
  `--mac-label`, `--mac-secondary-label`, `--mac-fill`, `--mac-blue`,
  `--mac-separator`, `--mac-window-background`… The vibrant ones
  (`--mac-vibrant-*`) are drawn with `--mac-vibrant-blend` (plus darker in
  light, plus lighter in dark; WebKit, the app's webview, has both).
- **Type** from the text styles, as `font` shorthands: `--mac-font-body`,
  `--mac-font-headline-emphasized`, `--mac-font-caption1-tight`… on the system
  font, which in WebKit is SF Pro with its own tracking and optical sizes.
- **Layer styles** by the kit's path: `-bg` (the fills composited into one
  colour, blend modes included), `-blend`, `-ring` (borders as box-shadow),
  `-shadow` and `-backdrop` (background blurs; glass only roughly).

Light values sit on `:root`; dark ones apply under `prefers-color-scheme:
dark`, or under `[data-appearance='dark']`. `tokens.css` is generated: change
`src/tokens.ts` and run it again rather than editing it. It holds values only
(colours, sizes, type settings, which Apple also publishes in the Human
Interface Guidelines), so it is committed.

**Nothing from the kit goes in the repo.** Apple's design resources licence
doesn't allow redistributing the kit, its fonts, or pictures made from it, and
this repo is public. Keep the kit outside the repo and the output in `kit/out/`
(ignored by git). Only this code, and the CSS and measurements we write
ourselves (and `tokens.css`, below), are committed.
