import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { queryName } from './librarySearch.ts';
import * as pl from './playlists.ts';
import type { Lists, Playlist } from './playlists.ts';
import { plural } from './controls.ts';
import { isOver, listTarget, useDrag } from './drag.ts';
import { recentList, sections, type Pane } from './home.ts';
import { Popover } from './Popover.tsx';
import { say } from './words.ts';
import './sources.css';

/**
 * The home's source list (decision 67, "Music-style"): the library, the starred
 * presets and "Recently played" up top; then the playlists, with + and ⤓ beside
 * their heading; then the smart playlists. Each row opens its pane; a playlist
 * row is also a place to drop a preset, and plays or stops on a double-click or
 * from its icon. In a narrow window `SourceMenu` stands in for it.
 */

export interface SidebarProps {
  lists: Lists | null;
  /** The pane picked. */
  shown: Pane | null;
  /** How many presets: the library's, the starred ones, and a playlist's (manual: items; smart: its matches); null while unknown (show nothing). */
  counts: { library: number | null; starred: number | null; list(p: Playlist): number | null };
  onPick(pane: Pane): void;
  onLists(lists: Lists): void;
  onImport(text: string): void;
  onError(what: string): (e: unknown) => void;
}

/** Enter or space on a row, as a click. */
const onActivate = (f: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    f();
  }
};

/** What a playlist's row says to a screen reader: its name, what kind it is, how many presets (a manual one), and whether it plays. */
export function rowSays(p: Playlist, playing: boolean): string {
  const what = p.kind === 'smart' ? `smart playlist, fills itself with ${p.query ? queryName(p.query) : 'presets'}` : `playlist, ${plural(p.items.length, 'preset')}`;
  return `${p.name}, ${what}${playing ? ', playing' : ''}`;
}

/** The name a pane goes by: "Library", "Starred", or the playlist's name ("Recently played" for that one). */
export function paneName(pane: Pane | null, lists: Lists | null): string {
  if (!pane || pane.kind === 'library') return 'Library';
  if (pane.kind === 'starred') return 'Starred';
  return lists?.playlists.find((p) => p.id === pane.id)?.name ?? 'Library';
}

/** A count as a row shows it, or nothing while unknown. */
const Count = ({ n }: { n: number | null | undefined }) => (n === null || n === undefined ? null : <i aria-hidden="true">{n.toLocaleString('en-US')}</i>);

