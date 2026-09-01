import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import type {
  ModelAsset,
  ModelLibrary,
  ModelSetup,
  ModelSetupDraft,
  ModelTextureAsset,
} from '../../model.ts';
import { modelPorts } from '../../model.ts';
import { paletteOf, type CircuitNode, type Scheme, type Show } from '../../protocol.ts';
import { createCompositor } from '../render/compositor.ts';
import type { ModelView } from '../render/model.ts';
import { packColor } from '../state/useRoom.ts';

const PREVIEW_FLOW = '~model-setup-preview';
const PREVIEW_SETUP = 'model-setup-preview';
// Deliberately stable while the editor is open. Draft metadata is handed to the
// live model instance each frame, so changing a label, range or material does
// not refetch immutable GLB bytes on every keystroke.
const PREVIEW_REVISION = 'working-copy';
const EMPTY_COLORWAYS: Scheme['colorways'] = {};

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
  textures: readonly ModelTextureAsset[] = [],
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
    library: { assets: [asset], setups: [setup], textures: [...textures], notice: null },
  };
}

type PreviewState = 'loading' | 'ready' | 'error';

const HOME_VIEW: ModelView = { enabled: false, yaw: 0, pitch: 0, panX: 0, panY: 0, zoom: 1 };

const swatch = (colour: number): string => `#${(colour & 0xffffff).toString(16).padStart(6, '0')}`;

/** The setup editor's live, bounded rendering of its working copy. */
export function ModelSetupPreview({
  draft,
  asset,
  scheme,
  show,
  textures = [],
}: {
  draft: ModelSetupDraft;
  asset: ModelAsset;
  scheme: Scheme;
  show: Show;
  textures?: readonly ModelTextureAsset[];
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const colorwayMap = scheme.colorways ?? EMPTY_COLORWAYS;
  const colorways = useMemo(() => Object.keys(colorwayMap), [colorwayMap]);
  const initialColorway = colorways.includes(show.colorway ?? '') ? show.colorway! : (colorways[0] ?? '');
  const [colorway, setColorway] = useState(initialColorway);
  const previewShow = useMemo<Show>(() => {
    const chosen = colorwayMap[colorway];
    if (!chosen) return show;
    return { ...show, colorway, colors: paletteOf(chosen).map(packColor) };
  }, [show, colorwayMap, colorway]);
  const document = useMemo(
    () => modelPreviewDocument(draft, asset, scheme, previewShow, textures),
    [draft, asset, scheme, previewShow, textures],
  );
  const current = useRef(document);
  current.current = document;
  const [view, setView] = useState<ModelView>(HOME_VIEW);
  const currentView = useRef(view);
  currentView.current = view;
  const gesture = useRef<{ pointer: number; x: number; y: number; mode: 'orbit' | 'pan' } | null>(null);
  const [state, setState] = useState<PreviewState>('loading');
  const [message, setMessage] = useState('loading model…');

  useEffect(() => {
    if (!colorwayMap[colorway]) setColorway(colorways[0] ?? '');
  }, [colorwayMap, colorway, colorways]);

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
      compositor.frame(at.show, at.scheme, beat, seconds, dt, undefined, at.library, { model: currentView.current });
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

  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode: event.button === 1 || event.button === 2 || event.shiftKey ? 'pan' : 'orbit',
    };
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const held = gesture.current;
    if (!held || held.pointer !== event.pointerId) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    held.x = event.clientX;
    held.y = event.clientY;
    setView((at) => held.mode === 'orbit'
      ? { ...at, enabled: true, yaw: at.yaw - dx * 0.008, pitch: Math.max(-1.5, Math.min(1.5, at.pitch - dy * 0.008)) }
      : { ...at, enabled: true, panX: at.panX - dx * 0.003 / at.zoom, panY: at.panY + dy * 0.003 / at.zoom });
  };

  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (gesture.current?.pointer === event.pointerId) gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const zoom = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setView((at) => ({ ...at, enabled: true, zoom: Math.max(0.08, Math.min(16, at.zoom * Math.exp(-event.deltaY * 0.0015))) }));
  };

  return (
    <figure className="model-preview" data-state={state}>
      <canvas
        ref={canvas}
        aria-label={`Interactive preview of ${draft.name || asset.name}`}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={zoom}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="model-preview-status" aria-live="polite">
        <span className="model-preview-light" />
        {message}
      </div>
      <div className="model-preview-tools">
        <span>drag orbit · shift/right drag pan · wheel zoom</span>
        <button type="button" onClick={() => setView(HOME_VIEW)}>reset view</button>
      </div>
      <figcaption>
        <label>
          <span>preview colorway</span>
          <select value={colorway} onChange={(event) => setColorway(event.currentTarget.value)}>
            {colorways.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <span className="model-preview-swatches" aria-label={`${previewShow.colorway || 'current'} colorway`}>
          {previewShow.colors.slice(0, 5).map((colour, index) => (
            <i key={`${colour}-${index}`} style={{ background: swatch(colour) }} />
          ))}
        </span>
        <small>Preview view and colorway are local; setup lighting and published starts are reusable.</small>
      </figcaption>
    </figure>
  );
}
