# The lab

`lab.ts`, `server/lab.ts`, `server/lineage.ts`, `server/batch.ts`, `server/finals.ts`,
`server/fresh.ts`, `client/ui/TrainView.tsx`, `client/ui/ForestView.tsx`, `client/ui/ExploreView.tsx`,
`client/ui/DevelopView.tsx`, `client/ui/FinalsView.tsx`, `client/ui/ReviewsView.tsx`. One subsystem
under two console tabs: **train** grows a body of work and the record of how it got there,
while **review** preserves the slower scored and tagged corpus.

## What it is for

The end goal is not a dealer with one increasingly narrow house style, and it is not a
search that terminates on a winner. It is a growing body of work, plus the derivations that
produced it — *this exact one-node change made it better, and here are the nine that did
not, judged under identical conditions.* Collections of good output are common; that second
thing is rare, and it is the raw material a learned policy would actually need.

So the lab cultivates rather than optimizes. There is no objective function, nothing
converges, and the corpus is the product rather than the endpoint. What punctuates it is an
**edition** — a collection frozen out of the corpus periodically, the way a release is
tagged — not a finish line.

## Quality does not travel along an edge

This is the load-bearing rule, and the previous design broke it.

A search tree gives an interior node **instrumental** value: it matters because of what it
led to, and a better descendant supersedes it. This tree does not. Generation three is a
finished work; generation thirteen is a different finished work that happens to be related.
Neither ranks the other, an ancestor and a descendant can both be worth keeping, and lineage
explains kinship while conferring nothing.

So judgments attach to **nodes**, the graph attaches nodes to **each other**, and those two
layers are never collapsed. Every pathology described below is a place where they were.

## What went wrong, precisely

`lineage@2` scheduled one pairwise queue and decided, encounter by encounter, what you were
doing. Three mechanisms funnelled it:

- **A candidate had to win to ever be mutated.** `frontierFor` admitted only rows with
  `acceptedAt > 0`, so a graph that lost once — to something excellent, on an unlucky draw —
  became structurally ineligible to anchor, and nothing was ever descended from it. Losing
  scored `-0.5`; quality propagated along edges in both directions.
- **Exploration was coupled to comparison.** `globalExplore` sampled twelve generation-zero
  graphs and staged the two most structurally distant. The other ten were discarded unseen.
  Ten of every twelve new ideas were spent to satisfy a pairing, in the one currency the
  search was shortest on.
- **The phase was imposed.** `phaseFor` alternated explore and refine per anchor and forced a
  global immigrant every fifth settled encounter, so the person never chose what they were
  doing.

Good work was lost at its first node, and the search funnelled into whatever had early
success. The facts those comparisons recorded are still true and still feed the forest; what
was wrong was the scheduler reading fitness out of them.

## The shape now

```text
                    ┌─ explore ─ one fresh root ─ yes / no / skip ─┐
                    │                                              │
  train ─ forest ───┼─ develop ─ a batch on one node ─ tournament ─┼─→ the corpus
   (home)           │                                              │
                    └─ editions ─ freeze a collection ─────────────┘

  review ── browse / rescore / retag / renote ──> detailed-review corpus
```

Nothing schedules anything. The forest is the home, the phases are places you go from it,
and you are the scheduler. That is not a convenience: answering "which branch deserves the
next comparison" automatically, on evidence that thin, is what caused the funnelling.

- **`lab.ts`** is the shared contract: candidate identity, rooms, evidence, promotion, and
  the `LabSearchMethod` boundary.
- **`server/lab.ts`** is the store and engine. The server is the only SQLite writer; browsers
  send coarse messages and receive coarse state. WAL, transactions, foreign keys and
  `PRAGMA user_version` migrations keep the corpus durable.
- **`server/lineage.ts`** is the generator: a generic small-graph constructor, the atomic
  mutation vocabulary, structural distance, `seedDraft` and `batchDrafts`.
- **`server/batch.ts`** is the tournament over one parent's children.
- **`server/finals.ts`** nominates and plays an edition.
- **`server/fresh.ts`**, `lineage@1` and the paired `search` UI are inactive. Their
  observations, selections, comparisons and reviews have not been converted or deleted.

