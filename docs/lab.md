# The lab

`lab.ts`, `server/lab.ts`, `server/lineage.ts`, `server/finals.ts`, `server/fresh.ts`,
`src/ui/TrainView.tsx`, `src/ui/ArchiveView.tsx`, `src/ui/FinalsView.tsx`,
`src/ui/ReviewsView.tsx`. One subsystem with three kinds of evidence under two console
tabs: **train** discovers directions, preserves finished works and holds frozen Finals
editions, while **review** preserves the slower scored and tagged corpus.

## What it is for

The end goal is not a dealer with one increasingly narrow house style. It is a system
that first learns which visual structures are worth exploring, then eventually learns
how to construct a requested thing from the same graph vocabulary — for example, “a
solar system where each planet's surface is reactive.”

Train deliberately asks less than Review. It shows one explicit pair and records one of
four answers:

- **left** or **right** keeps that direction in the search;
- **both** preserves two branches when both ideas work;
- **neither** says the comparison produced no winner; and
- **skip this pair** records that no comparison was formed at all.

Both and neither are not conveniences mapped onto two binary votes. They are whole facts.
Neither question says whether either candidate should be remembered as a finished work:
**Search** asks where to continue, while **Archive** asks what to preserve. Conflating those
questions made brilliant ancestors disappear from the first Finals even though their graphs
were still durable. They now have separate gestures and separate facts.
The earlier 1–5 score, tags and note remain intact in Review, where they can later become
useful language for prompt-conditioned construction. They are not required while the
search is still finding enough good material to describe.

## The shape

```text
                         ┌── Explore: two distant directions ──┐
train / search ────────> LabStore                         ├──> recursive frontier
  │                      └── Refine: parent vs one change ─────┘
  │
  ├── archive ──> every staged work, in its first room ──> keep / pass
  │                                                    │
  └── finals <──── kept works first ── frozen nominees ──> four rooms ──> top ten
                              │
                              └── preference + independent show-ready marks

search / finals ──> two synchronized Benches ──> one frozen room and song seed

review ── browse / rescore / retag / renote ──> detailed-review corpus
```

- **`lab.ts`** is the shared contract: candidate identity, rooms, comparison evidence,
  promotion, and the `LabSearchMethod` boundary.
- **`server/lab.ts`** is the store and engine. The server is the only SQLite writer;
  browsers send coarse `lab-open`, `lab-compare`, `lab-skip-encounter` and `lab-offer`
  messages. WAL, transactions, foreign keys and `PRAGMA user_version` migrations keep the
  corpus durable.
- **`server/lineage.ts`** is the active `lineage@2` methodology: a generic small-graph
  constructor, atomic mutation vocabulary, structural distance and recursive scheduler.
- **`server/finals.ts`** nominates a lineage-diverse snapshot, deals the fixed room deck,
  schedules balanced cross-family matches and derives standings from their raw facts.
- **`server/fresh.ts`** and `lineage@1` are inactive historical methods. Their old
  observations, binary selections and detailed reviews have not been converted or
  deleted.
- The Build tab's **train** button offers the open flow by hand. A distinct manual flow is
  put at the front as a Refine question, and can then become an ordinary search parent.

## Explore and Refine recur at every depth

The scheduler is divergent and convergent at every accepted generation, rather than
running one exploration stage and one final cleanup stage.

**Global Explore** samples twelve unrelated generation-zero graphs and presents the most
structurally distant pair. This is the cold start and the continuing escape hatch.

**Local Explore** starts from an accepted parent. It samples ten visible leaps, where each
leap contains two to four exact atomic operations, then presents the two most different
directions. The leaps are intentionally large enough to answer “which future?” rather
than asking for a judgment between near-duplicates.

**Refine** presents the current parent against one atomic mutation. That is the causal
question: did this one mode, value, driver, connection or node improve the family?

The next accepted candidate receives both kinds of attention again. An accepted
exploratory leap is refined first; an accepted random root or atomic child is explored
first. After that the candidate alternates toward whichever phase it has seen less. The
scheduler selects the least-used member of the frontier, so a new depth gets a turn before
an older branch consumes more comparisons.

Every fifth settled encounter is a new Global Explore pair. This immigrant cadence keeps
the search capable of discovering a different island even when one lineage is doing well.
A skip counts as settled for scheduling but creates no preference.

## The frontier is quality plus novelty

Every chosen side becomes eligible for a bounded frontier. A single-side win carries more
quality evidence than a both answer; a losing side is weakened; neither adds no candidate.
The frontier is rebuilt from durable facts rather than stored as mutable truth.

At most eight candidates survive. Selection greedily mixes accumulated comparison quality
with structural distance from the candidates already admitted, and slightly favors
underused branches. This is a small novelty-preserving beam: it prevents one attractive
family from occupying every future encounter without pretending that novelty alone is
quality.

Structural distance is generic. It compares node and mode vocabulary, typed topology,
graph scale, held numeric values and modulation depths. There is deliberately no named
strategy such as “LFO-heavy” or “layered” in the scheduler. If those personalities are
real, successful lineages should expose them as clusters of operations and graph features.
They can be named, sampled or deliberately crossed after they emerge; hard-coding them in
the initial dealer would make the answer precede the experiment.

