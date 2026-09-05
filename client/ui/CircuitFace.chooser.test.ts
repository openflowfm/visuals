// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Circuit, CircuitNode, MediaAsset } from '../../protocol.ts';
import { NodeFace } from './Circuit.tsx';
afterEach(cleanup);

/**
 * What a chooser offers, which is only legible with the menu open.
 *
 * The rest of the face is checked as a string in `CircuitFace.test.ts`, and
 * that suits everything a shut face prints. A menu is not one of those: it is
 * drawn on demand, in the top layer, so the list behind it needs a DOM and a
 * press to reach.
 */
const noop = () => {};

function face(node: CircuitNode, media: readonly MediaAsset[], onChange = noop) {
  const circuit: Circuit = { nodes: [node], cords: [] };
  return render(
    h(NodeFace, {
      node,
      circuit,
      tracks: [],
      flows: [],
      media,
      energy: 0.62,
      beat: () => 0.5,
      numberReadings: {},
      onSwap: noop,
      onChange,
      onTurn: noop,
      onRange: noop,
      onFree: noop,
      onCut: noop,
      onDrop: noop,
    }),
  );
}

const offered = () =>
  Array.from(document.querySelectorAll('[role="option"]')).map((el) => el.textContent);

const MEDIA: readonly MediaAsset[] = [
  { id: 'loops/one.mp4', name: 'one.mp4', bytes: 10, type: 'video' },
  { id: 'two.webm', name: 'two.webm', bytes: 20, type: 'video' },
  { id: 'art/poster.png', name: 'poster.png', bytes: 30, type: 'image' },
];

describe('a media chooser', () => {
  it('offers every server-approved video and nothing else, on a video face', () => {
    const view = face({ id: 'v', kind: 'video', op: 'loop', asset: 'loops/one.mp4', x: 0, y: 0 }, MEDIA);
    fireEvent.click(view.getByRole('combobox', { name: 'Video file' }));
    expect(offered()).toEqual(['choose video', 'loops/one.mp4', 'two.webm']);
  });

  it('offers the stills to an image face, and keeps the videos off it', () => {
    const view = face({ id: 'i', kind: 'image', op: 'contain', asset: 'art/poster.png', x: 0, y: 0 }, MEDIA);
    fireEvent.click(view.getByRole('combobox', { name: 'Image file' }));
    expect(offered()).toEqual(['choose image', 'art/poster.png']);
  });

  it('reports the id that was picked, and never a path off the server', () => {
    const onChange = vi.fn();
    const view = face(
      { id: 'v', kind: 'video', op: 'loop', asset: 'loops/one.mp4', x: 0, y: 0 },
      MEDIA,
      onChange,
    );
    fireEvent.click(view.getByRole('combobox', { name: 'Video file' }));
    fireEvent.click(document.querySelectorAll('[role="option"]')[2] as Element);
    expect(onChange).toHaveBeenCalledWith({ asset: 'two.webm' });
  });
});