## Explore acquires stock

One fresh root, alone, under a frozen room: **yes**, **no**, or **skip**.

There is nothing to compare it to, and that is the point. A pair always manufactures a
relative question — is this better than that — when what is actually being decided is
absolute: is there anything here worth developing. One at a time is also far cheaper per
look, so every sampled root reaches a person instead of one in six.

That makes a number visible that the lab could never previously compute: **admitted over
seen**. If the hit rate is dismal, no amount of developing downstream will help and the work
belongs in the generator. Under a pairing this was unmeasurable, because most roots were
discarded before anybody saw them.

**Yes bookmarks the root** — "worth developing" and "come back to this" are one intention
said once. **No** records a decline and nothing else; it is not a verdict the work carries
around, and the seed stays in the forest. **Skip** says no judgment was formed, settles the
question, and must never quietly become a no.

## Develop spends attention deliberately

Open a node in the forest, choose a field size, and a batch is generated: **the parent plus
its children**, all judged against each other under one room, over three rounds.

It happens because somebody asked for it. Attention is the scarcest thing here and a
tournament is the most expensive way to spend it, so the person spends it — a cost asymmetry
only they can judge. Explore is one look and one key; Develop is fifteen comparisons.

**The parent is in its own field.** That is what lets the answer be *nothing here beat it* —
this node is at a local peak, a real and useful result that the old Refine phase could not
state, because it only ever recorded which of two things won.

**The children mix distances on purpose.** A one-step child answers *which knob*: it is the
causal question, and its recorded operand names the single edit responsible. A leap of two
to four steps answers *which future*. Running both in one field means one set of comparisons
answers both questions, against the same parent, under the same room — the control that a
scattered pairwise record across unrelated families never had.

Survivors of the oversampled pool are chosen for being **unlike one another**, never for
looking good. Nothing has been judged yet, and letting a distance metric guess at quality is
how a dealer's opinion gets in front of the person's. Refusing to ask the same question
twice is all it may legitimately do.

Rounds pair by current standing after the first, which spans structural distance. Standings
are derived from raw comparisons every time, smoothed, so a child that won its only match
does not tie one that won four of five. `both` is worth less than a clean win; `neither` is
worth nothing to either side, because they are answers about the pair and splitting them
would invent a preference nobody expressed.

A batch ends `complete` when every round is answered, or `abandoned` when somebody walks
away mid-way, and `closed` once a finished one has been read. Those are three different
facts and are kept apart: a batch nobody finished is not evidence of the same thing as a
batch that ran out of matches.

## The forest is the document

It used to be a report — a rendering of decisions taken somewhere else. Now it is the
surface you act on: click a work to look at it, bookmark it, develop it, or copy it. Same
distinction as a log versus an editor.

**One family at a time.** Three panes: the lineages on the left, the chosen one on the
canvas, the selected work on the right. Every family stacked in one scroll was a wall —
the thing you actually do here is follow a single lineage, and drawing forty at once made
that the hardest thing to do. The left pane lists each family by its **root**, the topmost
ancestor, because that is the name anybody would look for. Selecting a work anywhere opens
the family it belongs to, so a jump from the inspector or from **next undeveloped** never
lands on a tree that is not showing.

**It grows downward.** Left-to-right was chosen when every family shared one canvas and
generation had to run unbounded across it. With one tree in a pane of its own the unbounded
axis is the one you scroll anyway, and a parent above its children is what "descendant"
already means. Layout is `d3-hierarchy`'s Reingold–Tilford, unswapped.

**The canvas is React Flow.** Pan, zoom, fit-to-view, a minimap and keyboard focus are all
things a map of several hundred works needs and none of them are worth hand-rolling. It is
configured as a **read-only map** — nothing drags, nothing connects — so the library is
doing navigation rather than editing. `widgets`' own `Graph` stays the circuit editor's,
because that canvas has the opposite requirements: the host owns positions so an edit can be
undone or refused, a rejected cord must cost nothing, and it draws twenty nodes rather than
two thousand. Two canvases with different jobs, not one canvas used twice.

