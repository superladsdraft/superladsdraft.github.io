/*
 * Service worker: only here to show push notifications for new waivers, free-agent
 * signings and trades. It doesn't cache anything, so the site always loads fresh.
 *
 * The relay's ping carries no message, so on each ping this asks the relay what
 * happened (/push/notice) and shows that. The relay address comes in as ?api=.
 */

const API = new URL(location.href).searchParams.get("api");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let notice = { title: "Super Lads Draft", body: "New waivers, signings or trades. Tap to see.", url: "./#moves" };
      try {
        const res = await fetch(`${API}/push/notice`, { cache: "no-store" });
        if (res.ok) notice = { ...notice, ...(await res.json()) };
      } catch (err) {
        // Offline or the relay is down: the general message above still goes out.
      }
      await self.registration.showNotification(notice.title, {
        body: notice.body,
        icon: "assets/icon-192.png",
        badge: "assets/badge-96.png",
        tag: "moves", // a newer notification replaces an older one rather than stacking up
        renotify: true,
        data: { url: notice.url },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "./#moves", self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const tab = open.find((c) => c.url.startsWith(self.registration.scope));
      if (tab) {
        await tab.focus();
        try {
          await tab.navigate(url);
          return;
        } catch (err) {
          // Can't steer that tab; open a fresh one instead.
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
