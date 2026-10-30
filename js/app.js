(function () {
  "use strict";

  const L = window.LEAGUE;
  const FPL = window.FPL;
  const view = document.getElementById("view");
  const sheet = document.getElementById("sheet"); // pop-up used for the shareable waivers image

  const state = {
    model: null, // FPL data, once loaded
    error: null,
    loading: true,
    viewGw: null, // gameweek shown on the Live page; null = the current one
    tableView: "live",
    motmMonth: null, // month picked on the Manager of the Month page; null = the latest one under way
    shot: false, // Manager of the Month "screenshot view"
  };
  const openDetails = new Set(); // keeps expanded sections open across refreshes

  // ---------- Helpers ----------

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const money = (n) => "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

  const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function monthName(ym, long) {
    const [year, month] = ym.split("-").map(Number);
    return long ? `${LONG_MONTHS[month - 1]} ${year}` : SHORT_MONTHS[month - 1];
  }

  function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const deadlineFormat = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const managerByKey = Object.fromEntries(L.managers.map((m) => [m.key, m]));

  // Nickname from league.js, team name from FPL (so renames show up by themselves).
  function person(key) {
    const entry = state.model && state.model.entryByKey[key];
    const manager = managerByKey[key];
    return {
      nickname: manager ? manager.nickname : entry ? entry.nickname : key,
      team: entry ? entry.team : manager ? manager.team : "",
    };
  }

  const nickname = (key) => person(key).nickname;

  const chip = (kind, text) => `<span class="chip chip-${kind}">${text}</span>`;

  const gwRange = (gws) => (gws.length === 0 ? "" : gws.length === 1 ? `GW${gws[0]}` : `GW${gws[0]}–${gws[gws.length - 1]}`);

  // ---------- Results: FPL data plus anything overridden in league.js ----------

  function months() {
    if (state.model) return FPL.motm(state.model);
    return L.motm.months.map((m) => ({
      ...m,
      gws: [],
      gwStates: [],
      started: false,
      complete: false,
      table: [],
      leaders: [],
      winners: m.winner ? [m.winner] : [],
      tie: false,
    }));
  }

  function prizes() {
    const status = state.model ? FPL.prizeStatus(state.model) : {};
    return L.prizes.map((p) => {
      const s = status[p.id] || {};
      return { ...p, winner: p.winner || s.winner || null, leader: s.leader || null, gw: s.gw || null };
    });
  }

  // Every prize as one flat list, so the money maths only lives in one place.
  // A shared Manager of the Month prize is split between the winners.
  function allPrizes() {
    const motm = months().flatMap((m) =>
      m.winners.map((key) => ({ amount: L.motm.amount / m.winners.length, winner: key, paid: m.paid }))
    );
    return prizes().concat(motm);
  }

  // ---------- Icons (Lucide, ISC licence) ----------

  const svg = (body) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const ICONS = {
    live: svg('<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>'),
    table: svg('<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
    motm: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m12 13 1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 15.3l2-.3z"/>'),
    moves: svg('<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>'),
    prizes: svg('<circle cx="12" cy="12" r="10"/><path d="M14.5 8.3A2.6 2.6 0 0 0 10 10v6M8.5 12.5h4M8.5 16h7"/>'),
  };

  // ---------- Shared bits ----------

  function pageHead(title, text) {
    return `
      <div class="page-head">
        <h1>${title}</h1>
        ${text ? `<p>${text}</p>` : ""}
        ${statusLine()}
      </div>`;
  }

  function statusLine() {
    const m = state.model;
    if (!m) return "";
    const live = m.liveGw ? `<span class="live-dot" aria-hidden="true"></span>Live · ` : "";
    const stale = state.error ? ` · <span class="stale">couldn't refresh, showing last update</span>` : "";
    return `<p class="status-line">${live}Updated ${timeFormat.format(m.updated)}${stale}</p>`;
  }

  // Shown in place of FPL-based content while it loads or if it can't.
  function dataNotice() {
    if (state.model) return "";
    if (state.loading) return `<section class="card notice">Getting the latest from FPL…</section>`;
    if (state.error.code === "not-connected") {
      return `<section class="card notice">Live FPL data isn't connected yet, so results and tables can't load. It needs <code>apiBase</code> setting in <code>data/league.js</code>.</section>`;
    }
    return `
      <section class="card notice notice-error">
        <span>Couldn't reach FPL: ${esc(state.error.message)}</span>
        <button type="button" class="btn" data-action="retry">Try again</button>
      </section>`;
  }

  // ---------- Pages ----------

  // Line-ups for gameweeks other than the live one are fetched when first viewed.
  const gameweeks = {};
  const gameweekErrors = {};
  const gameweeksLoading = new Set();

  function gameweekData(gw) {
    const m = state.model;
    if (m.live && m.live.gw === gw) return m.live;
    if (gameweeks[gw]) return gameweeks[gw];
    if (!gameweeksLoading.has(gw) && !gameweekErrors[gw]) {
      gameweeksLoading.add(gw);
      FPL.gameweek(m, gw)
        .then((result) => (gameweeks[gw] = result))
        .catch((err) => (gameweekErrors[gw] = err))
        .finally(() => {
          gameweeksLoading.delete(gw);
          render();
        });
    }
    return null;
  }

  const STATUS = {
    playing: { icon: "●", label: "Playing now" },
    waiting: { icon: "◌", label: "On the bench" },
    upcoming: { icon: "○", label: "Still to play" },
    played: { icon: "✓", label: "Played" },
    dnp: { icon: "✕", label: "Didn't play" },
  };

  // Short stat names, draftfpl.live style, in the order they're shown.
  // The optional test hides stats that don't score for that position.
  const STAT_ABBR = [
    ["minutes", "MP"],
    ["goals_scored", "G"],
    ["assists", "A"],
    ["clean_sheets", "CS", (p) => p.position !== "FWD"],
    ["goals_conceded", "GC", (p) => p.position === "GKP" || p.position === "DEF"],
    ["saves", "S"],
    ["defensive_contribution", "DC"],
    ["bonus", "B"],
    ["yellow_cards", "YC"],
    ["red_cards", "RC"],
    ["own_goals", "OG"],
    ["penalties_saved", "PS"],
    ["penalties_missed", "PM"],
  ];

  function statLine(p) {
    const parts = STAT_ABBR.filter(([key, , show]) => p.stats[key] && (!show || show(p))).map(
      ([key, abbr]) => `${p.stats[key]} ${abbr}`
    );
    if (p.bonus) parts.push(`${p.bonus} B*`);
    return parts.join(", ");
  }

  const kickoffFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

  // "14:00" for today's matches, "Sun 14:00" otherwise.
  function kickoffTime(iso) {
    const date = new Date(iso);
    return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : kickoffFormat.format(date);
  }

  // FPL doesn't give the match clock, so estimate it from kick-off, allowing for stoppage time and half-time.
  function matchClock(kickoff) {
    const elapsed = Math.floor((Date.now() - new Date(kickoff)) / 60000);
    if (elapsed <= 47) return `${Math.max(elapsed, 1)}'`;
    if (elapsed < 63) return "HT";
    return elapsed - 17 >= 90 ? "90+'" : `${elapsed - 17}'`;
  }

  function matchLine(p) {
    if (!p.matches.length) return "No match this gameweek";
    return p.matches
      .map((f) =>
        f.started
          ? `${f.home} ${f.homeScore} - ${f.awayScore} ${f.away} | ${f.done ? "FT" : matchClock(f.kickoff)}`
          : `${f.home} v ${f.away} | ${kickoffTime(f.kickoff)}`
      )
      .join(" · ");
  }

  // Start or Bench in their real match (FPL only knows once it kicks off).
  function roleTag(p) {
    if (p.status === "waiting") return '<span class="role role-bench is-live">Bench</span>';
    if (p.status === "playing" || p.status === "played") {
      const live = p.status === "playing" ? " is-live" : "";
      return p.starts
        ? `<span class="role role-start${live}">Start</span>`
        : `<span class="role role-bench${live}">Bench</span>`;
    }
    return "";
  }

  // FPL's injury/suspension flag for players who haven't played yet.
  function availabilityFlag(p) {
    const a = p.availability;
    if (!a || p.status !== "upcoming") return "";
    const reason = (a.news || "").split(" - ")[0];
    const chance = a.chance !== null && a.chance !== undefined ? `${a.chance}%` : a.status === "s" ? "Suspended" : "Out";
    const level = a.status === "d" ? "doubt" : "out";
    return `<span class="flag flag-${level}" title="${esc(a.news || "")}">⚠ ${esc(chance)}${reason ? ` · ${esc(reason)}` : ""}</span>`;
  }

  // FPL's own kit images (keepers get the keeper shirt). If one doesn't load, the status badge still shows.
  function shirtUrl(p) {
    if (!p.teamCode) return "";
    const keeper = p.position === "GKP" ? "_1" : "";
    return `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${p.teamCode}${keeper}-66.webp`;
  }

  // Every row is the same three lines (name, stats, match) so both teams line up.
  function playerRow(p) {
    const status = STATUS[p.status];
    // Amber while the swap is only "as things stand" and could still change.
    const pending = p.subPending ? " is-pending" : "";
    const subTag = p.subIn
      ? `<span class="sub-tag in${pending}" title="${p.subPending ? "On for now, in place of" : "Auto-subbed on for"} ${esc(p.subFor || "a starter")}">SUBBED IN</span>`
      : p.subOut
        ? `<span class="sub-tag out${pending}" title="${p.subPending ? "Out for now, replaced by" : "Auto-subbed off for"} ${esc(p.subBy || "a bench player")}">SUBBED OUT</span>`
        : "";
    // A blank (or worse) from someone who's actually been on the pitch.
    const lol = (p.status === "played" || p.status === "playing") && p.points <= 0 ? '<span class="lol" role="img" aria-label="crying with laughter">😂</span>' : "";
    const stats = statLine(p);
    const live = p.matches.some((f) => f.started && !f.done);
    return `
      <li class="pl st-${p.status}${p.subOut ? " is-out" : ""}">
        <span class="pl-kit"${p.teamCode ? ` style="background-image:url('${shirtUrl(p)}')"` : ""}>
          <span class="pl-status" title="${status.label}" aria-label="${status.label}">${status.icon}</span>
        </span>
        <span class="pl-main">
          <span class="pl-line pl-name"><span class="pl-name-text">${esc(p.name)}</span>${roleTag(p)}</span>
          <span class="pl-line pl-stats">${subTag}${stats ? esc(stats) : availabilityFlag(p)}</span>
          <span class="pl-line pl-match${live ? " is-live" : ""}">${esc(matchLine(p))}</span>
        </span>
        <span class="pl-pts">${lol}${p.points}</span>
      </li>`;
  }

  function lineupList(entry, lu) {
    return `
      <div class="lineup">
        <div class="lineup-head">${esc(entry.team)}</div>
        <ul class="players">${lu.xi.map(playerRow).join("")}</ul>
        <div class="bench-label">Bench</div>
        <ul class="players bench">${lu.bench.map(playerRow).join("")}</ul>
      </div>`;
  }

  function renderLive() {
    const m = state.model;
    if (!m) return pageHead("Live") + dataNotice();

    const gw = state.viewGw || m.currentGw;
    const event = m.events.find((e) => e.id === gw);
    const matches = m.matches.filter((x) => x.gw === gw);
    const complete = FPL.gwComplete(m, gw);
    const started = matches.some((x) => x.started);
    const data = started ? gameweekData(gw) : null;
    const status = complete
      ? chip("good", "Final")
      : started
        ? chip("live", "Live")
        : chip("pending", `Deadline ${deadlineFormat.format(new Date(event.deadline))}`);

    const side = (entry, cls, lu) => {
      const left = lu && !complete && lu.left ? `<span class="left">${lu.left} to play</span>` : "";
      return `<div class="side ${cls}"><span class="who">${esc(entry.team)}</span><span class="who-sub">${esc(entry.nickname)}</span>${left}</div>`;
    };

    const fixtures = matches
      .map((x) => {
        const home = m.entryById[x.home];
        const away = m.entryById[x.away];
        const homeLu = data && data.lineups[x.home];
        const awayLu = data && data.lineups[x.away];
        const homePts = homeLu ? homeLu.score : x.homePts;
        const awayPts = awayLu ? awayLu.score : x.awayPts;
        const lead = x.started ? Math.sign(homePts - awayPts) : 0;
        const score = x.started
          ? `<span>${homePts}</span><span class="dash">–</span><span>${awayPts}</span>`
          : `<span class="vs">v</span>`;
        const header = `
          <div class="fixture">
            ${side(home, "home" + (lead > 0 ? " ahead" : ""), homeLu)}
            <div class="score">${score}</div>
            ${side(away, "away" + (lead < 0 ? " ahead" : ""), awayLu)}
          </div>`;

        if (!started) return `<article class="card fixture-card">${header}</article>`;

        let body;
        if (homeLu && awayLu) body = `<div class="lineups">${lineupList(home, homeLu)}${lineupList(away, awayLu)}</div>`;
        else if (gameweekErrors[gw]) body = `<p class="note">Couldn't load the teams: ${esc(gameweekErrors[gw].message)}</p>`;
        else body = `<p class="note">Loading teams…</p>`;

        return `
          <details class="card fixture-card" data-key="fx-${gw}-${x.home}">
            <summary>${header}<span class="expand-hint">Teams</span></summary>
            ${body}
          </details>`;
      })
      .join("");

    const legend = Object.values(STATUS)
      .map((st) => `<span><span class="pl-status">${st.icon}</span> ${st.label}</span>`)
      .join("");

    const note = m.liveError && gw === m.liveGw
      ? `Couldn't work out live scores (${esc(m.liveError.message)}), so these are FPL's own running scores.`
      : complete
        ? "Final scores from FPL. Tap a match to see both teams."
        : started
          ? "Live scores are as things stand: auto-subs happen as soon as a starter isn't on the pitch (or is ruled out by FPL), and provisional bonus is included, so they can be ahead of FPL's own numbers until the gameweek is finalised. Tap a match to see both teams."
          : "Teams appear here once the deadline has passed.";

    return `
      ${movesAlert()}
      <div class="page-head">
        <div class="gw-nav">
          <button type="button" class="icon-btn" data-gw-step="-1" aria-label="Previous gameweek" ${gw <= 1 ? "disabled" : ""}>‹</button>
          <div class="gw-title">
            <h1>Gameweek ${gw}</h1>
            ${status}
          </div>
          <button type="button" class="icon-btn" data-gw-step="1" aria-label="Next gameweek" ${gw >= m.lastGw ? "disabled" : ""}>›</button>
        </div>
        ${statusLine()}
        ${gw !== m.currentGw ? `<button type="button" class="btn btn-quiet" data-gw-step="current">Back to gameweek ${m.currentGw}</button>` : ""}
      </div>
      <div class="fixtures">${fixtures}</div>
      <p class="note">${note}</p>
      ${started ? `<p class="legend">${legend}</p><p class="legend"><span><span class="key-done">8</span> played, points banked</span><span><span class="key-live">3</span> playing now</span><span><span class="key-todo">0</span> still to play</span><span>😂 0 or fewer points</span></p><p class="legend"><span><span class="sub-tag in">SUBBED IN</span> / <span class="sub-tag out">SUBBED OUT</span> auto-subs, made as things stand: <span class="sub-tag in is-pending">amber</span> means it can still change, e.g. if the starter comes off the bench</span></p><p class="legend">MP minutes · G goals · A assists · CS clean sheet · GC goals conceded · S saves · DC defensive contributions · B bonus (* provisional) · YC/RC cards</p>` : ""}`;
  }

  function renderTable() {
    const m = state.model;
    if (!m) return pageHead("Table") + dataNotice();

    const showLive = Boolean(m.liveGw) && state.tableView === "live";
    const rows = showLive ? FPL.standings(m, m.liveGw, true) : FPL.standings(m, m.lastFinishedGw, false);
    // Arrows compare against the last finished gameweek (live view) or the one before it.
    const baseGw = showLive ? m.lastFinishedGw : m.lastFinishedGw - 1;
    const baseRank = baseGw > 0 ? Object.fromEntries(FPL.standings(m, baseGw, false).map((r) => [r.entry.id, r.rank])) : null;

    const toggle = m.liveGw
      ? `
        <div class="segmented" role="group" aria-label="Table view">
          <button type="button" data-table-view="live" aria-pressed="${showLive}">Live</button>
          <button type="button" data-table-view="official" aria-pressed="${!showLive}">After GW${m.lastFinishedGw}</button>
        </div>`
      : "";

    const lastRank = Math.max(...rows.map((r) => r.rank));
    const body = rows
      .map((r) => {
        const move = baseRank ? baseRank[r.entry.id] - r.rank : 0;
        const arrow =
          move > 0
            ? `<span class="move up" title="Up ${move}">▲</span>`
            : move < 0
              ? `<span class="move down" title="Down ${-move}">▼</span>`
              : `<span class="move"></span>`;
        const form = r.form.map((f) => `<span class="form form-${f}">${f}</span>`).join("");
        const sticker =
          r.rank === 1
            ? '<img class="row-sticker" src="assets/img/kane.png" alt="" title="Top of the league">'
            : r.rank === lastRank
              ? '<img class="row-sticker is-last" src="assets/img/haaland.png" alt="" title="Bottom of the league">'
              : "";
        return `
          <tr class="${r.rank <= 2 ? "is-top" : ""}">
            <td class="rank">${r.rank}${arrow}</td>
            <td class="team-cell"><div class="team-cell-inner"><div><span class="who">${esc(r.entry.team)}</span><span class="who-sub">${esc(r.entry.nickname)}</span></div>${sticker}</div></td>
            <td class="num wide">${r.won}</td>
            <td class="num wide">${r.drawn}</td>
            <td class="num wide">${r.lost}</td>
            <td class="num narrow">${r.won}-${r.drawn}-${r.lost}</td>
            <td class="num">${r.pf}</td>
            <td class="num pts">${r.pts}</td>
            <td class="form-cell wide">${form}</td>
          </tr>`;
      })
      .join("");

    const caption = showLive
      ? `Including gameweek ${m.liveGw} scores so far.`
      : m.lastFinishedGw
        ? `After gameweek ${m.lastFinishedGw}.`
        : "No gameweeks finished yet.";

    return `
      ${pageHead("Table", caption)}
      ${toggle}
      <section class="card table-card">
        <table class="league-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th class="num wide">W</th>
              <th class="num wide">D</th>
              <th class="num wide">L</th>
              <th class="num narrow">W-D-L</th>
              <th class="num"><abbr title="Total points scored">+</abbr></th>
              <th class="num">Pts</th>
              <th class="wide">Form</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </section>
      <p class="note">3 points for a win, 1 for a draw. Level teams are split on total points scored, like on FPL.</p>`;
  }

  function motmSelected(list) {
    if (state.motmMonth && list.some((m) => m.month === state.motmMonth)) return state.motmMonth;
    const underway = list.filter((m) => m.started);
    return (underway.length ? underway[underway.length - 1] : list[0]).month;
  }

  // Ring showing how much of the month is played (half a step for a gameweek under way), or a tick once it's won.
  function monthRing(states, won) {
    const done = states.filter((g) => g.state === "done").length;
    const live = states.filter((g) => g.state === "live").length;
    const circumference = 2 * Math.PI * 22;
    const fraction = won ? 1 : states.length ? Math.min(1, (done + live * 0.5) / states.length) : 0;
    const inner = won
      ? '<path d="M17 27l7 7 12-14" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
      : `<text x="26" y="31.5" text-anchor="middle">${done}/${states.length}</text>`;
    return `
      <svg class="ring${won ? " is-won" : ""}" viewBox="0 0 52 52" role="img" aria-label="${done} of ${states.length} gameweeks done">
        <circle cx="26" cy="26" r="22" class="ring-track"/>
        <circle cx="26" cy="26" r="22" class="ring-fill" stroke-dasharray="${(fraction * circumference).toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 26 26)"/>
        ${inner}
      </svg>`;
  }

  const listNames = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

  const chanceText = (r) => (r.chanceLevel === "out" ? "0%" : r.chance < 0.01 ? "<1%" : `${Math.round(r.chance * 100)}%`);
  const CHANCE_LABELS = { ok: "In the running", maybe: "Outside chance", out: "No chance" };

  function motmHero(m) {
    const done = m.gwStates.filter((g) => g.state === "done").length;
    const won = m.complete && m.winners.length > 0;
    const prize = won
      ? `
        <div class="motm-prize is-won">
          <span class="stat-label">${m.tie ? "Prize shared" : "Prize won"}</span>
          <b>${money(L.motm.amount / m.winners.length)}${m.tie ? " each" : ""}</b>
          ${m.paid ? chip("good", "✓ Paid") : chip("owed", "Owed")}
        </div>`
      : `
        <div class="motm-prize">
          <span class="stat-label">Prize pending</span>
          <b>${money(L.motm.amount)}</b>
          <span class="bar" aria-hidden="true">${m.gwStates.map((g) => `<i class="${g.state}"></i>`).join("")}</span>
          <small>${done} of ${m.gwStates.length} GWs done</small>
        </div>`;

    if (!m.started) {
      const first = m.gwStates[0];
      return `
        <section class="card motm-hero">
          <div class="motm-hero-body">
            <span class="chip chip-pending">${monthName(m.month, true)}</span>
            <div class="motm-team">Not started yet</div>
            ${first ? `<div class="muted">First deadline ${deadlineFormat.format(new Date(first.deadline))}</div>` : ""}
          </div>
          ${prize}
        </section>`;
    }

    const a = m.table[0];
    const b = m.table[1];
    const tag = won
      ? chip("good", `${m.tie ? "Shared" : "Manager of the Month"} · ${monthName(m.month, true)}`)
      : chip("pending", `Leading in ${monthName(m.month, true).split(" ")[0]}`);
    const heroTeams = won ? m.winners.map((key) => person(key).team) : [a.entry.team];
    const heroNames = won ? m.winners.map(nickname) : [a.entry.nickname];

    let gap = "";
    if (b && !m.tie) {
      const level = m.table.filter((r) => r !== a && r.pts === a.pts);
      if (!level.length) gap = `${a.pts - b.pts} H2H pts ahead of ${esc(b.entry.nickname)}`;
      else if (level.every((r) => r.pf === a.pf)) gap = `Level with ${listNames(level.map((r) => esc(r.entry.nickname)))} on H2H and GW pts`;
      else
        gap = `Level on H2H with ${listNames(level.map((r) => esc(r.entry.nickname)))}, ahead on GW pts by ${listNames(level.map((r) => String(a.pf - r.pf)))}`;
    }

    return `
      <section class="card motm-hero">
        ${monthRing(m.gwStates, won)}
        <div class="motm-hero-body">
          ${tag}
          <div class="motm-team">${heroTeams.map(esc).join(" & ")}</div>
          <div class="motm-who">${heroNames.map(esc).join(" & ")}</div>
          <div class="motm-stats"><span><b>${a.pts}</b> H2H pts</span><span><b>${a.pf}</b> GW pts</span></div>
          ${gap ? `<div class="muted small">${gap}</div>` : ""}
        </div>
        ${prize}
      </section>`;
  }

  function motmTable(m) {
    const best = {};
    m.gws.forEach((gw) => {
      const scores = m.table.map((r) => r.scores[gw]).filter((v) => v !== undefined);
      best[gw] = scores.length ? Math.max(...scores) : null;
    });
    const rows = m.table
      .map((r) => {
        const level = r.chanceLevel || "";
        const pill = level
          ? `<span class="pill pill-${level}"><span class="pill-label">${CHANCE_LABELS[level]} </span>${chanceText(r)}</span>`
          : "";
        const scores = m.gws
          .map((gw) => {
            const v = r.scores[gw];
            return v === undefined ? '<td class="num muted">–</td>' : `<td class="num${v === best[gw] ? " best" : ""}">${v}</td>`;
          })
          .join("");
        return `
          <tr class="${level === "out" ? "is-out" : ""}">
            <td>
              <div class="mgr">
                <span class="rank-dot ${level || (r.rank === 1 && m.started ? "lead" : "")}">${m.started ? r.rank : "–"}</span>
                <div class="names">
                  <b>${esc(r.entry.team)}${r.live ? '<i class="live-dot" title="Match in progress"></i>' : ""}</b>
                  <span class="who-sub">${esc(r.entry.nickname)}${r.next && !m.complete ? ` · next v ${esc(r.next.nickname)}` : ""}</span>
                  ${pill}
                </div>
              </div>
            </td>
            <td class="num key">${r.pts}</td>
            <td class="num">${r.pf}</td>
            <td class="num">${r.won}</td>
            <td class="num">${r.drawn}</td>
            <td class="num">${r.lost}</td>
            ${scores}
          </tr>`;
      })
      .join("");
    return `
      <section class="card table-card motm-table-card">
        <div class="scroll-x">
          <table class="motm-table">
            <thead>
              <tr>
                <th>Team</th>
                <th class="num key">H2H</th>
                <th class="num">GW pts</th>
                <th class="num">W</th>
                <th class="num">D</th>
                <th class="num">L</th>
                ${m.gws.map((gw) => `<th class="num">GW${gw}</th>`).join("")}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderMotm() {
    const list = months();
    const selected = motmSelected(list);
    const m = list.find((x) => x.month === selected);

    const tabs = list
      .map(
        (x) => `
          <button type="button" role="tab" class="month-tab" data-motm-month="${x.month}" aria-selected="${x.month === selected}">
            ${monthName(x.month)}<small>${x.gws.length ? `${gwRange(x.gws)} · ${x.gws.length} GW${x.gws.length === 1 ? "" : "s"}` : "&nbsp;"}</small>
          </button>`
      )
      .join("");

    const gwChips = m.gwStates
      .map((g) =>
        g.state === "done"
          ? chip("good", `GW${g.gw} done`)
          : g.state === "live"
            ? chip("live", `GW${g.gw} live`)
            : chip("pending", `GW${g.gw} · ${deadlineFormat.format(new Date(g.deadline))}`)
      )
      .join("");

    const prizeList = list
      .map((x) => {
        let text;
        let right = `<span class="amt">${money(L.motm.amount)}</span>`;
        if (x.winners.length) {
          text = `<b>${monthName(x.month, true).split(" ")[0]}</b> · ${x.winners.map((k) => esc(nickname(k))).join(" & ")}`;
          right = `<span class="amt is-won">${money(L.motm.amount / x.winners.length)}${x.winners.length > 1 ? " each" : ""}</span> ${x.paid ? chip("good", "✓ Paid") : chip("owed", "Owed")}`;
        } else if (x.started) {
          text = `<b>${monthName(x.month, true).split(" ")[0]}</b> · <span class="muted">still to play${x.leaders.length === 1 ? `, ${esc(x.leaders[0].entry.nickname)} leading` : ""}</span>`;
        } else {
          text = `<b>${monthName(x.month, true).split(" ")[0]}</b> · <span class="muted">not started${x.gws.length ? ` (${x.gws.length} GW${x.gws.length === 1 ? "" : "s"})` : ""}</span>`;
        }
        return `<li><span>${text}</span><span class="prize-right">${right}</span></li>`;
      })
      .join("");

    const rule = `Ranked by H2H points within the month (3 for a win, 1 for a draw), then total GW points. Level on both and the prize is shared. The best score of each gameweek is highlighted.${
      m.started && !m.complete
        ? ` Percentages come from ${(6000).toLocaleString("en-GB")} simulated finishes to the month, using each manager's scoring average this season and the opponents they have left. Red means they can't catch the leader any more; yellow means it's possible but under 10%.`
        : ""
    }`;

    return `
      ${pageHead("Manager of the Month", `${money(L.motm.amount)} a month. Each month is its own mini head-to-head league over that month's gameweeks.`)}
      ${dataNotice()}
      <div class="month-tabs" role="tablist" aria-label="Month">${tabs}</div>
      ${state.model ? motmHero(m) : ""}
      ${state.model && m.gwStates.length ? `<div class="motm-gws">${gwChips}</div>` : ""}
      ${state.model ? motmTable(m) : ""}
      <p class="note motm-rule">${rule}</p>
      <div class="shot-start"><button type="button" class="btn btn-quiet" data-action="shot">📸 Screenshot view</button></div>
      <div class="shot-exit"><button type="button" class="btn btn-quiet" data-action="shot-exit">Back to full view</button></div>
      <section class="motm-prizes">
        <h2>Prizes, ${money(L.motm.amount)} a month</h2>
        <ul class="card prize-list">${prizeList}</ul>
      </section>`;
  }

  function renderPrizes() {
    const flat = allPrizes();
    const pot = L.managers.length * L.buyIn;
    const paidIn = L.managers.filter((m) => m.paid).length;
    const paidOut = flat.filter((p) => p.winner && p.paid).reduce((sum, p) => sum + p.amount, 0);
    const decided = flat.filter((p) => p.winner).reduce((sum, p) => sum + p.amount, 0);

    const stats = [
      ["Prize pot", money(pot)],
      ["Buy-ins paid", `${paidIn}/${L.managers.length}`],
      ["Paid out", money(paidOut)],
      ["Still to win", money(pot - decided)],
    ]
      .map(([label, value]) => `<div class="card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`)
      .join("");

    const prizeCards = prizes()
      .map((p) => {
        const status = p.winner
          ? `${chip("win", "👑 " + esc(nickname(p.winner)))} ${p.paid ? chip("good", "✓ Paid") : chip("owed", "Owed")}`
          : `${chip("pending", "⏳ To be decided")}${p.leader ? `<span class="leader">Leading: <b>${esc(nickname(p.leader))}</b></span>` : ""}`;
        return `
          <article class="card prize">
            <div class="prize-top">
              <h3>${esc(p.label)}</h3>
              <span class="prize-amount">${money(p.amount)}</span>
            </div>
            <p class="prize-detail">${esc(p.detail)}${p.gw && !p.winner ? ` · settled after GW${p.gw}` : ""}</p>
            <div class="prize-foot">${status}</div>
          </article>`;
      })
      .join("");

    const monthList = months();
    const strip = monthList
      .map((m) => {
        const inProgress = m.started && !m.complete;
        const who = m.winners.length
          ? m.winners.map((k) => esc(nickname(k))).join(" & ")
          : inProgress && m.leaders.length === 1
            ? esc(m.leaders[0].entry.nickname)
            : "⏳";
        return `
          <a class="strip-item${m.winners.length ? " is-won" : ""}${inProgress ? " is-current" : ""}" href="#motm">
            <span class="strip-month">${monthName(m.month)}</span>
            <span class="strip-who">${who}</span>
          </a>`;
      })
      .join("");

    // Money board: what each manager has won so far, and what they're still owed.
    const rows = L.managers
      .map((m) => {
        const mine = flat.filter((p) => p.winner === m.key);
        const won = mine.reduce((sum, p) => sum + p.amount, 0);
        const owed = mine.filter((p) => !p.paid).reduce((sum, p) => sum + p.amount, 0);
        return { m, team: person(m.key).team, won, owed, net: won - L.buyIn };
      })
      .sort((a, b) => b.won - a.won || a.m.nickname.localeCompare(b.m.nickname))
      .map(
        ({ m, team, won, owed, net }) => `
          <tr>
            <td><span class="who">${esc(team)}</span><span class="who-sub">${esc(m.nickname)}</span></td>
            <td>${m.paid ? chip("good", "✓") : chip("owed", "Unpaid")}</td>
            <td class="num">${won ? money(won) : "–"}${owed ? `<div>${chip("owed", money(owed) + " owed")}</div>` : ""}</td>
            <td class="num ${net > 0 ? "pos" : "neg"}">${net > 0 ? "+" : net < 0 ? "−" : ""}${money(Math.abs(net))}</td>
          </tr>`
      )
      .join("");

    const links = L.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("");

    return `
      ${pageHead("Prizes &amp; money", `${money(L.buyIn)} each, ${L.managers.length} managers. Who's won what, and who's still owed.`)}
      ${dataNotice()}

      <div class="stats">${stats}</div>

      <h2>Big prizes</h2>
      <div class="grid">${prizeCards}</div>

      <h2>Manager of the Month</h2>
      <section class="card">
        <div class="card-head">
          <span class="muted">${money(L.motm.amount)} a month · ${monthList.filter((m) => m.winners.length).length} of ${monthList.length} decided</span>
          <a href="#motm">See all months →</a>
        </div>
        <div class="strip">${strip}</div>
      </section>

      <h2>Money board</h2>
      <section class="card table-card">
        <table>
          <thead><tr><th>Team</th><th>Buy-in</th><th class="num">Won</th><th class="num">Net</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>

      ${hallOfFame()}

      <h2>League info</h2>
      <section class="card">
        <dl class="info-list">
          <dt>Season</dt><dd>${esc(L.season)}</dd>
          <dt>League code</dt><dd>${esc(L.leagueCode)}</dd>
          <dt>League ID</dt><dd>${esc(L.leagueId)}</dd>
          <dt>Links</dt><dd class="links">${links}</dd>
        </dl>
      </section>`;
  }

  function hallOfFame() {
    // The current season's winners come from the prizes once they're decided.
    const resolved = Object.fromEntries(prizes().map((p) => [p.id, p.winner]));
    const seasons = L.history.map((h) =>
      h.season === L.season
        ? {
            ...h,
            winner: h.winner || (resolved.champion && nickname(resolved.champion)),
            christmas: h.christmas || (resolved.christmas && nickname(resolved.christmas)),
          }
        : h
    );

    const pending = chip("pending", "⏳");
    const cards = seasons
      .slice()
      .reverse()
      .map((h) => {
        const current = h.season === L.season;
        return `
          <article class="card season${current ? " is-current" : ""}">
            <div class="card-head" style="margin:0">
              <span class="season-year">${esc(h.season)}</span>
              ${current ? chip("pending", "In progress") : ""}
            </div>
            <dl>
              <dt>🏆 Champion</dt><dd>${h.winner ? esc(h.winner) : pending}</dd>
              <dt>🎄 Top at Christmas</dt><dd>${h.christmas ? esc(h.christmas) : pending}</dd>
              <dt>🥇 First draft pick</dt><dd>${h.firstPick ? esc(h.firstPick) : pending}</dd>
            </dl>
          </article>`;
      })
      .join("");

    const cabinet = {};
    seasons.forEach((h) => {
      if (h.winner) (cabinet[h.winner] = cabinet[h.winner] || { titles: 0, xmas: 0 }).titles++;
      if (h.christmas) (cabinet[h.christmas] = cabinet[h.christmas] || { titles: 0, xmas: 0 }).xmas++;
    });
    const cabinetRows = Object.entries(cabinet)
      .sort(([a, x], [b, y]) => y.titles - x.titles || y.xmas - x.xmas || a.localeCompare(b))
      .map(
        ([name, c]) => `
          <div class="cabinet-row">
            <span class="who">${esc(name)}</span>
            <span class="trophies">
              ${c.titles ? chip("win", `🏆 × ${c.titles}`) : ""}
              ${c.xmas ? chip("good", `🎄 × ${c.xmas}`) : ""}
            </span>
          </div>`
      )
      .join("");

    return `
      <h2 id="hall-of-fame">Hall of Fame</h2>
      <div class="grid">${cards}</div>

      <h2>Trophy cabinet</h2>
      <section class="card cabinet">${cabinetRows}</section>`;
  }

  const MOVES_REFRESH_MS = 5 * 60 * 1000;
  const SEEN_KEY = "sld-seen-moves";
  const moves = { items: null, loaded: 0, error: null, loading: false, unseen: [], fresh: new Set() };

  // Waivers and trades are fetched with the rest of the data, then every few minutes,
  // so the Live page can say when something new has happened.
  function movesData() {
    if (state.model && !moves.loading && Date.now() - moves.loaded > MOVES_REFRESH_MS) {
      moves.loading = true;
      FPL.moves(state.model)
        .then((items) => {
          moves.items = items;
          moves.error = null;
          const seen = readSeen();
          if (seen) moves.unseen = items.filter((i) => !seen.has(i.id));
          else writeSeen(items); // first visit: start from now rather than flagging the whole season
        })
        .catch((err) => (moves.error = err))
        .finally(() => {
          moves.loaded = Date.now();
          moves.loading = false;
          render();
        });
    }
    return moves.items;
  }

  // Which moves this browser has already seen, so only genuinely new ones get flagged.
  function readSeen() {
    try {
      const ids = JSON.parse(localStorage.getItem(SEEN_KEY));
      return Array.isArray(ids) ? new Set(ids) : null;
    } catch (err) {
      return null;
    }
  }

  function writeSeen(items) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(items.map((i) => i.id)));
    } catch (err) {
      // Private browsing etc. Alerts just won't remember what's been seen.
    }
  }

  // Opening the Moves page counts as seeing everything on it; this visit still badges the new ones.
  function markMovesSeen(arrived) {
    if (arrived) moves.fresh = new Set();
    moves.unseen.forEach((i) => moves.fresh.add(i.id));
    moves.unseen = [];
    writeSeen(moves.items);
  }

  function describeMoves(items) {
    const count = (type) => items.filter((i) => i.type === type).length;
    const parts = [
      [count("waiver"), "waiver"],
      [count("free"), "free agent signing"],
      [count("trade"), "trade"],
    ]
      .filter(([n]) => n)
      .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`);
    return listNames(parts);
  }

  // Shown at the top of the Live page when there are waivers, signings or trades you haven't seen.
  function movesAlert() {
    if (!moves.unseen.length) return "";
    return `
      <a class="card alert" href="#moves">
        <span class="alert-icon" aria-hidden="true">🔔</span>
        <span class="alert-text"><b>New since you last looked:</b> ${describeMoves(moves.unseen)}</span>
        <span class="alert-go">See moves →</span>
      </a>`;
  }

  const playerLabel = (pl) =>
    `<span class="mv-name">${esc(pl.name)}</span> <span class="muted small">${esc(pl.position)} · ${esc(pl.team)}</span>`;

  const newChip = (i) => (moves.fresh.has(i.id) ? chip("live", "New") : "");

  // Teams whose waiver claim for the same player lost out.
  const missedOut = (rivals) => `${listNames(rivals.map((r) => esc(r.team)))} didn't get theirs in time!`;

  function moveCard(i) {
    const when = `<span class="move-when">${newChip(i)}<span class="muted small">${deadlineFormat.format(new Date(i.time))}</span></span>`;
    if (i.type === "trade") {
      const side = (entry, gets) => `
        <div>
          <div class="who">${esc(entry.team)}</div>
          <div class="who-sub">${esc(entry.nickname)} gets</div>
          ${gets.map((pl) => `<div class="mv mv-in">▲ ${playerLabel(pl)}</div>`).join("")}
        </div>`;
      return `
        <article class="card move-card">
          <div class="move-head">${chip("trade", "Trade")}${when}</div>
          <div class="trade">${side(i.from, i.fromGets)}${side(i.to, i.toGets)}</div>
        </article>`;
    }
    return `
      <article class="card move-card">
        <div class="move-head">${i.type === "waiver" ? chip("waiver", "Waiver") : chip("free", "Free agent")}${when}</div>
        <div class="who">${esc(i.entry.team)}</div>
        <div class="who-sub">${esc(i.entry.nickname)}</div>
        <div class="mv mv-in">▲ ${playerLabel(i.in)}</div>
        <div class="mv mv-out">▼ ${playerLabel(i.out)}</div>
        ${i.rivals.length ? `<div class="muted small">${missedOut(i.rivals)}</div>` : ""}
      </article>`;
  }

  // Successful waivers for a gameweek, in the order they were picked.
  const waiversFor = (gw) =>
    (moves.items || []).filter((i) => i.type === "waiver" && i.gw === gw).sort((a, b) => a.order - b.order);

  function waiverList(gw, list) {
    const rows = list
      .map(
        (i, n) => `
          <li class="waiver-row">
            <span class="waiver-pick">${n + 1}</span>
            <div class="waiver-who">
              <div class="who">${esc(i.entry.team)} ${newChip(i)}</div>
              <div class="who-sub">${esc(i.entry.nickname)}</div>
            </div>
            <div class="waiver-players">
              <div class="mv mv-in">▲ ${playerLabel(i.in)}</div>
              <div class="mv mv-out">▼ ${playerLabel(i.out)}</div>
            </div>
            ${i.rivals.length ? `<div class="waiver-rivals muted small">${missedOut(i.rivals)}</div>` : ""}
          </li>`
      )
      .join("");
    return `
      <section class="card waiver-card">
        <div class="card-head">
          <span class="waiver-title">Waivers, in pick order</span>
          <button type="button" class="btn btn-quiet btn-small" data-share-waivers="${gw}">📸 Share image</button>
        </div>
        <ol class="waiver-list">${rows}</ol>
      </section>`;
  }

  function renderMoves() {
    const head = pageHead(
      "Waivers &amp; trades",
      "Each gameweek's waivers in the order they were picked, then free-agent signings and trades, newest first."
    );
    if (!state.model) return head + dataNotice();

    const items = movesData();
    if (!items) {
      return (
        head +
        (moves.error
          ? `<section class="card notice notice-error"><span>Couldn't load waivers and trades: ${esc(moves.error.message)}</span><button type="button" class="btn" data-action="retry-moves">Try again</button></section>`
          : `<section class="card notice">Loading waivers and trades…</section>`)
      );
    }
    if (!items.length) return head + `<section class="card notice">No waivers or trades yet.</section>`;

    const signings = items.filter((i) => i.type !== "trade").length;
    const trades = items.length - signings;
    const busy = {};
    items.forEach((i) => [i.entry, i.from, i.to].filter(Boolean).forEach((e) => (busy[e.id] = (busy[e.id] || 0) + 1)));
    const [busiestId, busiestCount] = Object.entries(busy).sort((a, b) => b[1] - a[1])[0];
    const busiest = state.model.entryById[busiestId];

    const gws = [...new Set(items.map((i) => i.gw))].sort((a, b) => b - a);
    const groups = gws
      .map((gw) => {
        const waivers = waiversFor(gw);
        const others = items.filter((i) => i.gw === gw && i.type !== "waiver");
        return `
          <h2>Gameweek ${gw}</h2>
          ${waivers.length ? waiverList(gw, waivers) : ""}
          ${others.length ? `<div class="moves">${others.map(moveCard).join("")}</div>` : ""}`;
      })
      .join("");

    return `
      ${head}
      ${pushCard()}
      <p class="note">${signings} signings and ${trades} trades so far · busiest: ${esc(busiest.team)} (${esc(busiest.nickname)}, ${busiestCount} moves)</p>
      ${groups}`;
  }

  // ---------- Push notifications ----------
  //
  // Phones sign up here; the relay's cron job (see worker/) pings them when there are new
  // waivers, signings or trades. iPhones only allow this once the site's on the Home Screen.

  const push = { status: "checking", busy: false, message: "" };
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const onIphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const fromHomeScreen = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let swRegistration = null;

  async function setUpPush() {
    if (!pushSupported || !FPL.apiBase) {
      push.status = onIphone && !fromHomeScreen ? "install" : "unsupported";
      return;
    }
    try {
      swRegistration = await navigator.serviceWorker.register(`sw.js?api=${encodeURIComponent(FPL.apiBase)}`);
      const sub = await swRegistration.pushManager.getSubscription();
      push.status = Notification.permission === "denied" ? "blocked" : sub ? "on" : "off";
    } catch (err) {
      push.status = "unsupported";
    }
    if (currentRoute() === "moves") render();
  }

  function base64UrlToBytes(text) {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  async function relayFetch(path, body) {
    const res = await fetch(`${FPL.apiBase}/${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body } : {});
    if (res.status === 404 || res.status === 503) throw new Error("Notifications aren't switched on in the relay yet.");
    if (!res.ok) throw new Error(`The relay answered ${res.status}.`);
    return res.json();
  }

  async function pushOn() {
    push.busy = true;
    push.message = "";
    render();
    try {
      // Asked straight from the tap, which phones require.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        push.status = permission === "denied" ? "blocked" : "off";
        return;
      }
      const { publicKey } = await relayFetch("push/key");
      // A sign-up made with an older relay key has to go before a new one can be made.
      const old = await swRegistration.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      await relayFetch("push/subscribe", JSON.stringify(sub));
      push.status = "on";
    } catch (err) {
      push.message = err.message;
    } finally {
      push.busy = false;
      render();
    }
  }

  async function pushOff() {
    push.busy = true;
    push.message = "";
    render();
    try {
      const sub = await swRegistration.pushManager.getSubscription();
      if (sub) {
        await relayFetch("push/unsubscribe", JSON.stringify({ endpoint: sub.endpoint })).catch(() => {});
        await sub.unsubscribe();
      }
      push.status = "off";
    } catch (err) {
      push.message = err.message;
    } finally {
      push.busy = false;
      render();
    }
  }

  function pushCard() {
    const busy = push.busy ? "disabled" : "";
    const body = {
      install: `<span>🔔 <b>Want a notification for new waivers and trades?</b> On iPhone: tap Share, then <b>Add to Home Screen</b>, open Super Ladz from your home screen and turn notifications on here.</span>`,
      unsupported: `<span>🔔 This browser can't do notifications. Use Chrome on Android, or add the site to your Home Screen on iPhone.</span>`,
      blocked: `<span>🔔 Notifications are blocked for this site. Allow them in your browser or phone settings, then come back here.</span>`,
      off: `<span>🔔 <b>Get a notification</b> when there are new waivers, free-agent signings or trades.</span><button type="button" class="btn" data-action="push-on" ${busy}>${push.busy ? "Turning on…" : "Turn on"}</button>`,
      on: `<span>🔔 <b>Notifications are on</b> for new waivers, free-agent signings and trades.</span><button type="button" class="btn btn-quiet" data-action="push-off" ${busy}>Turn off</button>`,
    }[push.status];
    if (!body) return "";
    return `<section class="card push-card">${body}${push.message ? `<p class="small stale">${esc(push.message)}</p>` : ""}</section>`;
  }

  // ---------- Shareable waivers image ----------

  const MAST_COLOURS = { light: ["#37003c", "#520a5c"], dark: ["#1d0422", "#2d0935"], barbie: ["#ff62b2", "#c4137a"] };

  // Shorten text with "…" until it fits.
  function fitText(c, text, max) {
    if (c.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && c.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
  }

  // Draws the gameweek's waivers as a picture in the current theme, ready to send to the group chat.
  async function waiverImage(gw, list) {
    await Promise.all(
      ['96px "Supercharge Halftone"', '44px "Supercharge Condensed"'].map((f) => document.fonts.load(f).catch(() => null))
    );
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const body = getComputedStyle(document.body).fontFamily;
    const mast = MAST_COLOURS[document.documentElement.getAttribute("data-theme")] || MAST_COLOURS.light;

    const W = 1080;
    const PAD = 56;
    const HEAD = 240;
    const ROW = 132;
    const H = HEAD + list.length * ROW + 120;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext("2d");

    c.fillStyle = v("--bg");
    c.fillRect(0, 0, W, H);
    const band = c.createLinearGradient(0, 0, W, HEAD);
    band.addColorStop(0, mast[0]);
    band.addColorStop(1, mast[1]);
    c.fillStyle = band;
    c.fillRect(0, 0, W, HEAD - 40);

    c.fillStyle = v("--title");
    c.font = '96px "Supercharge Halftone", Impact, sans-serif';
    c.fillText("SUPER LADS", PAD, 118);
    c.fillStyle = "rgba(255, 255, 255, 0.85)";
    c.font = '44px "Supercharge Condensed", Impact, sans-serif';
    c.fillText(`GAMEWEEK ${gw} WAIVERS`, PAD, 172);

    c.fillStyle = v("--surface");
    c.beginPath();
    if (c.roundRect) c.roundRect(PAD / 2, HEAD - 16, W - PAD, list.length * ROW + 16, 24);
    else c.rect(PAD / 2, HEAD - 16, W - PAD, list.length * ROW + 16);
    c.fill();

    list.forEach((i, n) => {
      const y = HEAD + n * ROW;
      if (n) {
        c.fillStyle = v("--border");
        c.fillRect(PAD, y - 4, W - PAD * 2, 2);
      }
      c.fillStyle = v("--accent");
      c.beginPath();
      c.arc(PAD + 26, y + 58, 26, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = v("--accent-ink");
      c.font = `700 28px ${body}`;
      c.textAlign = "center";
      c.fillText(String(n + 1), PAD + 26, y + 68);
      c.textAlign = "left";

      const left = PAD + 76;
      const right = 560;
      c.fillStyle = v("--text");
      c.font = `700 36px ${body}`;
      c.fillText(fitText(c, i.entry.team, right - left - 20), left, y + 52);
      c.fillStyle = v("--muted");
      c.font = `28px ${body}`;
      c.fillText(fitText(c, i.entry.nickname, right - left - 20), left, y + 92);

      const line = (arrow, pl, colour, top) => {
        c.fillStyle = colour;
        c.font = `700 32px ${body}`;
        const name = fitText(c, `${arrow} ${pl.name}`, W - PAD - right - 150);
        c.fillText(name, right, top);
        const width = c.measureText(name).width;
        c.fillStyle = v("--muted");
        c.font = `24px ${body}`;
        c.fillText(`${pl.position} · ${pl.team}`, right + width + 12, top);
      };
      line("▲", i.in, v("--good"), y + 52);
      line("▼", i.out, v("--down"), y + 94);
    });

    c.fillStyle = v("--muted");
    c.font = `26px ${body}`;
    c.textAlign = "center";
    c.fillText("superladsdraft.github.io", W / 2, H - 44);
    return canvas;
  }

  let shareFile = null;
  let shareUrl = null;

  async function openWaiverShare(gw) {
    const list = waiversFor(gw);
    if (!list.length) return;
    sheet.innerHTML = `
      <div class="sheet-body">
        <div class="sheet-head"><h2>GW${gw} waivers</h2><button type="button" class="icon-btn" data-close aria-label="Close">×</button></div>
        <p class="muted small">Making the image…</p>
      </div>`;
    sheet.showModal();

    const canvas = await waiverImage(gw, list);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(blob);
    shareFile = new File([blob], `superlads-gw${gw}-waivers.png`, { type: "image/png" });
    const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [shareFile] }));
    sheet.innerHTML = `
      <div class="sheet-body">
        <div class="sheet-head"><h2>GW${gw} waivers</h2><button type="button" class="icon-btn" data-close aria-label="Close">×</button></div>
        <img class="share-preview" src="${shareUrl}" alt="Gameweek ${gw} waivers in pick order">
        <div class="share-actions">
          ${canShare ? '<button type="button" class="btn" data-action="share-file">Share</button>' : ""}
          <a class="btn btn-quiet" href="${shareUrl}" download="${shareFile.name}">Save image</a>
        </div>
      </div>`;
  }

  // ---------- Routing ----------

  const ROUTES = {
    table: { label: "Table", title: "Table", render: renderTable },
    motm: { label: "MOTM", title: "Manager of the Month", render: renderMotm },
    live: { label: "Live", title: "Live", render: renderLive },
    moves: { label: "Moves", title: "Waivers & trades", render: renderMoves },
    prizes: { label: "Prizes", title: "Prizes", render: renderPrizes },
  };
  const DEFAULT_ROUTE = "live";
  const SITE_NAME = document.title; // set in index.html
  const ALIASES = { history: "prizes" }; // old Hall of Fame links

  document.getElementById("tabs").innerHTML = Object.entries(ROUTES)
    .map(([id, r]) => `<a class="tab" href="#${id}" data-route="${id}">${ICONS[id]}<span>${r.label}</span></a>`)
    .join("");

  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, "");
    const requested = ALIASES[hash] || hash;
    return ROUTES[requested] ? requested : DEFAULT_ROUTE;
  }

  // The lads pop up next to the Table heading for a moment each time someone opens the Table tab.
  // Data refreshes redraw the page, so the photo is put back where its animation had got to.
  const LADS_SRC = "assets/img/lads.png";
  const LADS_MS = 2000;
  let ladsStart = 0;
  let lastRoute = null;
  new Image().src = LADS_SRC; // load it up front so it's ready the first time

  function showLads(arrived) {
    if (arrived) ladsStart = performance.now();
    const elapsed = performance.now() - ladsStart;
    const head = view.querySelector(".page-head");
    if (!ladsStart || elapsed >= LADS_MS || !head) return;

    const img = document.createElement("img");
    img.src = LADS_SRC;
    img.alt = "";
    img.className = "lads-pop";
    head.appendChild(img);

    const frames = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: "scale(0.6) rotate(-10deg)" },
          { opacity: 1, transform: "scale(1.08) rotate(3deg)", offset: 0.12 },
          { opacity: 1, transform: "scale(1) rotate(0deg)", offset: 0.2 },
          { opacity: 1, transform: "scale(1) rotate(0deg)", offset: 0.7 },
          { opacity: 0, transform: "scale(0.95) rotate(0deg)" },
        ];
    const animation = img.animate(frames, { duration: LADS_MS, easing: "ease-out", fill: "forwards" });
    animation.currentTime = elapsed;
    animation.onfinish = () => img.remove();
  }

  function render() {
    const id = currentRoute();
    const arrived = id !== lastRoute;
    lastRoute = id;
    if (id !== "motm") state.shot = false;
    document.body.classList.toggle("shot", state.shot);
    if (id === "moves" && moves.items) markMovesSeen(arrived); // before drawing, so this visit badges them "New"
    view.innerHTML = ROUTES[id].render();
    if (id === "table") showLads(arrived);
    document.querySelector('.tab[data-route="moves"]').classList.toggle("has-new", moves.unseen.length > 0);
    if (id === "motm") centreMonthTab();
    view.querySelectorAll("details[data-key]").forEach((d) => {
      if (openDetails.has(d.dataset.key)) d.open = true;
    });
    document.title = `${ROUTES[id].title} · ${SITE_NAME}`;
    document.querySelectorAll(".tab").forEach((tab) => {
      if (tab.dataset.route === id) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
  }

  // Keep the picked month in view in the scrolling row of month tabs.
  function centreMonthTab() {
    const row = view.querySelector(".month-tabs");
    const tab = row && row.querySelector('[aria-selected="true"]');
    if (tab) row.scrollLeft = tab.offsetLeft - row.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
  }

  window.addEventListener("hashchange", () => {
    render();
    window.scrollTo(0, 0);
  });

  view.addEventListener("click", (e) => {
    const step = e.target.closest("[data-gw-step]");
    if (step && state.model) {
      const m = state.model;
      const from = state.viewGw || m.currentGw;
      const to = step.dataset.gwStep === "current" ? m.currentGw : from + Number(step.dataset.gwStep);
      const gw = Math.min(m.lastGw, Math.max(1, to));
      state.viewGw = gw === m.currentGw ? null : gw;
      render();
      return;
    }
    const monthTab = e.target.closest("[data-motm-month]");
    if (monthTab) {
      state.motmMonth = monthTab.dataset.motmMonth;
      render();
      return;
    }
    const shareWaivers = e.target.closest("[data-share-waivers]");
    if (shareWaivers) {
      openWaiverShare(Number(shareWaivers.dataset.shareWaivers));
      return;
    }
    const shot = e.target.closest('[data-action="shot"], [data-action="shot-exit"]');
    if (shot) {
      state.shot = shot.dataset.action === "shot";
      render();
      window.scrollTo(0, 0);
      return;
    }
    const tableView = e.target.closest("[data-table-view]");
    if (tableView) {
      state.tableView = tableView.dataset.tableView;
      render();
      return;
    }
    if (e.target.closest('[data-action="push-on"]')) {
      pushOn();
      return;
    }
    if (e.target.closest('[data-action="push-off"]')) {
      pushOff();
      return;
    }
    if (e.target.closest('[data-action="retry-moves"]')) {
      moves.loaded = 0;
      moves.error = null;
      render();
      return;
    }
    if (e.target.closest('[data-action="retry"]')) {
      state.loading = true;
      state.error = null;
      render();
      refresh();
    }
  });

  // Close on the × or a tap outside the sheet (the backdrop counts as the dialog itself).
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || e.target.closest("[data-close]")) {
      sheet.close();
      return;
    }
    if (e.target.closest('[data-action="share-file"]') && shareFile) {
      // Called straight from the tap, which phones need before they'll open the share menu.
      navigator.share({ files: [shareFile], title: shareFile.name }).catch(() => {});
    }
  });

  // <details> toggle events don't bubble, so listen in the capture phase.
  view.addEventListener(
    "toggle",
    (e) => {
      const key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      if (e.target.open) openDetails.add(key);
      else openDetails.delete(key);
    },
    true
  );

  // ---------- Data refresh ----------

  const LIVE_REFRESH_MS = 60 * 1000;
  const IDLE_REFRESH_MS = 10 * 60 * 1000;
  const RETRY_MS = 15 * 1000;
  let refreshTimer = null;

  async function refresh() {
    clearTimeout(refreshTimer);
    try {
      state.model = await FPL.load();
      state.error = null;
    } catch (err) {
      state.error = err;
    }
    state.loading = false;
    movesData();
    render();
    if (state.error && state.error.code === "not-connected") return;
    const delay = !state.model ? RETRY_MS : state.model.liveGw ? LIVE_REFRESH_MS : IDLE_REFRESH_MS;
    refreshTimer = setTimeout(refresh, delay);
  }

  // Phones pause background tabs, so catch up as soon as the page is looked at again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.model && Date.now() - state.model.updated > LIVE_REFRESH_MS) {
      refresh();
    }
  });

  // ---------- Theme switcher ----------

  const THEMES = [
    { id: "light", emoji: "☀️", label: "Light", color: "#37003c" },
    { id: "dark", emoji: "🌙", label: "Dark", color: "#1d0422" },
    { id: "barbie", emoji: "💖", label: "Barbie", color: "#e0218a" },
  ];
  const themeSwitch = document.getElementById("theme-switch");

  themeSwitch.innerHTML = THEMES.map(
    (t) =>
      `<button type="button" role="radio" data-theme-choice="${t.id}" aria-label="${t.label} theme"><span class="emoji" aria-hidden="true">${t.emoji}</span><span class="label">${t.label}</span></button>`
  ).join("");

  function applyTheme(id) {
    document.documentElement.setAttribute("data-theme", id);
    themeSwitch.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeChoice === id)));
    const theme = THEMES.find((t) => t.id === id);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", theme.color);
  }

  const compactSwitch = window.matchMedia("(max-width: 699px)");

  themeSwitch.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    let id = button.dataset.themeChoice;
    // On phones only the current theme's button shows, and tapping it moves to the next theme.
    if (compactSwitch.matches && button.getAttribute("aria-checked") === "true") {
      id = THEMES[(THEMES.findIndex((t) => t.id === id) + 1) % THEMES.length].id;
    }
    applyTheme(id);
    try {
      localStorage.setItem("sld-theme", id);
    } catch (err) {
      // Private browsing etc. The theme still changes, it just won't be remembered.
    }
  });

  // ---------- Start ----------

  document.querySelectorAll("[data-season]").forEach((el) => (el.textContent = L.season));
  applyTheme(document.documentElement.getAttribute("data-theme"));
  render();
  refresh();
  setUpPush();
})();
