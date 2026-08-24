import { describe, expect, it } from 'vitest';
import { mediaUrl } from './media.ts';
import { videoRate } from './video.ts';

describe('video playback controls', () => {
  it('maps the centred pace control exponentially from half to double speed', () => {
    expect(videoRate(0)).toBeCloseTo(0.5);
    expect(videoRate(0.5)).toBeCloseTo(1);
    expect(videoRate(1)).toBeCloseTo(2);
  });

  it('encodes each asset path segment without losing folders', () => {
    expect(mediaUrl('loops/A bright one.mp4')).toBe('/media/loops/A%20bright%20one.mp4');
  });
});
