import { SourcePicker } from './SourcePicker.tsx';

/**
 * What the presets listen to, in the header: the source picker
 * ([`SourcePicker`](./SourcePicker.tsx)) — your DAW, everything on this Mac, or
 * a microphone or interface — with its meter.
 */
export function AudioInput({ onError }: { onError(error: unknown): void }) {
  return <SourcePicker onError={onError} />;
}
