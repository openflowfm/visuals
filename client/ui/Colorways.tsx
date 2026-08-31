import { COLOR_ROLES, MOODS, MOOD_ABOUT, paletteOf, type Mood, type Scheme } from '../../protocol.ts';
import { newSeed, palette, seeded } from '../../randomize.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';

/**
 * The colours a song can be assigned, and how to author one.
 *
 * A song owns its colours — that is the topmost thing the cascade lets a song
 * decide, and the thing most responsible for two songs not looking alike. So the
 * palette has to be editable somewhere, and the honest place is next to the set
 * rather than inside one song: a colourway is shared, and editing it from a song
 * that happens to use it hides how many others just changed with it.
 *
 * Renaming carries every reference with it. A rename that quietly orphaned the
 * songs pointing at the old name would turn every one of them black — which is
 * the failure this whole level exists to prevent.
 *
 * Five swatches, labelled with the role each one fills — see `COLOR_ROLES`. The
 * row used to grow and shrink with `+` and `−`; the length is the vocabulary
 * now, because a `colorway` node has an outlet per role and a cord cannot point
 * at a position that a palette edit removed.
 *
 * **And a light beside the dice** — see `MOODS`. The generator knows a great
 * deal about how to build a palette and nothing about which one you want
 * tonight, which is the gap that made the dice feel like a slot machine: getting
 * the cold one you had in mind meant pressing until it came up. The mood is the
 * person's half of that decision, and it lives on the row rather than in a
 * dialog because it is a property of *this colourway* — it is what this row gets
 * re-dealt as, every time either dice is pressed, until somebody changes it.
 */
export function Colorways({
  scheme,
  edit,
  current,
}: {
  scheme: Scheme;
  edit(next: Scheme): void;
  /** The one the show is using, so it can be marked. */
  current: string | null;
}) {
  const ways = Object.keys(scheme.colorways);

  const setWay = (name: string, colors: string[] | null) => {
    const colorways = { ...scheme.colorways };
    const moods = { ...scheme.moods };
    if (colors === null) {
      delete colorways[name];
      // The moods map is the one overlay in a scheme, so it is the one thing
      // that can be left holding a key for a row that no longer exists. `merge`
      // prunes an orphan at the door, but leaving one here would mean a deleted
      // colourway quietly haunting a new one of the same name until the next
      // reload — which is action at a distance with a delay on it.
      delete moods[name];
    } else colorways[name] = colors;
    edit({ ...scheme, colorways, moods });
  };

  const setMood = (name: string, mood: Mood) => {
    const moods = { ...scheme.moods };
    // `any` is the absence of an instruction rather than an instruction, so it
    // is stored by not being stored. Keeps a hand-edited scheme file readable:
    // what is in `moods` is what somebody actually asked for.
    if (mood === 'any') delete moods[name];
    else moods[name] = mood;
    edit({ ...scheme, moods });
  };

  const renameWay = (from: string, to: string) => {
    const name = to.trim();
    if (!name || name === from || scheme.colorways[name]) return;
    const colorways: Record<string, string[]> = {};
    for (const [key, colors] of Object.entries(scheme.colorways)) {
      colorways[key === from ? name : key] = colors;
    }
    const songs = Object.fromEntries(
      Object.entries(scheme.songs).map(([song, spec]) => [
        song,
        spec.colorway === from ? { ...spec, colorway: name } : spec,
      ]),
    );
    const defaults =
      scheme.defaults.colorway === from ? { ...scheme.defaults, colorway: name } : scheme.defaults;
    // The mood is keyed by name like everything else here, so it is carried by
    // the rename for the same reason the song pins are: a row that silently lost
    // its light on being renamed would look exactly like the dice having got
    // worse.
    const moods = Object.fromEntries(
      Object.entries(scheme.moods).map(([key, mood]) => [key === from ? name : key, mood]),
    );
    edit({ ...scheme, colorways, moods, songs, defaults });
  };

  /**
   * New colours for this one colourway, leaving every other alone.
   *
   * The randomise button deals the whole library, which is the wrong size of
   * gesture most of the time: by the second evening three of the four are
   * settled and the fourth is the one being fished for. Dealt from a fresh seed
   * and not written down, because this is a hand edit like dragging a swatch —
   * the scheme's `seed` is what the last *library* was dealt from and a
   * per-row deal is not that.
   */
  const deal = (name: string) => setWay(name, palette(seeded(newSeed()), scheme.moods[name] ?? 'any'));

  const add = () => {
    let name = 'new';
    for (let n = 2; scheme.colorways[name]; n++) name = `new ${n}`;
    // A harmony rather than five greys, because a new colourway that draws
    // nothing distinguishable teaches that the roles do not matter. Loud base,
    // its opposite loud, a neighbour, an accent, and a tint of the base.
    setWay(name, ['#ff5a1f', '#ffb703', '#00c4ff', '#ff2d55', '#ffe3c2']);
  };

  return (
    <div className="ways">
      {ways.map((name) => (
        <div key={name} className="way" data-on={name === current ? '' : undefined}>
          <input
            className="wayname"
            defaultValue={name}
            key={`${name}-name`}
            spellCheck={false}
            aria-label={`${name} name`}
            onBlur={(e) => renameWay(name, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span className="swatches">
            {paletteOf(scheme.colorways[name]).map((hex, i) => (
              <label key={COLOR_ROLES[i]} className="role">
                <input
                  type="color"
                  value={hex}
                  aria-label={`${name} ${COLOR_ROLES[i]}`}
                  onChange={(e) => {
                    const colors = paletteOf(scheme.colorways[name]);
                    colors[i] = e.target.value;
                    setWay(name, colors);
                  }}
                />
                <span>{COLOR_ROLES[i]}</span>
              </label>
            ))}
          </span>
          <label className="waymood">
            <select
              value={scheme.moods[name] ?? 'any'}
              aria-label={`${name} mood`}
              title={MOOD_ABOUT[scheme.moods[name] ?? 'any']}
              onChange={(e) => setMood(name, e.target.value as Mood)}
            >
              {MOODS.map((mood) => (
                <option key={mood} value={mood} title={MOOD_ABOUT[mood]}>
                  {mood}
                </option>
              ))}
            </select>
          </label>
          <Button
            tone="quiet"
            label={`Deal new colours for ${name}`}
            title="new colours for this colourway alone"
            onPress={() => deal(name)}
          >
            {'\u2684'}
          </Button>
          <Button
            tone="danger"
            label={`Delete ${name}`}
            disabled={ways.length <= 1 || name === scheme.defaults.colorway}
            title={
              name === scheme.defaults.colorway
                ? 'the fallback colourway cannot be deleted'
                : undefined
            }
            onPress={() => setWay(name, null)}
          >
            ×
          </Button>
        </div>
      ))}
      <Button onPress={add}>+ colourway</Button>
    </div>
  );
}
