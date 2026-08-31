import { useCallback, useEffect, useMemo, useState } from 'react';
import { hierarchy, tree } from 'd3-hierarchy';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type {
  LabArchiveState,
  LabBookmarkSubmission,
  LabDevelopRequest,
  LabLineageNode,
  Scheme,
} from '../../protocol.ts';
import { promoteCandidate, promotedCandidateId } from '../../lab.ts';
import type { Clock } from '../state/useShow.ts';
import { useTransport } from '../state/useTransport.ts';
import { KEYS } from '../state/useRoom.ts';
import { Bench } from './Preview.tsx';
import { CANDIDATE_FLOW, parkedScheme, stagedShow } from './stage.ts';

/**
 * The forest: Train's home, and the thing you act on rather than read.
 *
 * Three panes, and the middle one shows **one family at a time**. Every family
 * stacked in one scroll was a wall: the thing you actually do here is follow a
 * single lineage, and drawing forty of them at once made that the hardest thing
 * to do. So the left pane lists the families by their root — the topmost
 * ancestor, which is the name anybody would look for — and the canvas draws the
 * one that is chosen.
 *
 * It grows **downward**, which is how a family tree reads. Left-to-right was
 * chosen when every family shared one canvas and generation was the axis that
 * had to run unbounded; with one tree in a pane of its own, the unbounded axis
 * is the one you scroll anyway, and a parent above its children is what the
 * word "descendant" already means.
 *
 * The canvas is React Flow rather than hand-rolled SVG. Pan, zoom, fit-to-view,
 * a minimap and keyboard focus are all things a map of several hundred works
 * needs and none of them are worth writing again — this is a **read-only map**,
 * so nothing drags, nothing connects, and the library is doing navigation
 * rather than editing. `widgets`' own `Graph` stays the circuit editor's,
 * because that canvas has the opposite requirements: the host owns positions,
 * a refused cord must cost nothing, and there are twenty nodes rather than two
 * thousand.
 */

const NODE_WIDTH = 150;
const NODE_HEIGHT = 54;

/** Bookmarks first, then evidence of having been chosen. Never a hidden score. */
const interest = (node: LabLineageNode): number =>
  (node.bookmarked ? 500 : 0) +
  node.batches * 60 +
  node.finals * 40 +
  node.chosen * 12 +
  ((node.chosen + 1) / (node.appearances + 2)) * 20;

/** One family as a tree. The head is synthetic, so several roots still lay out. */
interface Branch {
  node: LabLineageNode | null;
  children: Branch[];
  /** Descendants folded away under this one, and zero when it is open. */
  hidden: number;
}

/**
 * Which way a family grows.
 *
 * Downward reads like a family tree and puts the unbounded axis where a pane
 * scrolls anyway. Left-to-right puts generation on the horizontal, which is
 * what a long refinement chain wants — 243 deep and eight wide is a column of
 * specks growing downward and a legible run across. Neither is right for both
 * shapes, so it is a toggle rather than a decision.
 */
type Growth = 'down' | 'right';

export interface Family {
  id: string;
  /** The topmost ancestor, which is what the sidebar lists a family by. */
  root: LabLineageNode;
  members: LabLineageNode[];
  generations: number;
  bookmarked: number;
  batches: number;
  /** Works in this family that have led a settled batch. */
  won: number;
  interest: number;
}

export function familiesOf(nodes: readonly LabLineageNode[]): Family[] {
  const grouped = new Map<string, LabLineageNode[]>();
  for (const node of nodes) grouped.set(node.cohort, [...(grouped.get(node.cohort) ?? []), node]);
  const families: Family[] = [];
  for (const [id, members] of grouped) {
    const present = new Set(members.map((node) => node.id));
    const roots = members.filter((node) => !node.parentId || !present.has(node.parentId));
    const root = roots.sort((a, b) => a.generation - b.generation || interest(b) - interest(a))[0];
    if (!root) continue;
    families.push({
      id,
      root,
      members,
      generations: Math.max(...members.map((node) => node.generation)) + 1,
      bookmarked: members.filter((node) => node.bookmarked).length,
      won: members.filter((node) => node.wins > 0).length,
      batches: members.reduce((total, node) => total + node.batches, 0),
      interest: Math.max(...members.map(interest)),
    });
  }
  return families.sort((a, b) => b.interest - a.interest);
}

