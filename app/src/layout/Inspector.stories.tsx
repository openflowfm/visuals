import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { LibraryChange, LibraryData, LibraryRow, Look } from '../api.ts';
import { strip, type Pane } from '../home.ts';
import { prepare, prepareRow } from '../librarySearch.ts';
import type { Playlist } from '../playlists.ts';
import { PlaylistHead } from '../PlaylistHead.tsx';
import { Header } from '../views.tsx';
import { DATA, LISTS, PLAYLISTS, RECENT, ROWS, row, WARM_UP } from '../stories/fixtures.ts';
import { tileName } from '../PresetTile.tsx';
import index from '../../src-tauri/presets/starter/cream-of-the-crop/index.json';
import { HomeLayout, InspectorPanel, INSPECTOR_LABEL } from './HomeLayout.tsx';
import { InsetSidebar } from './InsetSidebar.tsx';
import { Hero } from './Hero.tsx';
import { Section } from './Section.tsx';
import { TransportBar } from './TransportBar.tsx';
import { Icon } from './icons.tsx';
import { NOW, SECTIONS, SIDEBAR } from './fixtures.ts';
import { Inspector, type InspectorProps } from './inspector/Inspector.tsx';
import { dotsOf, H, nearest, W } from './inspector/field.ts';

/** What the inspector starts on: the preset playing, one picked, several picked together, the source playing (its playlist), or nothing playing. */
type Start = 'playing' | 'picked' | 'several' | 'source' | 'nothing';

/** The one picked in the stories: starred and tagged, unlike the preset playing. */
const PICKED: LibraryRow = row(21);
/** Several picked together: the one picked (starred, tagged "peak") and eight around it. */
const SEVERAL: LibraryRow[] = [18, 19, 20, 21, 22, 23, 24, 25, 26].map(row);

const storyRows = prepare(ROWS, DATA);

/** The playlist playing as the inspector shows a source: its head as a card, its lists kept as they change. */
function SourceHead() {
  const [lists, setLists] = useState(LISTS);
  const list = lists.playlists.find((p) => p.id === WARM_UP.id)!;
  const { tiles, total } = strip(list, { rows: storyRows, played: RECENT, playing: null });
  return <PlaylistHead variant="inspector" list={list} lists={lists} tiles={tiles} total={total} onLists={setLists} onDeleted={() => {}} onError={() => () => {}} />;
}
/** The names the panel's heading shows. */
const PLAYING_NAME = tileName(NOW.preset!.title, NOW.preset!.path);
const PICKED_NAME = tileName(PICKED.title, PICKED.path);

/** The starter set: the stories' slice of the library (the 63 rows the sections, the preset playing and the one picked come from) and every other preset its index has drawn. */
const STARTER: LibraryRow[] = [
  ...ROWS,
  ...(index.rows as { path: string; style: string; sub_style: string | null; authors: string[]; title: string; look: Look | null }[])
    .filter((r) => !ROWS.some((s) => s.key.endsWith(`/${r.path}`)))
    .map((r) => ({
      key: `field/${r.path}`,
      path: `field/${r.path}`,
      hash: '',
      style: r.style,
      sub_style: r.sub_style,
      authors: r.authors,
      title: r.title,
      thumbnail: null,
      look: r.look,
      starter: true,
    })),
];

/** The full pack's size in made-up presets, spread as the pack's measures are: most slow and dim, a long tail of fast and bright, a tenth grey. */
const PACK = 9_800;
function synthetic(n: number): LibraryRow[] {
  let s = 0x2545f491;
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: n }, (_, i) => {
    const speed = 8 * rand() ** 2.2;
    const brightness = Math.min(1, ((rand() + rand() + rand()) / 3) ** 1.4);
    const look: Look = {
      hues: rand() < 0.1 ? [] : [Math.floor(rand() * 360), Math.floor(rand() * 360)],
      brightness,
      speed,
      intensity: 60 * rand() ** 2,
      brightness_level: brightness < 0.33 ? 'low' : brightness < 0.66 ? 'mid' : 'high',
      speed_level: speed < 1 ? 'low' : speed < 4 ? 'mid' : 'high',
      intensity_level: 'mid',
    };
    return { key: `pack/${i}`, path: `pack/Synthetic ${i}.milk`, hash: '', style: 'Synthetic', sub_style: null, authors: ['nobody'], title: `Synthetic ${i}`, thumbnail: null, look, starter: false };
  });
}
const FULL_PACK: LibraryRow[] = [...STARTER, ...synthetic(PACK - STARTER.length)];

