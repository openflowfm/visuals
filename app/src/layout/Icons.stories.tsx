import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { ICON_NAMES, Icon } from './icons.tsx';

const SIZES = [12, 16, 20, 24] as const;

/** Home's surfaces, as their tokens name them, and the two colours an icon takes on them. */
const SURFACES = ['--surface-0', '--surface-1', '--surface-2'] as const;
const COLOURS = [
  { name: 'text', value: 'var(--fg)' },
  { name: 'caption', value: 'var(--caption)' },
] as const;

/** Every icon at every size, in one colour on one surface: a row per name. */
function Sheet({ surface, colour }: { surface: string; colour: string }) {
  return (
    <div style={{ background: `var(${surface})`, color: colour, padding: '12px 16px', borderRadius: 10 }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {ICON_NAMES.map((name) => (
            <tr key={name}>
              <td style={{ padding: '4px 16px 4px 0', fontSize: 12, color: 'var(--caption)', whiteSpace: 'nowrap' }}>{name}</td>
              {SIZES.map((size) => (
                <td key={size} style={{ padding: '4px 10px', textAlign: 'center', lineHeight: 0 }}>
                  <Icon name={name} size={size} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The set on each surface, in the text and the caption colours. */
function IconSet() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 16, background: '#262628' }}>
      {SURFACES.map((surface) =>
        COLOURS.map((c) => (
          <figure key={`${surface} ${c.name}`} style={{ margin: 0 }} data-sheet={`${surface} ${c.name}`}>
            <figcaption style={{ fontSize: 12, color: 'var(--caption)', marginBottom: 6 }}>
              {c.name} on {surface}
            </figcaption>
            <Sheet surface={surface} colour={c.value} />
          </figure>
        )),
      )}
    </div>
  );
}

/** Beside the words they stand for, as a row or a button would put them. */
function InUse() {
  const row = (name: (typeof ICON_NAMES)[number], text: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg)', height: 28 }}>
      <span style={{ color: 'var(--caption)', display: 'inline-flex' }}>
        <Icon name={name} />
      </span>
      {text}
    </div>
  );
  return (
    <div style={{ background: 'var(--surface-0)', padding: 16, width: 240 }}>
      {row('library', 'Library')}
      {row('star', 'Starred')}
      {row('recent', 'Recently played')}
      {row('playlist', 'Late set')}
      {row('smart-playlist', 'Hypnotic, fast')}
      <div style={{ display: 'flex', gap: 14, marginTop: 12, color: 'var(--fg)' }}>
        <Icon name="previous" size={20} label="previous" />
        <Icon name="play" size={20} label="play" />
        <Icon name="pause" size={20} label="pause" />
        <Icon name="next" size={20} label="next" />
        <Icon name="stop" size={20} label="stop" />
      </div>
    </div>
  );
}

/**
 * The layout's icons (`icons.tsx`): drawn for this app on a 16-unit grid, one
 * round stroke, solid only for the transport keys. Shown at 12, 16, 20 and
 * 24 px on Home's surfaces, in the text and the caption colours.
 */
const meta = {
  title: 'Layout/Icons',
  component: IconSet,
} satisfies Meta<typeof IconSet>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The whole set, at each size, on each surface and in each colour. */
export const AllIcons: Story = {
  name: 'All icons',
  play: async ({ canvasElement }) => {
    for (const name of ICON_NAMES) {
      const drawn = canvasElement.querySelectorAll<SVGSVGElement>(`svg[data-icon="${name}"]`);
      await expect(drawn.length).toBe(SIZES.length * SURFACES.length * COLOURS.length);
      for (const size of SIZES) {
        const one = [...drawn].find((s) => s.getAttribute('width') === String(size));
        await expect(one, `${name} at ${size}`).toBeDefined();
        await expect(one!.getAttribute('height')).toBe(String(size));
        await expect(one!.getBoundingClientRect().width).toBe(size);
        await expect(one!.childElementCount).toBeGreaterThan(0);
        // Without a label it is hidden from screen readers.
        await expect(one).toHaveAttribute('aria-hidden', 'true');
      }
    }
  },
};

/** In a sidebar's rows and a transport, where labelled ones are named images. */
export const InContext: Story = {
  name: 'In use',
  render: () => <InUse />,
  play: async ({ canvas }) => {
    for (const name of ['previous', 'play', 'pause', 'next', 'stop']) {
      const img = canvas.getByRole('img', { name });
      await expect(img.tagName.toLowerCase()).toBe('svg');
      await expect(img).not.toHaveAttribute('aria-hidden');
    }
    // The rows' icons are named by their text, so screen readers skip them.
    await expect(canvas.queryByRole('img', { name: /library/i })).toBeNull();
  },
};
