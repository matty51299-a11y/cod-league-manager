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

// ── Curated Ghosts-era overalls, keyed by normalised gamertag ──────────────────
// Tiered so team strength reflects the real 2013/14 season: compLexity are the
// class of the field, OpTic / EnVy / FaZe / Strictly Business are strong, then a
// band of decent teams. Individual stars are rated on their own merit even on
// weaker teams (e.g. FormaL 89 on an otherwise mid Team Kaliber). Outliers that
// over-performed at a single event (VexX Revenge, Trident T1 Dotters) are kept
// modest. Everyone not listed falls to the low depth-tier default below, so the
// no-name orgs (New Star Player, Reign Mix, Aztek…) are correctly weak.
const GHOSTS_OVERALLS = {
  // compLexity — champions / best team
  aches: 86, teepee: 85, crimsix: 89, karma: 89,
  // Team EnVyUs
  rambo: 82, merk: 86, nameless: 82, studyy: 85,
  // OpTic Gaming
  nadeshot: 83, clayster: 85, mboze: 79, scump: 88,
  // Strictly Business
  censor: 83, apathy: 82, saints: 80, dedo: 79,
  // FaZe Clan
  replays: 80, classic: 82, jkap: 85, proofy: 79,
  // Rise Nation
  pacman: 82, whea7s: 80, loony: 82, fears: 78,
  // Epsilon eSports
  jurd: 79, swanny: 82, tommey: 84, flux: 78,
  // TCM-Gaming
  markyb: 82, moose: 79, gunshy: 79, madcat: 80,
  // Xfinity Gaming
  muddawg: 78, crowster: 78, sinful: 79, doubt: 77,
  // Team Kaliber — FormaL is a star, the rest are mid
  sharp: 79, theory: 75, goonjar: 77, formal: 89,
  // Vitality.Rises
  gotaga: 74, broken: 76, krnage: 75, blue: 75,
  // Team Immunity
  buzzo: 76, naked: 76, shockz: 77, rampage: 75,
  // WiLD Gaming
  brock: 74, incepts: 74, anticity: 75, nexxx: 74,
  // Vitality.Returns
  agonie: 74, azox: 74, getsom: 73, dylux: 73,
  // Outliers — decent but should not routinely finish near the top
  iskatuu: 77, chilean: 77, denz: 76, damage: 77,        // Trident T1 Dotters
  slumber: 76, illskill: 77, mech: 76, demon: 75,        // VexX Revenge
};

// Curated role/age/potential detail from the authored 12-slot roster (used for
// flavour where available; overalls above take precedence).
const CURATED = new Map();
for (const p of GHOSTS_STARTING_ROSTER) {
  CURATED.set(normName(p.name), {
    overall: p.overall, potential: p.potential,
    primary: p.primary, secondary: p.secondary, age: p.age, region: p.region,
  });
}

// Resolve a curated overall (explicit tier map first, then authored roster).
function curatedOverall(playerId, displayName) {
  const byName = GHOSTS_OVERALLS[normName(displayName)] ?? GHOSTS_OVERALLS[normName(playerId)];
  if (byName != null) return byName;
  const c = CURATED.get(normName(displayName)) || CURATED.get(normName(playerId));
  return c ? c.overall : null;
}

// Deterministic overall for any player — curated when known, otherwise a stable
// DEPTH-tier value (60–71) so uncurated no-name players never out-rate the real
// pros. Used by both the roster and the circuit engine so ratings agree.
export function historicalPlayerOverall(playerId, displayName) {
  const curated = curatedOverall(playerId, displayName);
  if (curated != null) return curated;
  return 60 + (hashString(playerId) % 12);
}

// Full, coherent player record for a historical roster entry: real overall,
// role, age and a derived sub-stat block (so chemistry has real inputs instead
// of NaN, and the roster grid is fully populated).
export function buildHistoricalPlayerRecord({ playerId, displayName, teamId, region = "NA", eraId }) {
  const curated = CURATED.get(normName(displayName)) || CURATED.get(normName(playerId));
  const h = hashString(`${eraId || "ghosts"}|${playerId}`);
  const overall = historicalPlayerOverall(playerId, displayName);
  const potential = clamp(Math.max(curated?.potential ?? 0, overall + 2 + (h % 6)));
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
