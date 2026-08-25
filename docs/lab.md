# The lab

`lab.ts`, `server/lab.ts`, `server/fresh.ts`, `src/ui/TrainView.tsx`,
`src/ui/ReviewsView.tsx`. One subsystem: the durable evidence under two console tabs —
**train**, where judgments are made, and **review**, where they are browsed.

## What it is for

The rig can deal flows (`roll.ts`) faster than anyone can decide which ones matter. The lab
is where that deciding happens without the decisions evaporating: one generated candidate at
a time gets the wall, a judge gives it an anchored score and a useful account of the score,
and the judgment is kept — with everything needed to know, years later, exactly what was
judged and under what conditions.

The visible names are **train** and **review**; the subsystem is the **lab**. `arena` was
rejected on purpose: unlike things would have to compete, and a library whose owner likes
many different kinds of thing is not a ladder. This is judging one dive at a time — and
coming back to what was judged.

## The shape

```
train view ───WS, three gestures──> server ── LabStore ──> ~/.openflow/visuals/lab.sqlite3
review tab ───WS, log/retag/renote──┤ │
     │                                │
     └── same Bench/compositor        └── LabMethod (fresh, …) deals candidates
```

- **`lab.ts`** is the shared contract: the tag vocabulary, the rubric, the submit rules,
  candidate identity, the room dealer, promotion, and the `LabMethod` boundary. Both ends of
  the wire import it, so neither can learn a private definition of what a judgment means.
- **`server/lab.ts`** is the store and the engine. The server is the only SQLite writer;
  browsers speak three coarse messages (`lab-open`, `lab-review`, `lab-skip`) and receive
  coarse `lab` state. WAL, transactions, `PRAGMA user_version` migrations, foreign keys.
- **`server/fresh.ts`** is the first methodology, deliberately plain: deal from
  `rollCircuit`, validate that it compiles, queue it. It exists to prove the boundary.
- Not everything judged is dealt: the build tab's **judge** button offers the open flow to
  the queue by hand (`lab-offer`), frozen with its bundle the way any candidate is, origin
  `manual`. Offers jump the queue — the person who offered is standing there, where the
  dealt supply is infinite and patient.
- **`TrainView.tsx`** draws the candidate through the same `Bench` the designer uses, on
  its own clock, needing no Ableton, no Link and no bridge — and when a bridge *is*
  connected, its source switch judges the candidate against the live set instead: real
  beat, real meters, real section and colourway. A live judgment freezes the set as a
  room, sampled at submit, palette by value, with `live` where a dealt room's seed goes.
- **`ReviewsView.tsx`** is the review tab: the log of past judgments, newest first, each
  re-staged on the bench from what the judgment froze — and its tags and note editable
  through the same `TagPicker` the train view uses, because a reviewer's vocabulary
  arrives after their taste does.

## Reviews are facts; scores are derived

A stored review binds one candidate to one room at one moment, and that binding is never
edited: no verb on the wire or in the store can change a review's candidate, room or
moment. The **assessment** — score, tags, note — is revisable from the review tab,
because taste is allowed to settle: a score given quickly tonight gets reconsidered, and
earns its tags, on a slower pass tomorrow. Anything that looks like "this candidate's score" is a named,
versioned calculation rebuilt from raw reviews (`aggregate`, `snapshotRatings`) — deleting
every derived row loses nothing. A **skip** is its own disposition in the `served` table,
never a low score; the corpus keeps skips, low scores, and everything else it was shown.

There is deliberately no global leaderboard and no single learned taste. A candidate's
score is evidence inside whatever regions its tags describe — serene + organic + drifting is
not competing with chaotic + set-forward + euphoric.

## What a judgment freezes

- **The candidate**: its id is a SHA-256 of canonical visual behaviour — kinds, modes,
  named targets, held values, depths, smoothing, wiring, and the complete transitive bundle
  of nested flows. Display names, canvas positions and labels are excluded by whitelist, so
  an editor field added later cannot silently re-identify the corpus. Editing a library flow
  never changes what an old judgment claims: the bundle rode along.
- **The room**: `challenges.room_json` holds the palette **by value**, plus tempo, energy,
  section, sections list and key — never a colourway name resolved against the open scheme.
  Rooms are dealt from seeds (`dealRoom`), so the exact conditions can be staged again.
- **The versions**: rubric, tag vocabulary, renderer generation, method id and version, and
  the seed the candidate was dealt from.

## The method boundary

A `LabMethod` may read a snapshot of evidence and propose `CandidateDraft`s; it cannot
render, persist a judgment, or touch a scheme — nothing in the interface reaches any of
those. The engine owns seeds (`experiment seed : deals so far`), so a method is
deterministic without holding state that a restart would lose, and a restarted server keeps
dealing from the same deck. Lineage, ablation, hard-room, underexplored and wild methods are
expected later; each should be one module and its tests.

`fresh` is versioned against the grammar it deals from: widening `rollCircuit` changes what
a seed means, so it is a version bump, and old candidates keep naming the deck they came
from.

## What the lab never does

- It never writes a scheme. **Promotion** copies the frozen candidate into the open
  in-memory scheme through the console's ordinary `edit`, which makes the scheme dirty and
  is saved by the ordinary save. The candidate and its reviews stay in the lab untouched.
- It never runs while unwatched. The database opens on the first `lab-open`, candidates are
  dealt only when the queue is empty and a review view is asking, and closing the view
  unmounts the one GL context it owns. A server nobody points a review view at does no
  evaluation work at all.
- It never moves with `OPENFLOW_VISUALS_SCHEME`. That variable pins a scheme file; the lab
  lives under `OPENFLOW_HOME` (`~/.openflow/visuals/lab.sqlite3`), because pointing the rig
  at a scratch scheme must not orphan a corpus.

## Portability

`LabStore.exportJsonl` writes every durable fact — experiments, candidates, origins,
challenges, evaluations, reviews, tags, dispositions, rating snapshots — as versioned
JSONL, and `importJsonl` refills an empty store from it. Render artifacts
(`lab-artifacts/`, content-addressed) are optional caches and deliberately excluded: the
flow, bundle, room and renderer version are the durable identity.
