// Sign-out cache purge (SPEC 8.2 Account actions, plan 8.6): delete every
// runtime cache the service worker filled. The precache (app shell assets)
// holds nothing user-specific, so it stays.
export async function purgeRuntimeCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith("workbox-precache")).map((k) => caches.delete(k)));
  } catch {
    // Cache Storage can be unavailable (private mode, insecure origin); sign-out goes on.
  }
}
