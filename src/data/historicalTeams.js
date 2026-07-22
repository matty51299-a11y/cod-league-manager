// src/data/historicalTeams.js
// Era-appropriate team identities and starting rosters for Historical Dynasty.
//
// The engine keys everything to 12 STABLE team ids (see teams.js). Rather than
// swap the team set (which the whole engine assumes is fixed), a historical
// dynasty RE-SKINS those stable slots to the real organisations of the era and
// seeds them with era-appropriate players. As the dynasty crosses ecosystems the
// brands evolve MLG → CWL → CDL, so a slot has a recognisable lineage (e.g. the
// "optic" slot is OpTic Gaming in the MLG/CWL eras and OpTic Texas in the CDL
// era) while its id — and therefore its history — never changes.
//
// Rosters are only seeded at the START of a dynasty (Ghosts). From then on the
// simulation drives every transfer, so the timeline becomes the player's own
// alternate history — historical rosters are never re-imposed later.

import { applyTeamBranding, resetTeamBranding } from "./teams.js";
import { getEra, ECOSYSTEM, HISTORICAL_START_ERA_ID } from "./codEras.js";

// ── Era brand sets (stable slot id → real org of the era) ─────────────────────
// Colours are chosen to stay legible on the app's surfaces. Logos fall back to a
// coloured tag box (TeamLogo handles null), so no per-org image assets are needed.
export const MLG_TEAM_BRANDS = {
  optic:     { name: "OpTic Gaming",       tag: "OG",    color: "#8CC63F", org: "OpTic Gaming" },
  lat:       { name: "compLexity",         tag: "coL",   color: "#1D3F8B", org: "compLexity Gaming" },
  miami:     { name: "Team EnVyUs",        tag: "EnVy",  color: "#0A0A0A", org: "Team EnVyUs" },
  cloud9:    { name: "Evil Geniuses",      tag: "EG",    color: "#0B4DA2", org: "Evil Geniuses" },
  faze:      { name: "Rise Nation",        tag: "RISE",  color: "#C0272D", org: "Rise Nation" },
  g2:        { name: "FaZe Red",           tag: "FaZe",  color: "#E4322B", org: "FaZe Clan" },
  boston:    { name: "Team Kaliber",       tag: "tK",    color: "#111827", org: "Team Kaliber" },
  carolina:  { name: "Denial Esports",     tag: "DNL",   color: "#6D28D9", org: "Denial Esports" },
  riyadh:    { name: "Prophecy",           tag: "PXY",   color: "#0E7490", org: "Prophecy" },
  paris:     { name: "Epsilon eSports",    tag: "EPS",   color: "#2563EB", org: "Epsilon eSports" },
  toronto:   { name: "Team Vitality",      tag: "VIT",   color: "#F2C200", org: "Team Vitality" },
  vancouver: { name: "Strictly Business",  tag: "SB",    color: "#B45309", org: "Strictly Business" },
};

export const CWL_TEAM_BRANDS = {
  optic:     { name: "OpTic Gaming",       tag: "OG",    color: "#8CC63F", org: "OpTic Gaming" },
  lat:       { name: "Luminosity Gaming",  tag: "LG",    color: "#111827", org: "Luminosity Gaming" },
  miami:     { name: "Team EnVyUs",        tag: "EnVy",  color: "#0A0A0A", org: "Team EnVyUs" },
  cloud9:    { name: "eUnited",            tag: "eU",    color: "#16A34A", org: "eUnited" },
  faze:      { name: "FaZe Clan",          tag: "FaZe",  color: "#E4322B", org: "FaZe Clan" },
  g2:        { name: "Splyce",             tag: "SPY",   color: "#F59E0B", org: "Splyce" },
  boston:    { name: "Team Kaliber",       tag: "tK",    color: "#111827", org: "Team Kaliber" },
  carolina:  { name: "Enigma6",            tag: "E6",    color: "#DC2626", org: "Enigma6" },
  riyadh:    { name: "Gen.G",              tag: "GEN",   color: "#B8860B", org: "Gen.G Esports" },
  paris:     { name: "Red Reserve",        tag: "RED",   color: "#B91C1C", org: "Red Reserve" },
  toronto:   { name: "UNILAD",             tag: "UL",    color: "#1D4ED8", org: "UNILAD Esports" },
  vancouver: { name: "Rise Nation",        tag: "RISE",  color: "#C0272D", org: "Rise Nation" },
};

