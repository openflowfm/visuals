/**
 * **Job.** The library map's choice of axes and colour (`MapAxes`), kept: read once from the
 * page's storage, held in one store every map shares (the Home's and live mode's), and written
 * back on a change, so a pick in one shows in the other and survives a restart. A change another
 * window keeps (the page's `storage` event) is read again, and every map follows it.
 */
import { useSyncExternalStore } from 'react';
import { AXES, COLOURINGS, DEFAULT_AXES, type AxisId, type ColourBy, type MapAxes } from './field';
import { localMark } from './home';

/** Where the choice is kept, as JSON (`{"across":"speed","up":"brightness","colour":"hue"}`). */
export const MAP_AXES_KEY = 'visuals.map.axes';

const isAxis = (v: unknown): v is AxisId => typeof v === 'string' && AXES.some((a) => a.id === v);
const isColour = (v: unknown): v is ColourBy => typeof v === 'string' && COLOURINGS.some((c) => c.id === v);

/**
 * The choice kept, from its JSON: each field checked on its own, so one unknown or missing
 * takes the default's and the rest stand; nothing, bad JSON or not an object is the default.
 * Across and up the same (not a choice the pickers make) gives up the default's, or across's
 * when that is up's default.
 */
export function readAxes(raw: string | null): MapAxes {
  if (!raw) return DEFAULT_AXES;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_AXES;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return DEFAULT_AXES;
  const o = v as Record<string, unknown>;
  const across = isAxis(o.across) ? o.across : DEFAULT_AXES.across;
  let up = isAxis(o.up) ? o.up : DEFAULT_AXES.up;
  if (up === across) up = across === DEFAULT_AXES.up ? DEFAULT_AXES.across : DEFAULT_AXES.up;
  return { across, up, colour: isColour(o.colour) ? o.colour : DEFAULT_AXES.colour };
}

let current: MapAxes | null = null;
const listeners = new Set<() => void>();

function now(): MapAxes {
  if (!current) {
    let raw: string | null = null;
    try {
      raw = localMark()?.get(MAP_AXES_KEY) ?? null;
    } catch {
      raw = null;
    }
    current = readAxes(raw);
  }
  return current;
}

/** Keep a new choice and tell every mounted `useMapAxes`. */
export function setMapAxes(next: MapAxes): void {
  current = next;
  try {
    localMark()?.set(MAP_AXES_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the choice holds for this session.
  }
  for (const l of [...listeners]) l();
}

// Another window kept a choice (or cleared storage): read it again, and every map follows it.
function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== MAP_AXES_KEY) return;
  current = null;
  for (const l of [...listeners]) l();
}

/** Listen while anything does: the first listener starts following other windows, the last one stops. */
function subscribe(l: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** The map's choice and the way to change it, shared by every map on the page. */
export function useMapAxes(): [MapAxes, (next: MapAxes) => void] {
  return [useSyncExternalStore(subscribe, now, now), setMapAxes];
}
