/**
 * Every binary expression in a MilkDrop shader, parenthesised.
 *
 * **Why this exists.** `milkdrop-preset-converter@0.1.2` translates HLSL to GLSL
 * through an Emscripten build of hlslparser, and that build mis-parses any
 * binary operator whose left operand is itself a binary expression: `a * 2 + b`,
 * `a - b + c` and `a + b + c` all come out as `bvec(…) && bvec(…)`, with the
 * real operator lost. GLSL refuses `&&` on vectors, so the shader fails to
 * compile — and that one shape is in nearly every MilkDrop 2 preset, because
 * `GetBlur1(uv)` expands to `tex * scale + bias`. Written with the left operand
 * already in parentheses, `(a * 2) + b`, the same converter is correct.
 *
 * So this re-prints the shader with every binary sub-expression bracketed and
 * changes nothing else: same tokens, same order, same whitespace and comments.
 * Brackets never change what C-family precedence already meant, so the result
 * is the shader the author wrote.
 *
 * It is a conservative parser by construction. Anything it does not recognise
 * as an expression — declarations, statements, function signatures, macros — is
 * copied through a token at a time, so the worst case is a span left as it
 * was, never a token lost. A shader that still fails falls back to MilkDrop's
 * default in the renderer. See `docs/milkdrop.md`.
 */

interface Token {
  /** Whitespace and comments before the token, kept verbatim. */
  pre: string;
  text: string;
  kind: 'word' | 'number' | 'punct';
}

const PUNCT = [
  '<<=', '>>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '==', '!=', '<=', '>=', '&&', '||', '<<', '>>',
];

function tokenize(source: string): { tokens: Token[]; tail: string } {
  const tokens: Token[] = [];
  let i = 0;
  let pre = '';
  while (i < source.length) {
    const rest = source.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      pre += space[0];
      i += space[0].length;
      continue;
    }
    if (rest.startsWith('//')) {
      const end = rest.indexOf('\n');
      const comment = end < 0 ? rest : rest.slice(0, end);
      pre += comment;
      i += comment.length;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      const comment = end < 0 ? rest : rest.slice(0, end + 2);
      pre += comment;
      i += comment.length;
      continue;
    }
    // A preprocessor line is left exactly as written.
    if (rest[0] === '#' && /(^|\n)[ \t]*$/.test(source.slice(0, i))) {
      const end = rest.indexOf('\n');
      const line = end < 0 ? rest : rest.slice(0, end);
      pre += line;
      i += line.length;
      continue;
    }
    const number = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFhHlLuU]?/.exec(rest);
    if (number) {
      tokens.push({ pre, text: number[0], kind: 'number' });
      pre = '';
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_]\w*/.exec(rest);
    if (word) {
      tokens.push({ pre, text: word[0], kind: 'word' });
      pre = '';
      i += word[0].length;
      continue;
    }
    const punct = PUNCT.find((p) => rest.startsWith(p)) ?? rest[0];
    tokens.push({ pre, text: punct, kind: 'punct' });
    pre = '';
    i += punct.length;
  }
  return { tokens, tail: pre };
}

const BINARY: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '%': 10,
};
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const UNARY = new Set(['-', '+', '!', '~', '++', '--']);
/** Words that begin a statement or a declaration rather than an expression. */
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'discard',
  'shader_body', 'static', 'const', 'uniform', 'in', 'out', 'inout', 'struct',
  'sampler', 'sampler2D', 'sampler3D', 'texture', 'void',
]);
const TYPE = /^(float|half|int|uint|bool|double|min16float|min10float)([1-4](x[1-4])?)?$/;

class Stop extends Error {}

/**
 * `GetBlur1(uv)` and its siblings, written out.
 *
 * The converter defines them as macros — `(tex2D(sampler_blur1,uv).xyz*scale1 +
 * bias1)` — and its macro bodies are exactly the shape it mistranslates. Expanded
 * here, before the brackets go in, they are bracketed like everything else and
 * the macro is never used.
 */
