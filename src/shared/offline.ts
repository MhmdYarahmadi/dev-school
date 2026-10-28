import { useSyncExternalStore } from 'react';

/** A new version of the site, downloaded and waiting for the learner to reload. */
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
function setWaiting(w: ServiceWorker | null) {
  waiting = w;
  listeners.forEach((l) => l());
}

/**
 * Install the service worker (offline/sw.js), which saves the whole site in the browser so the
 * courses open without internet. Only in production builds: the dev server has no sw.js.
 */
export function registerOffline() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // An update already downloaded on an earlier visit.
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            // The first install needs no reload; later ones wait for the learner.
            if (w.state === 'installed' && navigator.serviceWorker.controller) setWaiting(w);
          });
        });
      })
      .catch(() => undefined);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !waiting) return;
      reloading = true;
      window.location.reload();
    });
  });
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => waiting !== null,
    () => false,
  );
}

/** Switch to the waiting version; the page reloads when it takes over. */
export function applyUpdate() {
  waiting?.postMessage('skipWaiting');
}
