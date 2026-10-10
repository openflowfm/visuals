import { useState, type ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { LibraryChange, LibraryData, LibraryRow, Look } from '../api.ts';
import type { Pane } from '../home.ts';
import { prepareRow } from '../librarySearch.ts';
import type { Playlist } from '../playlists.ts';
import { Header } from '../views.tsx';
import { DATA, PLAYLISTS, row } from '../stories/fixtures.ts';
import { tileName } from '../PresetTile.tsx';
import index from '../../src-tauri/presets/starter/cream-of-the-crop/index.json';
import { HomeLayout, InspectorPanel, INSPECTOR_LABEL } from './HomeLayout.tsx';
import { InsetSidebar } from './InsetSidebar.tsx';
import { Hero } from './Hero.tsx';
import { Section } from './Section.tsx';
import { Icon } from './icons.tsx';
import { NOW, SECTIONS, SIDEBAR } from './fixtures.ts';
import type { InspectorProps } from './inspector/model.ts';
import { InspectorMarks } from './inspector/Marks.tsx';
import { InspectorEditorial } from './inspector/Editorial.tsx';
import { InspectorScope } from './inspector/Scope.tsx';

/** The three options, by the letter the owner picks from. */
const OPTIONS = {
  a: { name: 'A, Marks', Option: InspectorMarks },
  b: { name: 'B, Editorial', Option: InspectorEditorial },
  c: { name: 'C, Scope', Option: InspectorScope },
} satisfies Record<string, { name: string; Option: ComponentType<InspectorProps> }>;
type Letter = keyof typeof OPTIONS;

/** What the inspector starts on: the preset playing, a tile picked in a section, or nothing playing. */
type Start = 'playing' | 'picked' | 'nothing';

/** The tile picked in the stories: one starred and tagged, unlike the preset playing. */
const PICKED: LibraryRow = row(21);
/** The names the panel's heading shows. */
const PLAYING_NAME = tileName(NOW.preset!.title, NOW.preset!.path);
const PICKED_NAME = tileName(PICKED.title, PICKED.path);

/** Every preset the starter set's index has drawn, for an option that places the preset among the rest (the stories' slice has only 63). */
const FIELD: LibraryRow[] = (index.rows as { path: string; style: string; sub_style: string | null; authors: string[]; title: string; look: Look | null }[]).map((r) => ({
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
}));

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

/** An option holding the user's data, the playlists and what it's about, so its actions and "back" work. */
function useInspector(start: Start) {
  const [data, setData] = useState(DATA);
  const [playlists, setPlaylists] = useState<Playlist[]>(PLAYLISTS);
  const [picked, setPicked] = useState<LibraryRow | null>(start === 'picked' ? PICKED : null);
  const playing = start === 'nothing' ? null : NOW.preset;
  const shown = picked ?? playing;
  const props: InspectorProps = {
    subject: shown ? prepareRow(shown, data.presets[shown.key]) : null,
    picked: picked !== null,
    picture: picked ? picked.thumbnail : playing ? NOW.picture : null,
    from: picked || !playing ? '' : NOW.from,
    playlists,
    library: FIELD,
    onSet: (keys, change) => setData((d) => applied(d, keys, change)),
    onAddTo: (id, paths) => setPlaylists((ls) => ls.map((l) => (l.id === id ? { ...l, items: [...l.items, ...paths.map((path) => ({ path, name: path, group: '', missing: false, hash: null }))] } : l))),
    onBack: () => setPicked(null),
    onPlay: () => setPicked(null),
    onEdit: () => {},
  };
  return { props, pick: setPicked, playing, data };
}

/** One option on its own, in the inspector's panel at its width. */
function Alone({ option, start }: { option: Letter; start: Start }) {
  const { Option } = OPTIONS[option];
  const { props } = useInspector(start);
  return (
    <div className="app home lay" data-inspector-alone="" style={{ height: 860 }}>
      <InspectorPanel>
        <Option {...props} />
      </InspectorPanel>
    </div>
  );
}

/** The whole window with the option open beside the main column: a tile's click picks it, the header's button opens and closes the panel. */
function InWindow({ option, start }: { option: Letter; start: Start }) {
  const { Option } = OPTIONS[option];
  const { props, pick, playing, data } = useInspector(start);
  const [selected, setSelected] = useState<Pane | null>({ kind: 'library' });
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
          <button type="button" className="insp-toggle" aria-label="show the preset's details" aria-pressed={open} title={open ? 'Hide the details' : 'Show the details'} onClick={() => setOpen((o) => !o)}>
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
      inspector={open ? <Option {...props} /> : undefined}
    >
      {SECTIONS.map((s) => (
        <Section key={s.title} title={s.title} rows={s.rows} playing={playing?.path ?? null} starred={starred} onPlay={pick} />
      ))}
    </HomeLayout>
    </div>
  );
}

/** Which story: an option, alone or in the window, and what it starts on. */
interface Args {
  option: Letter;
  start: Start;
  window: boolean;
}
function Story({ option, start, window }: Args) {
  return window ? <InWindow option={option} start={start} /> : <Alone option={option} start={start} />;
}

