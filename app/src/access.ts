/**
 * Accessibility (#100): will follow the app's reduced-motion setting, and
 * macOS's "Reduce motion" when none is chosen (`api.reducedMotion`), marking the
 * document so the page's CSS can calm its motion. Does nothing until its 0.9 lane (#100) lands.
 */
export function useAccessibility(): void {}