/** `change` made to the user's data, as Rust's `library_set` would. */
function applied(data: LibraryData, keys: string[], change: LibraryChange): LibraryData {
  const presets = { ...data.presets };
  for (const key of keys) {
    const was = presets[key] ?? {};
    let tags = was.tags ?? [];
    if (change.add_tags) tags = [...tags, ...change.add_tags.filter((t) => !tags.includes(t))];
    if (change.remove_tags) tags = tags.filter((t) => !change.remove_tags!.includes(t));
    presets[key] = { ...was, star: change.star ?? was.star, hidden: change.hidden ?? was.hidden, tags };
  }
  return { ...data, presets };
}

/** What a Home holds for the inspector: the user's data, the playlists and the one picked, so its actions, picks and "back" work. */
function useInspector(start: Start, library: readonly LibraryRow[]) {
  const [data, setData] = useState(DATA);
  const [playlists, setPlaylists] = useState<Playlist[]>(PLAYLISTS);
  const [picked, setPicked] = useState<LibraryRow | null>(start === 'picked' ? PICKED : null);
  const playing = start === 'nothing' ? null : NOW.preset;
  // A source shows while no preset is: the Home passes no subject then.
  const shown = start === 'source' ? picked : (picked ?? playing);
  const props: InspectorProps = {
    subject: shown ? prepareRow(shown, data.presets[shown.key]) : null,
    chosen: start === 'several' ? SEVERAL.map((r) => prepareRow(r, data.presets[r.key])) : undefined,
    source: start === 'source' ? <SourceHead /> : undefined,
    playing: playing?.key ?? null,
    from: playing ? NOW.from : '',
    playlists,
    library,
    mine: data.presets,
    onSet: (keys, change) => setData((d) => applied(d, keys, change)),
    onAddTo: (id, paths) =>
      setPlaylists((ls) => ls.map((l) => (l.id === id ? { ...l, items: [...l.items, ...paths.map((path) => ({ path, name: path, group: '', missing: false, hash: null }))] } : l))),
    onPick: setPicked,
    onBack: () => setPicked(null),
    onPlay: () => setPicked(null),
    onEdit: () => {},
  };
  return { props, pick: setPicked, playing, data };
}

/** The inspector on its own, in its panel at its width; laid over (`overlay`), it has a ✕ and Esc, and closed it leaves a button to open it again. */
function Alone({ start, library, error, overlay }: { start: Start; library: readonly LibraryRow[]; error?: string; overlay?: boolean }) {
  const { props } = useInspector(start, library);
  const [open, setOpen] = useState(true);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Show the inspector
      </button>
    );
  return (
    <div className="app home lay" data-inspector-alone="" style={{ height: 860 }}>
      <InspectorPanel>
        <Inspector {...props} error={error ?? null} onClose={overlay ? () => setOpen(false) : undefined} />
      </InspectorPanel>
    </div>
  );
}

/** The whole window with the inspector open beside the main column and the transport bar under it: a tile's click picks it, the header's button opens and closes the panel. */
function InWindow({ start, library }: { start: Start; library: readonly LibraryRow[] }) {
  const { props, pick, playing, data } = useInspector(start, library);
  const [selected, setSelected] = useState<Pane | null>({ kind: 'list', id: WARM_UP.id });
  const [open, setOpen] = useState(true);
  const starred = Object.entries(data.presets)
    .filter(([, p]) => p.star)
    .map(([k]) => k);
  // A window of 1440×900 whatever the runner's viewport, so the column and the panel lay out as they would there.
  return (
    <div style={{ width: 1440, height: 900 }}>
      <HomeLayout
        lights
        sidebar={<InsetSidebar sections={SIDEBAR} selected={selected} onSelect={setSelected} collapsed={[]} onToggle={() => {}} />}
        header={
          <Header view="home" onChange={() => {}}>
            <span className="vf-fill" />
            <button
              type="button"
              className="insp-toggle"
              aria-label="show the preset's details"
              aria-pressed={open}
              title={open ? 'Hide the details' : 'Show the details'}
              onClick={() => setOpen((o) => !o)}
            >
              <Icon name="sidebar" />
            </button>
            <Button tone="quiet" onPress={() => {}} label="settings" title="Settings: sound, presets, the output, quality and more">
              ⚙
            </Button>
          </Header>
        }
        hero={
          <Hero
            preset={playing}
            picture={playing ? NOW.picture : null}
            playing={NOW.playing}
            from={playing ? NOW.from : ''}
            starred={!!playing && starred.includes(playing.key)}
            onPlayPause={() => {}}
            onNext={() => {}}
            onStar={() => {}}
            onAdd={() => {}}
          />
        }
        bar={<TransportBar playing={NOW.playing} onPlayPause={() => {}} onStep={() => {}} stepIn=" in the playlist" position={{ elapsed: 12, length: 30 }} onAudioError={() => {}} />}
        inspector={open ? <Inspector {...props} /> : undefined}
      >
        {SECTIONS.map((s) => (
          <Section key={s.title} title={s.title} rows={s.rows} playing={playing?.path ?? null} starred={starred} onPlay={pick} />
        ))}
      </HomeLayout>
    </div>
  );
}

