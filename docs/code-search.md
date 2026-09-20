# Local code search with optional Jev ranking

This read-only prototype retrieves exact source excerpts. It does not answer the engineering question, edit files, or establish that missing results mean absent behavior. No measured quality or token savings have been established. The engine is transport-independent; the initial interface is a CLI, with no MCP configuration or hooks required.

Requires Node 26 and `rg` on PATH; uses existing dependencies only.

```sh
npm run search:code -- 'Where does the renderer consume palette colors?' --scope client
npm run search:code -- 'How are shader compilation errors reported?' --pattern 'compileShader|COMPILE_STATUS' --glob '**/*.ts'
npm run search:code -- 'Where does the preview get its colors?' --max-output-tokens 12000 --jev
npm run test:code-search
```

`--root` defaults to the working directory. Repeat `--scope` for relative directories and `--glob` for ripgrep file globs. `--pattern` uses ripgrep's default regex syntax to select matching lines; the required natural-language query still determines ranking. These are selected retrieval controls, not arbitrary ripgrep argument passthrough. No shell interpolation is used.

The engine interface is `searchCode({root, query, scopes?, pattern?, globs?, max_output_tokens?, jev?})`. The CLI prints one compact JSON result; use the direct Node command rather than npm if consuming stdout as JSON.

## Retrieval and response

Ripgrep discovers nonignored files, including untracked files. Additional default exclusions remove dependency/build outputs, lockfiles, hidden paths (except `.storybook`), common credential/private/recording filenames and unsupported extensions. Binary, invalid UTF-8, symlink files and paths resolving outside the configured root are excluded. Basic content checks reject private key blocks and obvious literal credential assignments. These heuristics are not a complete secret detector: restrict scopes to public/source-safe code before opting into remote ranking. The tool does not inspect credential files.

Without a pattern, a bounded local scan scores case-insensitive literal query terms and file paths. Stopwords are removed; this is lexical retrieval, not semantic indexing. With a pattern, ripgrep selects lines and the query scores the resulting candidates. Nearby matching lines form bounded, nonoverlapping line windows. No AST expansion is performed.

Limits: 1,500 eligible files; 256 KB per file; 8 MB total reads; 24 retained candidates; 3.5 KB per excerpt; 100 KB provider request; 32 KB provider response; four-second provider timeout. Discovery is capped at 1 MB and five seconds, failing explicitly if exceeded. Candidate truncation happens before Jev and can exclude important evidence. Sorted file scan order can bias results under limits. Narrow the scope or search again when limits are hit. File matching has a one-second timeout per file. No retries are made.

Each excerpt includes its relative path, one-based inclusive line range, exact text, whole-file and excerpt SHA-256, lexical score, and optional Jev score. The snapshot records Git HEAD when available, but hashes cover actual bytes read, including dirty and untracked content. It is not an atomic snapshot. Coverage reports read/scan counts, skipped files and limits; `exhaustive` is always false because retrieval is heuristic.

`max_output_tokens` is validated from 1,500 to 100,000 (default 12,000). For this prototype it caps **UTF-8 bytes of the complete compact JSON plus newline**, a conservative upper bound for typical byte-level tokenizers, not an exact tokenizer measurement. Metadata counts toward the limit. Excerpts are dropped whole until the response fits; very small budgets with long queries can fail explicitly if metadata alone exceeds budget.

## Optional remote ranking

Local retrieval is the default. `--jev` explicitly opts into sending the query and retained source excerpts to TypeSafe. Export `TYPESAFE_API_KEY` in the launching shell; never put it in source or CLI arguments. `TYPESAFE_MODEL` can override pinned `jev-1.13.0`. The endpoint is fixed to `https://api.typesafe.ai/v1/systemone`.

The request uses structured per-candidate score questions with three criteria (unrelated, contextual, direct evidence). Response scores must be finite in [0,2], confidence in [0,1], and every candidate must have an answer. Confidence is not a correctness probability. Success returns model and numeric token usage if provided. Missing keys, HTTP failures, malformed answers, size limits and timeouts retain deterministic lexical ranking with a non-secret fallback reason. Provider response bodies and credentials are never logged.

Official contract: [API](https://docs.typesafe.ai/api), [score primitive](https://docs.typesafe.ai/primitives/score), [structured questions](https://docs.typesafe.ai/concepts/how-to-build-with-system-one). Tests use synthetic fixtures and injected fetch; live smoke is opt-in and separate.
