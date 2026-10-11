// The score report as a page (`tags/out/report.html`): per tag, its labels,
// how each scorer did on held-out presets, whether it ships and why not, and
// the presets themselves as moving clips: the ones it gets right, the ones it
// tags wrongly and the ones it misses. The clips are the point; everything
// else stays quiet. Self-contained but for the clips, which it references by
// absolute file:// URL in the features folder.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Features, FeatureRow } from './features.ts';
import type { Report, ScorerReport, TagReport } from './score-core.ts';

const SHOWN_FEATURES = 8;
const W = 144;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function n2(x: number | null | undefined): string {
  return x === null || x === undefined ? '–' : x.toFixed(2);
}

export function clipUrl(dir: string, row: FeatureRow): string {
  return pathToFileURL(resolve(dir, 'clips', row.clip)).href;
}

function clip(row: FeatureRow | undefined, dir: string): string {
  if (!row) return '';
  return `<figure class="clip" title="${esc(row.path)}"><div class="sprite" style="background-image:url('${esc(clipUrl(dir, row))}')"></div><figcaption>${esc(row.path.replace(/\.milk$/, ''))}</figcaption></figure>`;
}

function strip(title: string, hashes: string[], rows: Map<string, FeatureRow>, dir: string, empty: string): string {
  const body = hashes.length ? hashes.map((h) => clip(rows.get(h), dir)).join('') : `<p class="none">${esc(empty)}</p>`;
  return `<div class="strip"><h4>${esc(title)} <span>${hashes.length}</span></h4><div class="clips">${body}</div></div>`;
}

function scorerRow(s: ScorerReport, chosen: boolean): string {
  const at = s.at;
  const p = at ? `${n2(at.precision)}${at.reached ? '' : '<sup>F1</sup>'}` : '–';
  return `<tr class="${chosen ? 'chosen' : ''}"><td>${chosen ? '●' : ''}</td><td>${esc(s.label)}</td><td>${n2(s.ap)}</td><td>${p}</td><td>${at ? n2(at.recall) : '–'}</td><td>${n2(s.maxPrecision)}</td></tr>`;
}

