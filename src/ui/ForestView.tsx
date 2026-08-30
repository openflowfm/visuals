import { useEffect, useMemo, useState } from 'react';
import { hierarchy, tree } from 'd3-hierarchy';
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
 * The forest: the home of Train, and the thing you act on rather than read.
 *
 * It used to be a report — a rendering of decisions taken somewhere else, with
 * the actual work happening in a queue that decided for you which branch got
 * developed next. That scheduler is gone, and this is what replaced it. A node
 * is clicked to be looked at, bookmarked, developed or copied, which makes the
 * map the document and the modes the places you go from it.
 *
 * Two facts on every dot carry the weight. **Bookmarked** says come back here,
 * and several per family is ordinary rather than a conflict: an ancestor and a
 * descendant ten generations apart can both be finished work, because lineage
 * is provenance and confers no ranking. **Batches** says how many times this
 * node has been developed, which is the one number that reveals the failure
 * this rewrite exists to fix — an idea nobody argued with, that simply never
 * got mutated.
 */

const ROW = 20;
const COLUMN = 92;

interface Placed extends LabLineageNode {
  x: number;
  y: number;
}

interface Family {
  id: string;
  y: number;
  height: number;
  nodes: Placed[];
}

/** One family as a tree. The head is synthetic, so several roots still lay out. */
interface Branch {
  node: LabLineageNode | null;
  children: Branch[];
}

/** Bookmarks first, then evidence of having been chosen. Never a hidden score. */
const interest = (node: LabLineageNode): number =>
  (node.bookmarked ? 500 : 0) +
  node.batches * 60 +
  node.finals * 40 +
  node.chosen * 12 +
  ((node.chosen + 1) / (node.appearances + 2)) * 20;

/**
 * One tidy tree per family, stacked.
 *
 * `d3-hierarchy`'s Reingold–Tilford rather than the generation-by-index grid
 * that was here before. The grid put a node wherever its generation and its
 * arrival order happened to land, so a cord could cross half the family to
 * reach its parent and sibling groups read as unrelated. A tidy tree keeps
 * children under their parent and siblings adjacent, which is the entire
 * reason a lineage is worth drawing as a tree at all.
 *
 * The layout runs on x and y swapped — depth is horizontal, because generation
 * is the axis that grows without bound and a screen is wider than it is tall.
 */
function layoutForest(nodes: readonly LabLineageNode[]) {
  const grouped = new Map<string, LabLineageNode[]>();
  for (const node of nodes) grouped.set(node.cohort, [...(grouped.get(node.cohort) ?? []), node]);
  const ordered = [...grouped.entries()].sort(
    ([, a], [, b]) => Math.max(...b.map(interest)) - Math.max(...a.map(interest)),
  );

  const families: Family[] = [];
  const byId = new Map<string, Placed>();
  let top = 10;
  let width = 640;

  for (const [id, members] of ordered) {
    const present = new Set(members.map((node) => node.id));
    const childrenOf = new Map<string, LabLineageNode[]>();
    for (const node of members) {
      if (!node.parentId || !present.has(node.parentId)) continue;
      childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node]);
    }
    // A family's roots are the members whose parent is outside it. Normally
    // one; a manual offer or an imported corpus can leave several, and a
    // synthetic head above them keeps that a tidy forest rather than a crash.
    const roots = members.filter((node) => !node.parentId || !present.has(node.parentId));
    if (roots.length === 0) continue;

    const branch = (node: LabLineageNode): Branch => ({
      node,
      children: (childrenOf.get(node.id) ?? [])
        .sort((a, b) => interest(b) - interest(a))
        .map(branch),
    });
    const head: Branch = { node: null, children: roots.map(branch) };

    const laid = tree<Branch>()
      .nodeSize([ROW, COLUMN])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.4))(
      hierarchy<Branch>(head, (datum) => datum.children),
    );

    const points = laid.descendants().filter((point) => point.data.node !== null);
    if (points.length === 0) continue;
    const lowest = Math.min(...points.map((point) => point.x));
    const highest = Math.max(...points.map((point) => point.x));
    const height = Math.max(66, highest - lowest + 46);
    const placed: Placed[] = [];
    for (const point of points) {
      const held = point.data.node!;
      const result: Placed = {
        ...held,
        x: 118 + point.y - COLUMN,
        y: top + 30 + (point.x - lowest),
      };
      placed.push(result);
      byId.set(held.id, result);
      width = Math.max(width, result.x + 150);
    }
    families.push({ id, y: top, height, nodes: placed });
    top += height + 8;
  }
  return { families, byId, width, height: top + 10 };
}

const sizeOf = (node: Placed): number =>
  node.bookmarked ? 6.5 : node.batches > 0 || node.finals > 0 || node.chosen >= 2 ? 5 : 3.2;

