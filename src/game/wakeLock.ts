// Keeps a phone's screen from dimming while a battle is running (Screen Wake Lock API).

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

export function keepAwake(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else void release();
}

async function acquire(): Promise<void> {
  if (sentinel || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => (sentinel = null));
  } catch {
    // Not allowed (battery saver, unsupported); the screen may dim as usual.
  }
}

async function release(): Promise<void> {
  const s = sentinel;
  sentinel = null;
  await s?.release().catch(() => undefined);
}

// The browser drops the lock when the page is hidden; take it back on return.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void acquire();
  });
}
