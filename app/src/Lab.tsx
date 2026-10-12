import { VisualsApp } from '@satoramoto/zen/visuals';
import { VisualsEditor } from '@satoramoto/zen/visuals/lab';
import '@satoramoto/zen/visuals-lab.css';

/**
 * A lab build's page (`VITE_LAB=1`; main.tsx loads this module only then, so
 * none of it reaches the app people get): zen's whole UI with its preset editor,
 * `@satoramoto/zen/visuals/lab` (its own package entry, so the editor and its
 * commands stay in this chunk). It starts in the editor unless `VISUALS_VIEW`
 * says another view, and every header's switch offers home, editor and live.
 */
export default function Lab() {
  return <VisualsApp mode="dark" lab={VisualsEditor} />;
}