// Resolve the brand set for an era from its ecosystem. CDL / future eras keep the
// default (modern CDL franchise) branding baked into teams.js.
export function brandSetForEra(eraId) {
  const era = getEra(eraId);
  if (era?.ecosystem === ECOSYSTEM.MLG) return MLG_TEAM_BRANDS;
  if (era?.ecosystem === ECOSYSTEM.CWL) return CWL_TEAM_BRANDS;
  return null; // CDL / future → default franchise brands
}

// Apply the era-appropriate branding to the 12 stable slots. Deterministic from
// the era id, so it is safe to call on new-game, on load, and after every era
// transition. Modern careers (or CDL-era dynasties) reset to the default brands.
export function applyEraTeamBranding(eraId, careerMode = "historical") {
  if (careerMode !== "historical") { resetTeamBranding(); return; }
  const brands = brandSetForEra(eraId);
  if (brands) applyTeamBranding(brands);
  else resetTeamBranding();
}

// ── Deterministic player builder ──────────────────────────────────────────────
function hashString(str) { let h = 2166136261; for (const ch of String(str || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function clamp(v, min = 40, max = 99) { return Math.max(min, Math.min(max, Math.round(v))); }

// Role-flavoured stat emphasis so a starter's block matches their role.
const ROLE_BIAS = {
  "Main AR":            { awareness: 5, searchIQ: 4, gunny: 1, objective: 2, clutch: 1, composure: 3, teamwork: 3, adaptability: 0 },
  "Search Specialist":  { searchIQ: 7, composure: 5, awareness: 4, clutch: 3, gunny: -2, objective: -1, teamwork: 3, adaptability: -1 },
  "Slayer SMG":         { gunny: 6, clutch: 4, adaptability: 3, awareness: 1, objective: -2, searchIQ: -2, composure: 1, teamwork: -1 },
  "Entry SMG":          { gunny: 5, adaptability: 4, clutch: 2, objective: 1, awareness: -1, searchIQ: -2, composure: -1, teamwork: 0 },
  "Objective":          { objective: 7, teamwork: 5, awareness: 3, composure: 2, gunny: -2, searchIQ: 1, clutch: 0, adaptability: 2 },
  "Flex":               { adaptability: 5, teamwork: 3, awareness: 2, objective: 3, gunny: 1, searchIQ: 1, clutch: 1, composure: 1 },
};

// hp — build a full era player from a compact spec. sub-stats derive from overall
// + role bias + a small deterministic variance, so blocks are coherent and stable.
function hp(name, teamId, age, primary, secondary, overall, potential, region = "NA", opts = {}) {
  const h = hashString(`${teamId}|${name}`);
  const bias = ROLE_BIAS[primary] || ROLE_BIAS.Flex;
  const v = (salt, spread = 5) => ((h >> salt) % (spread * 2 + 1)) - spread;
  const stat = (key, salt) => clamp(overall + (bias[key] || 0) + v(salt, 4));
  return {
    id: `${teamId}_${name.toLowerCase().replace(/\s/g, "_")}`,
    name, teamId, age, primary, secondary, region,
    salary: (() => { const t = Math.max(0, (overall - 70) / 29); return Math.round((Math.pow(t, 2.5) * 400 + 20)) * 1000; })(),
    overall, potential,
    gunny: stat("gunny", 0), awareness: stat("awareness", 3), objective: stat("objective", 6), searchIQ: stat("searchIQ", 9),
    clutch: stat("clutch", 12), teamwork: stat("teamwork", 15), composure: stat("composure", 18), adaptability: stat("adaptability", 21),
    ego: opts.ego ?? (1 + (h % 5)), workEthic: opts.workEthic ?? (2 + ((h >> 3) % 4)),
    tiltResistance: opts.tiltResistance ?? (2 + ((h >> 6) % 4)), leadership: opts.leadership ?? (1 + ((h >> 9) % 5)),
    metaDependence: opts.metaDependence ?? (1 + ((h >> 12) % 4)),
    form: 70, experience: 1, isProspect: false,
    contractYears: (hashString(name) % 3) + 1,
    dataStatus: "historical",
  };
}

// ── Ghosts (2013/14) starting rosters ─────────────────────────────────────────
// Recognisable open/MLG-era pros distributed across the 12 era-branded slots.
// Rosters are representative starting points; from here the simulation drives an
// alternate history, so exact real-world lineups are neither required nor forced.
export const GHOSTS_STARTING_ROSTER = [
  // OpTic Gaming (optic)
  hp("Scump",     "optic", 19, "Slayer SMG",       "Entry SMG",       83, 92, "NA", { leadership: 4, ego: 3 }),
  hp("NaDeSHoT",  "optic", 21, "Main AR",          "Flex",            80, 84, "NA", { leadership: 5, workEthic: 5 }),
  hp("BigTymer",  "optic", 24, "Objective",        "Main AR",         78, 80, "NA", { leadership: 4 }),
  hp("MiRx",      "optic", 22, "Search Specialist","Flex",            76, 82, "NA"),
  // compLexity (lat)
  hp("Crimsix",   "lat", 20, "Main AR",            "Slayer SMG",      82, 93, "NA", { workEthic: 5, ego: 3 }),
  hp("ACHES",     "lat", 22, "Objective",          "Flex",            80, 84, "NA", { leadership: 5 }),
  hp("TeePee",    "lat", 23, "Slayer SMG",         "Search Specialist",81, 83, "NA"),
  hp("ProoFy",    "lat", 20, "Flex",               "Entry SMG",       76, 85, "NA"),
  // Team EnVyUs (miami)
  hp("JKap",      "miami", 21, "Objective",         "Main AR",         81, 88, "NA", { leadership: 5 }),
  hp("Clayster",  "miami", 21, "Main AR",           "Flex",            82, 89, "NA", { leadership: 4 }),
  hp("Nagafen",   "miami", 22, "Slayer SMG",        "Entry SMG",       77, 81, "NA"),
  hp("Sender",    "miami", 20, "Flex",              "Search Specialist",75, 83, "NA"),
  // Evil Geniuses (cloud9)
  hp("Karma",     "cloud9", 20, "Main AR",          "Flex",            83, 91, "NA", { leadership: 5, workEthic: 5 }),
  hp("Aqua",      "cloud9", 21, "Slayer SMG",       "Entry SMG",       78, 84, "NA"),
  hp("EnaBLe",    "cloud9", 20, "Entry SMG",        "Flex",            77, 86, "NA"),
  hp("Studyy",    "cloud9", 19, "Objective",        "Main AR",         74, 85, "NA"),
  // Rise Nation (faze)
  hp("Loony",     "faze", 21, "Objective",          "Main AR",         79, 84, "NA", { leadership: 4 }),
  hp("Slacked",   "faze", 20, "Entry SMG",          "Flex",            78, 85, "NA"),
  hp("Faccento",  "faze", 21, "Main AR",            "Search Specialist",76, 82, "NA"),
  hp("SiNfuL",    "faze", 19, "Slayer SMG",         "Entry SMG",       75, 84, "NA"),
  // FaZe Red (g2)
  hp("ZooMaa",    "g2", 20, "Slayer SMG",           "Entry SMG",       80, 86, "NA", { ego: 3 }),
  hp("Replays",   "g2", 21, "Objective",            "Flex",            77, 82, "NA"),
  hp("Priestahh", "g2", 20, "Main AR",              "Slayer SMG",      78, 85, "NA"),
  hp("MboZe",     "g2", 19, "Flex",                 "Entry SMG",       74, 84, "NA"),
  // Team Kaliber (boston)
  hp("Goonjar",   "boston", 20, "Slayer SMG",       "Entry SMG",       78, 85, "NA"),
  hp("Nelson",    "boston", 21, "Main AR",          "Flex",            76, 82, "NA"),
  hp("Assault",   "boston", 22, "Search Specialist","Objective",       75, 80, "NA", { leadership: 4 }),
  hp("Lacefield", "boston", 20, "Flex",             "Entry SMG",       74, 83, "NA"),
  // Denial Esports (carolina)
  hp("BLfire",    "carolina", 20, "Slayer SMG",     "Entry SMG",       75, 82, "NA"),
  hp("Theory",    "carolina", 21, "Main AR",        "Flex",            74, 80, "NA"),
  hp("Maux",      "carolina", 20, "Objective",      "Search Specialist",73, 81, "NA"),
  hp("Fatal",     "carolina", 19, "Flex",           "Slayer SMG",      72, 84, "NA"),
  // Prophecy (riyadh)
  hp("Saints",    "riyadh", 21, "Main AR",          "Flex",            76, 82, "NA", { leadership: 4 }),
  hp("Xotic",     "riyadh", 20, "Slayer SMG",       "Entry SMG",       75, 83, "NA"),
  hp("Diabolic",  "riyadh", 22, "Search Specialist","Objective",       74, 79, "NA"),
  hp("Neslo",     "riyadh", 20, "Flex",             "Main AR",         73, 82, "NA"),
  // Epsilon eSports (paris) — EU
  hp("Tommey",    "paris", 20, "Slayer SMG",        "Entry SMG",       77, 84, "EU"),
  hp("Rated",     "paris", 21, "Objective",         "Flex",            76, 82, "EU", { leadership: 4 }),
  hp("Joshh",     "paris", 20, "Main AR",           "Search Specialist",75, 82, "EU"),
  hp("Zed",       "paris", 19, "Flex",              "Entry SMG",       73, 83, "EU"),
  // Team Vitality (toronto) — EU
  hp("MadCat",    "toronto", 21, "Slayer SMG",      "Entry SMG",       76, 82, "EU"),
  hp("Swanny",    "toronto", 20, "Main AR",         "Flex",            75, 84, "EU"),
  hp("Jurd",      "toronto", 21, "Objective",       "Search Specialist",75, 83, "EU", { leadership: 4 }),
  hp("Bance",     "toronto", 20, "Flex",            "Slayer SMG",      74, 83, "EU"),
  // Strictly Business (vancouver)
  hp("Whea7s",    "vancouver", 21, "Main AR",       "Flex",            75, 81, "NA"),
  hp("Sharp",     "vancouver", 20, "Slayer SMG",    "Entry SMG",       74, 83, "NA"),
  hp("Loony2",    "vancouver", 22, "Objective",     "Search Specialist",73, 79, "NA"),
  hp("Nolan",     "vancouver", 19, "Flex",          "Entry SMG",       72, 83, "NA"),
];
// Fix the accidental duplicate display name on the Strictly Business objective
// slot (kept id-unique above): present it as its own gamertag.
GHOSTS_STARTING_ROSTER.find(p => p.name === "Loony2").name = "Loonzy";

// Starting rosters keyed by era id. Only the dynasty entry point (Ghosts) is
// seeded; later eras inherit whatever the simulation produced.
const HISTORICAL_STARTING_ROSTERS = {
  [HISTORICAL_START_ERA_ID]: GHOSTS_STARTING_ROSTER,
};

// Return a fresh copy of the era's starting roster, or null when the era has no
// curated roster (so the caller falls back to the default modern roster).
export function buildHistoricalStartingRoster(eraId) {
  const roster = HISTORICAL_STARTING_ROSTERS[eraId];
  if (!roster) return null;
  // Deep-ish clone so callers can mutate freely without touching the source data.
  return roster.map(p => ({ ...p }));
}
