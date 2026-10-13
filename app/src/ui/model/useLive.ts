import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from './api';
import * as fx from './fx';
import { useNotice, useTauriEvent } from './hooks';
import { startLive } from './library';
import * as link from './link';
import type { Stars } from './liveKeys';
import * as output from './output';
import * as pl from './playlists';
import { notice, openFailed } from './shell';
import { intensityOf, keyOf, opensOnStart, ratingOf, sendIntensity, sinceAfter, starred, type LiveState } from './live-model';
// UI import: OutputPanel.tsx, where the screen port puts it.
import { leave } from '../OutputPanel/OutputPanel';

/**
 * Live mode's state, read from the app and followed as it changes: the
 * playlists and the deck, the preset playing, the effects, where the output is,
 * and the user's stars and ratings, with the actions on them.
 *
 * Mounting it is going live: it plays in the window (the output opens only when
 * the user picks a display, `show`, or when the app was started in live mode,
 * `windowed` false: `opensOnStart`), the previews stop, and with nothing
 * playing it starts `start` (else what the app puts back, else any preset).
 * Unmounting closes the output and puts the effects back (`leave`).
 */
export function useLive({ start, windowed }: { start: string | null; windowed?: boolean }): LiveState {
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  // When the preset playing started: going live counts as a start until the first open reports.
  const [since, setSince] = useState(() => Date.now());
  const { notice: error, set: setError, fail, dismiss } = useNotice();
  const [status, setStatus] = useState<output.Status>({ display: null, size: null });
  const [displays, setDisplays] = useState<output.Display[] | null>(null);
  const [effects, setEffects] = useState<fx.Fx | null>(null);
  const [data, setData] = useState<api.LibraryData | null>(null);
  const [rows, setRows] = useState<api.LibraryRow[]>([]);

  const held = (effects?.hold ?? lists?.deck.hold) === true;

  const show = useCallback((id: number | null) => void output.open(id).then(setStatus, fail("Couldn't show the output on that display.")), [fail]);

  // Live plays in the window: the output opens on the way in only when started in live mode; it closes (and the effects reset) on the way out.
  useEffect(() => {
    api.setPreviews([]).catch(() => {});
    // Left before the displays came back: don't open an output nothing would close.
    let gone = false;
    output.displays().then(
      (ds) => {
        if (gone) return;
        setDisplays(ds);
        if (opensOnStart(windowed, ds)) show(null);
      },
      () => {
        if (!gone && opensOnStart(windowed, null)) show(null);
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
    setSince((was) => sinceAfter(was, now, Date.now()));
    // A preset that opened clears a failure to open the last one.
    if (now.error) setError(openFailed(now.path, now.error));
    else if (now.path) dismiss();
  });

  const act = useCallback(
    (action: pl.Action) =>
      void pl.act(action).catch((e) => {
        const step = action.kind === 'next' || action.kind === 'previous' || action.kind === 'random';
        setError(notice(step ? `Couldn't ${action.kind === 'random' ? 'pick a random preset' : `go to the ${action.kind} preset`}.` : "Couldn't play that.", e));
      }),
    [setError],
  );

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
    hint: null,
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
    since,
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
