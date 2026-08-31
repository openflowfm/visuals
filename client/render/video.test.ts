import { describe, expect, it } from 'vitest';
import type { CircuitVideo } from './circuit.ts';
import type { NumberSample } from './evaluateNumber.ts';
import { mediaUrl } from './media.ts';
import { videoControl, videoRate } from './video.ts';

describe('video playback controls', () => {
  it('maps the centred pace control exponentially from half to double speed', () => {
    expect(videoRate(0)).toBeCloseTo(0.5);
    expect(videoRate(0.5)).toBeCloseTo(1);
    expect(videoRate(1)).toBeCloseTo(2);
  });

  const asked = (numbers: Record<string, number>): NumberSample => ({
    outlet: () => undefined,
    inlet: (id) => numbers[id],
  });
  const node = (mode: CircuitVideo['mode']): CircuitVideo => ({
    id: 'v',
    asset: 'a.mp4',
    mode,
    index: 0,
  });

  it('reads a played clip’s speed and freeze, and never a position', () => {
    expect(videoControl(asked({ 'v/pace': 0.75, 'v/freeze': 0 }), node('loop'))).toEqual({
      pace: 0.75,
      freeze: false,
      position: null,
    });
    // A gate, and over a half is on. It is a separate inlet from `pace` rather
    // than a pace of zero because playbackRate = 0 is not a legal rate in every
    // browser, and the ones that take it disagree about whether the decoder is
    // still holding the frame.
    expect(videoControl(asked({ 'v/freeze': 0.6 }), node('once')).freeze).toBe(true);
    expect(videoControl(asked({ 'v/freeze': 0.5 }), node('once')).freeze).toBe(false);
  });

  it('reads a scrubbed clip’s position, and neither of the other two', () => {
    // The mode decides, rather than whichever inlet happens to have a cord on
    // it: a scrubbed clip has no `pace` and no `freeze` mounted at all, so a
    // number left behind on one by an earlier mode must not reach the decoder.
    expect(videoControl(asked({ 'v/position': 0.4, 'v/pace': 1, 'v/freeze': 1 }), node('scrub'))).toEqual(
      { pace: 0.5, freeze: false, position: 0.4 },
    );
  });

  it('sits at the first frame when a scrub has nothing wired or set', () => {
    expect(videoControl(asked({}), node('scrub')).position).toBe(0);
    expect(videoControl(asked({}), node('loop'))).toEqual({ pace: 0.5, freeze: false, position: null });
  });

  it('encodes each asset path segment without losing folders', () => {
    expect(mediaUrl('loops/A bright one.mp4')).toBe('/media/loops/A%20bright%20one.mp4');
  });
});
