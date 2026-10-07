import { Composition } from 'remotion';
import { Teaser } from './Teaser';
import { FPS, LENGTH } from './timing';

export const Root = () => (
  <>
    <Composition id="Teaser" component={Teaser} durationInFrames={LENGTH} fps={FPS} width={1920} height={1080} />
    <Composition
      id="TeaserVertical"
      component={Teaser}
      durationInFrames={LENGTH}
      fps={FPS}
      width={1080}
      height={1920}
    />
  </>
);
