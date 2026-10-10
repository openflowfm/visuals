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
Each export lands at `out/<name path>@2x.png` on a transparent background, with
its shadows; `out/sheet.html` lays them all out on their appearance's window
background (white, or `#1e1e1e` for dark).

**Nothing from the kit goes in the repo.** Apple's design resources licence
doesn't allow redistributing the kit, its fonts, or pictures made from it, and
this repo is public. Keep the kit outside the repo and the output in `kit/out/`
(ignored by git). Only this code, and the CSS and measurements we write
ourselves, are committed.
