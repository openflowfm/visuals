/** Encode a server-approved relative media id without letting slashes become data. */
export const mediaUrl = (asset: string): string =>
  `/media/${asset
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
