// src/data/prospects.js
// Builds the Challengers / prospect player pool from seeded real-player data.
// Additional simulation fields are generated deterministically from seed.

import { challengersPlayers } from "./challengersPlayers.js";

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

  return {
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
  };
}

export function generateProspects(seed = 42) {
  const rng = seededRng(seed);
  return challengersPlayers.map((p, idx) => buildProspect(p, idx, rng, seed));
}