/** Which story: alone or in the window, what it starts on, how big the library is, and (alone) something failed or laid over with a close. */
interface Args {
  start: Start;
  window: boolean;
  pack: boolean;
  error?: string;
  overlay?: boolean;
}
function Story({ start, window, pack, error, overlay }: Args) {
  const library = pack ? FULL_PACK : STARTER;
  return window ? <InWindow start={start} library={library} /> : <Alone start={start} library={library} error={error} overlay={overlay} />;
}

/**
 * The inspector ("Scope"), the macOS layout's inset panel down the window's
 * right (macOS 26's inspector), mirroring the sidebar: the preset placed among
 * the library, a field of every preset by speed and brightness with this one
 * lit, then its character (style, authors, the measures in words, its
 * colours) and the actions on it. It is about the preset playing, or one
 * picked (a dot in the field, or a tile in a section) until "back".
 */
const meta = {
  title: 'Layout/Inspector',
  component: Story,
  args: { start: 'playing', window: false, pack: false },
  argTypes: { start: { control: 'inline-radio', options: ['playing', 'picked', 'several', 'source', 'nothing'] } },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Story>;
export default meta;
type S = StoryObj<typeof meta>;

/** The panel's landmark, named. */
const panelOf = (canvas: ReturnType<typeof within>) => canvas.getByRole('complementary', { name: INSPECTOR_LABEL });
/** The field, the one control the dots are reached by. */
const fieldOf = (panel: HTMLElement) => within(panel).getByRole('listbox', { name: 'The library by speed and brightness' });

/** Where a row's dot is on screen, and the row the field takes a click there for (the nearest dot to it, which may be another on the same spot). */
function dotOnScreen(panel: HTMLElement, library: readonly LibraryRow[], key: string) {
  const svg = panel.querySelector<SVGSVGElement>('.insp-field-scope')!;
  const r = svg.getBoundingClientRect();
  const dots = dotsOf(library);
  const d = dots.find((x) => x.row.key === key)!;
  const clientX = r.left + (d.x / W) * r.width;
  const clientY = r.top + (d.y / H) * r.height;
  const hit = dots[nearest(dots, d.x, d.y, 6)].row;
  return { svg, at: { clientX, clientY }, row: hit, name: tileName(hit.title, hit.path) };
}

/** Now playing: the name and where it plays from, the actions (star toggling), and a tag added. */
export const NowPlaying: S = {
  name: 'Now playing',
  play: async ({ canvasElement }) => {
    const panel = within(panelOf(within(canvasElement)));
    await expect(panel.getByRole('heading', { name: PLAYING_NAME })).toBeVisible();
    await expect(panel.getByText(NOW.from)).toBeVisible();
    await expect(panel.queryByRole('button', { name: 'back to now playing' })).toBeNull();
    const star = panel.getByRole('button', { name: 'star' });
    const was = star.getAttribute('aria-pressed');
    await userEvent.click(star);
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true'));
    await userEvent.click(star);
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', was ?? 'false'));
    const never = panel.getByRole('button', { name: 'never play' });
    await userEvent.click(never);
    await waitFor(() => expect(never).toHaveAttribute('aria-pressed', 'true'));
    await expect(panel.getByRole('button', { name: 'add to a playlist' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'open in the editor' })).toBeVisible();
    await userEvent.click(panel.getByRole('button', { name: '+ Tag' }));
    await userEvent.type(panel.getByRole('textbox', { name: 'add tags' }), 'opener{Enter}');
    await waitFor(() => expect(panel.getByRole('group', { name: 'my tags' })).toHaveTextContent('opener'));
  },
};

/** A dot picked in the field: hover names it, a click shows it with the way back, and the dot playing stays marked; back returns. */
export const PickedInTheField: S = {
  name: 'Picked in the field',
  play: async ({ canvasElement }) => {
    const panelEl = panelOf(within(canvasElement));
    const panel = within(panelEl);
    const { svg, at, row: hit, name } = dotOnScreen(panelEl, STARTER, PICKED.key);
    fireEvent.pointerMove(svg, at);
    await waitFor(() => expect(panelEl.querySelector('.insp-field-tip')).toHaveTextContent(name));
    fireEvent.pointerDown(svg, at);
    fireEvent.click(svg, at);
    await waitFor(() => expect(panel.getByRole('heading', { name })).toBeVisible());
    await expect(panel.getByText(/^Picked/)).toBeVisible();
    await expect(hit.key).not.toBe(NOW.preset!.key);
    // The preset playing keeps its mark while another is shown.
    await expect(panelEl.querySelector('.insp-field-playing')).not.toBeNull();
    await userEvent.click(panel.getByRole('button', { name: 'back to now playing' }));
    await waitFor(() => expect(panel.getByRole('heading', { name: PLAYING_NAME })).toBeVisible());
    await expect(panelEl.querySelector('.insp-field-playing')).toBeNull();
  },
};

/** One picked (as a section's tile would): its name, its star, and back goes to the preset playing. */
export const Picked: S = {
  name: 'Picked',
  args: { start: 'picked' },
  play: async ({ canvasElement }) => {
    const panel = within(panelOf(within(canvasElement)));
    await expect(panel.getByRole('heading', { name: PICKED_NAME })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'star' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('group', { name: 'my tags' })).toHaveTextContent('peak');
    await expect(panel.getByRole('button', { name: 'play it' })).toBeVisible();
    await userEvent.click(panel.getByRole('button', { name: 'back to now playing' }));
    await waitFor(() => expect(panel.getByRole('heading', { name: PLAYING_NAME })).toBeVisible());
    await expect(panel.queryByRole('button', { name: 'back to now playing' })).toBeNull();
  },
};

/** Nothing playing: the field still draws the library, the words say so, and no action shows. */
export const NothingPlaying: S = {
  name: 'Nothing playing',
  args: { start: 'nothing' },
  play: async ({ canvasElement }) => {
    const panelEl = panelOf(within(canvasElement));
    const panel = within(panelEl);
    await expect(panel.getByText(/nothing playing/i)).toBeVisible();
    await expect(panel.queryByRole('button', { name: 'star' })).toBeNull();
    await expect(fieldOf(panelEl)).toBeVisible();
  },
};

/** Several picked in a section together: their first pictures, "9 selected", and star, add, never play and tags over all of them. */
export const Several: S = {
  name: 'Several picked',
  args: { start: 'several' },
  play: async ({ canvasElement }) => {
    const panelEl = panelOf(within(canvasElement));
    const panel = within(panelEl);
    await expect(panel.getByRole('heading', { name: `${SEVERAL.length} selected` })).toBeVisible();
    await expect(panel.queryByRole('listbox')).toBeNull();
    await expect(panel.queryByRole('button', { name: 'play it' })).toBeNull();
    const star = panel.getByRole('button', { name: 'star' });
    await userEvent.click(star);
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(star);
    await waitFor(() => expect(star).toHaveAttribute('aria-pressed', 'false'));
    await userEvent.click(panel.getByRole('button', { name: '+ Tag' }));
    await userEvent.type(panel.getByRole('textbox', { name: 'add tags' }), 'set{Enter}');
    // On all of them: no count beside it.
    await waitFor(() => expect(panel.getByRole('button', { name: 'take the tag set off' })).toBeInTheDocument());
    await expect(panel.getByRole('button', { name: 'add to a playlist' })).toBeVisible();
  },
};

/** No preset picked, the playlist playing as the source: its head as a card, with how it plays and more (no playback controls). */
export const Source: S = {
  name: 'The source',
  args: { start: 'source' },
  play: async ({ canvasElement }) => {
    const panelEl = panelOf(within(canvasElement));
    const panel = within(panelEl);
    await expect(panel.getByRole('heading', { level: 2, name: WARM_UP.name })).toBeVisible();
    // No playback controls on the card: shuffle is in how it plays.
    await expect(panel.queryByRole('button', { name: /Stop/ })).toBeNull();
    await expect(panel.queryByRole('button', { name: 'Shuffle' })).toBeNull();
    await expect(panel.queryByRole('listbox')).toBeNull();
    await userEvent.click(panel.getByRole('button', { name: 'more' }));
    await expect(panel.getByRole('menu', { name: 'more' })).toBeVisible();
  },
};

/** Something failed (a change that didn't stick): one line under the rest. */
export const Failed: S = {
  name: 'Something failed',
  args: { error: 'Couldn’t keep the star: the library file is read-only' },
  play: async ({ canvasElement }) => {
    const panel = within(panelOf(within(canvasElement)));
    await expect(panel.getByRole('alert')).toHaveTextContent('read-only');
  },
};

/** Laid over the window (a narrow one): a ✕ closes it, and so does Esc. */
export const LaidOver: S = {
  name: 'Laid over',
  args: { overlay: true, start: 'picked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(panelOf(canvas)).getByRole('button', { name: 'close info' }));
    await waitFor(() => expect(canvas.queryByRole('complementary', { name: INSPECTOR_LABEL })).toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'Show the inspector' }));
    await waitFor(() => expect(panelOf(canvas)).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('complementary', { name: INSPECTOR_LABEL })).toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'Show the inspector' }));
    await waitFor(() => expect(panelOf(canvas)).toBeVisible());
  },
};

