import type { ReactNode } from 'react';

/** Mounted once across Home/Live; the feature lane supplies capture ownership. */
export function CameraProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Contract stub; the feature lane supplies the existing app sheet. */
export function CameraPanel(_props: { open: boolean; onClose(): void }) {
  return null;
}