/**
 * One family, laid out. Reingold-Tilford, unswapped.
 *
 * Folding a branch away is a fact about the *layout* and not about the corpus:
 * the works under it are still there, still counted, still reachable by opening
 * it again. It exists because the largest family here is 435 works and reading
 * one lineage should not mean drawing the four hundred somebody is not looking
 * at — d3 lays out what it is given, so the cheapest way to leave them out of
 * the picture is to not hand them over.
 */
function layoutFamily(
  family: Family,
  growth: Growth,
  collapsed: ReadonlySet<string>,
): { nodes: Node[]; edges: Edge[] } {
  const present = new Set(family.members.map((node) => node.id));
  const childrenOf = new Map<string, LabLineageNode[]>();
  for (const node of family.members) {
    if (!node.parentId || !present.has(node.parentId)) continue;
    childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node]);
  }
  const roots = family.members.filter((node) => !node.parentId || !present.has(node.parentId));

  const under = (node: LabLineageNode): number => {
    let total = 0;
    const queue = [...(childrenOf.get(node.id) ?? [])];
    while (queue.length > 0) {
      const each = queue.pop()!;
      total += 1;
      queue.push(...(childrenOf.get(each.id) ?? []));
    }
    return total;
  };

  const branch = (node: LabLineageNode): Branch => {
    const shut = collapsed.has(node.id);
    return {
      node,
      hidden: shut ? under(node) : 0,
      children: shut
        ? []
        : (childrenOf.get(node.id) ?? []).sort((a, b) => interest(b) - interest(a)).map(branch),
    };
  };
  const head: Branch = { node: null, children: roots.map(branch), hidden: 0 };

  // d3 lays out breadth first and depth second, whichever way the picture ends
  // up pointing; growing rightward is that same layout read with the axes
  // swapped, which is why the node size swaps with it.
  const down = growth === 'down';
  const breadth = down ? NODE_WIDTH + 26 : NODE_HEIGHT + 26;
  const depth = down ? NODE_HEIGHT + 46 : NODE_WIDTH + 46;

  const laid = tree<Branch>()
    .nodeSize([breadth, depth])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(
    hierarchy<Branch>(head, (datum) => datum.children),
  );

  const points = laid.descendants().filter((point) => point.data.node !== null);
  const nodes: Node[] = points.map((point) => ({
    id: point.data.node!.id,
    type: 'work',
    // The synthetic head sits one rank before the real roots, so the whole
    // tree comes back by one rank along whichever axis depth runs on.
    position: down
      ? { x: point.x, y: point.y - depth }
      : { x: point.y - depth, y: point.x },
    data: { work: point.data.node!, growth, hidden: point.data.hidden },
    draggable: false,
  }));
  const drawn = new Set(points.map((point) => point.data.node!.id));
  const edges: Edge[] = family.members.flatMap((node) =>
    node.parentId && drawn.has(node.id) && drawn.has(node.parentId)
      ? [
          {
            id: `${node.parentId}:${node.id}`,
            source: node.parentId,
            target: node.id,
            type: 'smoothstep',
          },
        ]
      : [],
  );
  return { nodes, edges };
}

const operationName = (operation: string): string =>
  operation === 'random'
    ? 'new family'
    : operation === 'explore:leap'
      ? 'leap'
      : operation.replace(/^mutate:/, '');

