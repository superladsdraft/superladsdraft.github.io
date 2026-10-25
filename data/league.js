/*
 * SUPER LADS DRAFT — the hand-edited bits.
 *
 * Everything the FPL Draft API can't tell us lives here: nicknames, money,
 * prize payouts and past seasons. Edit this file on GitHub (pencil icon),
 * commit, and the site updates in a minute or two.
 *
 * Manager keys ("mike", "dill" ...) are used everywhere else in this file,
 * so use the key rather than the nickname when filling in a winner.
 *
 * Winners: leave them as null and the site works them out from FPL
 * (Manager of the Month, Christmas, Champion, Runner-up). Only fill one in
 * to override the result, e.g. to settle a tie. The League Cup is manual.
 */
window.LEAGUE = {
  season: "26/27",
  leagueId: 4674,
  leagueCode: "skijok",
  buyIn: 25,

  // Address of the Cloudflare Worker that fetches FPL data (see worker/README.md),
  // e.g. "https://superlads-fpl.yourname.workers.dev". Empty = not connected yet.
  apiBase: "https://superlads-fpl.lilliesimpsonlittle.workers.dev",

  links: [
    { label: "FPL Draft", url: "https://draft.premierleague.com/league" },
    { label: "fplstats", url: "https://draft.fplstats.co.uk/league/4674" },
    { label: "draftfpl.live", url: "https://www.draftfpl.live" },
  ],

  // entryId = the team's FPL entry, leagueEntryId = its id inside this league.
  // Both come from the FPL API, so don't change them.
  managers: [
    { key: "mike",   nickname: "Big Daddy Mike", team: "No Cherki Jeremy",   entryId: 19381, leagueEntryId: 19391, paid: true },
    { key: "tim",    nickname: "Tim",            team: "Bristol Palace",     entryId: 19382, leagueEntryId: 19392, paid: true },
    { key: "craske", nickname: "Craske",         team: "Craskal Palace",     entryId: 19383, leagueEntryId: 19393, paid: true },
    { key: "dill",   nickname: "Dill",           team: "Dillem II",          entryId: 19385, leagueEntryId: 19395, paid: true },
    { key: "lillie", nickname: "Lillie",         team: "Queer Park Rangers", entryId: 19386, leagueEntryId: 19396, paid: true },
    { key: "pads",   nickname: "Pads",           team: "Three-O Walcott",    entryId: 19387, leagueEntryId: 19397, paid: true },
    { key: "ryan",   nickname: "Ryan",           team: "Chicken Thiaw Mein", entryId: 19388, leagueEntryId: 19398, paid: true },
    { key: "bwb",    nickname: "BWB",            team: "Aymeric Exporte",    entryId: 19389, leagueEntryId: 19399, paid: true },
    { key: "shugs",  nickname: "Shugs",          team: "Cross It FC",        entryId: 19390, leagueEntryId: 19400, paid: true },
    { key: "jake",   nickname: "Jake",           team: "ADHD fc",            entryId: 19844, leagueEntryId: 19854, paid: true },
  ],

  // Big prizes. paid = has the money gone out.
  prizes: [
    { id: "champion",  label: "Champion",          detail: "Top of the league at the end of the season", amount: 75, winner: null, paid: false },
    { id: "runner-up", label: "Runner-up",         detail: "2nd in the league at the end of the season",  amount: 25, winner: null, paid: false },
    { id: "christmas", label: "Top at Christmas",  detail: "Top of the table on Christmas Day",           amount: 25, winner: null, paid: false },
    { id: "cup",       label: "League Cup",        detail: "Format to be confirmed",                      amount: 25, winner: null, paid: false },
  ],

  // Manager of the Month: most FPL points across the gameweeks whose
  // deadline falls in that month. Winners are worked out automatically;
  // just tick paid: true once they've had their tenner.
  motm: {
    amount: 10,
    months: [
      { month: "2026-08", winner: null,   paid: true },
      { month: "2026-09", winner: null,   paid: false },
      { month: "2026-10", winner: null,   paid: false },
      { month: "2026-11", winner: null,   paid: false },
      { month: "2026-12", winner: null,   paid: false },
      { month: "2027-01", winner: null,   paid: false },
      { month: "2027-02", winner: null,   paid: false },
      { month: "2027-03", winner: null,   paid: false },
      { month: "2027-04", winner: null,   paid: false },
      { month: "2027-05", winner: null,   paid: false },
    ],
  },

  // Past seasons. Names are plain text so ex-members still show up.
  // null = still to be decided.
  history: [
    { season: "23/24", firstPick: "Lillie", winner: "Pete H", christmas: "Ben" },
    { season: "24/25", firstPick: "Dill",   winner: "Rob",    christmas: "Pete H" },
    { season: "25/26", firstPick: "Shugs",  winner: "Dill",   christmas: "Dill" },
    { season: "26/27", firstPick: "Lillie", winner: null,     christmas: null },
  ],
};
