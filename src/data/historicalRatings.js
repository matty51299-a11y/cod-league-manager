// src/data/historicalRatings.js
// Single source of truth for historical player ratings.
//
// The corrected roster database (cod_dynasty_rosters.corrected.json) carries
// IDENTITY only — playerId + gamertag — and no ratings. Rather than flat-rate
// every player (which produced the "everyone is 70" bug), we resolve a rating
// for each player deterministically:
//
//   1. Curated overalls/roles for recognisable era stars (reusing the hand-
//      authored GHOSTS_STARTING_ROSTER data), matched by gamertag.
//   2. A deterministic fallback derived from the stable playerId, so every
//      other player still gets a coherent, stable, varied rating (66–91).
//
// Both the roster UI (state.players) and the open-circuit simulation read from
// here, so a team's strength on the roster screen matches its strength in the
// circuit.

import { GHOSTS_STARTING_ROSTER } from "./historicalTeams.js";

function hashString(str) {
  let h = 2166136261;
  for (const ch of String(str || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function clamp(v, min = 40, max = 99) { return Math.max(min, Math.min(max, Math.round(v))); }
function normName(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

const ROLES = ["Main AR", "Slayer SMG", "Objective", "Search Specialist", "Flex", "Entry SMG"];

// Role-flavoured stat emphasis (kept in sync with historicalTeams.js).
const ROLE_BIAS = {
  "Main AR":            { awareness: 5, searchIQ: 4, gunny: 1, objective: 2, clutch: 1, composure: 3, teamwork: 3, adaptability: 0 },
  "Search Specialist":  { searchIQ: 7, composure: 5, awareness: 4, clutch: 3, gunny: -2, objective: -1, teamwork: 3, adaptability: -1 },
  "Slayer SMG":         { gunny: 6, clutch: 4, adaptability: 3, awareness: 1, objective: -2, searchIQ: -2, composure: 1, teamwork: -1 },
  "Entry SMG":          { gunny: 5, adaptability: 4, clutch: 2, objective: 1, awareness: -1, searchIQ: -2, composure: -1, teamwork: 0 },
  "Objective":          { objective: 7, teamwork: 5, awareness: 3, composure: 2, gunny: -2, searchIQ: 1, clutch: 0, adaptability: 2 },
  "Flex":               { adaptability: 5, teamwork: 3, awareness: 2, objective: 3, gunny: 1, searchIQ: 1, clutch: 1, composure: 1 },
};

// Curated star index, keyed by normalised gamertag, from the authored roster.
const CURATED = new Map();
for (const p of GHOSTS_STARTING_ROSTER) {
  CURATED.set(normName(p.name), {
    overall: p.overall, potential: p.potential,
    primary: p.primary, secondary: p.secondary, age: p.age, region: p.region,
  });
}

// Deterministic overall for any player — curated when known, otherwise a stable
// 66–91 spread from the playerId. Used by both the roster and the circuit engine
// so ratings agree everywhere.
export function historicalPlayerOverall(playerId, displayName) {
  const curated = CURATED.get(normName(displayName)) || CURATED.get(normName(playerId));
  if (curated) return curated.overall;
  return 66 + (hashString(playerId) % 26);
}

// Full, coherent player record for a historical roster entry: real overall,
// role, age and a derived sub-stat block (so chemistry has real inputs instead
// of NaN, and the roster grid is fully populated).
export function buildHistoricalPlayerRecord({ playerId, displayName, teamId, region = "NA", eraId }) {
  const curated = CURATED.get(normName(displayName)) || CURATED.get(normName(playerId));
  const h = hashString(`${eraId || "ghosts"}|${playerId}`);
  const overall = curated?.overall ?? (66 + (hashString(playerId) % 26));
  const potential = curated?.potential ?? clamp(overall + 6 + (h % 12));
  const primary = curated?.primary ?? ROLES[h % ROLES.length];
  const secondary = curated?.secondary ?? "Flex";
  const age = curated?.age ?? (18 + (h % 8));
  const bias = ROLE_BIAS[primary] || ROLE_BIAS.Flex;
  const v = (salt, spread = 4) => ((h >> salt) % (spread * 2 + 1)) - spread;
  const stat = (key, salt) => clamp(overall + (bias[key] || 0) + v(salt));
  return {
    id: playerId, playerId,
    name: displayName || playerId, gamertag: displayName || playerId,
    teamId, primary, secondary, region: curated?.region || region,
    age,
    overall, potential,
    gunny: stat("gunny", 0), awareness: stat("awareness", 3), objective: stat("objective", 6), searchIQ: stat("searchIQ", 9),
    clutch: stat("clutch", 12), teamwork: stat("teamwork", 15), composure: stat("composure", 18), adaptability: stat("adaptability", 21),
    ego: 1 + (h % 5), workEthic: 2 + ((h >> 3) % 4), tiltResistance: 2 + ((h >> 6) % 4),
    leadership: 1 + ((h >> 9) % 5), metaDependence: 1 + ((h >> 12) % 4),
    salary: (() => { const t = Math.max(0, (overall - 66) / 33); return Math.round((Math.pow(t, 2.2) * 380 + 18)) * 1000; })(),
    form: 70, experience: 1, isProspect: false,
    contractYears: (hashString(playerId) % 3) + 1,
    dataStatus: "historical",
  };
}
