import {
  getEra, getNextEra, MODERN_ERA_ID, HISTORICAL_START_ERA_ID, LAST_HISTORICAL_ERA_ID,
  generateFutureEra, registerGeneratedEras, isFictionalEra,
} from "../data/codEras.js";
import { HISTORICAL_ROOKIE_CLASSES } from "../data/historicalRookieClasses.js";
import { applyEraTeamBranding } from "../data/historicalTeams.js";

function clamp(v, min = 40, max = 99) { return Math.max(min, Math.min(max, Math.round(v))); }
function hashString(str) { let h = 2166136261; for (const ch of String(str || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function attr(base, salt) { return clamp(base + ((salt % 13) - 6)); }

export const HISTORICAL_STRICTNESS = { LOOSE: "loose", BALANCED: "balanced", STRICT: "strict" };

export function migrateHistoricalDynastyState(state) {
  const careerMode = state?.careerMode === "historical" ? "historical" : "modern";
  // Re-register any generated future eras so getEra() resolves them after reload.
  registerGeneratedEras(state?.generatedEras || []);
  const currentEraId = careerMode === "historical" ? (state?.currentEraId || HISTORICAL_START_ERA_ID) : (state?.currentEraId || MODERN_ERA_ID);
  const era = getEra(currentEraId);
  // Re-skin the 12 stable team slots to the active era's real organisations
  // (or reset to the modern franchises for modern careers / the CDL era). Safe
  // to run on every hydrate: display-only, deterministic from the era id.
  applyEraTeamBranding(era.id, careerMode);
  return {
    ...state,
    careerMode,
    currentEraId: era.id,
    currentGameTitle: state?.currentGameTitle || era.gameTitle,
    historicalStrictness: state?.historicalStrictness || HISTORICAL_STRICTNESS.BALANCED,
    dynastySeed: Number.isFinite(state?.dynastySeed) ? state.dynastySeed : 0,
    historicalSeasonIndex: Number.isFinite(state?.historicalSeasonIndex) ? state.historicalSeasonIndex : 0,
    eraHistory: Array.isArray(state?.eraHistory) ? state.eraHistory : [],
    introducedRookieClassIds: Array.isArray(state?.introducedRookieClassIds) ? state.introducedRookieClassIds : [],
    generatedEras: Array.isArray(state?.generatedEras) ? state.generatedEras : [],
    pendingEraTransition: state?.pendingEraTransition || null,
  };
}

export function buildHistoricalProspect(row, eraId) {
  const overall = clamp(row.initialOvr ?? 68);
  const potential = clamp(row.potential ?? overall + 10);
  const h = hashString(`${row.id}|${eraId}`);
  return {
    id: row.id,
    name: row.name,
    teamId: null,
    challengerTeamId: null,
    primary: row.role || "Flex",
    secondary: "Flex",
    region: row.region || "NA",
    age: 18 + (h % 4),
    developmentCurve: potential - overall >= 14 ? "late" : "standard",
    salary: Math.round((overall / 99) * 50 + 15) * 1000,
    overall,
    potential,
    gunny: attr(overall, h), awareness: attr(overall, h >> 3), objective: attr(overall, h >> 6), searchIQ: attr(overall, h >> 9),
    clutch: attr(overall, h >> 12), teamwork: attr(overall, h >> 15), composure: attr(overall, h >> 18), adaptability: attr(overall, h >> 21),
    ego: 1 + (h % 5), workEthic: 1 + ((h >> 3) % 5), tiltResistance: 1 + ((h >> 6) % 5), leadership: 1 + ((h >> 9) % 5), metaDependence: 1 + ((h >> 12) % 5),
    scoutedOverall: overall, scoutedPotential: potential, scouted: false, form: 65, experience: 0, isProspect: true, contractYears: 0,
    status: "challengers", debutEraId: eraId, rookieClassId: `${eraId}_rookies`, eraFitTraits: row.traits || [], dataStatus: "historical",
  };
}

// ── Procedural fictional rookie generation ─────────────────────────────────────
const GT_PREFIX = ["Zap", "Vex", "Nyx", "Kro", "Dash", "Riot", "Frost", "Volt", "Sable", "Onyx", "Rift", "Ghost", "Blaze", "Cypher", "Echo", "Havoc", "Jinx", "Kilo", "Lunar", "Maverick", "Neon", "Pyro", "Quill", "Raze", "Surge", "Talon", "Venom", "Wisp", "Xen", "Zephyr"];
const GT_SUFFIX = ["y", "z", "er", "o", "ix", "ah", "en", "us", "ical", "ow", "yn", "ez", "ii", "ku", "ax", "on", "is", "ry"];
const REGIONS = ["NA", "NA", "NA", "EU", "EU", "APAC"];
const ROLES = ["Main AR", "Flex", "Slayer SMG", "Search Specialist", "Objective"];

function fictionalRng(seed) { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }; }

function generateGamertag(rng, used) {
  for (let i = 0; i < 40; i++) {
    let tag = GT_PREFIX[Math.floor(rng() * GT_PREFIX.length)] + GT_SUFFIX[Math.floor(rng() * GT_SUFFIX.length)];
    if (rng() < 0.25) tag += String(Math.floor(rng() * 90) + 10);
    if (!used.has(tag.toLowerCase())) { used.add(tag.toLowerCase()); return tag; }
  }
  const fallback = `Prospect${Math.floor(rng() * 100000)}`;
  used.add(fallback.toLowerCase());
  return fallback;
}

// Build a fictional rookie class for a fictional (procedurally generated) era.
// Deterministic given the dynasty seed and era id. Includes varied potential
// tiers: occasional generational talent, late bloomers, and role specialists.
export function generateFictionalRookieClass(era, dynastySeed, existingNames, count = 5) {
  const rng = fictionalRng((dynastySeed >>> 0) ^ hashString(era.id));
  const used = new Set([...(existingNames || [])].map(n => String(n).toLowerCase()));
  const rookies = [];
  for (let i = 0; i < count; i++) {
    const name = generateGamertag(rng, used);
    const roll = rng();
    // Potential tiers: rare generational talent, solid, and role specialists.
    let overall, potential;
    if (roll < 0.06) { overall = clamp(70 + Math.floor(rng() * 6)); potential = clamp(93 + Math.floor(rng() * 6)); } // generational
    else if (roll < 0.35) { overall = clamp(66 + Math.floor(rng() * 6)); potential = clamp(85 + Math.floor(rng() * 6)); }
    else { overall = clamp(60 + Math.floor(rng() * 8)); potential = clamp(74 + Math.floor(rng() * 10)); }
    const lateBloomer = rng() < 0.2;
    const role = ROLES[Math.floor(rng() * ROLES.length)];
    const h = hashString(`${era.id}|${name}|${i}`);
    rookies.push({
      id: `fic_${era.id}_${i}_${name.toLowerCase()}`,
      name,
      teamId: null, challengerTeamId: null,
      primary: role, secondary: "Flex",
      region: REGIONS[Math.floor(rng() * REGIONS.length)],
      age: 17 + Math.floor(rng() * 4),
      developmentCurve: lateBloomer ? "late" : (potential - overall >= 14 ? "late" : "standard"),
      salary: Math.round((overall / 99) * 40 + 12) * 1000,
      overall, potential,
      gunny: attr(overall, h), awareness: attr(overall, h >> 3), objective: attr(overall, h >> 6), searchIQ: attr(overall, h >> 9),
      clutch: attr(overall, h >> 12), teamwork: attr(overall, h >> 15), composure: attr(overall, h >> 18), adaptability: attr(overall, h >> 21),
      ego: 1 + (h % 5), workEthic: 1 + ((h >> 3) % 5), tiltResistance: 1 + ((h >> 6) % 5), leadership: 1 + ((h >> 9) % 5), metaDependence: 1 + ((h >> 12) % 5),
      scoutedOverall: overall, scoutedPotential: potential, scouted: false, form: 65, experience: 0, isProspect: true, contractYears: 0,
      status: "challengers", debutEraId: era.id, rookieClassId: `${era.id}_rookies`,
      eraFitTraits: lateBloomer ? ["Late Bloomer"] : (potential >= 93 ? ["Generational Talent"] : []),
      dataStatus: "fictional",
    });
  }
  return rookies;
}

// Introduce the rookie class for an era exactly once. Historical eras use the
// curated class; fictional eras generate one procedurally. Guarded by
// introducedRookieClassIds so reloading never duplicates a class.
export function introduceHistoricalRookieClass(state, eraId) {
  const era = getEra(eraId);
  const classId = era.rookieClassId || `${era.id}_rookies`;
  if (!state || state.careerMode !== "historical" || !classId) return state;
  const introduced = new Set(state.introducedRookieClassIds || []);
  if (introduced.has(classId)) return state;
  const existingIds = new Set([...(state.players || []), ...(state.prospects || [])].map(p => p.id));
  const existingNames = new Set([...(state.players || []), ...(state.prospects || [])].map(p => String(p.name || "").toLowerCase()));
  let rookies;
  if (isFictionalEra(era)) {
    rookies = generateFictionalRookieClass(era, state.dynastySeed ?? 0, existingNames, 5);
  } else {
    rookies = (HISTORICAL_ROOKIE_CLASSES[era.id] || []).map(row => buildHistoricalProspect(row, era.id));
  }
  rookies = rookies.filter(p => !existingIds.has(p.id) && !existingNames.has(String(p.name).toLowerCase()));
  return {
    ...state,
    prospects: [...(state.prospects || []), ...rookies],
    introducedRookieClassIds: [...introduced, classId],
  };
}

export function createHistoricalStateFields(careerMode = "modern", options = {}) {
  const historical = careerMode === "historical";
  const era = getEra(historical ? HISTORICAL_START_ERA_ID : MODERN_ERA_ID);
  return {
    careerMode: historical ? "historical" : "modern",
    currentEraId: era.id,
    currentGameTitle: era.gameTitle,
    historicalStrictness: options.historicalStrictness || HISTORICAL_STRICTNESS.BALANCED,
    dynastySeed: Number.isFinite(options.dynastySeed) ? (options.dynastySeed >>> 0) : (Date.now() >>> 0),
    historicalSeasonIndex: 0,
    eraHistory: [],
    introducedRookieClassIds: [],
    generatedEras: [],
    pendingEraTransition: null,
  };
}

// Resolve the next era for a historical dynasty. Returns a static historical era
// while history remains, otherwise deterministically generates the next fictional
// season and records it in generatedEras (so it persists and re-registers on load).
function resolveNextEra(state, previousEra) {
  const staticNext = getNextEra(previousEra.id);
  if (staticNext) return { era: staticNext, generated: null };
  // End of history (or end of a fictional chain) → generate the future.
  const seasonIndex = (state.historicalSeasonIndex || 0) + 1;
  const future = generateFutureEra(previousEra, seasonIndex, state.dynastySeed ?? 0);
  registerGeneratedEras([future]);
  return { era: future, generated: future };
}

export function advanceHistoricalEraIfNeeded(state) {
  const migrated = migrateHistoricalDynastyState(state);
  if (migrated.careerMode !== "historical") return migrated;
  // Idempotency guard: the era index tracks the season number (index 0 = season
  // 1, index 1 = season 2, …). This function is invoked when a NEW season has
  // been built (season already incremented). Only advance when the season has
  // moved ahead of the era index. This makes the transition safe against the
  // offseason pipeline calling it more than once, and against reloads mid-
  // offseason — the era is never advanced twice for the same season.
  const season = migrated.season ?? migrated.schedule?.season ?? 1;
  if ((migrated.historicalSeasonIndex || 0) >= season - 1) return migrated;
  const previousEra = getEra(migrated.currentEraId);
  const { era: nextEra, generated } = resolveNextEra(migrated, previousEra);
  if (!nextEra) return migrated;
  const rosterSizeChange = (nextEra.rosterSize || 4) - (previousEra.rosterSize || 4);
  let next = {
    ...migrated,
    currentEraId: nextEra.id,
    currentGameTitle: nextEra.gameTitle,
    historicalSeasonIndex: (migrated.historicalSeasonIndex || 0) + 1,
    generatedEras: generated ? [...(migrated.generatedEras || []), generated] : (migrated.generatedEras || []),
    eraHistory: [...(migrated.eraHistory || []), {
      fromEraId: previousEra.id, toEraId: nextEra.id,
      season: migrated.season ?? migrated.schedule?.season ?? 1,
      previousTitle: previousEra.gameTitle, newTitle: nextEra.gameTitle,
      ecosystemFrom: previousEra.ecosystem, ecosystemTo: nextEra.ecosystem,
      dataStatus: nextEra.dataStatus,
    }],
    pendingEraTransition: {
      previousEraId: previousEra.id, newEraId: nextEra.id,
      previousTitle: previousEra.gameTitle, newTitle: nextEra.gameTitle,
      movementStyle: nextEra.movementStyle, modes: nextEra.modes,
      rookieClassId: nextEra.rookieClassId, rulesNote: nextEra.rulesNote,
      previousRosterSize: previousEra.rosterSize || 4, newRosterSize: nextEra.rosterSize || 4,
      rosterSizeChange,
      ecosystemFrom: previousEra.ecosystem, ecosystemTo: nextEra.ecosystem,
      ecosystemChanged: previousEra.ecosystem !== nextEra.ecosystem,
      championship: nextEra.championship,
      dataStatus: nextEra.dataStatus,
      seasonLabel: nextEra.seasonLabel,
    },
  };
  return introduceHistoricalRookieClass(next, nextEra.id);
}

// Convenience re-exports used by callers/tests.
export { LAST_HISTORICAL_ERA_ID };
