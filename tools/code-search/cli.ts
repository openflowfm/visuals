import { parseArgs } from 'node:util';
import { searchCode } from './index.ts';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, scope: { type: 'string', multiple: true }, pattern: { type: 'string' }, glob: { type: 'string', multiple: true }, 'max-output-tokens': { type: 'string' }, jev: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) console.log('Usage: node tools/code-search/cli.ts "question" [--root DIR] [--scope RELATIVE_DIR] [--pattern REGEX] [--glob GLOB] [--max-output-tokens 12000] [--jev]\nRequires rg on PATH. Local lexical retrieval by default. --jev sends excerpts to TypeSafe using TYPESAFE_API_KEY; TYPESAFE_MODEL optionally overrides jev-1.13.0.');
  else {
    if (positionals.length !== 1) throw new Error('provide exactly one quoted query; use --help');
    const result = await searchCode({ root: values.root ?? process.cwd(), query: positionals[0], scopes: values.scope, pattern: values.pattern, globs: values.glob, max_output_tokens: values['max-output-tokens'] === undefined ? undefined : Number(values['max-output-tokens']), jev: values.jev }, { apiKey: process.env.TYPESAFE_API_KEY, model: process.env.TYPESAFE_MODEL });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'Code search failed'); process.exitCode = 1; }
