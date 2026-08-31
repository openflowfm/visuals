/** The most node faces allowed to draw on one animation frame. */
export const LIVE_PICTURE_LIMIT = 10;

/** Below this graph scale, a moving picture is too small to earn a GL draw. */
export const LIVE_PICTURE_ZOOM_FLOOR = 0.5;

export interface PictureBudgetInput {
  /** Mounted faces, in the stable order the circuit presents them. */
  ids: readonly string[];
  /** Faces intersecting the graph viewport. */
  visible: ReadonlySet<string>;
  /** The face promoted into the large picture, when there is one. */
  promoted?: string | null;
  /** The circuit's one output node. */
  out?: string | null;
  enabled: boolean;
  scale: number;
  limit?: number;
  zoomFloor?: number;
}

export interface PictureBudget {
  /** Visible faces that may draw, kept in circuit order. */
  live: readonly string[];
  /** Visible faces frozen on their last frame, kept in circuit order. */
  paused: readonly string[];
  /** Mounted faces outside the viewport, kept in circuit order. */
  culled: readonly string[];
  counts: {
    mounted: number;
    visible: number;
    live: number;
    paused: number;
    culled: number;
  };
}

/**
 * Which node pictures are worth drawing this frame.
 *
 * The promoted face and `out` take slots first, but the returned lists stay in
 * circuit order. Scheduling priority should not reshuffle the DOM or the
 * status readout, and an off-screen priority must not consume a slot that an
 * on-screen face could use.
 */
export function budgetPictures({
  ids,
  visible,
  promoted,
  out,
  enabled,
  scale,
  limit = LIVE_PICTURE_LIMIT,
  zoomFloor = LIVE_PICTURE_ZOOM_FLOOR,
}: PictureBudgetInput): PictureBudget {
  const shown = ids.filter((id) => visible.has(id));
  const culled = ids.filter((id) => !visible.has(id));
  const slots = Math.max(0, Math.floor(limit));
  const chosen = new Set<string>();

  if (enabled && scale >= zoomFloor && slots > 0) {
    for (const id of [promoted, out]) {
      if (id && visible.has(id) && ids.includes(id) && chosen.size < slots) chosen.add(id);
    }
    for (const id of shown) {
      if (chosen.size >= slots) break;
      chosen.add(id);
    }
  }

  const live = shown.filter((id) => chosen.has(id));
  const paused = shown.filter((id) => !chosen.has(id));

  return {
    live,
    paused,
    culled,
    counts: {
      mounted: ids.length,
      visible: shown.length,
      live: live.length,
      paused: paused.length,
      culled: culled.length,
    },
  };
}
