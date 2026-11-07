/*
 * Live match updates for the Ticker page: turns FPL's running totals into lines like
 * "Goal · Palmer (Big Daddy Mike) +5".
 *
 * FPL doesn't timestamp anything within a match, so each line is stamped with when
 * this browser first saw it change, and kept in localStorage per gameweek so the
 * order survives a refresh. Lines seen on the very first look have no time.
 */
(function () {
  "use strict";

  // Appearance points (1st and 60th minute) would swamp the feed, so they're left out.
  const SKIP = new Set(["minutes"]);

  const LABELS = {
    goals_scored: "Goal",
    assists: "Assist",
    clean_sheets: "Clean sheet",
    goals_conceded: "Goals conceded",
    own_goals: "Own goal",
    penalties_saved: "Penalty saved",
    penalties_missed: "Penalty missed",
    yellow_cards: "Yellow card",
    red_cards: "Red card",
    saves: "Saves",
    bonus: "Bonus",
    defensive_contribution: "Def con",
  };

  const ICONS = {
    goals_scored: "⚽",
    assists: "🅰️",
    clean_sheets: "🧱",
    goals_conceded: "🥅",
    own_goals: "🙈",
    penalties_saved: "🧤",
    penalties_missed: "😬",
    yellow_cards: "🟨",
    red_cards: "🟥",
    saves: "🧤",
    bonus: "⭐",
    defensive_contribution: "🛡️",
  };

  // Stats where the count matters: "Saves (6)" rather than just "Saves".
  const COUNTED = new Set(["saves", "goals_conceded", "defensive_contribution", "bonus"]);

  function label(stat, value) {
    const name = LABELS[stat] || stat;
    if (COUNTED.has(stat)) return `${name} (${value})`;
    return value > 1 ? `${name} ×${value}` : name;
  }

  const storageKey = (gw) => `sld-ticker-${gw}`;

  function load(gw) {
    try {
      return JSON.parse(localStorage.getItem(storageKey(gw)));
    } catch (err) {
      return null;
    }
  }

  function save(gw, state) {
    try {
      localStorage.setItem(storageKey(gw), JSON.stringify(state));
    } catch (err) {
      // Private browsing etc. The feed still works, it just forgets the order on refresh.
    }
  }

  // Only the current gameweek's feed is kept; older ones are cleared out.
  function forgetOtherGameweeks(gw) {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("sld-ticker-") && k !== storageKey(gw))
        .forEach((k) => localStorage.removeItem(k));
    } catch (err) {
      // Nothing to tidy if storage isn't available.
    }
  }

  // Every player's points this gameweek, per match and per stat, from FPL's live data.
  function snapshot(elements) {
    const items = {};
    Object.entries(elements).forEach(([id, el]) => {
      el.explain.forEach(([stats, fixture]) => {
        stats.forEach((s) => {
          if (SKIP.has(s.stat) || !s.points) return;
          items[`${id}:${fixture}:${s.stat}`] = { key: `${id}:${fixture}:${s.stat}`, id: Number(id), fixture, stat: s.stat, value: s.value, points: s.points };
        });
      });
    });
    return items;
  }

  // Merge the latest live data into what this browser has seen this gameweek, for the
  // players in `owned` (everyone in a league squad). Returns the owned lines, including
  // points that have since gone (a clean sheet broken, a goal ruled out).
  function update(gw, elements, owned) {
    const now = Date.now();
    const prev = load(gw);
    const current = snapshot(elements);
    const lines = {};

    Object.values(current)
      .filter((item) => owned.has(item.id))
      .forEach((item) => {
        const before = prev && prev.lines[item.key];
        const changed = !before || before.lostAt || before.value !== item.value || before.points !== item.points;
        lines[item.key] = changed
          ? { ...item, at: prev ? now : null, delta: item.points - (before && !before.lostAt ? before.points : 0), lostAt: null }
          : before;
      });

    if (prev) {
      Object.values(prev.lines).forEach((before) => {
        if (lines[before.key] || !owned.has(before.id)) return;
        lines[before.key] = before.lostAt ? before : { ...before, lostAt: now, at: now, delta: -before.points };
      });
    }

    save(gw, { lines });
    forgetOtherGameweeks(gw);
    return { lines: Object.values(lines), all: Object.values(current) };
  }

  window.Ticker = { update, label, ICONS };
})();
