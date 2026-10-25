# FPL relay (Cloudflare Worker)

The FPL Draft API doesn't allow other websites to read it from the browser, so the site goes through this small worker. It fetches from FPL, marks the answer as OK for superladsdraft.github.io to read, and keeps each answer for 30 seconds to an hour so FPL isn't hammered. It only passes through the handful of FPL addresses the site uses.

Cloudflare's free plan allows 100,000 requests a day, far more than ten of us will ever use.

## Setting it up (one time, about 5 minutes, no coding)

The worker lives on Cloudflare, completely separate from GitHub, so you can do this before or after the site is on GitHub.

1. Sign up for a free account at <https://dash.cloudflare.com/sign-up>.
2. In the dashboard, open **Workers & Pages** and choose **Create** → **Create Worker** (pick the "Hello World" starter if it asks).
3. Name it `superlads-fpl` and press **Deploy**. The first time, Cloudflare asks you to pick a `workers.dev` subdomain. Any name will do, e.g. `superlads`.
4. Cloudflare now shows your worker's own web address, made from the name and subdomain, e.g. `https://superlads-fpl.superlads.workers.dev`. Keep a copy of it.
5. Press **Edit code**, delete everything in the editor, paste in the whole of [`worker.js`](worker.js), and press **Deploy** again.
6. Check it works: open your worker's address with `/game` added on the end (e.g. `https://superlads-fpl.superlads.workers.dev/game`). You should see a short line of text starting `{"current_event":`.
7. Paste the address (without `/game`) into `apiBase` in [`../data/league.js`](../data/league.js):

   ```js
   apiBase: "https://superlads-fpl.superlads.workers.dev",
   ```

8. Once the site is on GitHub, commit that change. Within a couple of minutes the site's Live, Table and Manager of the Month pages fill in.

If you ever put the site on another address (a custom domain, say), add it to `ALLOWED_ORIGINS` at the top of `worker.js` and deploy again.

## Running it on your computer

```bash
node dev.mjs
```

That starts the same relay at <http://localhost:8787>, which the site uses automatically when you run it locally. Needs Node 18 or newer.
