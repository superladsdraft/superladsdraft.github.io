/*
 * Super Lads Draft: FPL data relay (Cloudflare Worker).
 *
 * The FPL Draft API doesn't let web pages on other sites read it, so the site
 * asks this worker instead. The worker fetches from FPL, adds the header that
 * lets our site read the answer, and remembers each answer for a short while
 * so FPL is only asked about once a minute however many of us are refreshing.
 *
 * Only the paths listed in ROUTES are passed through.
 */

const UPSTREAM = "https://draft.premierleague.com/api/";
const LEAGUE_ID = "4674";

// Sites allowed to read from this worker. Add a custom domain here if you get one.
const ALLOWED_ORIGINS = [
  "https://superladsdraft.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

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
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
  }
  return headers;
}

function json(body, status, seconds, request) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${Math.min(seconds, 30)}`,
      ...corsHeaders(request),
    },
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      return json('{"error":"Only GET is allowed"}', 405, 0, request);
    }

    const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");

    try {
      if (path === "bootstrap") {
        return json(await slimBootstrap(), 200, SLIM_BOOTSTRAP_SECONDS, request);
      }
      const route = ROUTES.find(([pattern]) => pattern.test(path));
      if (!route) {
        return json('{"error":"Not found"}', 404, 0, request);
      }
      return json(await fetchUpstream(path, route[1]), 200, route[1], request);
    } catch (err) {
      return json(JSON.stringify({ error: err.message }), err.status || 502, 0, request);
    }
  },
};
