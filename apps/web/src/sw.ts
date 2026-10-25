/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
registerRoute(({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'), createHandlerBoundToURL('/index.html'));
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('push', (event: PushEvent) => {
  let payload: { title?: string; body?: string; path?: string } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: 'IAC Asset Portal', body: event.data?.text() ?? '' };
  }
  const title = payload.title?.slice(0, 100) || 'IAC Asset Portal';
  const path = payload.path?.startsWith('/') && !payload.path.startsWith('//') ? payload.path : '/dashboard';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body?.slice(0, 500) || 'You have a new update.',
    icon: '/image.png',
    badge: '/loading-logo.png',
    tag: 'iac-announcement',
    data: { path },
  }));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const path = event.notification.data?.path;
  const url = new URL(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    return existing ? existing.navigate(url).then(() => existing.focus()) : self.clients.openWindow(url);
  }));
});
