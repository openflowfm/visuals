import { useEffect, useState } from 'react';

/** Where the preset playing is: seconds since `since` (ms, `Date.now()`'s), ticking each second while `on`, and its `length` (s, null for held). Null while nothing plays. */
export function useElapsed(since: number, on: boolean, length: number | null): { elapsed: number; length: number | null } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on, since]);
  return on ? { elapsed: Math.max(0, (now - since) / 1000), length } : null;
}
