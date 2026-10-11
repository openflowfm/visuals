# tags

Development-only tool for an empirical tagging system for the preset pack: hand
labels, measured features and Claude's picture judgements turned into tags with
a calibrated confidence, where a tag ships only if it reaches **≥ 85 %
precision on presets Ryan labelled by hand that the scorer never saw**. It is
for us, not for app users; nothing here ships in the app.

```sh
cd tags && npm ci
```

## The loop

```
features ──▶ label ──▶ rubric ──▶ score ──▶ (read the report) ──▶ iterate
```

1. **Features.** The engine's `features` bin (lane A) draws every preset and
   writes `DIR/features.json` (one row per preset: path, content hash, style,
   a number or null per measurement, its clip) and `DIR/clips/<hash16>.webp`,
   a horizontal sprite of 24 frames of 192×144. Feature names aren't fixed:
   everything here reads them generically. Until real features exist,
   `npm run fixture -- DIR [--n N] [--seed S] [--labels FILE]` makes a
   made-up DIR in the same shape (and, with `--labels`, simulated labels).
2. **Label.** Hand-label presets, one tag at a time (below). The labels are
   ground truth and are committed.
3. **Rubric.** For tags a picture judgement suits, Claude rates every preset
   0–1 from a sheet of its frames.
4. **Score.** Fit and compare scorers per tag under cross-validation, pick the
   best, calibrate it, find the threshold that reaches 85 % precision, and
   write the report.
5. **Iterate.** The report says what each tag lacks: more labels, a better
   rubric, or a measurement lane A doesn't take yet ("best single feature
   only reaches 0.6"). Label more where it's close, add or fix the measurement
   or rubric where it isn't, and score again.

## The vocabulary

[`vocabulary.json`](vocabulary.json): each tag's `id`, display `name`, `group`
(colour, temperature, motion, texture, character, structure), the one
`question` the labeller is asked ("Which of these are Liquid: flowing, fluid
motion?"), optionally a `proxy` feature (`{feature, direction}`) used to pick
which presets a labelling grid shows, a Claude `rubric` (what the tag means,
with the 0 and 1 anchors) for tags a picture judgement suits, and for Unique
`scorer: "nearest-neighbour"`. The proxies' feature names are guesses at lane
A's: a tag whose proxy isn't in the features gets random grids, and the label
command says so at start. `src/vocabulary.ts` checks it; the tests fail on an
invalid one.

## `npm run label -- <features DIR> [--labels FILE] [--port N] [--size 48]`

A local page on 127.0.0.1 (a free port unless `--port`; the URL is printed,
nothing is opened; Ctrl-C stops it). One tag at a time, a grid of 48 moving
clips:

- **click** (or space) marks a clip as having the tag; again un-marks it;
- **shift-click** (or `u`) marks it unsure;
- **Enter** submits: every clip left unmarked counts as not having the tag,
  and the next grid loads; `r` loads another grid without saving;
- arrows move over the grid, `]`/`n` and `[`/`p` change tag, `t` lists the
  tags with their progress, `?` shows the keys.

Every answer is appended to `labels.json` (or `FILE`) the moment it's given,
keyed by the preset's content hash, with the tag, the answer (yes, no or
unsure) and when; the latest answer for a preset and tag wins, so a
correction is just another label and the file only grows. A grid shows
presets not yet answered for that tag: about a third likely positives and a
third likely negatives by the tag's proxy feature (nearest-neighbour distance
for Unique), the rest random, shuffled, so positives aren't rare.

## `npm run rubric -- <features DIR> [--tags a,b] [--yes] [--limit N]`

Claude (`claude-sonnet-5-5`, through the Message Batches API at half price)
rates each preset 0–1 for each rubric tag, from a 4×2 sheet of 8 frames of its
clip and the rubrics, and nothing else: no path, name, author or features.
Scores are cached by content hash in `out/rubric.json`, with a hash of the
rubric they answered, so a rerun sends only new presets and edited rubrics.
It prints the request count and the estimated cost first (about $27 for the
whole pack and every rubric tag), then exits 2 without `ANTHROPIC_API_KEY`,
or 0 without `--yes`. With `--yes` it sends, remembers the batch in
`out/rubric-pending.json` (a rerun after an interruption waits for it rather
than sending again), checks every 30 s, and stores the scores as they come.

## `npm run score -- <features DIR> [--labels FILE] [--rubric FILE] [--out DIR] [--folds K] [--min-yes N] [--min-no N] [--seed S]`

For each tag with enough labels (10 yes and 10 no by default; unsure answers
are left out), compared under stratified k-fold cross-validation (5 folds, or
fewer when positives are few):

- a threshold on each single feature, in either direction;
- an L2-regularised logistic regression over all features (standardised on
  the training folds; a missing value takes the training mean);
- the rubric score alone, and logistic regression over the features plus the
  rubric score, when the tag has a rubric and most of its labelled presets
  have scores;
- for Unique, the distance to the nearest other preset in standardised
  feature space.

The scorer with the best held-out average precision is chosen. One line per
tag is printed, and `out/report.json` (every number), `out/report.html` (per
tag: label counts, each scorer's held-out precision, recall and AP, the chosen
scorer and threshold, ships or not yet with why, and moving clips of what it
gets right, what it tags wrongly and what it misses; then clusters of
near-duplicate presets) and `out/tags.json` (each preset's confidence for
every tag that ships, and the fitted scorers to reproduce them) are written.

**Confidence** is the chosen scorer's output passed through Platt scaling (a
logistic curve fitted to the held-out scores against the labels), so 0.8
means about 80 % of presets scored like that were labelled yes.

**Ships** means there is a confidence threshold at which the chosen scorer's
held-out precision is at least 0.85 with at least 5 true positives (the
threshold taken is the one with the most recall; a 95 % Wilson lower bound is
shown beside it, as the threshold was picked on the same predictions). Every
held-out number comes from presets the scorer was not fitted on. A tag that
doesn't ship says why: not enough labels (with the counts), or the best any
scorer reaches ("best single feature (flow, high) only reaches 0.61
precision; logistic 0.70; needs a measurement").

**Near-duplicates**: presets whose nearest neighbour is closer than a quarter
of the median nearest-neighbour distance are joined; each connected group is
a cluster.

## Checks

`npm test` and `npm run typecheck` here (the root ones don't reach this
folder). The tests cover the vocabulary, label storage, grid picking, the
label server, the rubric's batch requests and result parsing (no real API
calls), the scorers and calibration on synthetic data, and the report on the
fixture.
