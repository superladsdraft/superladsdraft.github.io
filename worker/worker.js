/*
 * Super Lads Draft: FPL data relay and push notifications (Cloudflare Worker).
 *
 * 1. Relay: the FPL Draft API doesn't let web pages on other sites read it, so
 *    the site asks this worker instead. The worker fetches from FPL, adds the
 *    header that lets our site read the answer, and remembers each answer for a
 *    short while so FPL is only asked about once a minute however many of us
 *    are refreshing. Only the paths listed in ROUTES are passed through.
 *
 * 2. Push notifications (needs the PUSH storage and a cron trigger, see README):
 *    phones sign up through /push/subscribe, and every few minutes the cron
 *    checks for new waivers, free-agent signings and trades and pings them all.
 *    The ping itself carries no message; the phone then asks /push/notice what
 *    happened and shows that.
 */

const UPSTREAM = "https://draft.premierleague.com/api/";
const LEAGUE_ID = "4674";
const SITE = "https://superladsdraft.github.io";

// Sites allowed to read from this worker. Add a custom domain here if you get one.
const ALLOWED_ORIGINS = [SITE, "http://localhost:8000", "http://127.0.0.1:8000"];

// [path pattern, seconds to keep the answer]
const ROUTES = [
  [/^game$/, 30],
  [new RegExp(`^league/${LEAGUE_ID}/details$`), 60],
  [new RegExp(`^league/${LEAGUE_ID}/element-status$`), 300],
  [new RegExp(`^draft/league/${LEAGUE_ID}/(transactions|trades)$`), 300],
  [/^event\/\d{1,2}\/live$/, 60],
  [/^entry\/\d{1,8}\/event\/\d{1,2}$/, 120],
];

// bootstrap-static is ~1MB, mostly stats we never show, so the worker trims it.
const SLIM_BOOTSTRAP_SECONDS = 3600;

// Phones only ever give us addresses at these push services; anything else is refused.
const PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

const memo = new Map();

