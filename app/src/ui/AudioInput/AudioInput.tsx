import { SourcePicker } from '../SourcePicker/SourcePicker';
import './AudioInput.css';

/**
 * **Job.** What the presets listen to, in the header: the source picker (`SourcePicker`) — your
 * DAW, everything on this Mac, or a microphone or interface — with its meter.
 *
 * **Changed.** The original's audio.css (Advanced's box, the notes) moved into `SourcePicker.css`,
 * which draws them; this file only keeps the header's narrow-window rule (app.css, decision 63) on
 * its own wrapper class, `vs-audio-header`.
 *
 * **Kept.** A plain pass-through: the same prop, and Advanced for the channels.
 */
export function AudioInput({ onError }: { onError(error: unknown): void }) {
  return (
    <span className="vs-audio-header">
      <SourcePicker onError={onError} />
    </span>
  );
}
