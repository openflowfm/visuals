// The fonts a Sketch document embeds (`document.json`'s `fontReferences` with
// `fontData`), and which face each PostScript name its text asks for maps to.
// A variable font names its instances in `fvar`; the browser reaches one by
// asking for its weight (and slant) on the whole family.

export type Face = { family: string; weight: number; italic: boolean; width: number; tracking: Tracking | null };

/** The font's `trak` table, normal track: tracking in em by point size. Core Text applies it; browsers don't. */
export type Tracking = { sizes: number[]; values: number[] };

/** Tracking in points for a size: the table's nearest values, interpolated, held at its ends. */
export function trackingAt(t: Tracking | null, size: number): number {
  if (!t || t.sizes.length === 0) return 0;
  const { sizes, values } = t;
  let em: number;
  if (size <= sizes[0]) em = values[0];
  else if (size >= sizes[sizes.length - 1]) em = values[values.length - 1];
  else {
    const i = sizes.findIndex((s) => s >= size);
    const f = (size - sizes[i - 1]) / (sizes[i] - sizes[i - 1]);
    em = values[i - 1] + f * (values[i] - values[i - 1]);
  }
  return em * size;
}

function tracking(buf: Buffer, t: Map<string, Table>): Tracking | null {
  const trak = t.get('trak');
  const head = t.get('head');
  if (!trak || !head) return null;
  const upem = buf.readUInt16BE(head.offset + 18);
  const o = trak.offset;
  const horiz = buf.readUInt16BE(o + 6);
  if (!horiz) return null;
  const d = o + horiz;
  const nTracks = buf.readUInt16BE(d);
  const nSizes = buf.readUInt16BE(d + 2);
  const sizeTable = o + buf.readUInt32BE(d + 4);
  const sizes = Array.from({ length: nSizes }, (_, i) => fixed(buf, sizeTable + i * 4));
  for (let k = 0; k < nTracks; k++) {
    const entry = d + 8 + k * 8;
    if (fixed(buf, entry) !== 0) continue;
    const at = o + buf.readUInt16BE(entry + 6);
    const values = Array.from({ length: nSizes }, (_, i) => buf.readInt16BE(at + i * 2) / upem);
    return { sizes, values };
  }
  return null;
}

type Table = { offset: number; length: number };

function tables(buf: Buffer): Map<string, Table> {
  const count = buf.readUInt16BE(4);
  const out = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    out.set(buf.toString('latin1', rec, rec + 4), { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) });
  }
  return out;
}

/** The `name` table's strings by name id (Windows Unicode, English first). */
function names(buf: Buffer, t: Table): Map<number, string> {
  const count = buf.readUInt16BE(t.offset + 2);
  const strings = t.offset + buf.readUInt16BE(t.offset + 4);
  const out = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const rec = t.offset + 6 + i * 12;
    const platform = buf.readUInt16BE(rec);
    const language = buf.readUInt16BE(rec + 4);
    const id = buf.readUInt16BE(rec + 6);
    const length = buf.readUInt16BE(rec + 8);
    const start = strings + buf.readUInt16BE(rec + 10);
    if (platform === 3 && (language === 0x409 || !out.has(id))) {
      const raw = buf.subarray(start, start + length);
      let s = '';
      for (let j = 0; j + 1 < raw.length; j += 2) s += String.fromCharCode(raw.readUInt16BE(j));
      out.set(id, s);
    } else if (platform === 1 && !out.has(id)) {
      out.set(id, buf.toString('latin1', start, start + length));
    }
  }
  return out;
}

const fixed = (buf: Buffer, at: number) => buf.readInt32BE(at) / 65536;

/**
 * Each PostScript name in one font file and the face that draws it. A
 * variable font gives one per named instance (its `wght`, `wdth` and `ital`
 * or `slnt`); a static one gives its own name, with `OS/2`'s weight.
 */
export function facesOf(buf: Buffer, family: string): { faces: Map<string, Face>; variable: boolean } {
  const t = tables(buf);
  const nameTable = t.get('name');
  if (!nameTable) throw new Error('font has no name table');
  const strs = names(buf, nameTable);
  const faces = new Map<string, Face>();
  const trak = tracking(buf, t);
  const fvar = t.get('fvar');
  if (fvar) {
    const o = fvar.offset;
    const axesOffset = buf.readUInt16BE(o + 4);
    const axisCount = buf.readUInt16BE(o + 8);
    const axisSize = buf.readUInt16BE(o + 10);
    const instanceCount = buf.readUInt16BE(o + 12);
    const instanceSize = buf.readUInt16BE(o + 14);
    const axes: string[] = [];
    for (let i = 0; i < axisCount; i++) axes.push(buf.toString('latin1', o + axesOffset + i * axisSize, o + axesOffset + i * axisSize + 4));
    const first = o + axesOffset + axisCount * axisSize;
    for (let i = 0; i < instanceCount; i++) {
      const rec = first + i * instanceSize;
      const coords = new Map(axes.map((tag, k) => [tag, fixed(buf, rec + 4 + k * 4)]));
      // The PostScript name id follows the coordinates when the record has room.
      const psId = instanceSize >= 6 + axisCount * 4 ? buf.readUInt16BE(rec + 4 + axisCount * 4) : 0xffff;
      const ps = psId !== 0xffff ? strs.get(psId) : undefined;
      const sub = strs.get(buf.readUInt16BE(rec));
      const name = ps ?? `${(strs.get(6) ?? family).split('-')[0]}-${(sub ?? '').replace(/\s+/g, '')}`;
      faces.set(name, {
        family,
        weight: coords.get('wght') ?? 400,
        italic: (coords.get('ital') ?? 0) > 0 || (coords.get('slnt') ?? 0) !== 0,
        width: coords.get('wdth') ?? 100,
        tracking: trak,
      });
    }
    return { faces, variable: true };
  }
  const os2 = t.get('OS/2');
  const weight = os2 ? buf.readUInt16BE(os2.offset + 4) : 400;
  const selection = os2 ? buf.readUInt16BE(os2.offset + 62) : 0;
  const ps = strs.get(6);
  if (ps) faces.set(ps, { family, weight, italic: (selection & 1) !== 0, width: 100, tracking: trak });
  return { faces, variable: false };
}

const WEIGHTS: [RegExp, number][] = [
  [/ultralight|extralight/i, 100],
  [/thin/i, 200],
  [/light/i, 300],
  [/medium/i, 510],
  [/semibold|demibold/i, 590],
  [/extrabold|heavy/i, 860],
  [/bold/i, 700],
  [/black/i, 1000],
];

/**
 * A face for a PostScript name no embedded font has: the system's own SF,
 * weight read off the name. `SFProRounded-*` and `SFCompact*` keep their
 * shapes only where those fonts are installed.
 */
export function fallbackFace(ps: string): Face {
  const [base, style = 'Regular'] = ps.split('-');
  const family = /Rounded/.test(base) ? 'ui-rounded' : /Mono/.test(base) ? 'ui-monospace' : 'system-ui';
  const weight = WEIGHTS.find(([re]) => re.test(style))?.[1] ?? 400;
  return { family, weight, italic: /italic/i.test(style), width: 100, tracking: null };
}