function WorkNode({ data, selected }: NodeProps) {
  const { work, growth, hidden, fold } = data as {
    work: LabLineageNode;
    growth: Growth;
    hidden: number;
    fold(id: string): void;
  };
  const down = growth === 'down';
  return (
    <div
      className="forest-work"
      data-selected={selected ? '' : undefined}
      data-bookmarked={work.bookmarked ? '' : undefined}
      data-developed={work.batches > 0 ? '' : undefined}
      data-won={work.wins > 0 ? '' : undefined}
      data-folded={hidden > 0 ? '' : undefined}
    >
      <Handle
        type="target"
        position={down ? Position.Top : Position.Left}
        isConnectable={false}
      />
      <strong>{work.name}</strong>
      <span className="forest-work-op">{operationName(work.operation)}</span>
      <span className="forest-work-facts">
        <i>g{work.generation}</i>
        {work.appearances > 0 && (
          <i>
            {work.chosen}/{work.appearances}
          </i>
        )}
        {work.batches > 0 && <i data-on="">{work.batches}×dev</i>}
        {/*
          Won and bookmarked are deliberately two marks. One is the corpus
          saying this came first in a field of its siblings; the other is a
          person saying come back here. A single mark for both would make the
          forest unable to show the interesting case, which is either without
          the other.
        */}
        {work.wins > 0 && <i data-won="">{work.wins > 1 ? `${work.wins}×` : ''}won</i>}
        {work.bookmarked && <i data-mark="">★</i>}
        {work.children > 0 && (
          <button
            type="button"
            className="forest-fold"
            aria-pressed={hidden > 0}
            title={hidden > 0 ? `show ${hidden} below` : 'fold this branch away'}
            // The card is the selection target, so the fold must not also be
            // one: without this, hiding a branch would drag the inspector onto
            // whatever it was hung from.
            onClick={(event) => {
              event.stopPropagation();
              fold(work.id);
            }}
          >
            {hidden > 0 ? `+${hidden}` : '−'}
          </button>
        )}
      </span>
      <Handle
        type="source"
        position={down ? Position.Bottom : Position.Right}
        isConnectable={false}
      />
    </div>
  );
}

const NODE_TYPES = { work: WorkNode };

function FamilyCanvas({
  family,
  growth,
  collapsed,
  selectedId,
  onSelect,
  onFold,
}: {
  family: Family;
  growth: Growth;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  onSelect(id: string): void;
  onFold(id: string): void;
}) {
  const { nodes, edges } = useMemo(
    () => layoutFamily(family, growth, collapsed),
    [family, growth, collapsed],
  );
  const flow = useReactFlow();

  // The fold handler is attached here rather than in the layout so that
  // changing it cannot invalidate a tree of several hundred positions.
  const painted = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedId,
        data: { ...node.data, fold: onFold },
      })),
    [nodes, selectedId, onFold],
  );

  // A different family is a different picture, not a pan of the same one, and
  // so is the same family turned on its side.
  useEffect(() => {
    const at = requestAnimationFrame(() => flow.fitView({ duration: 260, padding: 0.18 }));
    return () => cancelAnimationFrame(at);
  }, [family.id, growth, flow]);

  return (
    <ReactFlow
      nodes={painted}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_event, node) => onSelect(node.id)}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      minZoom={0.08}
      maxZoom={1.8}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      onlyRenderVisibleElements
    >
      <Background gap={22} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={3} />
    </ReactFlow>
  );
}

export function ForestView(props: {
  clock: Clock;
  scheme: Scheme;
  archive: LabArchiveState | null;
  notice: string | null;
  batchSizes: readonly number[];
  open(): void;
  select(candidateId: string): void;
  bookmark(decision: LabBookmarkSubmission): void;
  deal(request: LabDevelopRequest): void;
  edit(next: Scheme): void;
}) {
  return (
    <ReactFlowProvider>
      <Forest {...props} />
    </ReactFlowProvider>
  );
}

