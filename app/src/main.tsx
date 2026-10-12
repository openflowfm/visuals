import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { VisualsApp } from '@satoramoto/zen/visuals';
import '@satoramoto/zen/zen.css';
import '@satoramoto/zen/visuals.css';
import './main.css';
import { createCameraController } from './camera/capture';
import modelLicenseUrl from './camera/person-assets/LICENSE.mediapipe?url';
import { installTauriBridge } from './zenBridge.ts';

// The page is zen's visual[flow] UI (`@satoramoto/zen/visuals`): the home, live
// mode, the sheets, the welcome flow and the prompts, in its own theme scope
// with the `visuals` pack, dark as the window's frost is. Every command and
// event goes through the bridge installed here, over Tauri. Served on its own
// (a browser tab on the dev port) there is no Tauri behind the page and no
// bridge to install; zen's UI then says it has no backend.
if ('__TAURI_INTERNALS__' in window) installTauriBridge();

// The editor, only in a lab build: without `VITE_LAB` this is `null` at build
// time, and the editor's code (the graph, the inspector, the edits, the suite's
// widgets they still use) never reaches the bundle.
const Lab = import.meta.env.VITE_LAB ? lazy(() => import('./Lab.tsx')) : null;

const cameraController = Object.assign(createCameraController(), { modelLicenseUrl });
const app = <VisualsApp mode="dark" cameraController={cameraController} />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Lab ? (
      <Suspense fallback={null}>
        <Lab app={app} />
      </Suspense>
    ) : (
      app
    )}
  </StrictMode>,
);
