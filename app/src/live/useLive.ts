import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api.ts';
import * as fx from '../fx.ts';
import { useNotice, useTauriEvent } from '../hooks.ts';
import { startLive } from '../library.ts';
import * as link from '../link.ts';
import type { Stars } from '../liveKeys.ts';
import * as output from '../output.ts';
import { leave } from '../OutputPanel.tsx';
import * as pl from '../playlists.ts';
import { notice, openFailed } from '../shell.ts';
import { intensityOf, keyOf, LEAVE_HINT, LEAVE_MS, playsWindowed, ratingOf, sendIntensity, starred, type LiveState } from './live-model.ts';

/** What the hint line says, and why: leaving live waiting for its second press. */
interface Hint {
  kind: 'leave';
  text: string;
}

/**
 * Live mode's state, read from the app and followed as it changes: the
 * playlists and the deck, the preset playing, the effects, where the output is,
 * and the user's stars and ratings, with the actions on them.
 *
 * Mounting it is going live: the output opens full screen on the way in when
 * another display can take it (not when `windowed`, or with one display), the
 * previews stop, and with nothing playing it starts `start` (else what the app
 * puts back, else any preset). Unmounting closes the output and puts the
 * effects back (`leave`).
 */
export function useLive({ start, windowed = false }: { start: string | null; windowed?: boolean }): LiveState {
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const { notice: error, set: setError, fail, dismiss } = useNotice();
  const [status, setStatus] = useState<output.Status>({ display: null, size: null });
  const [displays, setDisplays] = useState<output.Display[] | null>(null);
  const [effects, setEffects] = useState<fx.Fx | null>(null);
  const [data, setData] = useState<api.LibraryData | null>(null);
  const [rows, setRows] = useState<api.LibraryRow[]>([]);

  const held = (effects?.hold ?? lists?.deck.hold) === true;

  const show = useCallback((id: number | null) => void output.open(id).then(setStatus, fail("Couldn't show the output on that display.")), [fail]);

  // Live mode is the output: open it on the way in when another display can take it, close it (and reset the effects) on the way out.
  useEffect(() => {
    api.setPreviews([]).catch(() => {});
    // Left before the displays came back: don't open an output nothing would close.
    let gone = false;
    output.displays().then(
      (ds) => {
        if (gone) return;
        setDisplays(ds);
        if (!playsWindowed(windowed, ds)) show(null);
      },
      () => {
        if (!gone && !windowed) show(null);
      },
    );
    fx.state().then(setEffects, fail("Couldn't read the effects."));
    return () => {
      gone = true;
      leave();
    };
  }, [show, fail, windowed]);
  useTauriEvent(output.onStatus, setStatus);
  useTauriEvent(fx.onFx, setEffects);

  // The user's library data, for the moods and the favourite star; the index, for a preset's key.
  useEffect(() => {
    api.libraryData().then(setData, () => {});
    api.libraryIndex().then(setRows, () => {});
  }, []);
  useTauriEvent(api.onLibraryChanged, setData);

  useEffect(() => {
    pl.lists().then((l) => {
      setLists(l);
      setCurrent((c) => c ?? l.deck.current ?? start);
      // Started in live mode, nothing is playing yet: the preset asked for; else
      // what the app puts back once it has; else any, so the picture is never black.
      if (l.deck.current) return;
      void startLive(start, {
        open: (path) => void api.open(path).catch((e) => setError(openFailed(path, String(e)))),
        random: () => void pl.act({ kind: 'random' }).catch(fail("Couldn't pick a preset to start on.")),
        shown: (path) => setCurrent((c) => c ?? path),
      });
    }, fail("Couldn't read the playlists."));
  }, [fail, setError, start]);
  useTauriEvent(pl.onLists, setLists);
  useTauriEvent(pl.onLive, (now) => {
    setLists((l) => (l ? { ...l, deck: now.deck } : l));
    if (now.path) setCurrent(now.path);
    // A preset that opened clears a failure to open the last one.
    if (now.error) setError(openFailed(now.path, now.error));
    else if (now.path) dismiss();
  });

  // A quiet line over the dock (not a failure): leaving live asking for a second press.
  const [hint, setHint] = useState<Hint | null>(null);

  const act = useCallback(
    (action: pl.Action) =>
      void pl.act(action).catch((e) => {
        const step = action.kind === 'next' || action.kind === 'previous' || action.kind === 'random';
        setError(notice(step ? `Couldn't ${action.kind === 'random' ? 'pick a random preset' : `go to the ${action.kind} preset`}.` : "Couldn't play that.", e));
      }),
    [setError],
  );

  // Leaving live with the output on a display takes a second press within LEAVE_MS, so one stray click or ⌘⇧L can't close it mid-set.
  const outputOpen = status.display !== null;
  const armed = useRef<number | null>(null);
  const askLeave = useCallback(
    (go: () => void) => {
      const now = Date.now();
      if (!outputOpen || (armed.current !== null && now - armed.current < LEAVE_MS)) {
        armed.current = null;
        setHint(null);
        return go();
      }
      armed.current = now;
      setHint({ kind: 'leave', text: LEAVE_HINT });
    },
    [outputOpen],
  );
  // The second press's window passing (or the output closing) takes the question away.
  useEffect(() => {
    if (hint?.kind !== 'leave') return;
    if (!outputOpen) return setHint(null);
    const t = window.setTimeout(() => {
      armed.current = null;
      setHint((h) => (h?.kind === 'leave' ? null : h));
    }, LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [hint, outputOpen]);
  const actFx = useCallback((action: fx.FxAction) => void fx.act(action).catch(fail("Couldn't change that effect.")), [fail]);

  const key = useMemo(() => keyOf(rows, current), [rows, current]);
  const star = starred(data, key);
  const favourite = useCallback(() => {
    if (!key) return setError(notice("This preset isn't in the library, so it can't be starred."));
    api.librarySet([key], { star: !star }).then(setData, fail("Couldn't star that preset."));
  }, [key, star, fail, setError]);
  const rating = ratingOf(data, key);
  // The same number again takes the rating off.
  const rate = useCallback(
    (stars: Stars) => {
      if (!key) return setError(notice("This preset isn't in the library, so it can't be rated."));
      api.librarySet([key], { rating: rating === stars ? 0 : stars }).then(setData, fail("Couldn't rate that preset."));
    },
    [key, rating, fail, setError],
  );
  const intensity = intensityOf(effects?.sensitivity ?? 1);
  const setIntensity = useCallback(
    (v: number) => {
      setEffects((e) => (e ? { ...e, sensitivity: 0.5 * 4 ** v } : e));
      sendIntensity(v).catch(fail("Couldn't change the intensity."));
    },
    [fail],
  );

  return {
    lists,
    setLists,
    deck: lists?.deck ?? null,
    current,
    held,
    effects,
    status,
    displays,
    inWindow: status.display === null && displays !== null,
    data,
    key,
    star,
    rating,
    says: pl.nextSays(lists, held),
    up: pl.upNext(lists),
    error,
    hint: hint?.text ?? null,
    leave: askLeave,
    setError,
    fail,
    dismiss,
    act,
    actFx,
    show,
    intensity,
    setIntensity,
    favourite,
    rate,
  };
}

/**
 * Link's frames, ten a second: a leaf that shows the beat (the Next line's "in
 * 3 beats", a beat light) reads them itself, so the rest of live mode doesn't
 * draw again on every frame.
 */
export function useLinkFrame(): link.Frame | null {
  const [frame, setFrame] = useState<link.Frame | null>(null);
  useEffect(() => {
    link.state().then(
      (f) => setFrame((was) => was ?? f),
      () => {},
    );
  }, []);
  useTauriEvent(link.onFrame, setFrame);
  return frame;
}
