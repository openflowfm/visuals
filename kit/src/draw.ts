// Runs in the browser: draws a scene (scene.ts) on canvases and hands back a
// PNG. render.ts strips the types and loads this as a module; it puts
// `drawScene` on `globalThis`.
//
// Sketch's groups pass blending through: a layer with plus darker inside a
// symbol darkens the window behind the symbol, not just its group. So a node
// that needs no isolation draws straight onto what is under it, and only one
// with opacity, a blend mode, shadows or a blur gets a canvas of its own.

import type { Border, Color, Paint, Scene, SceneNode, Shadow, TextRun } from './scene.ts';

type Ctx = OffscreenCanvasRenderingContext2D;
type Surface = { canvas: OffscreenCanvas; ctx: Ctx };
type Env = { w: number; h: number; base: DOMMatrix; scale: number };

function surface(env: Env): Surface {
  const canvas = new OffscreenCanvas(env.w, env.h);
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

const css = (c: Color, alpha = 1) => `color(srgb ${c[0]} ${c[1]} ${c[2]} / ${c[3] * alpha})`;

const OPS: GlobalCompositeOperation[] = [
  'source-over',
  'darken',
  'multiply',
  'color-burn',
  'lighten',
  'screen',
  'color-dodge',
  'overlay',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];
const PLUS_DARKER = 16;
const PLUS_LIGHTER = 17;

/** Draws `src` (device pixels, same size) over `dst` with an opacity and a Sketch blend mode. */
function composite(dst: Surface, src: Surface, alpha: number, blend: number) {
  if (blend === PLUS_DARKER) return plusDarker(dst, src, alpha);
  const c = dst.ctx;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = alpha;
  c.globalCompositeOperation = blend === PLUS_LIGHTER ? 'lighter' : (OPS[blend] ?? 'source-over');
  c.drawImage(src.canvas, 0, 0);
  c.restore();
}

/**
 * Plus darker (Core Graphics' kCGBlendModePlusDarker), which canvas lacks: on
 * premultiplied colour, αo = min(1, αs + αb) and co = max(0, αo − (αs − cs) −
 * (αb − cb)); over an opaque backdrop that is cs + cb − 1.
 */
function plusDarker(dst: Surface, src: Surface, alpha: number) {
  const { width: w, height: h } = dst.canvas;
  const d = dst.ctx.getImageData(0, 0, w, h);
  const s = src.ctx.getImageData(0, 0, w, h).data;
  const o = d.data;
  for (let i = 0; i < o.length; i += 4) {
    const sa = (s[i + 3] / 255) * alpha;
    if (sa === 0) continue;
    const ba = o[i + 3] / 255;
    const ao = Math.min(1, sa + ba);
    for (let k = 0; k < 3; k++) {
      const sc = (s[i + k] / 255) * sa;
      const bc = (o[i + k] / 255) * ba;
      const co = Math.max(0, ao - (sa - sc) - (ba - bc));
      o[i + k] = ao > 0 ? Math.round((co / ao) * 255) : 0;
    }
    o[i + 3] = Math.round(ao * 255);
  }
  dst.ctx.putImageData(d, 0, 0);
}

function deviceMatrix(n: SceneNode, env: Env): DOMMatrix {
  return env.base.multiply(new DOMMatrix(n.matrix));
}

function style(c: Ctx, p: Paint, n: SceneNode): string | CanvasGradient {
  if (p.kind === 'color') return css(p.color);
  let g: CanvasGradient;
  if (p.kind === 'linear') g = c.createLinearGradient(p.from[0], p.from[1], p.to[0], p.to[1]);
  else if (p.kind === 'radial') g = c.createRadialGradient(p.from[0], p.from[1], 0, p.from[0], p.from[1], Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]));
  else g = c.createConicGradient(Math.atan2(p.to[1] - p.from[1], p.to[0] - p.from[0]), n.width / 2, n.height / 2);
  for (const s of p.stops) g.addColorStop(Math.min(1, Math.max(0, s.pos)), css(s.color));
  return g;
}

