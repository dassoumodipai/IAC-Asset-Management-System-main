import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

type InstallPromptEvent = Event & { prompt(): Promise<void> };

const IOS_TIP_KEY = 'iac.iosInstallTip';

let deferredInstallPrompt: InstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredInstallPrompt = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
  });
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <button
      type="button"
      role="status"
      className="button fixed inset-x-4 bottom-36 z-50 mx-auto max-w-md shadow-lg"
      onClick={() => void updateServiceWorker(true)}
    >
      New version available. Tap to reload.
    </button>
  );
}

export function InstallMenuItem() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(deferredInstallPrompt);
  useEffect(() => {
    if (!event) return;
    const onInstalled = () => setEvent(null);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [event]);
  if (!event) return null;
  return (
    <button
      type="button"
      className="button text small"
      onClick={() => {
        const pending = event;
        setEvent(null);
        void pending.prompt().catch(() => undefined);
      }}
    >
      Install app
    </button>
  );
}

function readTipSeen() {
  try {
    return localStorage.getItem(IOS_TIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function IosInstallTip() {
  const [visible, setVisible] = useState(() => isIosSafari() && !isStandalone() && !readTipSeen());
  useEffect(() => {
    if (!visible) return;
    try {
      localStorage.setItem(IOS_TIP_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  }, [visible]);
  if (!visible) return null;
  return (
    <div
      role="note"
      className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg border border-sheet-edge bg-white p-3 text-sm text-ink shadow-lg"
    >
      <span className="flex-1">
        Install this app: tap the Share button, then &ldquo;Add to Home Screen&rdquo;.
      </span>
      <button type="button" className="button secondary small" onClick={() => setVisible(false)}>
        Got it
      </button>
    </div>
  );
}

export function OfflineScreen() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div
      role="alert"
      className="m-4 rounded-lg border border-sheet-edge bg-white p-6 text-center text-ink"
    >
      You&apos;re offline. Connect to the internet to scan or raise a ticket.
    </div>
  );
}
