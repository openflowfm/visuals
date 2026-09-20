import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { searchCode, LIMITS } from './index.ts';
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'code-search-test-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: root });
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n');
    await writeFile(path.join(root, 'src/palette.ts'), '// palette colors\nexport const palette = ["red", "green"];\n');
    await writeFile(path.join(root, 'src/other.ts'), 'export const colors = "white";\n');
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('relevance, exact source, dirty hashes and budget', () => fixture(async root => {
  const result = await searchCode({ root, query: 'palette colors', max_output_tokens: 1800 });
  assert.equal(result.excerpts[0].path, 'src/palette.ts');
  assert.equal(result.excerpts[0].text, '// palette colors\nexport const palette = ["red", "green"];\n');
  assert.equal(Buffer.byteLength(JSON.stringify(result)) + 1, result.budget.serialized_bytes);
  assert.ok(result.budget.serialized_bytes <= 1800);
  const before = result.excerpts[0].content_sha256;
  await writeFile(path.join(root, 'src/palette.ts'), 'export const palette = "blue";\n');
  assert.notEqual((await searchCode({ root, query: 'palette' })).excerpts[0].content_sha256, before);
}));
test('ignores secrets, binary, symlinks and validates scopes', () => fixture(async root => {
  for (const file of ['ignored.ts', 'secrets.json', '.env.ts']) await writeFile(path.join(root, file), 'palette');
  await writeFile(path.join(root, 'binary.ts'), Buffer.from('palette\0'));
  await writeFile(path.join(root, 'hidden.ts'), 'const api_key = "abcdefghijklmnop"; // palette');
  await symlink('/etc/passwd', path.join(root, 'escape.ts'));
  await symlink('/etc', path.join(root, 'escape'));
  const result = await searchCode({ root, query: 'palette' });
  assert.deepEqual(result.excerpts.map(e => e.path), ['src/palette.ts']);
  for (const scope of ['../', '/etc', 'escape']) await assert.rejects(searchCode({ root, query: 'palette', scopes: [scope] }));
  assert.equal((await searchCode({ root, query: 'palette', scopes: ['src'] })).excerpts.length, 1);
}));
test('pattern and glob narrow retrieval independently of question', () => fixture(async root => {
  const result = await searchCode({ root, query: 'unrelated question', pattern: 'colors', globs: ['**/other.ts'] });
  assert.equal(result.excerpts[0].path, 'src/other.ts');
  await assert.rejects(searchCode({ root, query: 'palette', pattern: '[' }));
}));
test('bounded file sizes and output', () => fixture(async root => {
  await writeFile(path.join(root, 'large.ts'), 'palette'.repeat(LIMITS.fileBytes));
  const result = await searchCode({ root, query: 'palette', max_output_tokens: 1500 });
  assert.ok(result.coverage.limits_hit.includes('file_bytes'));
  assert.ok(result.budget.serialized_bytes <= 1500);
  await assert.rejects(searchCode({ root, query: 'palette', max_output_tokens: 100 }));
}));
test('Jev request and ranked score response, no key fallback', () => fixture(async root => {
  const missing = await searchCode({ root, query: 'palette colors', jev: true });
  assert.equal(missing.ranking.fallback_reason, 'missing_api_key');
  const mock: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    const request = JSON.parse(init!.body as string);
    assert.equal(request.model, 'jev-1.13.0');
    assert.equal(request.state.query, 'palette colors');
    assert.equal(request.questions.candidate_0.instructions.candidate.path, 'src/palette.ts');
    return Response.json({ answers: Object.fromEntries(Object.keys(request.questions).map((key, i) => [key, { type: 'score', score: i, confidence: 0.7 }])) });
  };
  const result = await searchCode({ root, query: 'palette colors', jev: true }, { apiKey: 'synthetic', fetch: mock });
  assert.equal(result.ranking.method, 'jev');
  assert.equal(result.excerpts[0].path, 'src/other.ts');
}));
test('malformed, oversized, HTTP and timeout failures retain lexical results', () => fixture(async root => {
  const mocks: typeof fetch[] = [async () => Response.json({ answers: {} }), async () => new Response('x'.repeat(LIMITS.responseBytes + 1)), async () => new Response('private error', { status: 429 }), async () => { throw new Error('private data'); }, async () => new Promise(() => {})];
  for (const mock of mocks) {
    const result = await searchCode({ root, query: 'palette', jev: true }, { apiKey: 'synthetic', fetch: mock, timeoutMs: 10 });
    assert.equal(result.ranking.method, 'lexical');
    assert.equal(result.excerpts[0].path, 'src/palette.ts');
    assert.ok(result.ranking.fallback_reason);
    assert.ok(!JSON.stringify(result).includes('private data'));
  }
}));
test('candidate caps, output truncation and overlapping hits', () => fixture(async root => {
  for (let i = 0; i < 30; i++) await writeFile(path.join(root, 'src', `fixture${i}.ts`), `// palette ${i}\n` + '// colors\n'.repeat(60));
  const result = await searchCode({ root, query: 'palette colors', max_output_tokens: 1800 });
  assert.ok(result.coverage.limits_hit.includes('candidates'));
  assert.ok(result.coverage.limits_hit.includes('output_budget'));
  assert.ok(result.budget.serialized_bytes <= 1800);
  const expanded = await searchCode({ root, query: 'palette colors', max_output_tokens: 100000 });
  assert.ok(expanded.excerpts.length <= LIMITS.candidates);
  for (const excerpt of expanded.excerpts) for (const other of expanded.excerpts) {
    if (excerpt === other || excerpt.path !== other.path) continue;
    assert.ok(excerpt.end_line < other.start_line || other.end_line < excerpt.start_line);
  }
}));
test('partial valid scores followed by malformed score do not alter ranking', () => fixture(async root => {
  const result = await searchCode({ root, query: 'palette colors', jev: true }, { apiKey: 'synthetic', fetch: async () => Response.json({ answers: { candidate_0: { type: 'score', score: 0, confidence: 0.8 }, candidate_1: { type: 'score', score: 9, confidence: 0.8 } } }) });
  assert.equal(result.ranking.fallback_reason, 'malformed_scores');
  assert.equal(result.excerpts[0].path, 'src/palette.ts');
  assert.ok(result.excerpts.every(excerpt => excerpt.score === undefined));
}));
test('positive globs only narrow ignore-respecting discovery', () => fixture(async root => {
  await writeFile(path.join(root, 'ignored.ts'), 'export const needle = 1;\n');
  await writeFile(path.join(root, 'src/visible.ts'), 'export const needle = 2;\n');
  const result = await searchCode({ root, query: 'needle', globs: ['*.ts'] });
  assert.deepEqual(result.excerpts.map(excerpt => excerpt.path), ['src/visible.ts']);
}));
test('excerpt byte trimming preserves lexical and regex match anchors', () => fixture(async root => {
  const prefix = ('//' + 'x'.repeat(998) + '\n').repeat(4);
  await writeFile(path.join(root, 'src/anchor.ts'), prefix + 'export const needle = 1;\n');
  for (const pattern of [undefined, 'needle']) {
    const result = await searchCode({ root, query: pattern ? 'unrelated' : 'needle', pattern });
    assert.equal(result.excerpts.length, 1);
    assert.ok(result.excerpts[0].text.includes('export const needle = 1;'));
    assert.equal(result.excerpts[0].end_line, 5);
    assert.ok(result.excerpts[0].start_line > 1);
    assert.ok(Buffer.byteLength(result.excerpts[0].text) <= LIMITS.excerptBytes);
  }
  await writeFile(path.join(root, 'src/anchor.ts'), 'needle' + 'x'.repeat(LIMITS.excerptBytes));
  const oversized = await searchCode({ root, query: 'needle' });
  assert.equal(oversized.excerpts.length, 0);
  assert.ok(oversized.coverage.limits_hit.includes('excerpt_bytes'));
}));
