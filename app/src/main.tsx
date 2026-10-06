import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@openflow/widgets/palette.css';
import '@openflow/widgets/tokens.css';
import './app.css';
import { App } from './App.tsx';

// Served on its own (a browser tab on the dev port) the page has no app behind it:
// no engine, no presets, no bench. The window `npm run app` opens is the editor.
const inApp = '__TAURI_INTERNALS__' in window;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {inApp ? (
      <App />
    ) : (
      <p className="outside">This is the editor's page without the app behind it. The editor is the window <code>npm run app</code> opened.</p>
    )}
  </StrictMode>,
);
