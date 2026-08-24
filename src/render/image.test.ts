import { describe, expect, it } from 'vitest';
import { boundedImageSize } from './image.ts';

describe('still image upload bounds', () => {
  it('leaves images below the GPU edge unchanged', () => {
    expect(boundedImageSize(1920, 1080, 4096)).toEqual({ width: 1920, height: 1080 });
  });

  it('shrinks the long edge without changing aspect', () => {
    expect(boundedImageSize(8000, 4000, 4096)).toEqual({ width: 4096, height: 2048 });
    expect(boundedImageSize(2000, 8000, 4096)).toEqual({ width: 1024, height: 4096 });
  });
});