/** Fills the node's outline with one paint, onto `t`, honouring the fill's own blend mode. */
function fill(t: Surface, n: SceneNode, p: Paint, path: Path2D, m: DOMMatrix, env: Env) {
  const into = p.blend === 0 ? t : surface(env);
  const c = into.ctx;
  c.save();
  c.setTransform(m);
  c.globalAlpha = p.opacity;
  c.fillStyle = style(c, p, n);
  c.fill(path);
  c.restore();
  if (into !== t) composite(t, into, 1, p.blend);
}

function border(t: Surface, n: SceneNode, b: Border, path: Path2D, m: DOMMatrix, env: Env) {
  // 0 centre, 1 inside, 2 outside: inside and outside stroke twice the width
  // and keep the half on their side.
  const into = b.position === 0 && b.paint.blend === 0 ? t : surface(env);
  const c = into.ctx;
  c.save();
  c.setTransform(m);
  c.globalAlpha = b.paint.opacity;
  c.strokeStyle = style(c, b.paint, n);
  c.lineWidth = b.position === 0 ? b.width : b.width * 2;
  c.setLineDash(b.dash);
  c.lineCap = (['butt', 'round', 'square'] as const)[b.cap] ?? 'butt';
  c.lineJoin = (['miter', 'round', 'bevel'] as const)[b.join] ?? 'miter';
  if (b.position === 1) c.clip(path);
  c.stroke(path);
  if (b.position === 2) {
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'destination-out';
    c.fill(path);
  }
  c.restore();
  if (into !== t) composite(t, into, 1, b.paint.blend);
}

/** The node's outline as an opaque mask. */
function outlineMask(path: Path2D, m: DOMMatrix, env: Env): Surface {
  const s = surface(env);
  s.ctx.setTransform(m);
  s.ctx.fill(path);
  return s;
}

/**
 * Draws only the shadow `src` would cast: the image is drawn a canvas width to
 * the left and its shadow offset back, so none of the image itself lands.
 */
function castShadow(dst: Surface, src: Surface, s: Shadow, env: Env) {
  const c = dst.ctx;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.shadowColor = css(s.color);
  // Sketch's blur radius is CSS's: a Gaussian with σ = radius / 2, as canvas's shadowBlur.
  c.shadowBlur = s.blur * env.scale;
  c.shadowOffsetX = env.w + s.x * env.scale;
  c.shadowOffsetY = s.y * env.scale;
  c.drawImage(src.canvas, -env.w, 0);
  c.restore();
}

function innerShadow(t: Surface, s: Shadow, path: Path2D, m: DOMMatrix, env: Env) {
  const outside = surface(env);
  outside.ctx.fillStyle = '#000';
  outside.ctx.fillRect(0, 0, env.w, env.h);
  outside.ctx.setTransform(m);
  outside.ctx.globalCompositeOperation = 'destination-out';
  outside.ctx.fill(path);
  const shade = surface(env);
  castShadow(shade, outside, s, env);
  shade.ctx.setTransform(m);
  shade.ctx.globalCompositeOperation = 'destination-in';
  shade.ctx.fill(path);
  composite(t, shade, 1, 0);
}

function font(r: { italic: boolean; weight: number; size: number; family: string }) {
  return `${r.italic ? 'italic ' : ''}${r.weight} ${r.size}px "${r.family}"`;
}

type Piece = { text: string; run: TextRun; width: number };

