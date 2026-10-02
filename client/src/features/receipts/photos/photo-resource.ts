/** Own a fetched blob URL for one effect lifetime, including late replies. */
export function loadPhotoResource(
  load: (signal: AbortSignal) => Promise<Blob>,
  ready: (url: string, signal: AbortSignal) => void,
  failed: () => void,
) {
  const controller = new AbortController();
  let url = '';
  void load(controller.signal).then(blob => {
    if (controller.signal.aborted) return;
    url = URL.createObjectURL(blob);
    ready(url, controller.signal);
  }).catch(() => { if (!controller.signal.aborted) failed(); });
  return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
}

export function localPhotoBlob(base64: string) {
  return new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: 'image/jpeg' });
}