## Archive remembers works; the frontier remembers directions

Search fitness is not finished-work quality. Choosing a mutation can mean “this is the more
interesting future” without retracting the parent, and losing to one extraordinary work does
not make the other one bad. Exposure is uneven too: a productive parent appears in more
comparisons and accumulates a more complicated record than a one-off revelation. Archive is
the missing absolute axis.

Every candidate ever staged on either side of Search appears in Archive's zoomable lineage
forest, including candidates that lost or received neither. One horizontal island is one
root family; parent cords expose every mutation branch and generation. Every work remains a
dot, while repeated winners, past nominees, keepers and explicit lineage finalists are
larger landmarks. Search dims rather than removes non-matches. **Next likely peak** ranks
unreviewed work from its comparison selections and Finals history; **next undecided** is the
complete chronological fallback, so prioritization never becomes another deletion policy.

Clicking any dot loads that one full graph and replays it in the complete frozen room where
it first appeared. The map therefore stays a small summary over hundreds of works rather
than sending hundreds of circuits to the renderer at once. **Keep** protects the finished
work; **pass** says it need not be protected. Both leave the graph, lineage and comparisons
in the corpus.

The same star is available on both Search candidates. It records **keep** without advancing
or altering the search question, and clearing it returns the work to Archive's undecided
queue. Archive uses up/K for keep, down/X for pass and R to restart its clock. Its progress
and keep count are derived from the latest decision for every staged candidate; the complete
decision history remains append-only.

**Make lineage finalist** is a separate, stronger decision. Each family has at most one
current representative; choosing another descendant appends a replacement fact rather than
editing the old one. The diamond is visible on the forest and that representative enters the
next Finals edition before generic keepers and algorithmic fill. This is how a person picks
the true endpoint of a lineage without reviewing every near-duplicate in sequence.

## Finals is a frozen playoff, not another mutation strategy

Opening **Finals** for an experiment takes one durable snapshot. Explicit lineage finalists
enter first, followed by every Archive keeper—even when several came from one lineage—because
a lineage is provenance rather than a visual archetype. Remaining seats, up to a normal field of twenty-four, are filled from
historical search winners by mixing search confidence with graph novelty. If more than
twenty-four works are explicitly protected, protection expands the field rather than
silently discarding them. If every available work is protected and that makes an odd field,
Finals asks for one more staged work instead of manufacturing a bye or dropping a keeper.

The nominee list does not change if Search continues afterward. Finals neither rewrites nor
stops Search, and opening it again resumes the same run. This makes the result reproducible
without turning a useful snapshot into an irreversible lock.

After a run completes, **new edition from Archive** freezes another field from the current
keep decisions. Earlier runs, nominees, matches and results remain durable; a new edition
does not reinterpret or overwrite the first one.

Every nominee appears once in each of four named rooms: **hush**, **pulse**, **lift** and
**arrival**. Their palette is seeded and their tempo, energy and section are fixed from a
quiet opening through a high-energy chorus. The first room pairs structurally distant work
to cross the lineages; later rooms pair similar current standings, with a small novelty
preference, so their comparisons become progressively more discriminating. Twenty-four
nominees therefore make forty-eight answered matches.

Each match records two independent facts:

- left, right, both or neither answers which work is stronger in that room; and
- a **show-ready** mark on either candidate answers whether it could be used now, regardless
  of which side wins the comparison.

Skipping says no match was formed and deals another pair. After all four rooms, preference
and show-readiness are combined into a derived standing with Bayesian smoothing; seed search
confidence only breaks otherwise close ties. The ten-result collection is rebuilt from the
raw match rows every time. **Copy** and **copy all** use the normal dirty scheme edit and do
not alter the corpus.

## Random before strategic

Generation-zero candidates are sampled from typed node capabilities, not from the authored
example flows. Construction starts from a self-sufficient picture and applies generic graph
operations: carry a picture through another node, attach a point transform, drive a numeric
inlet, or add another picture branch. Nodes requiring a media file or saved flow are
excluded, but procedural sources, Live/set sources, feedback, layering, fields, point
transforms, analysis, LFOs and ordinary colour effects can all arise.

Fresh roots contain at most seven nodes. Descendants grow gradually: the node ceiling starts
at eight, gains one node every two generations, and stops at eighteen. This is a curriculum
and computational bound, not a definition of what a good flow is.

## Atomic means one intervention

Every descendant records its parent, generation, family, operation and exact operands. The
atomic vocabulary is:

- change one node's mode;
- change one held numeric value or one modulation depth;
- insert one compatible node into one cord;
- add one numeric driver to one free inlet;
- remove one pass-through node;
- rewire one cord to another compatible outlet; or
- add one blend around an existing colour cord, using another colour outlet already in the
  graph.

An addition introduces at most one node. Inserting or removing it may reconnect several
serialized cords, but the semantic intervention remains one graph edit. Every atomic result
is compiled and rejected if it is invalid or feeds a picture back into itself. Explore
leaps retain their complete ordered list of atomic steps, so their larger jump is still
auditable even though it is not treated as a causal comparison.

