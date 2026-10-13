// The public entry of @satoramoto/zen/visuals: visual[flow]'s whole UI on zen, for the app's
// main.tsx. `vite.lib.config.ts` builds it to `lib/visuals.js` and its own stylesheets to
// `lib/visuals.css` (the library's stay in `lib/zen.css`; import both), `tsconfig.lib.json` its types.
//
//   setBridge(tauriBridge);          // once, before rendering
//   createRoot(root).render(<StrictMode><VisualsApp /></StrictMode>);

export { VisualsApp, type VisualsAppProps, type LabEditor } from './App/App';
export { setBridge, currentBridge, type Bridge, type UnlistenFn, type Event, type EventCallback, type InvokeArgs, type DragDropEvent, type BridgeWindow, type BridgeWebview } from './model/ipc';

export type { CameraController, CameraSettings, CameraState } from './model/camera';
