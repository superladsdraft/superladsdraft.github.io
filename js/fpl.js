/*
 * Fetches league data from the FPL relay (see worker/) and works out
 * tables, Manager of the Month and prize winners from it.
 */
(function () {
  "use strict";

  const L = window.LEAGUE;
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API_BASE = (L.apiBase || (isLocal ? "http://localhost:8787" : "")).replace(/\/+$/, "");

  // ---------- Fetching ----------

  async function get(path) {
    const res = await fetch(`${API_BASE}/${path}`);
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        message = (await res.json()).error || message;
      } catch (err) {
        // Not JSON; keep the generic message.
      }
      throw new Error(message);
    }
    return res.json();
  }

  let bootstrap = null; // gameweeks and players barely change, so fetch once per visit
  const picksCache = {}; // gw -> { leagueEntryId: { picks, subs } }; teams are locked once the deadline passes
  const finishedCache = {}; // gw -> scored gameweek, for gameweeks that are over

  async function load() {
    if (!API_BASE) {
      const err = new Error("Live data isn't connected yet.");
      err.code = "not-connected";
      throw err;
    }
    const [game, boot, details] = await Promise.all([
      get("game"),
      bootstrap || get("bootstrap"),
      get(`league/${L.leagueId}/details`),
    ]);
    bootstrap = boot;
    const model = buildModel(game, boot, details);

    // During a gameweek, use our own live scores (with auto-subs and provisional
    // bonus) so the Live page, table and Manager of the Month all agree.
    // If that fails, FPL's own running scores are still there to fall back on.
    if (model.liveGw) {
      try {
        model.live = await gameweek(model, model.liveGw);
        applyLiveScores(model, model.live);
      } catch (err) {
        model.liveError = err;
      }
    }
    return model;
  }

  // Every manager's team and score for a gameweek that has started.
  async function gameweek(model, gw) {
    const complete = gwComplete(model, gw);
    if (complete && finishedCache[gw]) return finishedCache[gw];

    const [live, picks] = await Promise.all([
      get(`event/${gw}/live`),
      picksCache[gw] ||
        Promise.all(model.entries.map((e) => get(`entry/${e.entryId}/event/${gw}`).then((r) => [e.id, r]))).then(
          Object.fromEntries
        ),
    ]);
    picksCache[gw] = picks;

    const ctx = Scoring.context(bootstrap, live);
    const result = {
      gw,
      fixtures: live.fixtures,
      lineups: Object.fromEntries(
        model.entries.map((e) => [e.id, Scoring.lineup(ctx, picks[e.id].picks, picks[e.id].subs || [])])
      ),
    };
    if (complete) finishedCache[gw] = result;
    return result;
  }

  // Name, position and club for a player id (needs the bootstrap from load()).
  function playerInfo(id) {
    const el = bootstrap.elements.find((e) => e.id === id);
    if (!el) return { name: `Player ${id}`, position: "", team: "" };
    const team = bootstrap.teams.find((t) => t.id === el.team);
    const type = bootstrap.element_types.find((t) => t.id === el.element_type);
    return { name: el.web_name, position: type ? type.singular_name_short : "", team: team ? team.short_name : "" };
  }

  // Every successful waiver, free-agent signing and trade, newest first.
  async function moves(model) {
    const [tx, tr] = await Promise.all([
      get(`draft/league/${L.leagueId}/transactions`),
      get(`draft/league/${L.leagueId}/trades`),
    ]);
    const byEntryId = Object.fromEntries(model.entries.map((e) => [e.entryId, e]));
    const items = [];

    tx.transactions
      .filter((t) => t.result === "a")
      .forEach((t) => {
        // On waivers, other managers whose claim for the same player lost out
        // ("di" = beaten by a higher-priority claim; "do" is a different failure: their drop had already gone).
        const rivals = [
          ...new Set(
            tx.transactions
              .filter(
                (o) =>
                  t.kind === "w" &&
                  o.kind === "w" &&
                  o.event === t.event &&
                  o.element_in === t.element_in &&
                  o.result === "di" &&
                  o.entry !== t.entry
              )
              .map((o) => byEntryId[o.entry])
              .filter(Boolean)
          ),
        ];
        items.push({
          type: t.kind === "w" ? "waiver" : "free",
          gw: t.event,
          time: t.added,
          entry: byEntryId[t.entry],
          in: playerInfo(t.element_in),
          out: playerInfo(t.element_out),
          rivals,
        });
      });

    // In a trade, element_in goes to the manager who offered it and element_out to the one who accepted.
    tr.trades
      .filter((t) => t.state === "p")
      .forEach((t) => {
        items.push({
          type: "trade",
          gw: t.event,
          time: t.response_time || t.offer_time,
          from: byEntryId[t.offered_entry],
          to: byEntryId[t.received_entry],
          fromGets: t.tradeitem_set.map((i) => playerInfo(i.element_in)),
          toGets: t.tradeitem_set.map((i) => playerInfo(i.element_out)),
        });
      });

    return items.filter((i) => i.entry || (i.from && i.to)).sort((a, b) => b.time.localeCompare(a.time));
  }

  function applyLiveScores(model, live) {
    model.matches.forEach((m) => {
      if (m.gw !== live.gw || m.finished) return;
      m.homePts = live.lineups[m.home].score;
      m.awayPts = live.lineups[m.away].score;
    });
  }

  // ---------- Model ----------

  const ukDateFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // "2026-10-31T11:00:00Z" -> "2026-10-31" in UK time, so month edges match what we see on the FPL app.
  function ukDate(iso) {
    const parts = Object.fromEntries(ukDateFormat.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function buildModel(game, boot, details) {
    const events = boot.events.map((e) => {
      const date = ukDate(e.deadline_time);
      return { id: e.id, name: e.name, deadline: e.deadline_time, date, month: date.slice(0, 7), finished: e.finished };
    });

    const managerByEntry = {};
    L.managers.forEach((m) => (managerByEntry[m.leagueEntryId] = m));
    const entries = details.league_entries.map((le) => {
      const m = managerByEntry[le.id];
      return {
        id: le.id,
        entryId: le.entry_id,
        key: m ? m.key : String(le.id),
        nickname: m ? m.nickname : le.player_first_name,
        team: le.entry_name,
      };
    });

    const matches = details.matches.map((m) => ({
      gw: m.event,
      started: m.started,
      finished: m.finished,
      home: m.league_entry_1,
      homePts: m.league_entry_1_points,
      away: m.league_entry_2,
      awayPts: m.league_entry_2_points,
    }));

    const model = {
      events,
      entries,
      entryById: Object.fromEntries(entries.map((e) => [e.id, e])),
      entryByKey: Object.fromEntries(entries.map((e) => [e.key, e])),
      matches,
      currentGw: game.current_event,
      lastGw: events[events.length - 1].id,
      updated: new Date(),
    };
    model.lastFinishedGw = events.filter((e) => gwComplete(model, e.id)).reduce((max, e) => Math.max(max, e.id), 0);
    model.liveGw =
      !game.current_event_finished && matches.some((m) => m.gw === game.current_event && m.started) ? game.current_event : null;
    return model;
  }

  function gwComplete(model, gw) {
    const ms = model.matches.filter((m) => m.gw === gw);
    return ms.length > 0 && ms.every((m) => m.finished);
  }

  // ---------- Calculations ----------

  // Head-to-head table up to a gameweek. includeLive counts matches that have
  // started but not finished, using their scores so far.
  function standings(model, uptoGw, includeLive) {
    const rows = {};
    model.entries.forEach((e) => {
      rows[e.id] = { entry: e, played: 0, won: 0, drawn: 0, lost: 0, pf: 0, pa: 0, pts: 0, results: [] };
    });

    model.matches.forEach((m) => {
      if (m.gw > uptoGw || !(m.finished || (includeLive && m.started))) return;
      [
        [m.home, m.homePts, m.awayPts],
        [m.away, m.awayPts, m.homePts],
      ].forEach(([id, scored, conceded]) => {
        const r = rows[id];
        const result = scored > conceded ? "W" : scored < conceded ? "L" : "D";
        r.played++;
        r.pf += scored;
        r.pa += conceded;
        if (result === "W") {
          r.won++;
          r.pts += 3;
        } else if (result === "D") {
          r.drawn++;
          r.pts += 1;
        } else {
          r.lost++;
        }
        if (m.finished) r.results.push({ gw: m.gw, result });
      });
    });

    // Same order as FPL: league points, then total points scored.
    const list = Object.values(rows).sort(
      (a, b) => b.pts - a.pts || b.pf - a.pf || a.entry.nickname.localeCompare(b.entry.nickname)
    );
    list.forEach((r, i) => {
      const prev = list[i - 1];
      r.rank = prev && prev.pts === r.pts && prev.pf === r.pf ? prev.rank : i + 1;
      r.form = r.results
        .sort((a, b) => a.gw - b.gw)
        .slice(-5)
        .map((x) => x.result);
    });
    return list;
  }

  // Manager of the Month: most points across the gameweeks whose deadline is in that month.
  function motm(model) {
    return L.motm.months.map((cfg) => {
      const gws = model.events.filter((e) => e.month === cfg.month).map((e) => e.id);
      const ms = model.matches.filter((m) => gws.includes(m.gw));
      const started = ms.some((m) => m.started);
      const complete = ms.length > 0 && ms.every((m) => m.finished);

      const totals = {};
      model.entries.forEach((e) => (totals[e.id] = 0));
      ms.filter((m) => m.started).forEach((m) => {
        totals[m.home] += m.homePts;
        totals[m.away] += m.awayPts;
      });
      const ranking = model.entries
        .map((e) => ({ entry: e, points: totals[e.id] }))
        .sort((a, b) => b.points - a.points || a.entry.nickname.localeCompare(b.entry.nickname));
      const leaders = started ? ranking.filter((r) => r.points === ranking[0].points) : [];
      const autoWinner = complete && leaders.length === 1 ? leaders[0].entry.key : null;

      return {
        ...cfg,
        gws,
        started,
        complete,
        ranking,
        leaders,
        winner: cfg.winner || autoWinner,
        tie: complete && !cfg.winner && leaders.length > 1,
      };
    });
  }

  // Last gameweek with a deadline before Christmas Day; its final table decides the Christmas prize.
  function christmasGw(model) {
    const year = model.events[0].date.slice(0, 4);
    const before = model.events.filter((e) => e.date < `${year}-12-25`);
    return before.length ? before[before.length - 1].id : null;
  }

  // Winner (once decided) or current leader for the prizes FPL can settle.
  function prizeStatus(model) {
    const current = standings(model, model.lastFinishedGw, false);
    const decide = (gw, place) => {
      const complete = gw !== null && gwComplete(model, gw);
      const table = complete ? standings(model, gw, false) : current;
      return {
        gw,
        complete,
        winner: complete ? table[place].entry.key : null,
        leader: model.lastFinishedGw ? current[place].entry.key : null,
      };
    };
    return {
      champion: decide(model.lastGw, 0),
      "runner-up": decide(model.lastGw, 1),
      christmas: decide(christmasGw(model), 0),
    };
  }

  window.FPL = { load, gameweek, moves, standings, motm, prizeStatus, gwComplete };
})();