function expandBlurs(source: string): string {
  let out = '';
  let i = 0;
  const call = /\bGetBlur([123])\s*\(/g;
  for (let match = call.exec(source); match; match = call.exec(source)) {
    let depth = 1;
    let end = call.lastIndex;
    while (end < source.length && depth > 0) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')') depth--;
      end++;
    }
    if (depth !== 0) break;
    const n = match[1];
    const argument = expandBlurs(source.slice(call.lastIndex, end - 1));
    out += `${source.slice(i, match.index)}(tex2D(sampler_blur${n},${argument}).xyz*scale${n} + bias${n})`;
    i = end;
    call.lastIndex = end;
  }
  return out + source.slice(i);
}

export function parenthesize(source: string): string {
  const { tokens, tail } = tokenize(expandBlurs(source));
  let at = 0;
  const peek = (ahead = 0): Token | undefined => tokens[at + ahead];
  const take = (): Token => {
    const token = tokens[at++];
    if (!token) throw new Stop();
    return token;
  };
  const show = (token: Token) => token.pre + token.text;
  const expect = (text: string): Token => {
    if (peek()?.text !== text) throw new Stop();
    return take();
  };

  /** Brackets go inside the leading whitespace, so a line keeps its indent. */
  const wrap = (inner: string) => {
    const lead = /^\s*/.exec(inner)![0];
    return `${lead}(${inner.slice(lead.length)})`;
  };

  const primary = (): string => {
    const token = peek();
    if (!token) throw new Stop();
    if (token.text === '(') {
      take();
      const inner = sequence();
      return show(token) + inner + show(expect(')'));
    }
    if (token.kind === 'word' && !KEYWORDS.has(token.text)) return show(take());
    if (token.kind === 'number') return show(take());
    throw new Stop();
  };

  const postfix = (base: string): string => {
    let out = base;
    for (;;) {
      const token = peek();
      if (!token) return out;
      if (token.text === '(') {
        out += show(take());
        if (peek()?.text !== ')') {
          out += expression(0);
          while (peek()?.text === ',') out += show(take()) + expression(0);
        }
        out += show(expect(')'));
      } else if (token.text === '[') {
        out += show(take()) + sequence() + show(expect(']'));
      } else if (token.text === '.' && peek(1)?.kind === 'word') {
        out += show(take()) + show(take());
      } else if (token.text === '++' || token.text === '--') {
        out += show(take());
      } else return out;
    }
  };

  const unary = (): string => {
    const token = peek();
    if (!token) throw new Stop();
    if (UNARY.has(token.text)) {
      take();
      return show(token) + unary();
    }
    // `(float3)x` is a cast, not a bracketed expression followed by another.
    if (token.text === '(' && TYPE.test(peek(1)?.text ?? '') && peek(2)?.text === ')') {
      const open = take();
      const type = take();
      const close = take();
      return show(open) + show(type) + show(close) + unary();
    }
    return postfix(primary());
  };

  /** Precedence climbing. Assignment is right-associative and never wrapped. */
  const expression = (min: number): string => {
    let left = unary();
    for (;;) {
      const token = peek();
      if (!token) return left;
      const precedence = BINARY[token.text];
      if (precedence !== undefined && precedence >= min) {
        take();
        left = wrap(left + show(token) + expression(precedence + 1));
      } else if (token.text === '?' && min <= 0) {
        take();
        const middle = expression(0);
        const colon = expect(':');
        left = wrap(left + show(token) + middle + show(colon) + expression(0));
      } else if (ASSIGN.has(token.text) && min <= 0) {
        take();
        left = left + show(token) + expression(0);
      } else return left;
    }
  };

  /** A comma-separated run, as inside `( … )` or `[ … ]`. */
  const sequence = (): string => {
    let out = expression(0);
    while (peek()?.text === ',') out += show(take()) + expression(0);
    return out;
  };

  let out = '';
  while (at < tokens.length) {
    const token = tokens[at];
    const starts =
      (token.kind === 'word' && !KEYWORDS.has(token.text)) ||
      token.kind === 'number' ||
      token.text === '(' ||
      UNARY.has(token.text);
    if (!starts) {
      out += show(token);
      at++;
      continue;
    }
    const from = at;
    try {
      out += expression(0);
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
      at = from;
      out += show(token);
      at++;
    }
  }
  return out + tail;
}

