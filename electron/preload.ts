import { ipcRenderer } from 'electron';
import { expose } from '@openflow/desktop/preload.ts';

/**
 * The displays, which a renderer cannot see for itself.
 *
 * In a browser this is Chrome's window management API behind a permission
 * prompt — the one the wiki warns you to answer before you are standing in front
 * of a projector. Electron has no such API in the renderer and needs no such
 * permission: the main process asks the OS and hands the answer over.
 *
 * The shape is `useWall.ts`'s own `Display`, deliberately, so the hook takes
 * this list or the browser's without knowing which it got.
 */
export interface Display {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

expose({
  displays: (): Promise<Display[]> => ipcRenderer.invoke('openflow:displays'),
  /** A projector plugged in after launch is the ordinary case, not the exotic one. */
  onDisplaysChanged: (run: () => void): (() => void) => {
    const listener = () => run();
    ipcRenderer.on('openflow:displays-changed', listener);
    return () => ipcRenderer.off('openflow:displays-changed', listener);
  },
});