/**
 * Three options for the inspector, the macOS layout's inset panel down the
 * window's right (macOS 26's inspector), mirroring the sidebar: the preset's
 * character (its style, authors, colours, brightness, speed, intensity, from
 * the preset index) and the actions on it. It is about the preset playing, or
 * a tile picked in a section until "back". For the owner to pick from:
 *
 * - **A, Marks**: few labels, more marks: the colours a strip, brightness,
 *   speed and intensity quiet scales, the words set large.
 * - **B, Editorial**: like a magazine page: a big title, a line written from
 *   the analysis, generous space, sections told apart by type.
 * - **C, Scope**: the preset among the library: a field of every preset by
 *   speed and brightness, this one lit, so its character reads as where it sits.
 */
const meta = {
  title: 'Layout/Inspector options',
  component: Story,
  args: { option: 'a', start: 'playing', window: false },
  argTypes: {
    option: { control: 'inline-radio', options: Object.keys(OPTIONS) },
    start: { control: 'inline-radio', options: ['playing', 'picked', 'nothing'] },
  },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Story>;
export default meta;
type S = StoryObj<typeof meta>;

/** The panel's landmark, named. */
const panelOf = (canvas: ReturnType<typeof within>) => canvas.getByRole('complementary', { name: INSPECTOR_LABEL });

/** Now playing: the preset's name, and the actions, star toggling. */
const checkPlaying: S['play'] = async ({ canvasElement }) => {
  const panel = within(panelOf(within(canvasElement)));
  await expect(panel.getByRole('heading', { name: PLAYING_NAME })).toBeVisible();
  await expect(panel.queryByRole('button', { name: 'back to now playing' })).toBeNull();
  const star = panel.getByRole('button', { name: 'star' });
  const was = star.getAttribute('aria-pressed');
  await userEvent.click(star);
  await waitFor(() => expect(star).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true'));
  const never = panel.getByRole('button', { name: 'never play' });
  await userEvent.click(never);
  await waitFor(() => expect(never).toHaveAttribute('aria-pressed', 'true'));
  await expect(panel.getByRole('button', { name: 'add to a playlist' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'open in the editor' })).toBeVisible();
  // A tag added shows in my tags.
  await userEvent.click(panel.getByRole('button', { name: 'add a tag' }));
  await userEvent.type(panel.getByRole('textbox', { name: 'add tags' }), 'opener{Enter}');
  await waitFor(() => expect(panel.getByRole('group', { name: 'my tags' })).toHaveTextContent('opener'));
};

/** A tile picked: its name, and back goes to the preset playing. */
const checkPicked: S['play'] = async ({ canvasElement }) => {
  const panel = within(panelOf(within(canvasElement)));
  await expect(panel.getByRole('heading', { name: PICKED_NAME })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'star' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('group', { name: 'my tags' })).toHaveTextContent('peak');
  await userEvent.click(panel.getByRole('button', { name: 'back to now playing' }));
  await waitFor(() => expect(panel.getByRole('heading', { name: PLAYING_NAME })).toBeVisible());
  await expect(panel.queryByRole('button', { name: 'back to now playing' })).toBeNull();
};

/** Nothing playing: it says so, and no action shows. */
const checkNothing: S['play'] = async ({ canvasElement }) => {
  const panel = within(panelOf(within(canvasElement)));
  await expect(panel.getByText(/nothing playing/i)).toBeVisible();
  await expect(panel.queryByRole('button', { name: 'star' })).toBeNull();
};

/** In the window: a tile picked shows in the panel, back returns, and the header's button closes it. */
const checkWindow: S['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole('main')).toBeVisible();
  const panel = panelOf(canvas);
  await expect(within(panel).getByRole('heading', { name: PLAYING_NAME })).toBeVisible();
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
};

const story = (option: Letter, start: Start, window = false): S => ({
  name: `${OPTIONS[option].name}: ${window ? 'in the window' : start === 'playing' ? 'now playing' : start === 'picked' ? 'a tile picked' : 'nothing playing'}`,
  args: { option, start, window },
  ...(window ? { globals: { viewport: { value: 'home1440', isRotated: false } } } : {}),
  play: window ? checkWindow : start === 'playing' ? checkPlaying : start === 'picked' ? checkPicked : checkNothing,
});

export const MarksPlaying = story('a', 'playing');
export const MarksPicked = story('a', 'picked');
export const MarksNothing = story('a', 'nothing');
export const MarksInWindow = story('a', 'playing', true);

export const EditorialPlaying = story('b', 'playing');
export const EditorialPicked = story('b', 'picked');
export const EditorialNothing = story('b', 'nothing');
export const EditorialInWindow = story('b', 'playing', true);

export const ScopePlaying = story('c', 'playing');
export const ScopePicked = story('c', 'picked');
export const ScopeNothing = story('c', 'nothing');
export const ScopeInWindow = story('c', 'playing', true);