/** The library, the starred presets, the playlists and the smart playlists: each a row to open in the main pane, and a playlist a place to drop a preset. */
export function Sidebar({ lists, shown, counts, onPick, onLists, onImport, onError }: SidebarProps) {
  const drag = useDrag();
  const file = useRef<HTMLInputElement>(null);
  const playlists = lists?.playlists ?? [];
  const recent = recentList(playlists);
  const { manual } = sections(playlists);
  const smart = sections(playlists).smart.filter((p) => p !== recent);
  const deck = lists?.deck ?? pl.EMPTY_DECK;
  // Without counts (a caller that has none), a manual playlist still shows how many it holds.
  const countOf = (p: Playlist) => (counts ? counts.list(p) : p.kind === 'manual' ? p.items.length : null);

  const create = () =>
    pl.create(pl.freshName(playlists)).then((l) => {
      onLists(l);
      const made = l.playlists[l.playlists.length - 1];
      if (made) onPick({ kind: 'list', id: made.id });
    }, onError('make a playlist'));

  const fixed = (pane: { kind: 'library' } | { kind: 'starred' }, icon: string, name: string, n: number | null | undefined, title: string) => {
    const picked = shown?.kind === pane.kind;
    return (
      <li key={pane.kind} className="src-row" tabIndex={0} aria-current={picked ? 'true' : undefined} onClick={() => onPick(pane)} onKeyDown={onActivate(() => onPick(pane))} title={title}>
        <span className="src-ico" aria-hidden="true">
          <span className="src-glyph">{icon}</span>
        </span>
        <span className="src-name">{name}</span>
        <Count n={n} />
      </li>
    );
  };

  const row = (p: Playlist, icon: string) => {
    const n = playlists.indexOf(p);
    const on = deck.playlist === p.id;
    const picked = shown?.kind === 'list' && shown.id === p.id;
    const target = listTarget(p.id);
    const toggle = () => (on ? pl.act({ kind: 'unload' }) : pl.act({ kind: 'load', playlist: n, index: null })).catch(onError(on ? 'stop the playlist' : `play ${p.name}`));
    const empty = !on && p.kind === 'manual' && !p.items.length;
    return (
      <li
        key={p.id}
        className="src-row"
        tabIndex={0}
        aria-label={rowSays(p, on)}
        aria-current={picked ? 'true' : undefined}
        data-active={on ? '' : undefined}
        data-drop={p.kind === 'manual' ? target : undefined}
        data-over={isOver(drag, target) ? '' : undefined}
        data-refuses={drag && p.kind === 'smart' ? '' : undefined}
        onClick={() => onPick({ kind: 'list', id: p.id })}
        onDoubleClick={toggle}
        onKeyDown={onActivate(() => onPick({ kind: 'list', id: p.id }))}
        title={p.kind === 'smart' ? `${p.name}: fills itself with ${p.query ? queryName(p.query) : 'presets'}` : `${p.name}: drop presets here to add them`}
      >
        {/* The icon, which turns into a quiet play (or stop) button on hover and focus. */}
        <span className="src-ico" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <span className="src-glyph" aria-hidden="true">
            {icon}
          </span>
          <button
            type="button"
            className="src-play"
            aria-label={on ? `Stop ${p.name}` : `Play ${p.name}`}
            title={on ? `Stop ${p.name}` : empty ? 'Add presets to play it' : `Play ${p.name}`}
            disabled={empty}
            onClick={toggle}
          >
            {on ? '■' : '▶'}
          </button>
        </span>
        <span className="src-name">{p.name}</span>
        {/* The playlist playing: a small green dot after its name. */}
        {on && <span className="src-dot" aria-hidden="true" />}
        <Count n={countOf(p)} />
      </li>
    );
  };

  return (
    <nav className="src-list" aria-label="sources">
      <ul className="src-rows">
        {fixed({ kind: 'library' }, '▦', 'Library', counts?.library, 'Every preset: search, filter, and drag them onto a playlist')}
        {fixed({ kind: 'starred' }, '★', 'Starred', counts?.starred, 'The presets you starred')}
        {recent && row(recent, '↺')}
      </ul>
      <Section
        title="Playlists"
        tools={
          <>
            <Button tone="quiet" onPress={create} label="new playlist" title="Make a new, empty playlist">
              +
            </Button>
            <Button tone="quiet" onPress={() => file.current?.click()} label="add from a file" title="Add from a file: a playlist someone saved">
              ⤓
            </Button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) f.text().then(onImport, onError('read that file'));
              }}
            />
          </>
        }
      >
        {manual.length ? manual.map((p) => row(p, '♪')) : <li className="src-empty">None yet: + makes one.</li>}
      </Section>
      <Section title="Smart playlists">{smart.length ? smart.map((p) => row(p, '✦')) : <li className="src-empty">Filter the library, then {say('save query')}.</li>}</Section>
    </nav>
  );
}

function Section({ title, tools, children }: { title: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="src-section">
      {/* The tools sit beside the heading, not in it: a heading's name is just its title. */}
      <div className="src-head">
        <h2 className="src-title">{title}</h2>
        {tools}
      </div>
      <ul className="src-rows">{children}</ul>
    </section>
  );
}

/** The narrow window's (< 900 px) stand-in for the sidebar: a "<name of the pane shown> ▾" button at the top of the main pane opening the same list as a menu; picking a row closes it. */
export function SourceMenu(props: SidebarProps) {
  return (
    <Popover className="src-menu" name="sources" label={`${paneName(props.shown, props.lists)} ▾`} title="Library, starred, playlists: pick what to show">
      {(close) => (
        <Sidebar
          {...props}
          onPick={(pane) => {
            close();
            props.onPick(pane);
          }}
        />
      )}
    </Popover>
  );
}
