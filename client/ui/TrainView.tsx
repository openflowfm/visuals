import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LabArchiveSubmission,
  LabBatchSubmission,
  LabBookmarkSubmission,
  LabDevelopRequest,
  LabFinalsSubmission,
  LabSeedSubmission,
  LabState,
  Scheme,
} from '../../protocol.ts';
import type { Clock } from '../state/useShow.ts';
import { FinalsView } from './FinalsView.tsx';
import { ForestView } from './ForestView.tsx';
import { ExploreView } from './ExploreView.tsx';
import { DevelopView } from './DevelopView.tsx';

/**
 * Train, as three places rather than one queue.
 *
 * The old shape had a single Search tab whose scheduler decided, encounter by
 * encounter, whether you were exploring or refining and which branch you were
 * doing it to. Two things went wrong with that, and they were the same thing
 * twice. Exploration was coupled to comparison, so a new idea only reached a
 * person if it happened to be one of the two most distant of twelve. And a
 * candidate could only be developed after winning a comparison, so an idea that
 * lost once — to something excellent, on an unlucky draw — was never mutated
 * again. Good work got lost at its first node, and the search funnelled into
 * whatever had early success.
 *
 * So the phases became places you go, and the forest became the home you go
 * from. **Explore** acquires stock: one root, one look, yes or no. **Develop**
 * spends attention deliberately: a batch of children on a node you chose, all
 * judged against each other and against their parent. **Editions** freeze a
 * collection out of what accumulated. Nothing schedules anything; the map is
 * the document and you are the scheduler.
 *
 * The old paired Search is gone from the UI but not from the corpus. Its
 * answers still mean what they meant and still feed the forest's counts —
 * removing a mode is not permission to reinterpret the facts it left behind.
 */

/** Field sizes offered for a batch, the parent included. Mirrors `server/batch.ts`. */
const BATCH_SIZES: readonly number[] = [6, 10, 16];

type Place = 'forest' | 'explore' | 'develop' | 'editions';

interface TrainViewProps {
  clock: Clock;
  scheme: Scheme;
  lab: LabState | null;
  labOpen(): void;
  labArchiveOpen(): void;
  labArchiveSelect(candidateId: string): void;
  labArchiveDecide(decision: LabArchiveSubmission): void;
  labExploreOpen(): void;
  labExploreJudge(submission: LabSeedSubmission): void;
  labExploreSkip(encounterId: number): void;
  labBookmark(decision: LabBookmarkSubmission): void;
  labDevelopOpen(candidateId: string): void;
  labDevelopDeal(request: LabDevelopRequest): void;
  labDevelopCompare(comparison: LabBatchSubmission): void;
  labDevelopSkip(encounterId: number): void;
  labDevelopClose(): void;
  labFinalsOpen(): void;
  labFinalsNew(): void;
  labFinalsCompare(comparison: LabFinalsSubmission): void;
  labFinalsSkip(encounterId: number): void;
  edit(next: Scheme): void;
}

export function TrainView(props: TrainViewProps) {
  const [place, setPlace] = useState<Place>('forest');
  const develop = props.lab?.develop ?? null;

  /**
   * Dealing a batch is what opens Develop, from wherever it was asked for, and
   * closing one puts you back on the map.
   *
   * On the *change*, not on the state. Following `develop !== null` every render
   * would drag you back to the batch every time you tried to look at the forest
   * while one was open — which is exactly the browsing the forest exists for.
   */
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const id = develop?.batchId ?? null;
    if (id === seen.current) return;
    if (id !== null && seen.current === null) setPlace('develop');
    if (id === null) setPlace('forest');
    seen.current = id;
  }, [develop?.batchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const bookmarkedIds = useMemo(
    () =>
      new Set(
        (props.lab?.archive?.nodes ?? [])
          .filter((node) => node.bookmarked)
          .map((node) => node.id),
      ),
    [props.lab?.archive?.nodes],
  );

  const about: Record<Place, string> = {
    forest: 'browse the lineages — the home everything is reached from',
    explore: 'one fresh root at a time: is there anything here',
    develop: 'a batch of children on one node, judged against each other',
    editions: 'freeze a show-ready collection out of what accumulated',
  };

  return (
    <div className="train-workspace">
      <nav className="train-mode" aria-label="Training stage">
        {(['forest', 'explore', 'develop', 'editions'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={place === option}
            disabled={option === 'develop' && !develop}
            onClick={() => setPlace(option)}
          >
            {option}
          </button>
        ))}
        <span>{about[place]}</span>
      </nav>

      <div className="train-workspace-body">
        {place === 'forest' && (
          <ForestView
            clock={props.clock}
            scheme={props.scheme}
            archive={props.lab?.archive ?? null}
            notice={props.lab?.notice ?? null}
            batchSizes={BATCH_SIZES}
            open={props.labArchiveOpen}
            select={props.labDevelopOpen}
            bookmark={props.labBookmark}
            deal={props.labDevelopDeal}
            edit={props.edit}
          />
        )}

        {place === 'explore' && (
          <ExploreView
            clock={props.clock}
            scheme={props.scheme}
            explore={props.lab?.explore ?? null}
            open={props.labExploreOpen}
            judge={props.labExploreJudge}
            skip={props.labExploreSkip}
            edit={props.edit}
          />
        )}

        {place === 'develop' &&
          (develop ? (
            <DevelopView
              clock={props.clock}
              scheme={props.scheme}
              develop={develop}
              compare={props.labDevelopCompare}
              skip={props.labDevelopSkip}
              close={props.labDevelopClose}
              deal={props.labDevelopDeal}
              sizes={BATCH_SIZES}
              bookmark={props.labBookmark}
              bookmarkedIds={bookmarkedIds}
              edit={props.edit}
            />
          ) : (
            <div className="train train-empty">
              <p>No batch is open. Choose a node in the forest and develop it.</p>
            </div>
          ))}

        {place === 'editions' && (
          <FinalsView
            clock={props.clock}
            scheme={props.scheme}
            finals={props.lab?.finals ?? null}
            open={props.labFinalsOpen}
            newEdition={props.labFinalsNew}
            compare={props.labFinalsCompare}
            skip={props.labFinalsSkip}
            edit={props.edit}
          />
        )}
      </div>
    </div>
  );
}
