/**
 * Muybridge frame images, fetched from the museums' IIIF servers (all allow
 * cross-origin use) and kept in the Cache API so a day's poses work offline once
 * fetched. A day's frames are fetched ahead when it begins.
 */
const CACHE = "nicolaides-frames-v1";
const objectUrls = new Map<string, string>();

async function cached(url: string): Promise<Response> {
  if (!("caches" in self)) return fetch(url, { mode: "cors" });
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) return hit;
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await cache.put(url, response.clone());
  return response;
}

/** An object URL for the frame (cached copy first), kept for reuse while the page is open. */
export async function frameObjectUrl(url: string): Promise<string> {
  const known = objectUrls.get(url);
  if (known) return known;
  const blob = await (await cached(url)).blob();
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(url, objectUrl);
  return objectUrl;
}

/** Fetches every frame not yet cached, a few at a time. Resolves to how many failed. */
export async function prefetch(urls: readonly string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  let next = 0;
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try { await cached(url); } catch { failed += 1; }
      done += 1;
      onProgress?.(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return failed;
}

/** Drops cached frames not in `keep` (the current and next day's). */
export async function pruneFrames(keep: readonly string[]): Promise<void> {
  if (!("caches" in self)) return;
  const cache = await caches.open(CACHE);
  const wanted = new Set(keep);
  for (const request of await cache.keys()) if (!wanted.has(request.url)) await cache.delete(request);
}
