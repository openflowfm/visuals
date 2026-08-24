import type { Scheme } from '../../protocol.ts';
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
    setWay(name, ['#ffffff', '#888888']);
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
            {scheme.colorways[name].map((hex, i) => (
              <input
                key={i}
                type="color"
                value={hex}
                aria-label={`${name} colour ${i + 1}`}
                onChange={(e) => {
                  const colors = [...scheme.colorways[name]];
                  colors[i] = e.target.value;
                  setWay(name, colors);
                }}
              />
            ))}
          </span>
          <Button
            tone="quiet"
            label={`Add a colour to ${name}`}
            onPress={() => setWay(name, [...scheme.colorways[name], '#ffffff'])}
          >
            +
          </Button>
          <Button
            tone="quiet"
            label={`Remove the last colour from ${name}`}
            disabled={scheme.colorways[name].length <= 1}
            onPress={() => setWay(name, scheme.colorways[name].slice(0, -1))}
          >
            {String.fromCharCode(8722)}
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