function scorerTable(t: TagReport): string {
  if (!t.scorers.length) return '';
  const byAp = t.scorers.slice().sort((a, b) => b.ap - a.ap);
  const features = byAp.filter((s) => s.kind === 'feature');
  const shown = new Set([...byAp.filter((s) => s.kind !== 'feature'), ...features.slice(0, SHOWN_FEATURES)].map((s) => s.id));
  if (t.chosen) shown.add(t.chosen);
  const rows = byAp
    .filter((s) => shown.has(s.id))
    .map((s) => scorerRow(s, s.id === t.chosen))
    .join('');
  const more = features.length > SHOWN_FEATURES ? `<p class="more">and ${features.length - SHOWN_FEATURES} more single features below these</p>` : '';
  return `<table><thead><tr><th></th><th>scorer</th><th>AP</th><th>precision</th><th>recall</th><th>best P</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}

function tagSection(t: TagReport, rows: Map<string, FeatureRow>, dir: string): string {
  const c = t.counts;
  const status = t.ships ? '<span class="pill ships">ships</span>' : '<span class="pill">not yet</span>';
  const at = t.threshold !== null ? (t.ships ? `confidence ≥ ${n2(t.threshold)}` : `best F1 at confidence ${n2(t.threshold)}`) : '';
  const nums =
    t.threshold !== null
      ? `<div class="nums"><div><b>${n2(t.precision)}</b>precision</div><div><b>${n2(t.precisionLower)}</b>lower bound</div><div><b>${n2(t.recall)}</b>recall</div><div><b>${n2(t.threshold)}</b>${t.ships ? 'threshold' : 'best F1 at'}</div></div>`
      : '';
  const clips =
    t.examplesAt !== null
      ? strip('Tagged, and right', t.examples.truePositives, rows, dir, 'none above the threshold') +
        strip('Tagged, but labelled no', t.examples.falsePositives, rows, dir, 'none: every preset above the threshold was a yes') +
        strip('Labelled yes, but missed', t.examples.missed, rows, dir, 'none missed')
      : '';
  return `<section id="tag-${esc(t.id)}">
<header><h2>${esc(t.name)}</h2><span class="group">${esc(t.group)}</span>${status}<span class="counts">${c.usableYes} yes · ${c.usableNo} no${c.unsure ? ` · ${c.unsure} unsure` : ''}${t.folds ? ` · ${t.folds}-fold` : ''}</span></header>
<p class="diag">${esc(t.diagnosis)}${at && !t.ships ? ` <span>(examples at ${esc(at)})</span>` : ''}</p>
<div class="body">${nums}${scorerTable(t)}</div>
${clips}
</section>`;
}

export function renderReport(report: Report, features: Features, dir: string): string {
  const rows = new Map(features.rows.map((r) => [r.hash, r]));
  const [cw, ch] = features.clip.size;
  const h = Math.round((W * ch) / cw);
  const seconds = features.clip.frames / Math.max(1, features.clip.fps);
  const shipping = report.tags.filter((t) => t.ships).length;
  const index = report.tags.map((t) => `<a href="#tag-${esc(t.id)}" class="${t.ships ? 'ships' : t.scorers.length ? 'tried' : 'empty'}">${esc(t.name)}</a>`).join('');
  // Tags no scorer could be tried on yet are one line each, after the rest.
  const waiting = report.tags.filter((t) => !t.ships && !t.scorers.length);
  const dup = report.duplicates;
  const clusters = dup.clusters.length
    ? dup.clusters.map((c) => `<div class="cluster"><div class="clips">${c.hashes.map((hh) => clip(rows.get(hh), dir)).join('')}</div></div>`).join('')
    : '<p class="none">none found</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tag report</title>
<style>
:root { --bg: #0b0c0e; --fg: #e8e6e3; --dim: #8a8f98; --faint: #2a2d33; --accent: #7ee0b5; --warn: #e0a96e; --w: ${W}px; --h: ${h}px; --frames: ${features.clip.frames}; --dur: ${seconds.toFixed(2)}s; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1240px; margin: 0 auto; padding: 48px 24px 96px; }
h1 { font-weight: 600; font-size: 28px; letter-spacing: -0.02em; margin: 0 0 4px; }
.sub { color: var(--dim); margin: 0 0 28px; }
nav { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 56px; }
nav a { color: var(--dim); text-decoration: none; font-size: 13px; }
nav a.ships { color: var(--accent); }
nav a.empty { opacity: 0.45; }
nav a:hover { color: var(--fg); }
section { margin: 0 0 72px; }
header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; }
h2 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.group, .counts { color: var(--dim); font-size: 13px; }
.counts { margin-left: auto; font-variant-numeric: tabular-nums; }
.pill { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--warn); }
.pill.ships { color: var(--accent); }
.diag { color: var(--dim); margin: 6px 0 18px; max-width: 900px; }
.diag span { opacity: 0.7; }
.body { display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start; margin-bottom: 20px; }
.nums { display: flex; gap: 28px; }
.nums div { color: var(--dim); font-size: 12px; display: flex; flex-direction: column; }
.nums b { color: var(--fg); font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
table { border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
th { color: var(--dim); font-weight: 400; text-align: right; padding: 2px 10px; }
td { padding: 2px 10px; text-align: right; color: var(--dim); }
th:nth-child(2), td:nth-child(2) { text-align: left; }
td:first-child { color: var(--accent); padding: 2px 0; width: 10px; }
tr.chosen td { color: var(--fg); }
sup { font-size: 9px; color: var(--dim); margin-left: 2px; }
.more { color: var(--dim); font-size: 12px; margin: 4px 10px 0; opacity: 0.7; }
.strip { margin-top: 14px; }
h4 { font-size: 12px; font-weight: 500; color: var(--dim); margin: 0 0 8px; letter-spacing: 0.02em; }
h4 span { opacity: 0.6; margin-left: 4px; }
.clips { display: flex; flex-wrap: wrap; gap: 10px; }
.clip { margin: 0; width: var(--w); }
.sprite { width: var(--w); height: var(--h); border-radius: 6px; background-color: #000; background-repeat: no-repeat; background-size: calc(var(--w) * var(--frames)) var(--h); animation: play var(--dur) steps(var(--frames)) infinite; }
@keyframes play { from { background-position: 0 0; } to { background-position: calc(var(--w) * var(--frames) * -1) 0; } }
@media (prefers-reduced-motion: reduce) { .sprite { animation: none; } }
figcaption { color: var(--dim); font-size: 11px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.none { color: var(--dim); opacity: 0.6; font-size: 12px; margin: 0; }
.waiting { list-style: none; padding: 0; margin: 12px 0 0; columns: 2 420px; column-gap: 40px; }
.waiting li { display: flex; gap: 12px; padding: 3px 0; font-size: 13px; break-inside: avoid; }
.waiting b { font-weight: 500; min-width: 96px; }
.waiting span { color: var(--dim); }
.cluster { padding: 12px 0; border-top: 1px solid var(--faint); }
</style>
</head>
<body>
<main>
<h1>Tags</h1>
<p class="sub">${shipping} of ${report.tags.length} tags ship · ${report.presets} presets (${report.skipped} skipped by the features run) · ${report.rubricScores} with rubric scores · held-out precision target ${n2(report.options.target)}</p>
<nav>${index}</nav>
${[...report.tags.filter((t) => t.ships), ...report.tags.filter((t) => !t.ships && t.scorers.length)].map((t) => tagSection(t, rows, dir)).join('\n')}
${waiting.length ? `<section id="waiting"><header><h2>Waiting for labels</h2><span class="counts">${waiting.length} tags</span></header><ul class="waiting">${waiting.map((t) => `<li id="tag-${esc(t.id)}"><b>${esc(t.name)}</b><span>${esc(t.diagnosis)}</span></li>`).join('')}</ul></section>` : ''}
<section id="duplicates">
<header><h2>Near-duplicates</h2><span class="counts">${dup.clusters.length} clusters</span></header>
<p class="diag">${esc(dup.rule)}: median ${n2(dup.medianDistance)}, cutoff ${n2(dup.cutoff)}.</p>
${clusters}
</section>
</main>
</body>
</html>
`;
}