Both UI dependencies live in the **root** `package.json`, with React. `visuals/package.json`
is the server and Electron side — Link, `ws`, `zod`, the MCP SDK — and installing a
React-peered package there gives the tree a second copy of React, which is a null
`useContext` in every component that reads one.

Two facts on every dot carry the weight:

- **Bookmarked** says come back here. Several per family is ordinary rather than a conflict —
  which is why the old **lineage finalist**, with its at-most-one representative per family,
  is gone. That rule was the direct contradiction of an ancestor and a descendant both being
  finished work. Its decisions remain in the database as history; nothing writes new ones.
- **Batches** says how many times this node has ever been developed. This is the instrument
  against the failure the rewrite exists to fix. A shelf of admitted ideas is only half of
  it: what tells you an idea got lost is that nobody ever mutated it, and no other number
  reports that. **Next undeveloped** ranks exactly that — bookmarked, and never once
  developed.

Because any node is addressable and immutable, branching from an old generation years later
is not a feature that was added; it is what falls out of the marks living on the map.

## Nothing staged has a branch that draws nothing

A node whose work never reaches a door — `out`'s inlet, or a `give`'s — contributes nothing.
The graph renders pixel-identical to the same graph with that branch deleted.
`liveNodes` and `strandedNodes` in `client/render/circuit.ts` name them, walking backwards port
to port for the reason `wouldFeedItself` walks forwards that way: a `lens` hands back a point
that never looked at its colour, so node-to-node reachability would keep a picture that is
genuinely doing nothing.

The two callers want opposite things, and the rule is **reject, never avoid**:

- **The lab refuses a candidate that has any.** Not for tidiness. The candidate id is a hash
  of the whole circuit, so the same picture would enter the corpus under two ids, arrive as
  its own dot, and spend a comparison on a work already judged — dedup silently stops
  working. It also eats the generation's node ceiling with nodes that draw nothing. And a
  stranded branch is invisible to the only selection pressure in the system, so it could
  never be selected *for*: in a comparison, a mutation that strands a branch shows two
  identical frames.
- **The check belongs to the candidate, never to the edit.** The steps inside one exploratory
  leap may strand whatever they like. That is the one path where stranding a branch and
  blending it back in is a change somebody can see, because the jump is judged whole. Gating
  each step would delete that path and bias the operator set — a much larger loss than the
  duplicates it would save. Rejection resamples rather than repairs: pruning would make the
  recorded operation stop describing what happened.
- **The editor flags and never blocks.** A graph being wired is stranded almost continuously,
  so a canvas that objected would object the whole time somebody was working. Once something
  *does* leave the flow, the stranded nodes are dimmed and counted — a loose end worth
  knowing about before it is saved, not an error.

## Random before strategic

Generation-zero candidates are sampled from typed node capabilities, not authored example
flows. Construction starts from a self-sufficient picture and applies generic graph
operations: carry a picture through another node, attach a point transform, drive a numeric
inlet, or add another picture branch. Nodes requiring a media file or saved flow are
excluded; procedural sources, Live/set sources, feedback, layering, fields, point transforms,
analysis, LFOs and ordinary colour effects can all arise.

Fresh roots contain at most seven nodes. Descendants grow gradually: the ceiling starts at
eight, gains one node every two generations, and stops at eighteen. A curriculum and a
computational bound, not a definition of what a good flow is.

There is deliberately no named strategy such as "LFO-heavy" or "layered" anywhere in the
generator. If those personalities are real, successful lineages should expose them as
clusters of operations and graph features. Hard-coding them would make the answer precede
the experiment.

## Atomic means one intervention

Every descendant records its parent, generation, family, operation and exact operands:

- change one node's mode;
- change one held numeric value or one modulation depth;
- insert one compatible node into one cord;
- add one numeric driver to one free inlet;
- remove one pass-through node;
- rewire one cord to another compatible outlet; or
- add one blend around an existing colour cord, using another colour outlet already present.

An addition introduces at most one node. Inserting or removing it may reconnect several
serialized cords, but the semantic intervention remains one graph edit. Every result is
compiled and rejected if it is invalid, feeds a picture back into itself, or strands a
branch. Leaps retain their complete ordered list of atomic steps, so a larger jump is still
auditable even though it is not a causal comparison.

## One room per question