async function fetchUpstream(path, seconds) {
  const hit = memo.get(path);
  if (hit && hit.expires > Date.now()) return hit.body;

  const request = () =>
    fetch(UPSTREAM + path, {
      headers: { "User-Agent": "superladsdraft.github.io" },
      cf: { cacheTtl: seconds, cacheEverything: true },
    });
  // One retry smooths over the odd dropped connection to FPL.
  const res = await request().catch(request);
  if (!res.ok) {
    const error = new Error(`FPL answered ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const body = await res.text();
  // FPL serves an HTML holding page while it updates between gameweeks.
  if (!body.trim().startsWith("{") && !body.trim().startsWith("[")) {
    const error = new Error("FPL is updating");
    error.status = 503;
    throw error;
  }
  memo.set(path, { body, expires: Date.now() + seconds * 1000 });
  return body;
}

async function slimBootstrap() {
  const boot = JSON.parse(await fetchUpstream("bootstrap-static", SLIM_BOOTSTRAP_SECONDS));
  const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
  return JSON.stringify({
    events: boot.events.data.map((e) => pick(e, ["id", "name", "deadline_time", "finished"])),
    teams: boot.teams.map((t) => pick(t, ["id", "name", "short_name", "code"])),
    element_types: boot.element_types.map((t) => pick(t, ["id", "singular_name_short"])),
    elements: boot.elements.map((e) =>
      pick(e, ["id", "web_name", "team", "element_type", "status", "news", "chance_of_playing_this_round", "chance_of_playing_next_round"])
    ),
    squad: boot.settings.squad,
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

function json(body, status, seconds, request) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": seconds ? `public, max-age=${Math.min(seconds, 30)}` : "no-store",
      ...corsHeaders(request),
    },
  });
}

// ---------- Push: keys and signing ----------

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// The worker makes its own push key pair the first time it's asked and keeps it in PUSH storage.
async function vapidKeys(env) {
  const saved = await env.PUSH.get("vapid", "json");
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = {
    publicKey: b64url(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
  await env.PUSH.put("vapid", JSON.stringify(keys));
  return keys;
}

// A short signed note that proves the ping came from us (the "VAPID" standard push services use).
async function vapidToken(endpoint, keys) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    new TextEncoder().encode(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })
    )
  );
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(signature)}`;
}

// An empty ping: the phone wakes up, asks /push/notice what happened and shows it.
async function ping(subscription, keys) {
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${await vapidToken(subscription.endpoint, keys)}, k=${keys.publicKey}`,
      TTL: "86400",
      Urgency: "normal",
      "Content-Length": "0",
    },
  });
}

async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return `sub:${b64url(digest).slice(0, 32)}`;
}

function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== "string" || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
  try {
    const url = new URL(sub.endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch (err) {
    return false;
  }
}

async function handlePush(path, request, env) {
  if (!env.PUSH) return json({ error: "Push notifications aren't set up yet" }, 503, 0, request);

  if (path === "push/key" && request.method === "GET") {
    return json({ publicKey: (await vapidKeys(env)).publicKey }, 200, 0, request);
  }
  if (path === "push/notice" && request.method === "GET") {
    return json((await env.PUSH.get("notice")) || '{"title":"Super Lads Draft","body":"Nothing new yet."}', 200, 0, request);
  }
  if ((path === "push/subscribe" || path === "push/unsubscribe") && request.method === "POST") {
    const text = await request.text();
    if (text.length > 4096) return json({ error: "Too big" }, 413, 0, request);
    let sub;
    try {
      sub = JSON.parse(text);
    } catch (err) {
      return json({ error: "Not JSON" }, 400, 0, request);
    }
    if (path === "push/unsubscribe") {
      if (typeof sub.endpoint === "string") await env.PUSH.delete(await subscriptionId(sub.endpoint));
      return json({ ok: true }, 200, 0, request);
    }
    if (!validSubscription(sub)) return json({ error: "That isn't a push subscription" }, 400, 0, request);
    const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
    // Kept in the key's metadata too, so the cron can list everyone in one go.
    await env.PUSH.put(await subscriptionId(sub.endpoint), JSON.stringify(clean), { metadata: clean });
    return json({ ok: true }, 201, 0, request);
  }
  return json({ error: "Not found" }, 404, 0, request);
}

// ---------- Push: checking for new moves (runs on the cron trigger) ----------

function describeMoves(fresh, teams) {
  const waivers = fresh.filter((m) => m.kind === "w");
  const free = fresh.filter((m) => m.kind === "f");
  const trades = fresh.filter((m) => m.kind === "trade");
  const tally = (moves) => {
    const counts = {};
    moves.forEach((m) => (counts[teams[m.entry] || "Someone"] = (counts[teams[m.entry] || "Someone"] || 0) + 1));
    return Object.entries(counts)
      .map(([team, n]) => (n > 1 ? `${team} ×${n}` : team))
      .join(", ");
  };
  const lines = [];
  if (trades.length > 2) lines.push(`${trades.length} trades done`);
  else if (trades.length) lines.push(trades.map((t) => `Trade: ${teams[t.from] || "?"} ⇄ ${teams[t.to] || "?"}`).join(" · "));
  if (waivers.length) lines.push(`Waivers: ${waivers.length} signed (${tally(waivers)})`);
  if (free.length) lines.push(`Free agent${free.length > 1 ? "s" : ""}: ${tally(free)}`);
  const title = trades.length ? "Trade done! 🔄" : waivers.length ? "Waivers are in! 📋" : "New signing 🆕";
  return { title, body: `${lines.join(" · ")}. Tap to see who.`, url: `${SITE}/#moves`, time: new Date().toISOString() };
}

async function checkForMoves(env) {
  if (!env.PUSH) return { skipped: "no PUSH storage" };
  const [tx, tr, details] = await Promise.all([
    fetchUpstream(`draft/league/${LEAGUE_ID}/transactions`, 60).then(JSON.parse),
    fetchUpstream(`draft/league/${LEAGUE_ID}/trades`, 60).then(JSON.parse),
    fetchUpstream(`league/${LEAGUE_ID}/details`, 60).then(JSON.parse),
  ]);
  const teams = {};
  details.league_entries.forEach((e) => {
    teams[e.entry_id] = e.entry_name;
  });
  const moves = [
    ...tx.transactions.filter((t) => t.result === "a").map((t) => ({ id: `t${t.id}`, kind: t.kind, entry: t.entry })),
    ...tr.trades
      .filter((t) => t.state === "p")
      .map((t) => ({ id: `x${t.id}`, kind: "trade", from: t.offered_entry, to: t.received_entry })),
  ];

  const seen = await env.PUSH.get("seen", "json");
  const fresh = seen ? moves.filter((m) => !seen.includes(m.id)) : [];
  if (!seen || fresh.length) await env.PUSH.put("seen", JSON.stringify(moves.map((m) => m.id)));
  if (!fresh.length) return { fresh: 0, firstRun: !seen }; // the first run just notes what's already happened

  const notice = describeMoves(fresh, teams);
  await env.PUSH.put("notice", JSON.stringify(notice));

  const keys = await vapidKeys(env);
  const subs = [];
  let cursor;
  do {
    const page = await env.PUSH.list({ prefix: "sub:", cursor });
    page.keys.forEach((k) => k.metadata && subs.push({ name: k.name, sub: k.metadata }));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const results = await Promise.all(
    subs.map(async ({ name, sub }) => {
      const res = await ping(sub, keys).catch(() => null);
      // 404/410: that phone has unsubscribed or reinstalled, so forget it.
      if (res && (res.status === 404 || res.status === 410)) await env.PUSH.delete(name);
      return res ? res.status : "failed";
    })
  );
  return { fresh: fresh.length, notice, sent: results };
}

// ---------- Entry points ----------

export default {
  async fetch(request, env = {}) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");

    try {
      if (path.startsWith("push/")) return await handlePush(path, request, env);
      if (request.method !== "GET") {
        return json({ error: "Only GET is allowed" }, 405, 0, request);
      }
      if (path === "bootstrap") {
        return json(await slimBootstrap(), 200, SLIM_BOOTSTRAP_SECONDS, request);
      }
      const route = ROUTES.find(([pattern]) => pattern.test(path));
      if (!route) {
        return json({ error: "Not found" }, 404, 0, request);
      }
      return json(await fetchUpstream(path, route[1]), 200, route[1], request);
    } catch (err) {
      return json({ error: err.message }, err.status || 502, 0, request);
    }
  },

  // Cron trigger: look for new moves and ping everyone signed up.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkForMoves(env));
  },
};