/** The full pack's ~9,800 presets in the field: a dozen paths, not a node per preset, and still operable from the keyboard. */
export const FullPack: S = {
  name: 'The full pack',
  args: { pack: true },
  play: async ({ canvasElement }) => {
    const panelEl = panelOf(within(canvasElement));
    const panel = within(panelEl);
    const svg = panelEl.querySelector('.insp-field-scope')!;
    await expect(svg.querySelectorAll('.insp-field-dots path').length).toBeLessThanOrEqual(13);
    await expect(svg.querySelectorAll('*').length).toBeLessThan(60);
    // From the keyboard: Tab reaches the field, its cursor starts on the preset playing, the arrows move it, Enter shows the one under it.
    const field = fieldOf(panelEl);
    field.focus();
    await waitFor(() => expect(panel.getByRole('option', { name: /playing$/ })).toHaveAttribute('aria-selected', 'true'));
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowUp}');
    const option = panel.getByRole('option');
    await expect(option).not.toHaveAccessibleName(/playing$/);
    await expect(field).toHaveAttribute('aria-activedescendant', option.id);
    const name = option.textContent!.split(', by ')[0];
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(panel.getByRole('heading', { name })).toBeVisible());
    await userEvent.click(panel.getByRole('button', { name: 'back to now playing' }));
    await waitFor(() => expect(panel.getByRole('heading', { name: PLAYING_NAME })).toBeVisible());
  },
};

