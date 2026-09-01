import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ModelAsset,
  ModelLibrary,
  ModelSetup,
  ModelSetupDraft,
} from '../../model.ts';
import { modelPorts } from '../../model.ts';
import type { CircuitNode, Scheme, Show } from '../../protocol.ts';
import { createCompositor } from '../render/compositor.ts';

const PREVIEW_FLOW = '~model-setup-preview';
const PREVIEW_SETUP = 'model-setup-preview';
// Deliberately stable while the editor is open. Draft metadata is handed to the
// live model instance each frame, so changing a label, range or material does
// not refetch immutable GLB bytes on every keystroke.
const PREVIEW_REVISION = 'working-copy';

export interface ModelPreviewDocument {
  show: Show;
  scheme: Scheme;
  library: ModelLibrary;
}

/**
 * Put an unsaved setup through the same graph boundary as a saved model node.
 *
 * This document never reaches the server or the scheme being edited. It is a
 * one-node model → out flow whose instance values are the setup's normalized
 * starting positions, so changing a `start` field below the preview scrubs the
 * exact value a newly placed model node would receive.
 */
export function modelPreviewDocument(
  draft: ModelSetupDraft,
  asset: ModelAsset,
  scheme: Scheme,
  show: Show,
): ModelPreviewDocument {
  const setup: ModelSetup = {
    ...draft,
    id: PREVIEW_SETUP,
    revision: PREVIEW_REVISION,
    camera: draft.camera ?? null,
    createdAt: '',
    updatedAt: '',
  };
  const model: CircuitNode = {
    id: 'model',
    kind: 'model',
    setup: setup.id,
    setupRevision: setup.revision,
    modelPorts: modelPorts(setup),
    values: Object.fromEntries(setup.bindings.map((binding) => [binding.id, binding.default])),
    x: 20,
    y: 20,
  };

  return {
    show: { ...show, flow: PREVIEW_FLOW, pinned: false },
    scheme: {
      ...scheme,
      flows: {
        [PREVIEW_FLOW]: {
          name: 'Model setup preview',
          circuit: {
            nodes: [model, { id: 'out', kind: 'out', x: 260, y: 20 }],
            cords: [{ from: 'model/c', to: 'out/c' }],
          },
        },
      },
    },
    library: { assets: [asset], setups: [setup], notice: null },
  };
}

type PreviewState = 'loading' | 'ready' | 'error';

const swatch = (colour: number): string => `#${(colour & 0xffffff).toString(16).padStart(6, '0')}`;

/** The setup editor's live, bounded rendering of its working copy. */
export function ModelSetupPreview({
  draft,
  asset,
  scheme,
  show,
}: {
  draft: ModelSetupDraft;
  asset: ModelAsset;
  scheme: Scheme;
  show: Show;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const document = useMemo(
    () => modelPreviewDocument(draft, asset, scheme, show),
    [draft, asset, scheme, show],
  );
  const current = useRef(document);
  current.current = document;
  const [state, setState] = useState<PreviewState>('loading');
  const [message, setMessage] = useState('loading model…');

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const compositor = createCompositor(element);
    compositor.preview(true);
    let raf = 0;
    let last = performance.now();
    let said = '';

    const report = (nextState: PreviewState, nextMessage: string) => {
      const next = `${nextState}:${nextMessage}`;
      if (next === said) return;
      said = next;
      setState(nextState);
      setMessage(nextMessage);
    };

    const loop = (stamp: number) => {
      raf = requestAnimationFrame(loop);
      const at = current.current;
      const dt = Math.min((stamp - last) / 1000, 0.1);
      last = stamp;
      const seconds = stamp / 1000;
      const beat = seconds * at.show.tempo / 60;
      compositor.frame(at.show, at.scheme, beat, seconds, dt, undefined, at.library);
      const error = compositor.error;
      const resources = compositor.modelResources();
      if (error) report('error', error);
      else if (resources.loading > 0 || resources.instances === 0) report('loading', 'loading model…');
      else report('ready', 'live setup preview');
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      compositor.free();
    };
  }, []);

  return (
    <figure className="model-preview" data-state={state}>
      <canvas ref={canvas} aria-label={`Preview of ${draft.name || asset.name}`} />
      <div className="model-preview-status" aria-live="polite">
        <span className="model-preview-light" />
        {message}
      </div>
      <figcaption>
        <span>current colorway</span>
        <span className="model-preview-swatches" aria-label={`${show.colorway || 'current'} colorway`}>
          {show.colors.slice(0, 5).map((colour, index) => (
            <i key={`${colour}-${index}`} style={{ background: swatch(colour) }} />
          ))}
        </span>
        <small>Material mappings, camera, and published start values update here before save.</small>
      </figcaption>
    </figure>
  );
}