A batch shares one frozen room across its whole field, and both benches in a match share one
transport and one synthetic song seed. Different rooms would make a child look better for a
reason unrelated to the edit that made it, and different song seeds would make two `song`
nodes disagree under a room that looked identical. Train therefore offers no room dials and
no live-set following. It needs no Ableton, Link or bridge.

## Editions are punctuation, not a terminus

With no objective function there is no "done", which can become a treadmill. **Finals** is
the answer: periodically freeze a collection out of the corpus. It is the same engine as
before with a much smaller claim — a release tagged from an ongoing body of work rather than
the playoff that ends the search.

Bookmarked works enter first, even when several came from one lineage, because a lineage is
provenance rather than a visual archetype. Remaining seats are filled from historical winners
by mixing confidence with graph novelty. Every nominee appears once in each of four named
rooms — **hush**, **pulse**, **lift**, **arrival** — with tempo, energy and section fixed
from a quiet opening to a high-energy chorus. Each match records preference *and* an
independent **show-ready** mark on either side, because a nominee is a finished work being
cast for a show; a batch match asks only the first question, which is why the two modules are
separate rather than one parameterized one.

Opening Finals freezes a snapshot. Nothing that happens afterward changes it, and opening it
again resumes the same run. **New edition** freezes another field from the current
bookmarks; earlier runs remain durable and are never reinterpreted.

## What every fact freezes

- **The candidate**: its id is a SHA-256 of canonical visual behaviour — kinds, modes, named
  targets, held values, depths, smoothing, wiring, and the complete transitive bundle of
  nested flows. Display names, canvas positions and labels are excluded by whitelist.
- **The origin**: method and version, deterministic deal seed, parent, generation, family,
  operation and exact operands. Leaps preserve every atomic step.
- **The seed judgment**: which root, under which room, admitted or declined. A skip is a
  separate disposition and never becomes a decline.
- **The batch**: its parent, its frozen field and entry order, whether each entrant is the
  parent, its one room, its rounds, and how it ended.
- **The match**: both candidates, the round, and left/right/both/neither plus renderer
  generation. A skip never becomes negative preference.
- **The bookmark**: candidate, marked or unmarked, and the room it was marked in.
- **The edition**: source experiment, nominees, selection order, room deck, pairings,
  preferences and independent show-ready marks.

Editing a library flow never changes what an old fact claims: the complete bundle rode along.
Copying a candidate into the open scheme likewise leaves the lab untouched.

## The method boundary

A `LabSearchMethod` reads a snapshot of candidates, origins and evidence, then proposes work.
It cannot render, persist an answer, touch a scheme or choose a room. The engine owns
deterministic seeds, compilation, canonical identity, persistence and room construction.

This is human-guided cultivation, not a trained policy and not a claim of reinforcement
learning. It creates the right raw material for one — explicit preferences, counterfactual
atomic changes under a shared control, rejected directions, lineage, diversity — and does so
as a byproduct of working the way somebody wants to work anyway, which is the only kind of
dataset that actually gets built. A later strategy population, learned surrogate or
prompt-conditioned policy should be a new versioned method over those facts, not a new
database and not a silent reinterpretation of old answers.

## What the lab never does

- It never writes a scheme automatically. **Copy** uses the console's ordinary edit path,
  makes the scheme dirty, and is saved normally. Developing the copy never mutates its frozen
  lab candidate.
- It never runs while unwatched. The database opens on the first lab message. Explore keeps
  exactly one root staged and generates the next only when that one is answered; a batch
  stages one match at a time. Closing Train unmounts its GL benches.
- It never takes the show with it. Store and gesture failures return a lab state with a
  notice rather than escaping the socket handler.
- It never moves with `OPENFLOW_VISUALS_SCHEME`. It lives under `OPENFLOW_HOME` at
  `~/.openflow/visuals/lab.sqlite3`, because a scratch scheme must not orphan the corpus.

## Portability

`LabStore.exportJsonl` writes every durable fact as versioned JSONL; `importJsonl` refills an
empty store from it. Render artifacts (`lab-artifacts/`, content-addressed) are optional
caches and deliberately excluded: graph, bundle, origin, room, renderer version and answer
are the durable identity.