## One encounter means one controlled question

Both Benches share one transport, one frozen room and one synthetic song seed. Play, hold
and restart operate both clocks together. The room includes palette by value, tempo,
energy, section, section list and key; it is persisted once on the encounter rather than
reconstructed independently for each candidate.

That control matters twice. Different room values could make one graph look better for a
reason unrelated to its structure, and different synthetic song seeds could make two
`song` nodes disagree even when the displayed room looked identical. Train therefore
offers no room dials, another-room gesture or live-set following. It needs no Ableton, Link
or bridge.

The four comparison buttons remain visible because neither and both carry meaning. Keyboard
shortcuts are left/A, right/D, up/W for both, down/X for neither, S to skip the pair, and R
to restart both clocks.

## Comparison evidence and detailed reviews stay separate

`search_encounters` freezes the phase, anchor, pair, room, depth and disposition.
`search_comparisons` stores one left/right/both/neither answer against that encounter and
renderer version. It does not invent scores, tags, two evaluations or two binary votes.

`archive_decisions` appends keep, pass and clear gestures with their source and frozen room.
The latest gesture answers the current UI; the earlier ones remain evidence rather than
being updated in place.

`lineage_finalist_decisions` appends set and clear events per family. The latest event marks
the current diamond; prior representatives remain historically recoverable.

`finals_runs` freezes the source experiment, nominee count and named room deck;
`finals_nominees` freezes each selected candidate, family and selection evidence;
`finals_encounters` freezes each pair and room; and `finals_comparisons` stores preference,
both independent show-ready marks and renderer version. The leaderboard is deliberately not
a table.

`reviews` continues to hold anchored assessments, and Review continues to browse, restage,
rescore, retag and renote them. The old `selections` and single-candidate queue remain in the
database for historical `lineage@1` and `fresh` evidence, but the active Train UI does not
write them.

## What every fact freezes

- **The candidate**: its id is a SHA-256 of canonical visual behaviour — kinds, modes,
  named targets, held values, depths, smoothing, wiring, and the complete transitive bundle
  of nested flows. Display names, canvas positions and labels are excluded by whitelist.
- **The origin**: method and version, deterministic deal seed, parent, generation, family,
  operation and exact operands. Explore leaps preserve every atomic step.
- **The encounter**: Explore or Refine, its anchor and depth, both candidate ids, and the
  complete frozen room shared by the pair.
- **The answer**: left, right, both or neither plus renderer generation and moment. Skip is
  a separate disposition and never becomes negative preference.
- **The preservation judgment**: candidate, keep/pass/clear, whether it came from Search or
  Archive, and the exact room where the work was marked or replayed.
- **The lineage representative**: family, candidate and whether that event selected or
  cleared it.
- **The Finals snapshot**: its source experiment, archive-first nominees, selection order,
  room deck, pairings, preferences and independent show-ready marks.

Editing a library flow never changes what an old fact claims: the complete bundle rode
along. Copying a candidate into the open scheme likewise leaves the lab untouched.

## The method boundary

A `LabSearchMethod` reads a snapshot of candidate graphs, origins and pair evidence, then
proposes one whole encounter. It cannot render, persist an answer, touch a scheme or choose
a room. The engine owns deterministic seeds, compilation, canonical identity, persistence
and room construction. `LabMethod` remains as the compatible boundary for historical
single-candidate methods.

This is human-guided evolutionary novelty search, not a trained policy and not yet a claim
of reinforcement learning. It creates the right raw material for one: explicit preferences,
counterfactual atomic changes, rejected directions, lineage, diversity and controlled
conditions. A later strategy population, learned surrogate, prompt-conditioned policy or
hard-room curriculum should be a new versioned method over those facts, not a new database
or a silent reinterpretation of old answers.

## What the lab never does

- It never writes a scheme automatically. **Copy** uses the console's ordinary edit path,
  makes the scheme dirty, and is saved normally. Developing the copied flow never mutates
  its frozen lab candidate. Finals' **copy all** repeats that same edit for the collection.
- It never runs while unwatched. The database opens on the first `lab-open`, and only one
  Search encounter or Finals match is generated when its queue is empty. Closing Train
  unmounts its GL benches. Archive only replays graphs already in the corpus.
- It never takes the show with it. Store and gesture failures return a lab state with a
  notice rather than escaping the socket handler.
- It never moves with `OPENFLOW_VISUALS_SCHEME`. It lives under `OPENFLOW_HOME` at
  `~/.openflow/visuals/lab.sqlite3`, because a scratch scheme must not orphan the corpus.

## Portability

`LabStore.exportJsonl` writes every durable fact — experiments, candidates, origins,
challenges, encounters, comparisons, historical selections, detailed reviews, tags,
dispositions, Archive decisions, Finals runs, nominees, matches and judgments, and rating
snapshots — as versioned JSONL. `importJsonl` refills an empty store from it. Render artifacts
(`lab-artifacts/`, content-addressed) are optional caches and deliberately excluded: graph,
bundle, origin, room, renderer version and answer are the durable identity.
