import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@satoramoto/zen/zen.css';
import { VisualsApp } from './ui';
import './main.css';
import { createCameraController } from './camera/capture';
import modelLicenseUrl from './camera/person-assets/LICENSE.mediapipe?url';
import { installTauriBridge } from './zenBridge.ts';

// The page is the app's UI (`./ui`, built on zen's public entry
// `@satoramoto/zen`): the home, live mode, the sheets, the welcome flow and the
// prompts, in its own theme scope with zen's `visuals` pack, dark as the
// window's frost is. Each part imports its own stylesheet; zen's is zen.css.
// Every command and event goes through the bridge installed here, over Tauri.
// Served on its own (a browser tab on the dev port) there is no Tauri behind
// the page and no bridge to install; the UI then says it has no backend.
if ('__TAURI_INTERNALS__' in window) installTauriBridge();

// The editor, only in a lab build: without `VITE_LAB` this is `null` at build
// time, and the editor's code (`./ui/lab.ts`: the graph, the inspector, the
// edits and their commands) never reaches the bundle.
const Lab = import.meta.env.VITE_LAB ? lazy(() => import('./Lab.tsx')) : null;

// The camera runs in the host (the browser's capture and the local person model), handed to the UI.
const cameraController = Object.assign(createCameraController(), { modelLicenseUrl });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Lab ? (
      <Suspense fallback={null}>
        <Lab cameraController={cameraController} />
      </Suspense>
    ) : (
      <VisualsApp mode="dark" cameraController={cameraController} />
    )}
  </StrictMode>,
);
