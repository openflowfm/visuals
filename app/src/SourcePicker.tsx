import { AudioInput } from './AudioInput.tsx';

/**
 * What the app listens to: your DAW, everything on this Mac, or a microphone or
 * interface (`api.audioSources`, `api.listenToSource`). A stub for now — issue
 * #85 builds the picker — that offers today's input devices.
 */
export function SourcePicker({ onError }: { onError(error: unknown): void }) {
  return <AudioInput onError={onError} />;
}
