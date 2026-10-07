// The comparison bench's page: Butterchurn | ours | difference per preset,
// worst first, with approve / reject / note. Written by `harness/compare.ts`;
// served by it, which is what lets the page save.

export interface Approval {
  verdict: 'approve' | 'reject' | null;
  note: string;
  /** The score when the verdict was given. */
  score: number | null;
  at: string;
}

export interface ReportFrame {
  frame: number;
  time: number;
  butterchurn: string;
  ours: string;
  diff: string;
  score: number;
  parts: Record<string, number>;
}

export interface ReportPreset {
  /** The path in the pack: what approvals are keyed by. */
  id: string;
  name: string;
  folder: string;
  /** 0–100, the mean of the frames'; null when either engine could not draw it. */
  score: number | null;
  frames: ReportFrame[];
  notes: string[];
}

export interface Report {
  generated: string;
  settings: { width: number; height: number; frames: number; dt: number; refresh?: number; seed: string; captures: number[]; presetsRoot: string };
  weights: Record<string, number>;
  approvalsFile: string;
  presets: ReportPreset[];
  approvals: Record<string, Approval>;
}

export function reportHtml(report: Report): string {
  // `</` cannot end the script early.
  const data = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engine comparison</title>
<style>
  :root { --bg: #111; --panel: #1b1b1b; --line: #2c2c2c; --text: #ddd; --dim: #888; --good: #4caf72; --bad: #e0574f; --mid: #d6a740; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.4 -apple-system, system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 2; background: #151515ee; backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
  header h1 { font-size: 15px; margin: 0 8px 0 0; }
  label { color: var(--dim); }
  input, select, textarea, button { font: inherit; color: var(--text); background: #222; border: 1px solid var(--line); border-radius: 4px; padding: 3px 6px; }
  input[type=number] { width: 4.5em; }
  button { cursor: pointer; }
  #banner { display: none; background: #3a2a10; color: #f0d090; padding: 6px 16px; }
  main { padding: 12px 16px 60px; }
  .meta { color: var(--dim); margin-bottom: 10px; }
  .preset { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; margin-bottom: 14px; padding: 10px 12px; }
  .preset.approve { border-color: #2f6b45; } .preset.reject { border-color: #7a312c; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
  .name { font-weight: 600; font-size: 14px; }
  .folder { color: var(--dim); }
  .score { font-weight: 700; font-variant-numeric: tabular-nums; padding: 0 6px; border-radius: 4px; }
  .notes { color: #d9a35a; margin: 4px 0 0; padding-left: 18px; }
  .frame { margin-top: 8px; }
  .frame .label { color: var(--dim); font-variant-numeric: tabular-nums; margin-bottom: 3px; }
  .trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .trio figure { margin: 0; }
  .trio figcaption { color: var(--dim); font-size: 11px; }
  .trio img { width: 100%; height: auto; display: block; background: #000; image-rendering: auto; }
  .verdict { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
  .verdict button.on.approve { background: #2f6b45; } .verdict button.on.reject { background: #7a312c; }
  .verdict textarea { flex: 1 1 260px; min-height: 28px; resize: vertical; }
  .saved { color: var(--dim); font-size: 11px; }
  @media (max-width: 700px) { .trio { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Butterchurn | ours</h1>
  <label>sort <select id="sort"><option value="worst">worst first</option><option value="best">best first</option><option value="name">name</option></select></label>
  <label>score <input id="min" type="number" min="0" max="100" value="0"> – <input id="max" type="number" min="0" max="100" value="100"></label>
  <label>show <select id="show"><option value="all">all</option><option value="open">not yet judged</option><option value="approve">approved</option><option value="reject">rejected</option><option value="unscored">unscored</option></select></label>
  <label>find <input id="find" type="search" placeholder="name or folder"></label>
  <span id="count" class="folder"></span>
  <button id="download" title="Every verdict as JSON">download approvals</button>
</header>
<div id="banner">Not saving: open this page through <code>npm run compare -- --serve</code>. Verdicts made here are kept until the page closes; download them to keep them.</div>
<main>
  <div class="meta" id="meta"></div>
  <div id="list"></div>
</main>
<script id="data" type="application/json">${data}</script>
<script>
const report = JSON.parse(document.getElementById('data').textContent);
let approvals = report.approvals || {};
let saving = location.protocol.startsWith('http');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const colour = (s) => s === null ? '#555' : s >= 80 ? 'var(--good)' : s >= 60 ? 'var(--mid)' : 'var(--bad)';
const s = report.settings;
$('meta').textContent = report.presets.length + ' presets, ' + s.width + '×' + s.height + ', ' + s.frames + ' frames at ' + (1 / s.dt).toFixed(0) +
  ' fps, seed ' + s.seed + '. Score 0–100: ' + Object.entries(report.weights).map(([k, w]) => k + ' ' + Math.round(w * 100) + '%').join(', ') +
  '. Difference images are |Butterchurn − ours| × 2. Approvals: ' + report.approvalsFile + '. Generated ' + new Date(report.generated).toLocaleString() + '.';

function banner(on) { $('banner').style.display = on ? 'block' : 'none'; }
if (!saving) banner(true);
else fetch('/approvals').then((r) => r.json()).then((a) => { approvals = a; render(); }).catch(() => { saving = false; banner(true); });

async function save(p, verdict, note) {
  const entry = { verdict, note, score: p.score, at: new Date().toISOString() };
  if (!verdict && !note) delete approvals[p.id]; else approvals[p.id] = entry;
  if (!saving) return 'kept in this page';
  try {
    const res = await fetch('/approvals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.id, verdict, note, score: p.score }) });
    if (!res.ok) throw new Error(await res.text());
    return 'saved';
  } catch (e) {
    saving = false; banner(true);
    return 'not saved: ' + e.message;
  }
}

function card(p) {
  const a = approvals[p.id] || { verdict: null, note: '' };
  const el = document.createElement('section');
  el.className = 'preset' + (a.verdict ? ' ' + a.verdict : '');
  const parts = p.frames.length ? Object.keys(p.frames[0].parts).map((k) =>
    k + ' ' + (p.frames.reduce((t, f) => t + f.parts[k], 0) / p.frames.length).toFixed(2)).join(' · ') : '';
  el.innerHTML =
    '<div class="head"><span class="score" style="background:' + colour(p.score) + '">' + (p.score === null ? '—' : p.score.toFixed(1)) + '</span>' +
    '<span class="name">' + esc(p.name) + '</span><span class="folder">' + esc(p.folder) + '</span><span class="folder">' + esc(parts) + '</span></div>' +
    (p.notes.length ? '<ul class="notes">' + p.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
    p.frames.map((f) => '<div class="frame"><div class="label">frame ' + f.frame + ' · ' + f.time.toFixed(2) + ' s · score ' + f.score.toFixed(1) + '</div><div class="trio">' +
      [['Butterchurn', f.butterchurn], ['ours', f.ours], ['difference', f.diff]].map(([c, src]) =>
        '<figure><img loading="lazy" src="' + esc(src) + '" width="' + s.width + '" height="' + s.height + '" alt="' + c + '"><figcaption>' + c + '</figcaption></figure>').join('') +
      '</div></div>').join('') +
    '<div class="verdict"><button class="approve">approve</button><button class="reject">reject</button>' +
    '<textarea placeholder="note"></textarea><span class="saved"></span></div>';
  const [approve, reject] = el.querySelectorAll('.verdict button');
  const note = el.querySelector('textarea');
  const status = el.querySelector('.saved');
  note.value = a.note || '';
  let verdict = a.verdict || null;
  const paint = () => {
    approve.className = 'approve' + (verdict === 'approve' ? ' on' : '');
    reject.className = 'reject' + (verdict === 'reject' ? ' on' : '');
    el.className = 'preset' + (verdict ? ' ' + verdict : '');
  };
  paint();
  const commit = async () => { status.textContent = '…'; status.textContent = await save(p, verdict, note.value.trim()); };
  approve.onclick = () => { verdict = verdict === 'approve' ? null : 'approve'; paint(); commit(); };
  reject.onclick = () => { verdict = verdict === 'reject' ? null : 'reject'; paint(); commit(); };
  note.onchange = commit;
  return el;
}

function render() {
  const min = Number($('min').value), max = Number($('max').value), show = $('show').value, find = $('find').value.toLowerCase();
  const list = report.presets.filter((p) => {
    const v = (approvals[p.id] || {}).verdict;
    if (show === 'unscored') return p.score === null;
    if (show === 'open' && v) return false;
    if ((show === 'approve' || show === 'reject') && v !== show) return false;
    if (find && !(p.name + ' ' + p.folder).toLowerCase().includes(find)) return false;
    return p.score === null ? show === 'all' || show === 'open' : p.score >= min && p.score <= max;
  });
  const sort = $('sort').value;
  const value = (p) => p.score === null ? -1 : p.score;
  list.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'best' ? (a, b) => value(b) - value(a) : (a, b) => value(a) - value(b));
  $('count').textContent = list.length + ' shown';
  const root = $('list');
  root.replaceChildren(...list.map(card));
}
for (const id of ['sort', 'min', 'max', 'show', 'find']) $(id).addEventListener('input', render);
$('download').onclick = () => {
  const blob = new Blob([JSON.stringify(approvals, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'approvals.json';
  a.click();
};
render();
</script>
</body>
</html>
`;
}
