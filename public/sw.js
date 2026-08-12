/* The CFB Slate — service worker.
 *
 * Push only. This deliberately does NOT cache anything: the app is live scores
 * and lines, and a stale-while-revalidate shell is exactly how you end up
 * looking at Saturday's board on Sunday. If offline support is ever wanted it
 * belongs in a separate, deliberate pass.
 *
 * iOS delivers push only to a web app installed on the Home Screen, and only
 * when every push shows a notification — `userVisibleOnly` is enforced at
 * subscribe time, so there is no silent-data path to write here even if we
 * wanted one.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // A push with no body should still show something rather than nothing: iOS
  // shows a browser-generated placeholder if the handler resolves without
  // calling showNotification, which looks broken.
  let payload = { title: "The CFB Slate", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data ? event.data.text() : "";
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-32.png",
      data: { url: payload.url || "/" },
      // Same tag replaces rather than stacks — two updates about one game
      // should be one line in Notification Center, not a pile.
      tag: payload.tag || undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an open window and navigate it rather than opening a second copy
      // of an installed app, which on iOS looks like the app restarting.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

/* The browser can rotate a subscription on its own — iOS does it after a spell
 * of disuse. Without this the old endpoint is dead, the server keeps pushing to
 * it, and the user silently stops getting anything until they next open the app.
 * The client also re-syncs on launch; this is the half that works when it is
 * closed. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription?.options?.applicationServerKey;
      if (!key) return;
      const fresh = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      // Same-origin fetch from a service worker carries cookies, so this is
      // authenticated as the signed-in user without any token plumbing.
      await fetch("/api/push/resubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          old: event.oldSubscription?.endpoint ?? null,
          subscription: fresh.toJSON(),
        }),
      });
    })(),
  );
});
