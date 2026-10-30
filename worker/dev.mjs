// Runs worker.js on your computer at http://localhost:8787 for testing the site locally.
// Usage (from this folder): node dev.mjs
//
// PUSH storage is faked in memory, and visiting http://localhost:8787/__cron runs the
// "check for new moves" job once, the way Cloudflare's cron trigger would.

import http from "node:http";
import worker from "./worker.js";

const PORT = 8787;

// In-memory stand-in for Cloudflare KV (just the bits the worker uses).
function memoryKV() {
  const store = new Map();
  return {
    async get(key, type) {
      const hit = store.get(key);
      if (!hit) return null;
      return type === "json" ? JSON.parse(hit.value) : hit.value;
    },
    async put(key, value, options = {}) {
      store.set(key, { value, metadata: options.metadata ?? null });
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const keys = [...store].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata }));
      return { keys, list_complete: true };
    },
  };
}

const env = { PUSH: memoryKV() };

http
  .createServer(async (req, res) => {
    let response;
    if (req.url === "/__cron") {
      let job;
      await worker.scheduled({}, env, { waitUntil: (p) => (job = p) });
      response = new Response(JSON.stringify(await job, null, 2), { headers: { "Content-Type": "application/json" } });
    } else {
      const body = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : await new Promise((ok) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c)).on("end", () => ok(Buffer.concat(chunks)));
      });
      const request = new Request(`http://localhost:${PORT}${req.url}`, {
        method: req.method,
        headers: Object.entries(req.headers).filter(([, v]) => typeof v === "string"),
        body,
      });
      response = await worker.fetch(request, env);
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    console.log(response.status, req.method, req.url);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`FPL relay running at http://localhost:${PORT}`));
