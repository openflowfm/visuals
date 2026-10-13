import { VisualsApp, type VisualsAppProps } from './ui';
import { VisualsEditor } from './ui/lab';

/**
 * A lab build's page (`VITE_LAB=1`; main.tsx loads this module only then, so
 * none of it reaches the app people get): the whole UI with its preset editor,
 * `./ui/lab.ts` (its own entry, so the editor, its stylesheets and its commands
 * stay in this chunk). It starts in the editor unless `VISUALS_VIEW` says
 * another view, and every header's switch offers home, editor and live.
 */
export default function Lab({ cameraController }: Pick<VisualsAppProps, 'cameraController'>) {
  return <VisualsApp mode="dark" lab={VisualsEditor} cameraController={cameraController} />;
}
