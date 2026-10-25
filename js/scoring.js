/*
 * Live gameweek scoring: each manager's points as things stand, with the
 * auto-subs and bonus points FPL will give once the matches are done.
 */
(function () {
  "use strict";

  const isDone = (fixture) => fixture.finished || fixture.finished_provisional;

  // Bonus FPL would give if the match ended now: 3, 2 and 1 for the top BPS,
  // with FPL's tie rules (a tie for first gives both 3, the next player 1, and so on).
  function provisionalBonus(fixture) {
    if (!fixture.started) return {};
    const stat = (name) => fixture.stats.find((s) => s.s === name) || { h: [], a: [] };
    const awarded = stat("bonus");
    if (awarded.h.length || awarded.a.length) return {}; // FPL has already added the real bonus
    const bps = [...stat("bps").h, ...stat("bps").a];
    const bonus = {};
    bps.forEach((p) => {
      const rank = 1 + bps.filter((q) => q.value > p.value).length;
      if (rank <= 3) bonus[p.element] = 4 - rank;
    });
    return bonus;
  }

  // Everything needed to score players in one gameweek.
  // boot = the relay's slim bootstrap, live = /event/{gw}/live.
  function context(boot, live) {
    const fixturesByTeam = {};
    const bonus = {};
    live.fixtures.forEach((f) => {
      (fixturesByTeam[f.team_h] = fixturesByTeam[f.team_h] || []).push(f);
      (fixturesByTeam[f.team_a] = fixturesByTeam[f.team_a] || []).push(f);
      Object.entries(provisionalBonus(f)).forEach(([id, pts]) => (bonus[id] = (bonus[id] || 0) + pts));
    });
    return {
      elements: Object.fromEntries(boot.elements.map((e) => [e.id, e])),
      teams: Object.fromEntries(boot.teams.map((t) => [t.id, t.short_name])),
      teamCodes: Object.fromEntries(boot.teams.map((t) => [t.id, t.code])),
      positions: Object.fromEntries(boot.element_types.map((t) => [t.id, t.singular_name_short])),
      squad: boot.squad,
      fixturesByTeam,
      bonus,
      stats: live.elements,
    };
  }

  // One player's gameweek. status is one of:
  //   playing  - on the pitch in a match that's going on now
  //   waiting  - their match is going on but they haven't come on
  //   upcoming - they've still got a match to start
  //   played   - all their matches are over and they got minutes
  //   dnp      - all their matches are over (or they had none) and they didn't play
  function player(ctx, id) {
    const el = ctx.elements[id] || { web_name: `Player ${id}`, team: 0, element_type: 0 };
    const stats = (ctx.stats[id] && ctx.stats[id].stats) || { minutes: 0, total_points: 0 };
    const fixtures = ctx.fixturesByTeam[el.team] || [];
    const bonus = ctx.bonus[id] || 0;

    let status;
    if (fixtures.some((f) => f.started && !isDone(f))) status = stats.minutes > 0 ? "playing" : "waiting";
    else if (fixtures.some((f) => !f.started)) status = "upcoming";
    else status = stats.minutes > 0 ? "played" : "dnp";

    return {
      id,
      name: el.web_name,
      team: ctx.teams[el.team] || "",
      teamCode: ctx.teamCodes[el.team] || null,
      type: el.element_type,
      position: ctx.positions[el.element_type] || "",
      minutes: stats.minutes,
      starts: stats.starts || 0,
      points: stats.total_points + bonus,
      bonus,
      status,
      stats,
      // Their real-life match(es) this gameweek, for the "LEE 1 - 1 MUN | FT" line.
      matches: fixtures.map((f) => ({
        home: ctx.teams[f.team_h] || "",
        away: ctx.teams[f.team_a] || "",
        homeScore: f.team_h_score,
        awayScore: f.team_a_score,
        kickoff: f.kickoff_time,
        started: f.started,
        done: isDone(f),
      })),
      // FPL's injury/suspension flag, if any (needs the relay to pass these fields through).
      availability:
        el.status && el.status !== "a"
          ? { status: el.status, chance: el.chance_of_playing_this_round ?? el.chance_of_playing_next_round, news: el.news }
          : null,
    };
  }

  // Would swapping `incoming` into the starting XI at `index` keep a legal formation?
  function fits(ctx, xi, index, incoming) {
    const counts = {};
    xi.forEach((p, i) => {
      const type = i === index ? incoming.type : p.type;
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(ctx.positions).every(([type, name]) => {
      const n = counts[type] || 0;
      return n >= ctx.squad[`min_play_${name}`] && n <= ctx.squad[`max_play_${name}`];
    });
  }

  // A manager's team for the gameweek, with auto-subs made the way FPL makes them:
  // each starter who didn't play is swapped for the first bench player, in bench
  // order, who keeps the formation legal and hasn't already missed out. If that
  // bench player's match hasn't happened yet they come in provisionally (pending),
  // and if they then don't play either, the next refresh moves on to the next one.
  // fplSubs: subs FPL has already made (finished gameweeks come with them applied).
  function lineup(ctx, picks, fplSubs = []) {
    const squad = picks
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((p) => player(ctx, p.element));
    const xi = squad.slice(0, ctx.squad.play);
    const bench = squad.slice(ctx.squad.play);
    const subs = [];

    xi.forEach((starter, i) => {
      if (starter.status !== "dnp") return;
      for (const sub of bench) {
        if (sub.used || !fits(ctx, xi, i, sub)) continue;
        if (sub.status === "dnp") continue;
        const pending = sub.minutes === 0;
        sub.used = true;
        xi[i] = { ...sub, subIn: true, subPending: pending };
        subs.push({ out: starter, in: sub, pending });
        break;
      }
    });

    // FPL's own subs are already in the picks; just flag them so they show up.
    fplSubs.forEach((s) => {
      const i = xi.findIndex((p) => p.id === s.element_in);
      const out = bench.find((p) => p.id === s.element_out);
      if (i === -1 || !out) return;
      xi[i] = { ...xi[i], subIn: true };
      out.subOut = true;
      subs.push({ out, in: xi[i] });
    });

    const subbedOut = subs.filter((s) => !s.out.subOut).map((s) => ({ ...s.out, subOut: true }));
    const stillToCome = (p) => p.status === "playing" || p.status === "waiting" || p.status === "upcoming";

    return {
      score: xi.reduce((sum, p) => sum + p.points, 0),
      xi: xi.slice().sort((a, b) => a.type - b.type),
      bench: bench.filter((p) => !p.used).concat(subbedOut),
      subs,
      left: xi.filter(stillToCome).length,
      provisional: xi.some((p) => p.bonus > 0),
    };
  }

  window.Scoring = { context, lineup, provisionalBonus };
})();
