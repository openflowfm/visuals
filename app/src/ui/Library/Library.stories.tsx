import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { ENTRIES, row } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import type { Entry } from '../model/api';
import { FILTERS_KEY } from '../model/home';
import { searchLibrary } from '../model/librarySearch';
import { Library } from './Library';

interface HomeLibraryProps {
  /** The search box's text when it opens. */
  search?: string;
  /** What `presets` has answered; false keeps it loading. */
  loaded?: boolean;
  /** The preset playing. */
  current?: string | null;
  onLoad(e: Entry): void;
  onAdd(e: Entry): void;
}

/** The home's main pane as the story's stand-in: a column filling the canvas. */
const pane = { height: '100vh', display: 'flex', flexDirection: 'column' } as const;

/** The library as Home shows it on its main pane: the search held by the home, the "Library" heading and pane. */
function HomeLibrary({ search: start = '', loaded = true, current = null, onLoad, onAdd }: HomeLibraryProps) {
  const [search, setSearch] = useState(start);
  const entries = loaded ? ENTRIES : [];
  return (
    <main style={pane}>
      <Library
        entries={entries}
        loaded={loaded}
        search={search}
        onSearch={setSearch}
        found={searchLibrary(entries, search)}
        current={current}
        into={null}
        onLoad={onLoad}
        onAdd={onAdd}
        home={{ scope: 'library', title: 'Library', onChosen: () => {} }}
      />
    </main>
  );
}

/**
 * The home's library pane: search, the filter behind "Filter", and the grid (decision 68).
 *
 * The original sized these with its `home1440` and `home900` viewports; the pane here fills the canvas, and `Full900` holds it at 900 px wide (its narrow-window rules follow the window, so they show only in a narrow canvas).
 */
const meta = {
  title: 'open[flow]/visuals/Library/Library',
  component: HomeLibrary,
  args: { onLoad: fn(), onAdd: fn(), current: row(4).path },
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof HomeLibrary>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The whole library, one playing, the filter closed. */
export const Full: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('searchbox', { name: 'search presets' })).toHaveValue('');
    await expect((await canvas.findAllByRole('option')).length).toBeGreaterThan(12);
  },
};

/** At the home's 900 px width. */
export const Full900: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 900 }}>
        <Story />
      </div>
    ),
  ],
};

/** Filtered by search text: the ✕ to clear it, and the count of what's shown. */
export const Searched: Story = {
  args: { search: 'wormhole' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Clear the search' })).toBeVisible();
  },
};

/** The filter open on Style: the groups as tabs, a style's values with their counts. */
export const FilterOpen: Story = {
  parameters: { storage: { [FILTERS_KEY]: '1' } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'style' }));
    await expect(await canvas.findByRole('group', { name: 'style values' })).toBeVisible();
  },
};

/** Two styles picked, then the filter closed: the picked values on their line with the count, Clear and Save. */
export const Filtered: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'filter' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'style' }));
    const values = within(await canvas.findByRole('group', { name: 'style values' }));
    const buttons = await values.findAllByRole('button', { pressed: false });
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[2]);
    await userEvent.click(await canvas.findByRole('button', { name: /^filter, 2 picked$/ }));
    await expect(canvas.getByRole('button', { name: 'clear the filter' })).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: /^stop filtering by/ })).toHaveLength(2);
  },
};

/** Filtered and searched with the filter left open: both narrow the grid. */
export const FilteredOpen: Story = {
  args: { search: 'a' },
  parameters: { storage: { [FILTERS_KEY]: '1' } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'colour' }));
    const values = within(await canvas.findByRole('group', { name: 'colour values' }));
    await userEvent.click((await values.findAllByRole('button', { pressed: false }))[0]);
    await expect(await canvas.findByRole('button', { name: /^stop filtering by/ })).toBeVisible();
  },
};

/** A search that finds nothing: the centred state and the way back. */
export const NoResults: Story = {
  args: { search: 'zzqx nothing like this' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: /Nothing matches/ })).toBeVisible();
    await expect(canvas.queryByRole('listbox')).toBeNull();
  },
};

/** The inspector view's grid (decision 70), bare, its search and "Filter ▾" in a toolbar over it as Home's header holds them. */
function BareLibrary({ search: start = '', loaded = true, current = null, onLoad, onAdd }: HomeLibraryProps) {
  const [search, setSearch] = useState(start);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const entries = loaded ? ENTRIES : [];
  return (
    <main style={pane}>
      <div ref={setToolbar} data-testid="toolbar" style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 22px' }} />
      <Library
        entries={entries}
        loaded={loaded}
        search={search}
        onSearch={setSearch}
        found={searchLibrary(entries, search)}
        current={current}
        into={null}
        onLoad={onLoad}
        onAdd={onAdd}
        home={{ scope: 'library', title: 'Library', onChosen: (c) => setSelected(c.map((p) => p.row.key)), bare: true, toolbar, selected }}
      />
    </main>
  );
}

/** Bare, as the inspector view shows it: the search and Filter in the toolbar, only the grid in the pane. */
export const Bare: Story = {
  render: (args) => <BareLibrary {...args} />,
  play: async ({ canvas }) => {
    const toolbar = within(await canvas.findByTestId('toolbar'));
    await expect(await toolbar.findByRole('searchbox', { name: 'search presets' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'filter' })).toBeVisible();
    await expect((await canvas.findAllByRole('option')).length).toBeGreaterThan(12);
    await expect(canvas.queryByRole('heading', { name: 'Library' })).toBeNull();
  },
};

/** Before the presets and the index have come: the heading, and a note while it reads them. */
export const Loading: Story = {
  args: { loaded: false },
  parameters: { world: { hang: ['library_index', 'presets'] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Loading presets…')).toBeVisible();
  },
};
