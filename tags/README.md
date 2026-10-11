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
   best, calibrate it, find the threshold that reaches 85 % precision, check
   that whole procedure on presets it never saw (nested cross-validation),
   and write the report.
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
nothing is opened; Ctrl-C stops it). It answers only requests whose Host is
`127.0.0.1:<port>` or `localhost:<port>` (403 otherwise, against DNS
rebinding) and saves only POSTs sent as `application/json` (415 otherwise, so
another site's form can't post answers). One tag at a time, a grid of 48
moving clips:

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
are left out), these scorers are compared under stratified group k-fold
cross-validation (5 folds, or fewer when positives are few; every
near-duplicate cluster, below, stays whole in one fold, so a preset is never
tested against a near-copy that was trained on):

- a threshold on each single feature, in either direction;
- an L2-regularised logistic regression over all features (standardised on
  the training folds; a missing value takes the training mean);
- the rubric score alone, and logistic regression over the features plus the
  rubric score, when the tag has a rubric and most of its labelled presets
  have scores;
- for Unique, the distance to the nearest other preset in standardised
  feature space.

**The recipe**, run on a set of labelled presets: cross-validate every scorer
on it, choose the one with the best out-of-fold average precision, keep its
k fold models, fit Platt scaling (a logistic curve) to its out-of-fold scores
against the labels, and take as threshold the lowest confidence whose
out-of-fold precision is at least 0.85 with at least 5 true positives above
it (the most recall that keeps the precision).

**Held-out precision** — the number a tag ships on — is nested
cross-validation. The labelled presets are split into outer folds (near-
duplicates kept together). For each outer fold the whole recipe runs on the
other folds only, with inner folds of its own, so choosing the scorer,
calibrating it and picking its threshold never see the outer fold; then it
tags the outer fold's presets. Precision is the tagged presets labelled yes
over all those tagged, pooled over the outer folds; recall is the yeses
tagged over all the yeses. It is the precision to expect from this way of
choosing and fitting a scorer on presets it never saw. Picking the best of ~30
scorers and its threshold on the same predictions that measure it flatters
the number (on pure-noise labels it reaches 0.85 about half the time), which
is why those numbers, still shown in each tag's scorer table, don't decide
anything.

**Ships** means that held-out precision is at least 0.85 with at least 5 true
positives, and the recipe run on all the labels found a threshold. Its 95 %
Wilson lower bound is shown beside it: with few labels the true precision may
be well under the estimate. A tag that doesn't ship says why: not enough
labels (with the counts); a scorer that reaches the target on the labels that
chose it but not held out ("needs more labels or a better measurement"); or
the best any scorer reaches ("best single feature (flow, high) only reaches
0.61 precision; logistic 0.70; needs a measurement").

**Confidence** is what ships in `out/tags.json`: the recipe run on all the
labels, scoring every preset in the pack with the **mean of its k fold
models' raw scores**, through the Platt curve fitted on those same fold
models' out-of-fold scores, so 0.8 means about 80 % of presets scored like
that were labelled yes. Shipping the fold models' average, rather than a
model refitted on all the labels, keeps the shipped scores on the scale the
calibration and the threshold were fitted on (a refit's scores can sit on
another scale, which the Platt curve was never fitted to).
Confidences and thresholds are both rounded to 4 places, and a preset has the
tag when its confidence is at or over the threshold, exactly as the report
counts it.

One line per tag is printed, and `out/report.json` (every number),
`out/report.html` (per tag: label counts, the held-out precision, its lower
bound, recall and the threshold, each scorer's cross-validated AP, precision
and recall, ships or not yet with why, and moving clips of held-out presets
it gets right, tags wrongly and misses; then clusters of near-duplicate
presets) and `out/tags.json` (each preset's confidence for every tag that
ships, and the fold models, calibration and threshold to reproduce them) are
written.

**Near-duplicates**: presets whose nearest neighbour is closer than a quarter
of the median nearest-neighbour distance are joined; each connected group is
a cluster. The same clusters are the cross-validation's groups.

## Checks

`npm test` and `npm run typecheck` here (the root ones don't reach this
folder). The tests cover the vocabulary, label storage, grid picking, the
label server, the rubric's batch requests and result parsing (no real API
calls), the scorers and calibration on synthetic data, the group folds, that
pure-noise labels never ship, and the report on the fixture.