function drawText(t: Surface, n: SceneNode, m: DOMMatrix) {
  const tb = n.text!;
  const c = t.ctx;
  c.save();
  c.setTransform(m);
  const measure = (text: string, run: TextRun) => {
    c.font = font(run);
    c.letterSpacing = `${run.kerning}px`;
    return c.measureText(text);
  };
  // Lines of pieces: split at newlines, and at spaces when the box wraps.
  const lines: Piece[][] = [[]];
  for (const run of tb.runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      const words = tb.wrap ? part.split(/(?<= )/) : [part];
      for (const word of words) {
        if (!word) continue;
        const width = measure(word, run).width;
        const line = lines[lines.length - 1];
        const used = line.reduce((a, p) => a + p.width, 0);
        if (tb.wrap && line.length && used + width > n.width + 0.01) lines.push([{ text: word, run, width }]);
        else line.push({ text: word, run, width });
      }
    });
  }
  const metrics = lines.map((line) => {
    const runs = line.length ? line.map((p) => p.run) : [tb.runs[0]];
    let ascent = 0;
    let descent = 0;
    for (const r of runs) {
      const mm = measure('Hg', r);
      ascent = Math.max(ascent, mm.fontBoundingBoxAscent);
      descent = Math.max(descent, mm.fontBoundingBoxDescent);
    }
    return { ascent, descent, height: tb.lineHeight ?? ascent + descent };
  });
  const total = metrics.reduce((a, l) => a + l.height, 0);
  let y = tb.valign === 1 ? (n.height - total) / 2 : tb.valign === 2 ? n.height - total : 0;
  lines.forEach((line, i) => {
    const { ascent, descent, height } = metrics[i];
    // Extra line height is split above and below the glyphs.
    const baseline = y + (height - (ascent + descent)) / 2 + ascent;
    const width = line.reduce((a, p) => a + p.width, 0);
    // NSTextAlignment as Sketch writes it: 0 left, 1 right, 2 centre, 3 justified.
    let x = tb.align === 1 ? n.width - width : tb.align === 2 ? (n.width - width) / 2 : 0;
    for (const p of line) {
      c.font = font(p.run);
      c.letterSpacing = `${p.run.kerning}px`;
      c.fillStyle = css(p.run.color);
      c.fillText(p.text, x, baseline);
      x += p.width;
    }
    y += height;
  });
  c.restore();
}

/** The node's own drawing, onto `t`: fills, inner shadows, text, children, borders. */
function body(n: SceneNode, t: Surface, env: Env) {
  const m = deviceMatrix(n, env);
  const path = n.path ? new Path2D(n.path) : null;
  if (path) {
    for (const p of n.fills) fill(t, n, p, path, m, env);
    for (const s of n.innerShadows) innerShadow(t, s, path, m, env);
  }
  if (n.text) drawText(t, n, m);
  if (n.children.length) {
    if (n.clip && path) {
      // Children still blend with what is under the group: draw them over a
      // copy of it, keep the copy inside the outline, and put that back.
      const kids = surface(env);
      kids.ctx.drawImage(t.canvas, 0, 0);
      drawChildren(n.children, kids, env);
      kids.ctx.setTransform(m);
      kids.ctx.globalCompositeOperation = 'destination-in';
      kids.ctx.fill(path);
      t.ctx.save();
      t.ctx.setTransform(m);
      t.ctx.globalCompositeOperation = 'destination-out';
      t.ctx.fill(path);
      t.ctx.restore();
      composite(t, kids, 1, PLUS_LIGHTER);
    } else {
      drawChildren(n.children, t, env);
    }
  }
  if (path) for (const b of n.borders) border(t, n, b, path, m, env);
}