export function ForestView({
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
  /** Why a gesture was refused — a deal against an open batch, most often. */
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
  const [zoom, setZoom] = useState(0.9);
  const [size, setSize] = useState(batchSizes[1] ?? batchSizes[0]);

  const candidate = archive?.candidate ?? null;
  const room = archive?.room ?? null;
  const parked = useMemo(
    () => (candidate ? parkedScheme(candidate.flow, candidate.bundle) : null),
    [candidate],
  );
  const forest = useMemo(() => layoutForest(archive?.nodes ?? []), [archive?.nodes]);
  const selected = candidate ? forest.byId.get(candidate.id) ?? null : null;

  const normalized = query.trim().toLowerCase();
  const matches = (node: LabLineageNode) =>
    !normalized || `${node.name} ${node.operation} ${node.cohort}`.toLowerCase().includes(normalized);

  /**
   * The undeveloped shelf: bookmarked, and never once mutated.
   *
   * This is the list the old lab could not produce, and the absence of it is
   * exactly how good ideas got lost. A bookmark says somebody thought this was
   * worth coming back to; a batch count of zero says nobody ever did.
   */
  const neglected = useMemo(
    () =>
      (archive?.nodes ?? [])
        .filter((node) => node.bookmarked && node.batches === 0)
        .sort((a, b) => interest(b) - interest(a)),
    [archive?.nodes],
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
    <div className="lineage-archive">
      <section className="lineage-map">
        <header>
          <div>
            <span className="finals-kicker">lineage forest</span>
            <strong>
              {forest.families.length} families · {archive.nodes.length} works
            </strong>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="find a work, operation, or family"
            aria-label="Filter lineage map"
          />
          <label className="lineage-zoom">
            zoom
            <input
              type="range"
              min="0.4"
              max="1.8"
              step="0.05"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <Button
            tone="quiet"
            disabled={neglected.length === 0}
            onPress={() => neglected[0] && select(neglected[0].id)}
          >
            next undeveloped ({neglected.length})
          </Button>
        </header>

        <div className="lineage-scroll">
          <svg
            width={forest.width * zoom}
            height={forest.height * zoom}
            role="tree"
            aria-label="Visual lineages"
          >
            <g transform={`scale(${zoom})`}>
              {forest.families.map((family) => (
                <g key={family.id}>
                  <rect
                    className="lineage-band"
                    x="0"
                    y={family.y}
                    width={forest.width}
                    height={family.height}
                  />
                  <text className="lineage-family" x="10" y={family.y + 18}>
                    {family.id.replace(/^family-/, '')}
                  </text>
                  {family.nodes.map((node) => {
                    const parent = node.parentId ? forest.byId.get(node.parentId) : null;
                    return parent && parent.cohort === node.cohort ? (
                      <path
                        key={`${parent.id}:${node.id}`}
                        className="lineage-edge"
                        d={`M ${parent.x + 6} ${parent.y} C ${parent.x + 42} ${parent.y}, ${node.x - 42} ${node.y}, ${node.x - 6} ${node.y}`}
                      />
                    ) : null;
                  })}
                  {family.nodes.map((node) => (
                    <g
                      key={node.id}
                      className="lineage-node"
                      data-selected={selected?.id === node.id ? '' : undefined}
                      data-hot={node.batches > 0 || node.chosen >= 2 ? '' : undefined}
                      data-kept={node.bookmarked ? '' : undefined}
                      data-dim={!matches(node) ? '' : undefined}
                      transform={`translate(${node.x} ${node.y})`}
                      role="treeitem"
                      tabIndex={0}
                      onClick={() => select(node.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') select(node.id);
                      }}
                    >
                      <circle r={sizeOf(node)} />
                      {node.batches > 0 && <circle className="lineage-developed" r={sizeOf(node) + 3.5} />}
                      {(node.bookmarked || selected?.id === node.id) && (
                        <text x="11" y="3">
                          {node.name}
                        </text>
                      )}
                      <title>
                        {node.name} · generation {node.generation} · chosen {node.chosen}/
                        {node.appearances} · {node.batches} batches
                      </title>
                    </g>
                  ))}
                </g>
              ))}
            </g>
          </svg>
        </div>

        <footer>
          <span>
            <i data-legend="ordinary" /> every work
          </span>
          <span>
            <i data-legend="developed" /> developed
          </span>
          <span>
            <i data-legend="peak" /> repeatedly chosen
          </span>
          <span>
            <i data-legend="kept" /> bookmarked
          </span>
          <span className="gap" />
          <span>
            {bookmarked} bookmarked · {neglected.length} never developed
          </span>
        </footer>
      </section>

      <aside className="lineage-inspector wdg">
        {!candidate || !room || !show || !parked ? (
          <div className="archive-empty">
            <h2>Select any node.</h2>
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
              <span>{candidate.operation.replace(/^mutate:/, '')}</span>
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
                develop this node
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
