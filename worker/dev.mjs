// Runs worker.js on your computer at http://localhost:8787 for testing the site locally.
// Usage (from this folder): node dev.mjs

import http from "node:http";
import worker from "./worker.js";

const PORT = 8787;

http
  .createServer(async (req, res) => {
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([, v]) => typeof v === "string"),
    });
    const response = await worker.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    console.log(response.status, req.url);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`FPL relay running at http://localhost:${PORT}`));
