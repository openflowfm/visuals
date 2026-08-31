import { COLOR_ROLES, paletteOf, type Scheme } from '../../protocol.ts';
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
    if (colors === null) delete colorways[name];
    else colorways[name] = colors;
    edit({ ...scheme, colorways });
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
    edit({ ...scheme, colorways, songs, defaults });
  };

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
