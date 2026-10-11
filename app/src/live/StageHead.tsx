import type { FullScreenOfferProps, StageHeadProps } from './stage-model.ts';

/**
 * The Stage's header: two capsules on the traffic lights' line (see
 * `StageHeadProps`). A stub until the header lane fills it in; nothing mounts
 * it yet (Live.tsx's wiring does, last).
 */
export function StageHead(_props: StageHeadProps) {
  return null;
}

/** "Go full screen on…" over the picture while it plays in the window (see `FullScreenOfferProps`). A stub until the header lane fills it in. */
export function FullScreenOffer(_props: FullScreenOfferProps) {
  return null;
}