function Forest({
  clock,
  scheme,
  archive,
  notice,
  batchSizes,
  open,
  select,
  bookmark,
  deal,
  edit,
}: {
  clock: Clock;
  scheme: Scheme;
  archive: LabArchiveState | null;
  notice: string | null;
  batchSizes: readonly number[];
  open(): void;
  select(candidateId: string): void;
  bookmark(decision: LabBookmarkSubmission): void;
  deal(request: LabDevelopRequest): void;
  edit(next: Scheme): void;
}) {
  const transport = useTransport(clock, false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(batchSizes[1] ?? batchSizes[0]);
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const [growth, setGrowth] = useState<Growth>('down');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const fold = useCallback((id: string) => {
    setCollapsed((held) => {
      const next = new Set(held);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const candidate = archive?.candidate ?? null;
  const room = archive?.room ?? null;
  const families = useMemo(() => familiesOf(archive?.nodes ?? []), [archive?.nodes]);
  const byId = useMemo(
    () => new Map((archive?.nodes ?? []).map((node) => [node.id, node])),
    [archive?.nodes],
  );
  const selected = candidate ? (byId.get(candidate.id) ?? null) : null;

  // Selecting a work anywhere opens the family it belongs to, so following a
  // link from the inspector or from "next undeveloped" never lands on a tree
  // that is not showing.
  const family =
    families.find((held) => held.id === (selected?.cohort ?? openFamily)) ?? families[0] ?? null;

  // Every work with descendants, so folding the lot leaves the roots and the
  // shape of what hangs off them.
  const parents = useMemo(
    () => (family?.members ?? []).filter((node) => node.children > 0).map((node) => node.id),
    [family],
  );
  const folded = collapsed.size;

  const normalized = query.trim().toLowerCase();
  const shownFamilies = normalized
    ? families.filter((held) =>
        held.members.some((node) =>
          `${node.name} ${node.operation}`.toLowerCase().includes(normalized),
        ),
      )
    : families;

  /**
   * The undeveloped shelf: bookmarked, and never once mutated.
   *
   * The list the old lab could not produce, and the absence of it is how good
   * ideas got lost. A bookmark says somebody thought this was worth coming back
   * to; a batch count of zero says nobody ever did.
   */
  const neglected = useMemo(
    () =>
      (archive?.nodes ?? [])
        .filter((node) => node.bookmarked && node.batches === 0)
        .sort((a, b) => interest(b) - interest(a)),
    [archive?.nodes],
  );

  const parked = useMemo(
    () => (candidate ? parkedScheme(candidate.flow, candidate.bundle) : null),
    [candidate],
  );

  const pick = useCallback(
    (id: string) => {
      setOpenFamily(byId.get(id)?.cohort ?? null);
      select(id);
    },
    [byId, select],
  );

  useEffect(() => open(), [open]);
  useEffect(() => {
    if (!candidate || !room) return;
    setError(null);
    transport.setBpm(room.tempo);
    transport.restart();
  }, [candidate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof Element && event.target.matches('input, textarea, select'))
      ) {
        return;
      }
      const pressed = event.key.toLowerCase();
      if (pressed === 'b' && candidate && selected) {
        event.preventDefault();
        bookmark({ candidateId: candidate.id, marked: !selected.bookmarked });
      } else if (pressed === 'r') {
        event.preventDefault();
        transport.restart();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [candidate?.id, selected?.bookmarked, bookmark]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!archive) {
    return (
      <div className="archive archive-empty">
        <p>Reconstructing the lineage forest…</p>
      </div>
    );
  }

  const show = candidate && room ? stagedShow(room, `forest:${candidate.id}:${room.seed}`) : null;
  const copied = candidate ? promotedCandidateId(scheme, candidate) !== null : false;
  const keyName = room?.key === null ? 'no key' : room ? (KEYS[room.key] ?? 'no key') : 'no key';
  const bookmarked = archive.nodes.filter((node) => node.bookmarked).length;

  return (
    <div className="forest">
      <nav className="forest-roots" aria-label="Lineages">
        <header>
          <div>
            <span className="finals-kicker">lineages</span>
            <strong>
              {families.length} families · {archive.nodes.length} works
            </strong>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="find a work"
            aria-label="Filter lineages"
          />
        </header>

        <ul>
          {shownFamilies.map((held) => (
            <li key={held.id}>
              <button
                type="button"
                aria-pressed={family?.id === held.id}
                onClick={() => {
                  setOpenFamily(held.id);
                  select(held.root.id);
                }}
              >
                <strong>{held.root.name}</strong>
                <span>
                  {held.members.length} works · {held.generations} deep
                </span>
                <span className="forest-root-marks">
                  {held.bookmarked > 0 && <i data-mark="">★ {held.bookmarked}</i>}
                  {held.won > 0 && <i data-won="">{held.won} won</i>}
                  {held.batches > 0 && <i data-on="">{held.batches}×dev</i>}
                  {held.batches === 0 && held.bookmarked > 0 && <i data-warn="">undeveloped</i>}
                </span>
              </button>
            </li>
          ))}
          {shownFamilies.length === 0 && <li className="forest-roots-empty">nothing matches</li>}
        </ul>

        <footer>
          <Button
            tone="quiet"
            disabled={neglected.length === 0}
            onPress={() => neglected[0] && pick(neglected[0].id)}
          >
            next undeveloped ({neglected.length})
          </Button>
          <span>{bookmarked} bookmarked</span>
        </footer>
      </nav>

      <section className="forest-canvas">
        <div className="forest-canvas-bar wdg">
          {(['down', 'right'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={growth === option}
              onClick={() => setGrowth(option)}
            >
              {option === 'down' ? 'downward' : 'left to right'}
            </button>
          ))}
          <span className="forest-canvas-gap" />
          <button
            type="button"
            disabled={!family || parents.length === 0}
            onClick={() => setCollapsed(new Set(parents))}
          >
            fold branches
          </button>
          <button type="button" disabled={folded === 0} onClick={() => setCollapsed(new Set())}>
            unfold all{folded > 0 ? ` (${folded})` : ''}
          </button>
        </div>
        {family ? (
          <FamilyCanvas
            key={family.id}
            family={family}
            growth={growth}
            collapsed={collapsed}
            selectedId={selected?.id ?? null}
            onSelect={pick}
            onFold={fold}
          />
        ) : (
          <div className="archive-empty">
            <h2>No lineages yet.</h2>
            <p>Explore admits roots; developing one gives it descendants.</p>
          </div>
        )}
      </section>

      <aside className="lineage-inspector wdg">
        {!candidate || !room || !show || !parked ? (
          <div className="archive-empty">
            <h2>Select any work.</h2>
            <p>The whole history stays visible; only its graph loads.</p>
          </div>
        ) : (
          <>
            <header>
              <div>
                <span className="train-phase">generation {candidate.generation}</span>
                <strong>{candidate.flow.name}</strong>
              </div>
              <Button
                tone="quiet"
                disabled={copied}
                onPress={() => !copied && edit(promoteCandidate(scheme, candidate).scheme)}
              >
                {copied ? 'copied ✓' : 'copy'}
              </Button>
            </header>

            <div className="lineage-preview">
              <Bench
                show={show}
                scheme={parked}
                flow={CANDIDATE_FLOW}
                clock={transport}
                onError={setError}
              />
            </div>

            <div className="lineage-provenance">
              <span>{candidate.flow.circuit.nodes.length} nodes</span>
              <span>{operationName(candidate.operation)}</span>
              <span>
                chosen {selected?.chosen ?? 0} / {selected?.appearances ?? 0}
              </span>
              <span>{selected?.batches ?? 0} batches</span>
              <span>{selected?.children ?? 0} children</span>
            </div>

            <div className="lineage-room">
              <Button tone="quiet" onPress={() => transport.setPlaying(!transport.playing)}>
                {transport.playing ? '■' : '▶'}
              </Button>
              <Button tone="quiet" onPress={transport.restart}>
                ↺
              </Button>
              <span>{room.tempo} bpm</span>
              <span>{Math.round(room.energy * 100)}%</span>
              <span>{room.section}</span>
              <span>{keyName}</span>
            </div>
            {error && <span className="train-error">{error}</span>}

            <div className="lineage-decisions">
              <button
                type="button"
                data-on={selected?.bookmarked ? '' : undefined}
                onClick={() =>
                  bookmark({ candidateId: candidate.id, marked: !selected?.bookmarked })
                }
              >
                {selected?.bookmarked ? '★ bookmarked' : '☆ bookmark'}
              </button>
            </div>

            {/*
              Develop is the expensive gesture, so it is a deliberate one. The
              size is offered rather than assumed because how much a node is
              worth is a thing only the person looking at it knows.
            */}
            <div className="lineage-develop">
              <label>
                batch of
                <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
                  {batchSizes.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <Button onPress={() => deal({ candidateId: candidate.id, size })}>
                develop this work
              </Button>
            </div>
            <p className="lineage-explanation">
              A batch generates {size - 1} children — some one-step, some larger leaps — and runs
              them against the parent under one room. The parent entering its own batch is what
              lets the answer be “nothing here beat it”.
            </p>
            {(notice ?? archive.notice) && (
              <p className="train-notice">{notice ?? archive.notice}</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