function drawChildren(kids: SceneNode[], t: Surface, env: Env) {
  let masked: { group: Surface; mask: Surface } | null = null;
  // The masked group holds a copy of what was under it, drawn over: put back
  // only the part inside the mask.
  const flush = () => {
    if (!masked) return;
    const { group, mask } = masked;
    group.ctx.setTransform(1, 0, 0, 1, 0, 0);
    group.ctx.globalCompositeOperation = 'destination-in';
    group.ctx.drawImage(mask.canvas, 0, 0);
    t.ctx.save();
    t.ctx.setTransform(1, 0, 0, 1, 0, 0);
    t.ctx.globalCompositeOperation = 'destination-out';
    t.ctx.drawImage(mask.canvas, 0, 0);
    t.ctx.restore();
    composite(t, group, 1, PLUS_LIGHTER);
    masked = null;
  };
  for (const k of kids) {
    if (k.mask) {
      flush();
      draw(k, t, env);
      let mask: Surface;
      if (k.mask === 'outline' && k.path) mask = outlineMask(new Path2D(k.path), deviceMatrix(k, env), env);
      else {
        mask = surface(env);
        draw(k, mask, env);
      }
      // Masked siblings blend with what is under them, as clipped children do.
      const group = surface(env);
      group.ctx.drawImage(t.canvas, 0, 0);
      masked = { group, mask };
      continue;
    }
    if (k.breaksMask) flush();
    draw(k, masked ? masked.group : t, env);
  }
  flush();
}

function draw(n: SceneNode, t: Surface, env: Env) {
  const gaussian = n.blurs.find((b) => b.type === 0);
  for (const b of n.blurs) {
    if (b.type === 0 || !n.path) continue;
    // A background blur (and, roughly, glass): what is under the outline, blurred.
    const under = surface(env);
    under.ctx.filter = `blur(${(b.radius / 2) * env.scale}px)`;
    under.ctx.drawImage(t.canvas, 0, 0);
    under.ctx.filter = 'none';
    under.ctx.setTransform(deviceMatrix(n, env));
    under.ctx.globalCompositeOperation = 'destination-in';
    under.ctx.fill(new Path2D(n.path));
    composite(t, under, 1, 0);
  }
  // Nothing drawn casts no shadow, spread or not (glass layers carry shadows
  // that Sketch spends on its lighting, with no fill to cast them).
  const drawsSomething = n.fills.length > 0 || n.borders.length > 0 || n.text !== null || n.children.length > 0;
  const shadows = drawsSomething ? n.shadows : [];
  const isolate = n.opacity < 1 || n.blend !== 0 || shadows.length > 0 || !!gaussian;
  if (!isolate) return body(n, t, env);
  let own = surface(env);
  body(n, own, env);
  if (gaussian) {
    const blurred = surface(env);
    blurred.ctx.filter = `blur(${(gaussian.radius / 2) * env.scale}px)`;
    blurred.ctx.drawImage(own.canvas, 0, 0);
    own = blurred;
  }
  const out = surface(env);
  for (const s of shadows) {
    // A spread shadow is cast by the grown outline; otherwise by what was
    // drawn, so lighter fills cast lighter shadows.
    const caster = s.path ? outlineMask(new Path2D(s.path), deviceMatrix(n, env), env) : own;
    castShadow(out, caster, s, env);
  }
  composite(out, own, 1, 0);
  composite(t, out, n.opacity, n.blend);
}

/** Draws the scene at `scale` device pixels per point with `pad` points around it; returns a PNG data URL. */
export async function drawScene(scene: Scene, scale: number, pad: number): Promise<string> {
  const w = Math.ceil((scene.width + 2 * pad) * scale);
  const h = Math.ceil((scene.height + 2 * pad) * scale);
  const env: Env = { w, h, scale, base: new DOMMatrix([scale, 0, 0, scale, pad * scale, pad * scale]) };
  // The symbol blends within itself, then sits on the window: its dark
  // appearance's white labels use plus darker too, and only read as white
  // when it is drawn on its own first (as on Sketch's canvas).
  const root = surface(env);
  if (scene.background) {
    root.ctx.fillStyle = css(scene.background);
    root.ctx.fillRect(0, 0, w, h);
  }
  const symbol = surface(env);
  draw(scene.root, symbol, env);
  composite(root, symbol, 1, 0);
  const blob = await root.canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}

(globalThis as unknown as { drawScene: typeof drawScene }).drawScene = drawScene;