/**
 * Hand the shader the inputs MilkDrop promises it, after conversion.
 *
 * The converter moves the body of `shader_body` into a function,
 * `main_shader_sentinel(vec2 uv)`, declared above Butterchurn's `main`. But
 * `rad`, `ang`, `hue_shader` and the comp shader's `uv_orig` are locals *of*
 * that `main`, so any shader that reads them — which is most comp shaders —
 * names something its function cannot see, and fails to compile. Passing them
 * as parameters, under the same names, is all it takes.
 *
 * The warp shader's `uv_orig` is a varying and visible already; `hue_shader`
 * does not exist there at all, as in MilkDrop.
 */
const FORWARDED = {
  warp: { params: 'float rad, float ang', args: 'rad, ang' },
  comp: { params: 'vec2 uv_orig, float rad, float ang, vec3 hue_shader', args: 'uv_orig, rad, ang, hue_shader' },
} as const;

export function forwardInputs(glsl: string, kind: 'warp' | 'comp'): string {
  const { params, args } = FORWARDED[kind];
  return glsl
    .replace(/\bmain_shader_sentinel\s*\(\s*vec2\s+uv\s*\)/g, `main_shader_sentinel(vec2 uv, ${params})`)
    .replace(/\bmain_shader_sentinel\s*\(\s*uv\s*\)/g, `main_shader_sentinel(uv, ${args})`);
}

/**
 * A preset's own textures, declared the way GLSL requires.
 *
 * MilkDrop shaders name extra textures with a bare `sampler2D sampler_clouds;`
 * and the converter keeps it bare. GLSL only allows a sampler as a uniform, and
 * a uniform is what Butterchurn looks for when it binds a preset's textures.
 */
export function uniformSamplers(glsl: string): string {
  return glsl.replace(/^(\s*)(sampler[23]D\s+\w+\s*;)/gm, '$1uniform $2');
}

/** Everything done to converted GLSL before Butterchurn compiles it. */
export function repairShader(glsl: string, kind: 'warp' | 'comp'): string {
  return uniformSamplers(forwardInputs(glsl, kind));
}

/**
 * The same, applied to the `warp_N=` and `comp_N=` lines of a `.milk` file.
 *
 * Each shader is reassembled from its numbered lines, re-printed whole — an
 * expression can span lines — and written back one line per line, numbered
 * from 1 as MilkDrop writes them. Everything else in the file is untouched.
 */
export function parenthesizePreset(text: string): string {
  const lines = text.split(/\r?\n/);
  const shaders: Record<'warp' | 'comp', string[]> = { warp: [], comp: [] };
  const firstAt: Partial<Record<'warp' | 'comp', number>> = {};
  const kept: Array<string | 'warp' | 'comp'> = [];
  for (const line of lines) {
    const match = /^(warp|comp)_(\d+)=`?(.*)$/.exec(line);
    if (!match) {
      kept.push(line);
      continue;
    }
    const which = match[1] as 'warp' | 'comp';
    if (firstAt[which] === undefined) {
      firstAt[which] = kept.length;
      kept.push(which);
    }
    shaders[which][Number(match[2]) - 1] = match[3];
  }
  return kept
    .flatMap((line) => {
      if (line !== 'warp' && line !== 'comp') return [line];
      const source = shaders[line].map((each) => each ?? '').join('\n');
      return parenthesize(source)
        .split('\n')
        .map((each, i) => `${line}_${i + 1}=\`${each}`);
    })
    .join('\n');
}
