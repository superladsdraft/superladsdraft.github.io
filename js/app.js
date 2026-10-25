(function () {
  "use strict";

  const L = window.LEAGUE;
  const FPL = window.FPL;
  const view = document.getElementById("view");

  const state = {
    model: null, // FPL data, once loaded
    error: null,
    loading: true,
    viewGw: null, // gameweek shown on the Live page; null = the current one
    tableView: "live",
  };
  const openDetails = new Set(); // keeps expanded sections open across refreshes

  // ---------- Helpers ----------

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const money = (n) => "£" + n.toLocaleString("en-GB");

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
    return L.motm.months.map((m) => ({ ...m, gws: [], started: false, complete: false, ranking: [], leaders: [] }));
  }

  function prizes() {
    const status = state.model ? FPL.prizeStatus(state.model) : {};
    return L.prizes.map((p) => {
      const s = status[p.id] || {};
      return { ...p, winner: p.winner || s.winner || null, leader: s.leader || null, gw: s.gw || null };
    });
  }

  // Every prize as one flat list, so the money maths only lives in one place.
  function allPrizes() {
    const motm = months().map((m) => ({ amount: L.motm.amount, winner: m.winner, paid: m.paid }));
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

  // Every row is the same three lines (name, stats, match) so both teams line up.
  function playerRow(p) {
    const status = STATUS[p.status];
    const arrow = p.subIn
      ? p.subPending
        ? `<span class="sub-tag in is-pending" title="Comes on for a starter who didn't play, if they play">▲</span>`
        : '<span class="sub-tag in" title="Auto-subbed on">▲</span>'
      : p.subOut
        ? '<span class="sub-tag out" title="Auto-subbed off">▼</span>'
        : "";
    const stats = statLine(p);
    const live = p.matches.some((f) => f.started && !f.done);
    return `
      <li class="pl st-${p.status}${p.subOut ? " is-out" : ""}">
        <span class="pl-status" title="${status.label}" aria-label="${status.label}">${status.icon}</span>
        <span class="pl-main">
          <span class="pl-line pl-name"><span class="pl-name-text">${esc(p.name)}</span>${roleTag(p)}${arrow}</span>
          <span class="pl-line pl-stats">${stats ? esc(stats) : availabilityFlag(p)}</span>
          <span class="pl-line pl-match${live ? " is-live" : ""}">${esc(matchLine(p))}</span>
        </span>
        <span class="pl-pts">${p.points}</span>
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
          ? "Live scores include auto-subs and provisional bonus, worked out the way FPL does, so they can be ahead of FPL's own numbers until the gameweek is finalised. Tap a match to see both teams."
          : "Teams appear here once the deadline has passed.";

    return `
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
      ${started ? `<p class="legend">${legend}</p><p class="legend"><span><span class="key-done">8</span> played, points banked</span><span><span class="key-live">3</span> playing now</span><span><span class="key-todo">0</span> still to play</span><span>▲▼ auto-subs (<span class="key-pending">▲</span> comes on if they play)</span></p><p class="legend">MP minutes · G goals · A assists · CS clean sheet · GC goals conceded · S saves · DC defensive contributions · B bonus (* provisional) · YC/RC cards</p>` : ""}`;
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
        return `
          <tr class="${r.rank <= 2 ? "is-top" : ""}">
            <td class="rank">${r.rank}${arrow}</td>
            <td><span class="who">${esc(r.entry.team)}</span><span class="who-sub">${esc(r.entry.nickname)}</span></td>
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

  function renderMotm() {
    const now = currentMonth();

    const cards = months()
      .map((m) => {
        const current = state.model ? m.started && !m.complete : m.month === now;
        const leaders = m.leaders.map((l) => esc(l.entry.nickname)).join(" & ");
        let body;
        if (m.winner) {
          const p = person(m.winner);
          const row = m.ranking.find((r) => r.entry.key === m.winner);
          body = `
            <div class="month-winner">👑 ${esc(p.nickname)}${row ? ` <span class="pts-note">${row.points} pts</span>` : ""}</div>
            <div class="month-team">${esc(p.team)}</div>
            <div>${m.paid ? chip("good", "✓ Paid") : chip("owed", `${money(L.motm.amount)} owed`)}</div>`;
        } else if (m.tie) {
          body = `
            <div class="month-winner">🤝 ${leaders} <span class="pts-note">${m.leaders[0].points} pts</span></div>
            <div>${chip("pending", "Tied")}</div>`;
        } else if (m.started) {
          body = `
            <div class="month-leader"><span class="muted small">Leading</span> ${leaders} <span class="pts-note">${m.leaders[0].points} pts</span></div>
            <div>${chip("pending", "⏳ In progress")}</div>`;
        } else if (state.model && m.gws.length) {
          const first = state.model.events.find((e) => e.id === m.gws[0]);
          body = `<div class="muted small">Upcoming · first deadline ${dayFormat.format(new Date(first.deadline))}</div>`;
        } else {
          body = `<div class="muted small">${m.month > now ? "Upcoming" : "–"}</div>`;
        }

        const standings = m.started
          ? `<button type="button" class="link-btn" data-standings="${m.month}">Full standings →</button>`
          : "";

        return `
          <article class="card month${current ? " is-current" : ""}">
            <div class="month-head">
              <h3>${monthName(m.month, true)}</h3>
              <span class="muted small">${gwRange(m.gws)}</span>
            </div>
            ${body}
            ${standings}
          </article>`;
      })
      .join("");

    return `
      ${pageHead("Manager of the Month", `${money(L.motm.amount)} to whoever scores the most points in the gameweeks whose deadline falls in that month.`)}
      ${dataNotice()}
      <div class="grid month-grid">${cards}</div>`;
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
        const who = m.winner ? esc(nickname(m.winner)) : inProgress && m.leaders.length === 1 ? esc(m.leaders[0].entry.nickname) : "⏳";
        return `
          <a class="strip-item${m.winner ? " is-won" : ""}${inProgress ? " is-current" : ""}" href="#motm">
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
          <span class="muted">${money(L.motm.amount)} a month · ${monthList.filter((m) => m.winner).length} of ${monthList.length} decided</span>
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
  const moves = { items: null, loaded: 0, error: null, loading: false };

  // Waivers and trades are fetched when the page is first opened, then every few minutes.
  function movesData() {
    if (state.model && !moves.loading && Date.now() - moves.loaded > MOVES_REFRESH_MS) {
      moves.loading = true;
      FPL.moves(state.model)
        .then((items) => {
          moves.items = items;
          moves.error = null;
        })
        .catch((err) => (moves.error = err))
        .finally(() => {
          moves.loaded = Date.now();
          moves.loading = false;
          if (currentRoute() === "moves") render();
        });
    }
    return moves.items;
  }

  const playerLabel = (pl) =>
    `<span class="mv-name">${esc(pl.name)}</span> <span class="muted small">${esc(pl.position)} · ${esc(pl.team)}</span>`;

  function moveCard(i) {
    const when = `<span class="muted small">${deadlineFormat.format(new Date(i.time))}</span>`;
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
        ${i.rivals.length ? `<div class="muted small">Also claimed by ${i.rivals.map((r) => esc(r.nickname)).join(", ")}</div>` : ""}
      </article>`;
  }

  function renderMoves() {
    const head = pageHead("Waivers &amp; trades", "Every waiver, free-agent signing and trade this season, newest first.");
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
      .map(
        (gw) => `
          <h2>Gameweek ${gw}</h2>
          <div class="moves">${items.filter((i) => i.gw === gw).map(moveCard).join("")}</div>`
      )
      .join("");

    return `
      ${head}
      <p class="note">${signings} signings and ${trades} trades so far · busiest: ${esc(busiest.team)} (${esc(busiest.nickname)}, ${busiestCount} moves)</p>
      ${groups}`;
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
    view.innerHTML = ROUTES[id].render();
    if (id === "table") showLads(arrived);
    view.querySelectorAll("details[data-key]").forEach((d) => {
      if (openDetails.has(d.dataset.key)) d.open = true;
    });
    document.title = `${ROUTES[id].title} · Super Lads Draft`;
    document.querySelectorAll(".tab").forEach((tab) => {
      if (tab.dataset.route === id) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
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
    const standingsButton = e.target.closest("[data-standings]");
    if (standingsButton) {
      openStandings(standingsButton.dataset.standings);
      return;
    }
    const tableView = e.target.closest("[data-table-view]");
    if (tableView) {
      state.tableView = tableView.dataset.tableView;
      render();
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

  // Month standings open in a pop-up so the cards on the page all stay the same size.
  const sheet = document.getElementById("sheet");

  function openStandings(month) {
    const m = months().find((x) => x.month === month);
    if (!m) return;
    sheet.innerHTML = `
      <div class="sheet-body">
        <div class="sheet-head">
          <h2>${monthName(m.month, true)}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">×</button>
        </div>
        <p class="muted small">${gwRange(m.gws)} · ${m.complete ? "Final" : "So far"}</p>
        <ol class="ranking">
          ${m.ranking.map((r) => `<li><span>${esc(r.entry.nickname)}</span><span class="pts-note">${r.points} pts</span></li>`).join("")}
        </ol>
      </div>`;
    sheet.showModal();
  }

  // Close on the × or a tap outside the sheet (the backdrop counts as the dialog itself).
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || e.target.closest("[data-close]")) sheet.close();
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
})();
