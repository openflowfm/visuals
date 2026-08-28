import { useEffect, useMemo, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { LabArchiveSubmission, LabArchiveState, LabLineageFinalistSubmission, LabLineageNode, Scheme } from '../../protocol.ts';
import { promoteCandidate, promotedCandidateId } from '../../lab.ts';
import type { Clock } from '../state/useShow.ts';
import { useTransport } from '../state/useTransport.ts';
import { KEYS } from '../state/useRoom.ts';
import { Bench } from './Preview.tsx';
import { CANDIDATE_FLOW, parkedScheme, stagedShow } from './stage.ts';

interface PlacedNode extends LabLineageNode { x: number; y: number; hot: boolean }
interface PlacedFamily { id: string; y: number; height: number; nodes: PlacedNode[] }

const interest = (node: LabLineageNode): number =>
  (node.finalist ? 1000 : 0) + (node.kept ? 500 : 0) + node.finals * 90 +
  node.chosen * 14 + ((node.chosen + 1) / (node.appearances + 2)) * 24;

function layoutForest(nodes: readonly LabLineageNode[]) {
  const grouped = new Map<string, LabLineageNode[]>();
  for (const node of nodes) grouped.set(node.cohort, [...(grouped.get(node.cohort) ?? []), node]);
  const ordered = [...grouped.entries()].sort(([, a], [, b]) =>
    Math.max(...b.map(interest)) - Math.max(...a.map(interest)),
  );
  const families: PlacedFamily[] = [];
  const byId = new Map<string, PlacedNode>();
  let top = 10;
  let maxGeneration = 0;
  for (const [id, members] of ordered) {
    const generations = new Map<number, LabLineageNode[]>();
    for (const member of members) {
      generations.set(member.generation, [...(generations.get(member.generation) ?? []), member]);
      maxGeneration = Math.max(maxGeneration, member.generation);
    }
    for (const held of generations.values()) held.sort((a, b) => interest(b) - interest(a));
    const height = Math.max(72, Math.max(...[...generations.values()].map((held) => held.length)) * 17 + 34);
    const placed: PlacedNode[] = [];
    for (const [generation, held] of generations) held.forEach((node, at) => {
      const result = { ...node, x: 128 + generation * 70, y: top + 29 + at * 17,
        hot: node.finalist || node.kept || node.finals > 0 || node.chosen >= 2 };
      placed.push(result);
      byId.set(node.id, result);
    });
    families.push({ id, y: top, height, nodes: placed });
    top += height + 8;
  }
  return { families, byId, width: Math.max(640, 210 + maxGeneration * 70), height: top + 10 };
}

/** The complete history at once; full graphs load only when their dot is selected. */
export function ArchiveView({ clock, scheme, archive, open, select, decide, finalist, edit }: {
  clock: Clock;
  scheme: Scheme;
  archive: LabArchiveState | null;
  open(): void;
  select(candidateId: string): void;
  decide(decision: LabArchiveSubmission): void;
  finalist(decision: LabLineageFinalistSubmission): void;
  edit(next: Scheme): void;
}) {
  const transport = useTransport(clock, false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(0.85);
  const candidate = archive?.candidate ?? null;
  const room = archive?.room ?? null;
  const parked = useMemo(() => candidate ? parkedScheme(candidate.flow, candidate.bundle) : null, [candidate]);
  const forest = useMemo(() => layoutForest(archive?.nodes ?? []), [archive?.nodes]);
  const selected = candidate ? forest.byId.get(candidate.id) ?? null : null;
  const normalized = query.trim().toLowerCase();
  const matches = (node: LabLineageNode) => !normalized ||
    `${node.name} ${node.operation} ${node.cohort}`.toLowerCase().includes(normalized);
  const likely = useMemo(() => [...(archive?.nodes ?? [])]
    .filter((node) => !node.reviewed)
    .sort((a, b) => interest(b) - interest(a))[0] ?? null, [archive?.nodes]);

  useEffect(() => open(), [open]);
  useEffect(() => {
    if (!candidate || !room) return;
    setError(null);
    transport.setBpm(room.tempo);
    transport.restart();
  }, [candidate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey ||
        (event.target instanceof Element && event.target.matches('input, textarea, select'))) return;
      const pressed = event.key.toLowerCase();
      if ((event.key === 'ArrowUp' || pressed === 'k') && candidate) {
        event.preventDefault();
        decide({ candidateId: candidate.id, verdict: 'keep', source: 'archive' });
      } else if ((event.key === 'ArrowDown' || pressed === 'x') && candidate) {
        event.preventDefault();
        decide({ candidateId: candidate.id, verdict: 'pass', source: 'archive' });
      } else if (pressed === 'r') {
        event.preventDefault();
        transport.restart();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [candidate?.id, decide]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!archive) return <div className="archive archive-empty"><p>Reconstructing the lineage forest…</p></div>;
  const judge = (verdict: 'keep' | 'pass' | 'clear') => candidate &&
    decide({ candidateId: candidate.id, verdict, source: 'archive' });
  const show = candidate && room ? stagedShow(room, `archive:${candidate.id}:${room.seed}`) : null;
  const copied = candidate ? promotedCandidateId(scheme, candidate) !== null : false;
  const keyName = room?.key === null ? 'no key' : room ? KEYS[room.key] ?? 'no key' : 'no key';
  const nextUndecided = archive.nodes.find((node) => !node.reviewed) ?? null;

  return <div className="lineage-archive">
    <section className="lineage-map">
      <header>
        <div><span className="finals-kicker">lineage forest</span><strong>{forest.families.length} families · {archive.nodes.length} works</strong></div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="find a work, operation, or family" aria-label="Filter lineage map" />
        <label className="lineage-zoom">zoom <input type="range" min="0.45" max="1.8" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <Button tone="quiet" disabled={!likely} onPress={() => likely && select(likely.id)}>next likely peak</Button>
        <Button tone="quiet" disabled={!nextUndecided} onPress={() => nextUndecided && select(nextUndecided.id)}>next undecided</Button>
      </header>
      <div className="lineage-scroll">
        <svg width={forest.width * zoom} height={forest.height * zoom} role="tree" aria-label="Visual lineages">
          <g transform={`scale(${zoom})`}>
          {forest.families.map((family) => <g key={family.id}>
            <rect className="lineage-band" x="0" y={family.y} width={forest.width} height={family.height} />
            <text className="lineage-family" x="10" y={family.y + 18}>{family.id.replace(/^family-/, '')}</text>
            {family.nodes.map((node) => {
              const parent = node.parentId ? forest.byId.get(node.parentId) : null;
              return parent && parent.cohort === node.cohort ? <path key={`${parent.id}:${node.id}`} className="lineage-edge"
                d={`M ${parent.x + 6} ${parent.y} C ${parent.x + 34} ${parent.y}, ${node.x - 34} ${node.y}, ${node.x - 6} ${node.y}`} /> : null;
            })}
            {family.nodes.map((node) => <g key={node.id} className="lineage-node"
              data-selected={selected?.id === node.id ? '' : undefined} data-hot={node.hot ? '' : undefined}
              data-kept={node.kept ? '' : undefined} data-finalist={node.finalist ? '' : undefined}
              data-dim={!matches(node) ? '' : undefined} transform={`translate(${node.x} ${node.y})`}
              role="treeitem" tabIndex={0} onClick={() => select(node.id)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') select(node.id); }}>
              <circle r={node.finalist ? 7 : node.hot ? 5 : 3.5} />
              {(node.finalist || node.kept || selected?.id === node.id) && <text x="10" y="3">{node.name}</text>}
              <title>{node.name} · generation {node.generation} · chosen {node.chosen}/{node.appearances}</title>
            </g>)}
          </g>)}
          </g>
        </svg>
      </div>
      <footer>
        <span><i data-legend="ordinary" /> every staged work</span><span><i data-legend="peak" /> repeated winner / Finals</span>
        <span><i data-legend="kept" /> kept</span><span><i data-legend="finalist" /> lineage finalist</span>
        <span className="gap" /><span>{archive.reviewed} reviewed · {archive.kept} kept</span>
      </footer>
    </section>

    <aside className="lineage-inspector wdg">
      {!candidate || !room || !show || !parked ? <div className="archive-empty"><h2>Select any node.</h2><p>The whole history stays visible; only its graph loads.</p></div> : <>
        <header><div><span className="train-phase">generation {candidate.generation}</span><strong>{candidate.flow.name}</strong></div>
          <Button tone="quiet" disabled={copied} onPress={() => !copied && edit(promoteCandidate(scheme, candidate).scheme)}>{copied ? 'copied ✓' : 'copy'}</Button></header>
        <div className="lineage-preview"><Bench show={show} scheme={parked} flow={CANDIDATE_FLOW} clock={transport} onError={setError} /></div>
        <div className="lineage-provenance"><span>{candidate.flow.circuit.nodes.length} nodes</span><span>{candidate.operation.replace(/^mutate:/, '')}</span>
          <span>chosen {selected?.chosen ?? 0} / {selected?.appearances ?? 0}</span><span>Finals ×{selected?.finals ?? 0}</span></div>
        <div className="lineage-room"><Button tone="quiet" onPress={() => transport.setPlaying(!transport.playing)}>{transport.playing ? '■' : '▶'}</Button>
          <Button tone="quiet" onPress={transport.restart}>↺</Button><span>{room.tempo} bpm</span><span>{Math.round(room.energy * 100)}%</span><span>{room.section}</span><span>{keyName}</span></div>
        {error && <span className="train-error">{error}</span>}
        <div className="lineage-decisions">
          <button type="button" data-on={selected?.kept ? '' : undefined} onClick={() => judge(selected?.kept ? 'clear' : 'keep')}>{selected?.kept ? '★ kept' : '☆ keep work'}</button>
          <button type="button" onClick={() => judge('pass')}>pass</button>
          <button type="button" className="lineage-finalist" data-on={selected?.finalist ? '' : undefined}
            onClick={() => finalist({ candidateId: candidate.id, finalist: !selected?.finalist })}>{selected?.finalist ? '◆ lineage finalist' : '◇ make lineage finalist'}</button>
        </div>
        <p className="lineage-explanation">A lineage finalist replaces the previous representative for this family and enters the next Finals edition first.</p>
        {archive.notice && <p className="train-notice">{archive.notice}</p>}
      </>}
    </aside>
  </div>;
}
