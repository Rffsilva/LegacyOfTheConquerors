// Installable, offline app support: service worker registration, update prompts, the install
// button and keeping saved campaigns from being evicted.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = () => void;

let installEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

/** Starts offline support. Does nothing in development, where files change constantly. */
export function initPwa(onUpdateReady: (apply: () => void) => void): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own install button instead
    installEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    notify();
  });

  // Ask the browser not to clear our saves under storage pressure.
  void navigator.storage?.persist?.().catch(() => undefined);

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // Register once the page has loaded (it usually has by the time the game boots).
  if (document.readyState === 'complete') void register(onUpdateReady);
  else window.addEventListener('load', () => void register(onUpdateReady), { once: true });
}

async function register(onUpdateReady: (apply: () => void) => void): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    // Reload only for an update the player accepted, not when the first install takes over.
    let accepted = false;
    const offer = (worker: ServiceWorker) =>
      onUpdateReady(() => {
        accepted = true;
        worker.postMessage('skip-waiting');
      });
    // A new version was already downloaded on an earlier visit.
    if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        // Only offer an update if an older version is running; the first install is silent.
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!accepted) return;
      accepted = false;
      location.reload();
    });
  } catch {
    // Offline support is a bonus; the game still works without it.
  }
}

/** Is a one-tap install available (Chrome, Edge, Android)? */
export function canInstall(): boolean {
  return installEvent !== null;
}

export async function install(): Promise<void> {
  const event = installEvent;
  if (!event) return;
  await event.prompt();
  await event.userChoice;
  installEvent = null;
  notify();
}

/** iPhone and iPad Safari install via the Share menu instead of a prompt. */
export function needsManualInstall(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !isInstalled();
}

export function isInstalled(): boolean {
  return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Called when install availability changes. */
export function onInstallChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
