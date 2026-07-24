// src/data/prospects.js
// Builds the Challengers / prospect player pool from seeded real-player data.
// Additional simulation fields are generated deterministically from seed.

import { challengersPlayers } from "./challengersPlayers.js";
import { applyChallengerRatingOverride, CHALLENGER_RATING_OVERRIDES, normalizePlayerName } from "./challengerRatingOverrides.js";

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function ri(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function clamp(v, min = 41, max = 99) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

const ROLES = ["Entry SMG", "Slayer SMG", "Flex", "Main AR", "Objective", "Search Specialist"];

function derivePrimary(role, rng) {
  if (role === "SMG") return rng() < 0.6 ? "Entry SMG" : "Slayer SMG";
  if (role === "AR") return rng() < 0.7 ? "Main AR" : "Flex";
  return "Flex";
}

function deriveArchetype(role, age, rng) {
  if (role === "SMG") return age <= 20 ? "raw_upside" : (rng() < 0.5 ? "smg_heavy" : "risky_ego");
  if (role === "AR") return age <= 20 ? "raw_upside" : (rng() < 0.6 ? "ar_flex" : "polished");
  return "polished";
}

function buildProspect(seedRow, idx, rng, seed) {
  const age = typeof seedRow.age === "number" ? seedRow.age : null;
  const role = seedRow.role ?? null;
  const region = seedRow.region ?? null;

  const primary = derivePrimary(role, rng);
  const secondary = ROLES[Math.floor(rng() * ROLES.length)];
  const archetype = deriveArchetype(role, age ?? 22, rng);

  const ageValue = age ?? 22;
  const agePenalty = ageValue <= 19 ? ri(6, 14, rng) : ageValue === 20 ? ri(3, 9, rng) : ri(0, 5, rng);
  const roleBase = role === "SMG" ? ri(70, 82, rng) : role === "AR" ? ri(69, 81, rng) : ri(68, 80, rng);

  const overall = clamp(roleBase - agePenalty, 40, 99);
  const potential = clamp(overall + ri(5, 16, rng));

  const isSmg = primary === "Entry SMG" || primary === "Slayer SMG";
  const isSearch = primary === "Search Specialist";
  const isObj = primary === "Objective";

  const gunny = clamp(overall + (isSmg ? ri(2, 10, rng) : ri(-7, 4, rng)));
  const awareness = clamp(overall + (isSearch ? ri(4, 12, rng) : ri(-6, 6, rng)));
  const objective = clamp(overall + (isObj ? ri(4, 12, rng) : ri(-7, 5, rng)));
  const searchIQ = clamp(overall + (isSearch ? ri(6, 14, rng) : ri(-6, 6, rng)));
  const clutch = clamp(overall + ri(-8, 8, rng));
  const teamwork = clamp(overall + ri(-10, 10, rng));
  const composure = clamp(overall + ri(-10, 8, rng));
  const adaptability = clamp(overall + ri(-8, 10, rng));

  const ego = ri(1, 5, rng);
  const workEthic = ri(1, 5, rng);
  const tiltResistance = ri(1, 5, rng);
  const leadership = ri(1, 5, rng);
  const metaDependence = ri(1, 5, rng);

  const salary = Math.round((overall / 99) * 50 + 15) * 1000;
  const scoutedOverall = clamp(overall + ri(-8, 8, rng), 40, 99);
  const scoutedPotential = clamp(potential + ri(-6, 6, rng), 40, 99);

  const curvePick = rng();
  const developmentCurve = curvePick < 0.25 ? "early" : curvePick < 0.75 ? "standard" : "late";

  return applyChallengerRatingOverride({
    id: `prospect_${idx}_${seed}`,
    name: seedRow.name ?? null,
    age,
    role,
    region,
    teamId: null,
    primary,
    secondary,
    archetype,
    developmentCurve,
    salary,
    overall,
    potential,
    gunny,
    awareness,
    objective,
    searchIQ,
    clutch,
    teamwork,
    composure,
    adaptability,
    ego,
    workEthic,
    tiltResistance,
    leadership,
    metaDependence,
    scoutedOverall,
    scoutedPotential,
    scouted: false,
    form: 65,
    experience: 0,
    isProspect: true,
  });
}

export function generateProspects(seed = 42) {
  const rng = seededRng(seed);
  const generated = challengersPlayers.map((p, idx) => buildProspect(p, idx, rng, seed));
  const existing = new Set(generated.map(p => normalizePlayerName(p.name)));
  const missingRows = Object.values(CHALLENGER_RATING_OVERRIDES).filter(r => !existing.has(normalizePlayerName(r.displayName)));

  const inferred = missingRows.map((row, i) => {
    const h = [...normalizePlayerName(row.displayName)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) & 0xffff, 17);
    const age = 18 + (h % 5);
    const primary = h % 3 === 0 ? "Main AR" : h % 3 === 1 ? "Entry SMG" : "Flex";
    const secondary = primary === "Main AR" ? "Flex" : primary === "Entry SMG" ? "Slayer SMG" : "Main AR";
    const overall = clamp(row.overall, 41, 99);
    const potential = clamp(row.potential, 41, 99);
    const mkAttr = (bias = 0) => clamp(overall + bias + ((h % 7) - 3), 41, 99);
    return applyChallengerRatingOverride({
      id: `prospect_manual_${normalizePlayerName(row.displayName)}_${seed}_${i}`,
      name: row.displayName,
      age,
      role: null,
      region: "NA",
      teamId: null,
      primary,
      secondary,
      archetype: "polished",
      developmentCurve: potential - overall >= 10 ? "late" : "standard",
      salary: Math.round((overall / 99) * 50 + 15) * 1000,
      overall,
      potential,
      gunny: mkAttr(primary === "Entry SMG" ? 4 : 0),
      awareness: mkAttr(primary === "Main AR" ? 3 : 0),
      objective: mkAttr(primary === "Flex" ? 2 : 0),
      searchIQ: mkAttr(1),
      clutch: mkAttr(0),
      teamwork: mkAttr(1),
      composure: mkAttr(1),
      adaptability: mkAttr(0),
      ego: 1 + (h % 5),
      workEthic: 1 + ((h >> 1) % 5),
      tiltResistance: 1 + ((h >> 2) % 5),
      leadership: 1 + ((h >> 3) % 5),
      metaDependence: 1 + ((h >> 4) % 5),
      scoutedOverall: overall,
      scoutedPotential: potential,
      scouted: false,
      form: 65,
      experience: 0,
      isProspect: true,
      contractYears: 0,
    });
  });

  return [...generated, ...inferred];
}

// Modern CDL bootstrap reconciliation. Active pros always win identity conflicts;
// the pool keeps only unsigned Challenger candidates with distinct normalized names.
export function syncModernCdlChallengers(rawProspects, activePlayers, normalizeName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "")) {
  const existingNames = new Set((activePlayers || []).map(p => normalizeName(p.name)));
  const seen = new Set();
  return (rawProspects || []).filter((prospect) => {
    const key = normalizeName(prospect.name);
    if (!key || existingNames.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