/** The composed window at 1440×900: the inspector open beside the main column, the transport bar under it; a tile picked shows in the panel, back returns, and the header's button closes it. */
export const InTheWindow: S = {
  name: 'In the window',
  args: { window: true },
  globals: { viewport: { value: 'home1440', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('main')).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'transport' })).toBeVisible();
    const panel = panelOf(canvas);
    await expect(within(panel).getByRole('heading', { name: PLAYING_NAME })).toBeVisible();
    // The Now Playing hero stays on top of the main column with the inspector open.
    const hero = canvas.getByRole('region', { name: 'now playing' });
    await expect(hero).toBeVisible();
    await expect(within(hero).getByRole('heading', { name: PLAYING_NAME })).toBeVisible();
    // The main column narrows beside the panel: they don't overlap.
    await expect(canvas.getByRole('main').getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().left + 0.5);
    const tile = within(canvas.getByRole('region', { name: 'Hypnotic' })).getAllByRole('button')[0];
    const name = tile.getAttribute('aria-label')!;
    await userEvent.click(tile);
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'back to now playing' })).toBeVisible());
    await expect(within(panel).getByRole('heading', { name: name.split(' — ')[0] })).toBeVisible();
    await userEvent.click(within(panel).getByRole('button', { name: 'back to now playing' }));
    await waitFor(() => expect(within(panel).getByRole('heading', { name: PLAYING_NAME })).toBeVisible());
    const toggle = canvas.getByRole('button', { name: "show the preset's details" });
    await userEvent.click(toggle);
    await waitFor(() => expect(canvas.queryByRole('complementary', { name: INSPECTOR_LABEL })).toBeNull());
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(panelOf(canvas)).toBeVisible());
    // Back to the top of the column (the tile's click scrolled it): the hero and the inspector side by side.
    hero.scrollIntoView({ block: 'start' });
    await expect(hero).toBeVisible();
  },
};
