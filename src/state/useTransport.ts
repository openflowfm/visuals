import { useEffect, useRef, useState } from 'react';
import type { Clock } from './useShow.ts';

/**
 * A clock of the designer's own, so a look can be built with nothing playing.
 *
 * This is the change that makes the library-first workflow possible. Everything
 * in here used to read Link through the show — which is right on stage and
 * exactly wrong at a desk, because it made *Ableton running* a precondition for
 * drawing a picture. You cannot build a library of looks you can only see during
 * a rehearsal.
 *
 * So the designer free-runs by default and can be told to follow the room when
 * there is a room to follow. Following is not the fallback; it is the option.
 *
 * **It is a `Clock`**, the same shape the compositor and the bench already take,
 * so nothing downstream learns that there are now two kinds. A preview cannot
 * tell whether the beat it is drawing on came from a laptop or from a stage, and
 * that is the whole point — what you build at a desk is what will play.
 */
export interface Transport extends Clock {
  playing: boolean;
  setPlaying(next: boolean): void;
  bpm: number;
  setBpm(next: number): void;
  /** Beats in a bar, for `uPhase` and for the loop length. */
  quantum: number;
  /** Follow the show's clock instead of running one. */
  following: boolean;
  setFollowing(next: boolean): void;
  /** Back to the top of the bar, for judging the same moment twice. */
  restart(): void;
}

export function useTransport(show: Clock | null, canFollow: boolean): Transport {
  const [playing, setPlaying] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [following, setFollowing] = useState(false);
  const quantum = 4;

  // The running values live in a ref because the render loop reads them sixty
  // times a second and React must not be involved in that.
  const at = useRef({ beat: 0, seconds: 0 });
  const now = useRef({ playing, bpm, following: following && canFollow, show });
  now.current = { playing, bpm, following: following && canFollow, show };

  // Its own frame loop, so the transport advances whether or not anything is
  // drawing. A designer that only ticked while a canvas was mounted would stop
  // the moment you opened a list.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (stamp: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((stamp - last) / 1000, 0.1);
      last = stamp;
      const state = now.current;
      // Seconds run even when stopped: `uTime` is for drift and shimmer, the
      // things that should specifically *not* be in time, and freezing them
      // with the beat would make a paused frame look dead rather than held.
      at.current.seconds += dt;
      if (state.following && state.show) {
        at.current.beat = state.show.beat();
        return;
      }
      if (state.playing) at.current.beat += dt * (state.bpm / 60);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const held = useRef<Transport | null>(null);
  if (!held.current) {
    held.current = {
      beat: () => at.current.beat,
      seconds: () => at.current.seconds,
      // The loop above owns the advance. This exists because a `Clock` has it,
      // and a caller that advanced this one would be double-counting.
      advance: () => {},
      playing,
      setPlaying,
      bpm,
      setBpm,
      quantum,
      following,
      setFollowing,
      restart: () => {
        at.current.beat = 0;
      },
    };
  }
  const t = held.current;
  t.playing = playing;
  t.setPlaying = setPlaying;
  t.bpm = bpm;
  t.setBpm = setBpm;
  t.following = following && canFollow;
  t.setFollowing = setFollowing;
  return t;
}
