/**
 * How a MilkDrop preset is named wherever a flow could be.
 *
 * A rotation, a song pin and `Show.flow` all carry one string that says what is
 * up. A preset rides the same string with a `milk:` prefix rather than getting
 * a field of its own, so everything that turns, pins or reports a flow handles a
 * preset without learning a second noun — and a flow id can never collide with
 * a preset path, because no flow id has a colon in it. See `docs/milkdrop.md`.
 */
export const MILK = 'milk:';

export const isMilk = (id: string | null | undefined): id is string =>
  typeof id === 'string' && id.startsWith(MILK);

/** `Geiss/Swirl.milk` → `milk:Geiss/Swirl.milk`. */
export const milkId = (preset: string): string => MILK + preset;

/** The preset a `milk:` id names. */
export const presetOf = (id: string): string => id.slice(MILK.length);

/** Where the server answers with the converted preset. Each segment escaped, the slashes kept. */
export const presetUrl = (preset: string): string =>
  `/presets/${preset.split('/').map(encodeURIComponent).join('/')}`;

/** The favourites that ship already converted, under one prefix no file path can take. */
export const BUNDLED = '@butterchurn/';
