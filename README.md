# Super Lads Draft

Live tracker for the Super Lads FPL Draft head-to-head league (league 4674): this week's head-to-heads player by player, the table, Manager of the Month, waivers and trades, prizes and money, and the Hall of Fame.

Plain HTML, CSS and JavaScript with no build step, hosted free on GitHub Pages. FPL data comes through a small free Cloudflare Worker ([`worker/`](worker/)), because the FPL API doesn't let other websites read it directly.

## Putting it online at superladsdraft.github.io

GitHub Pages addresses are always `<owner>.github.io`, so the trick is to make the owner a free **organisation** called `superladsdraft`:

1. Signed in to GitHub, go to <https://github.com/organizations/plan>, pick **Free**, and name the organisation `superladsdraft`.
2. In the new organisation, create a **public** repository named exactly `superladsdraft.github.io`.
3. Upload this folder to it: in GitHub Desktop use *File → Add local repository* on this folder and publish it to the organisation, or drag the files into the repo's "uploading an existing file" page on the website.
4. In the repo go to **Settings → Pages**, set **Source** to *Deploy from a branch*, branch `main`, folder `/ (root)`, and save.

After a minute or two the site is live at <https://superladsdraft.github.io>. You can add the other lads to the organisation if they want to help edit.

Then set up the FPL relay by following [`worker/README.md`](worker/README.md). Until that's done, the pages that need FPL data say it isn't connected yet.

## Updating league info

Everything the FPL API can't tell us lives in [`data/league.js`](data/league.js): nicknames, buy-ins, payouts, the League Cup and past seasons. Edit it on GitHub (pencil icon), commit, and the site updates within a few minutes.

- Manager of the Month, Top at Christmas, Champion and Runner-up are worked out from FPL automatically. Leave their `winner` as `null` unless you need to override one.
- Manager of the Month is a mini head-to-head league over each month's gameweeks (3 for a win, 1 for a draw, then total points). If two managers are level on both, the site splits the £10 between them unless you set a `winner`.
- Set `paid: true` once the money has gone out.
- The League Cup winner is filled in by hand, with the manager's key (`"dill"`, `"jake"` …), not their nickname.

## Running it on your computer

From this folder, start the FPL relay:

```bash
node worker/dev.mjs
```

and, in a second terminal, the site:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. When running locally the site uses the local relay automatically.

## Roadmap

1. ✅ Site, themes (Light / Dark / Barbie), Prizes, Manager of the Month, Hall of Fame.
2. ✅ Cloudflare Worker for FPL data, league table (live and official), gameweek head-to-heads, and Manager of the Month, Christmas, Champion and Runner-up worked out automatically.
3. ✅ Live gameweek page: tap a match for both teams player by player, with live points, auto-subs and provisional bonus. These live scores feed the table and Manager of the Month too.
4. ✅ Waivers & trades page (every signing and trade, with beaten waiver claims), FPL injury flags, draftfpl.live-style player rows. Hall of Fame now lives at the bottom of Prizes.
5. ✅ Manager of the Month as a monthly H2H mini-league with chance percentages and a screenshot view; waivers in pick order with a shareable image; alerts for new waivers, signings and trades.
6. ✅ Phone push notifications for new waivers, signings and trades (needs the one-time setup in [`worker/README.md`](worker/README.md)); the site can be added to the Home Screen as an app.
7. Next: League Cup, rivalry records.

## Credits

Headings use [Supercharge](https://www.fontspace.com/supercharge-font-f109997) by Iconian Fonts, free for non-commercial use (see `assets/fonts/LICENSE-supercharge.txt`). Icons from [Lucide](https://lucide.dev) (ISC licence).
