// The CDN refuses cross-origin <img> loads, so fetch the bytes (host permission) and hand out blob URLs.
// Cached for the tab's lifetime so the card, facepiles and activity rows share one download per picture.
const cache = new Map<string, Promise<string>>();

export function pictureUrl(url: string): Promise<string> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url, { credentials: 'omit' })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`picture ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => URL.createObjectURL(blob));
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}

// For $effect: loads the picture and returns the cleanup that ignores a late result.
export function loadPicture(url: string, onLoad: (blobUrl: string) => void): () => void {
  let cancelled = false;
  pictureUrl(url)
    .then((blobUrl) => {
      if (!cancelled) {
        onLoad(blobUrl);
      }
    })
    // A missing picture falls back to initials; nothing to report.
    .catch(() => {});
  return () => {
    cancelled = true;
  };
}
