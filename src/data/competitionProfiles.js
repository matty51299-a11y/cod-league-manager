// src/data/competitionProfiles.js
// Data-driven competition-format configuration. Each COD title resolves to a
// SeasonCompetitionProfile describing its ecosystem, roster size, whether it
// uses Challengers / Pro Points / modern Majors, its event templates and its
// online-cup schedule. This centralises "what does a season look like" instead
// of scattering `if (season === "ghosts")` checks through UI and simulation.
//
// ECOSYSTEM TYPES:
//   OPEN_CIRCUIT      — Ghosts-era MLG/CWL open circuit (no Challengers division,
//                       Pro Points, many LANs + online cups, open brackets).
//   FRANCHISED_CDL    — modern CDL: four Majors + a separate Challengers system.
//
// Modern Major/CDL logic remains available (FRANCHISED_CDL) but is disabled for
// historical open-circuit seasons.

import { getEra, ECOSYSTEM } from "./codEras.js";

// ── Pro Point tables (per-player, first place = headline number) ──────────────
// All values are gameplay defaults and intentionally easy to edit here without
// touching tournament code.
export const POINT_TABLES = {
  ONLINE_2K: { 1: 2000, 2: 1200, 3: 800, 4: 800, 5: 400, 6: 400, 7: 400, 8: 400, 9: 200, 16: 200 },
  ONLINE_5K: { 1: 5000, 2: 3000, 3: 2000, 4: 2000, 5: 1000, 6: 1000, 7: 1000, 8: 1000, 9: 500, 16: 500 },
  LAN_A: { 1: 10000, 2: 7500, 3: 6000, 4: 5000, 5: 4000, 6: 4000, 7: 3000, 8: 3000, 9: 2000, 12: 2000, 13: 1000, 16: 1000, 32: 250 },
  LAN_B: { 1: 7500, 2: 5000, 3: 3500, 4: 3500, 5: 2000, 6: 2000, 7: 2000, 8: 2000, 9: 1000, 16: 1000 },
  WORLD: { 1: 15000, 2: 11000, 3: 8500, 4: 7000, 5: 5500, 6: 5500, 7: 5500, 8: 5500, 9: 3500, 16: 3500, 32: 1000 },
  LEAGUE: { 1: 8000, 2: 6000, 3: 4500, 4: 3500, 5: 2500, 6: 2500, 7: 1500, 8: 1500, 9: 800, 16: 800 },
};

// Resolve the per-player points for a final placement using a table whose keys
// are placement thresholds. A placement uses the value of the largest key <= it,
// so { 5:400, 9:200 } gives 400 for places 5–8 and 200 for 9+.
export function pointsForPlacement(tableId, placement) {
  const table = POINT_TABLES[tableId];
  if (!table || !Number.isFinite(placement) || placement < 1) return 0;
  const thresholds = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  let value = 0;
  for (const t of thresholds) {
    if (placement >= t) value = table[t];
  }
  return value;
}

// Prize money for a placement, derived from a total prize pool and a standard
// distribution curve so we don't hand-author money per event.
const PRIZE_CURVE = [0.4, 0.2, 0.12, 0.08, 0.05, 0.05, 0.03, 0.02];
export function prizeForPlacement(prizePool, placement, fieldSize = 16) {
  if (!prizePool || !Number.isFinite(placement) || placement < 1) return 0;
  if (placement <= PRIZE_CURVE.length) return Math.round(prizePool * PRIZE_CURVE[placement - 1]);
  // Small participation share for the rest of the field.
  const remaining = 1 - PRIZE_CURVE.reduce((a, b) => a + b, 0);
  const rest = Math.max(1, fieldSize - PRIZE_CURVE.length);
  return Math.round((prizePool * remaining) / rest);
}

// ── Ghosts (2013/14) event catalogue ──────────────────────────────────────────
// Metadata targets (dates, locations, field sizes, prize pools). The active
// career field is dynamically reduced when fewer eligible teams exist. Point
// tables reference POINT_TABLES by id. Regions: NA / EU / ANZ / GLOBAL.
export const GHOSTS_EVENT_CATALOGUE = [
  // ── S-tier / primary ──
  { id: "mlg_league_s1", name: "MLG CoD League 2014 — Season 1", eventType: "LEAGUE_SEASON", tier: "S", startDate: "2014-02-17", endDate: "2014-04-13", targetFieldSize: 10, prizePool: 13000, regionEligibility: ["NA"], qualificationMode: "LEAGUE_STANDINGS", proPointTableId: "LEAGUE", weeks: 8, playoffSize: 4 },
  { id: "cod_champs_2014", name: "Call of Duty Championship 2014", eventType: "WORLD_CHAMPIONSHIP", tier: "S", startDate: "2014-03-28", endDate: "2014-03-30", location: "Los Angeles", targetFieldSize: 32, prizePool: 1000000, regionEligibility: ["GLOBAL"], qualificationMode: "PRO_POINTS", proPointTableId: "WORLD", poolSize: 4, playoffSize: 16, bracketType: "DOUBLE_ELIMINATION" },
  { id: "mlg_league_s2", name: "MLG CoD League 2014 — Season 2", eventType: "LEAGUE_SEASON", tier: "S", startDate: "2014-04-19", endDate: "2014-06-22", location: "Anaheim", targetFieldSize: 15, prizePool: 70000, regionEligibility: ["NA"], qualificationMode: "LEAGUE_STANDINGS", proPointTableId: "LEAGUE", weeks: 9, playoffSize: 8 },
  { id: "mlg_league_s3", name: "MLG CoD League 2014 — Season 3", eventType: "LEAGUE_SEASON", tier: "S", startDate: "2014-07-14", endDate: "2014-10-26", location: "Columbus", targetFieldSize: 15, prizePool: 75000, regionEligibility: ["NA"], qualificationMode: "LEAGUE_STANDINGS", proPointTableId: "LEAGUE", weeks: 10, playoffSize: 8 },

  // ── A-tier / major LAN ──
  { id: "mlg_fall_champ_2013", name: "MLG Fall Championship 2013", eventType: "OPEN_LAN", tier: "A", startDate: "2013-11-22", endDate: "2013-11-24", location: "Columbus", targetFieldSize: 32, prizePool: 50000, regionEligibility: ["NA"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_A", directPoolInviteCount: 12, poolSize: 4, playoffSize: 16, bracketType: "DOUBLE_ELIMINATION" },
  { id: "umg_philadelphia_2014", name: "UMG Philadelphia 2014", eventType: "OPEN_LAN", tier: "A", startDate: "2014-01-03", endDate: "2014-01-05", location: "Philadelphia", targetFieldSize: 16, prizePool: 20000, regionEligibility: ["NA"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_A", directPoolInviteCount: 8, poolSize: 4, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "cod_anz_champ_2014", name: "Call of Duty ANZ Championship 2014", eventType: "REGIONAL_CHAMPIONSHIP", tier: "A", startDate: "2014-03-01", endDate: "2014-03-01", location: "New South Wales", targetFieldSize: 8, prizePool: 15000, regionEligibility: ["ANZ"], qualificationMode: "REGIONAL_QUALIFIER", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "cod_euro_champ_2014", name: "Call of Duty European Championship 2014", eventType: "REGIONAL_CHAMPIONSHIP", tier: "A", startDate: "2014-03-02", endDate: "2014-03-02", location: "London", targetFieldSize: 13, prizePool: 20561, regionEligibility: ["EU"], qualificationMode: "REGIONAL_QUALIFIER", proPointTableId: "LAN_B", poolSize: 4, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "lvp_final_cup_s6", name: "LVP Final Cup Season 6", eventType: "OPEN_LAN", tier: "A", startDate: "2014-06-27", endDate: "2014-06-28", location: "Madrid", targetFieldSize: 8, prizePool: 10919, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "gfinity_g3", name: "Gfinity G3", eventType: "OPEN_LAN", tier: "A", startDate: "2014-08-02", endDate: "2014-08-03", location: "London", targetFieldSize: 12, prizePool: 55000, regionEligibility: ["GLOBAL"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_A", poolSize: 4, poolCount: 3, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "umg_dallas_2014", name: "UMG Dallas 2014", eventType: "OPEN_LAN", tier: "A", startDate: "2014-08-22", endDate: "2014-08-24", location: "Dallas", targetFieldSize: 16, prizePool: 20000, regionEligibility: ["NA"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_A", directPoolInviteCount: 8, poolSize: 4, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "insomnia52", name: "Insomnia52", eventType: "OPEN_LAN", tier: "A", startDate: "2014-08-22", endDate: "2014-08-23", location: "Coventry", targetFieldSize: 8, prizePool: 4975, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "umg_nashville_2014", name: "UMG Nashville 2014", eventType: "OPEN_LAN", tier: "A", startDate: "2014-10-10", endDate: "2014-10-12", location: "Nashville", targetFieldSize: 16, prizePool: 25000, regionEligibility: ["NA"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_A", directPoolInviteCount: 8, poolSize: 4, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "eswc_2014", name: "ESWC 2014", eventType: "OPEN_LAN", tier: "A", startDate: "2014-10-29", endDate: "2014-11-02", location: "Paris", targetFieldSize: 16, prizePool: 25000, regionEligibility: ["GLOBAL"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_A", directPoolInviteCount: 8, poolSize: 4, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },

  // ── B-tier / regional, open & invitational ──
  { id: "astro_ghosts_cup", name: "Astro CoD: Ghosts Cup", eventType: "OPEN_LAN", tier: "B", startDate: "2013-08-23", endDate: "2013-08-25", location: "Telford", targetFieldSize: 21, prizePool: 3120, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "mlg_winter_invitational", name: "MLG Winter Invitational", eventType: "INVITATIONAL", tier: "B", startDate: "2014-01-20", endDate: "2014-02-07", targetFieldSize: 18, prizePool: 5000, regionEligibility: ["NA"], qualificationMode: "INVITATION", proPointTableId: "LAN_B", poolSize: 4, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "insomnia51", name: "Insomnia51", eventType: "OPEN_LAN", tier: "B", startDate: "2014-04-18", endDate: "2014-04-20", location: "Telford", targetFieldSize: 8, prizePool: 8395, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "gamers_assembly_2014", name: "Gamers Assembly 2014 Ghosts", eventType: "INVITATIONAL", tier: "B", startDate: "2014-04-19", endDate: "2014-04-21", location: "Poitiers", targetFieldSize: 4, prizePool: 6908, regionEligibility: ["EU"], qualificationMode: "INVITATION", proPointTableId: "LAN_B", playoffSize: 4, bracketType: "DOUBLE_ELIMINATION" },
  { id: "ugc_niagara_2014", name: "UGC Niagara 2014", eventType: "OPEN_LAN", tier: "B", startDate: "2014-05-02", endDate: "2014-05-04", location: "Ontario", targetFieldSize: 32, prizePool: 20000, regionEligibility: ["NA"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_A", directPoolInviteCount: 12, poolSize: 4, playoffSize: 16, bracketType: "DOUBLE_ELIMINATION" },
  { id: "egl12_sheffield", name: "European Gaming League 12: Sheffield", eventType: "OPEN_LAN", tier: "B", startDate: "2014-05-03", endDate: "2014-05-04", location: "Sheffield", targetFieldSize: 8, prizePool: 10983, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "mlg_xgames_austin", name: "MLG X Games Austin Invitational", eventType: "INVITATIONAL", tier: "B", startDate: "2014-06-06", endDate: "2014-06-08", location: "Austin", targetFieldSize: 8, prizePool: 12000, regionEligibility: ["NA"], qualificationMode: "INVITATION", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "reflex_gt12", name: "Reflex GT 12", eventType: "OPEN_LAN", tier: "B", startDate: "2014-06-14", endDate: "2014-06-15", location: "Weesp", targetFieldSize: 16, prizePool: 2169, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", poolSize: 4, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "lvp_dh_s6", name: "LVP División de Honor Season 6", eventType: "LEAGUE_SEASON", tier: "B", startDate: "2014-01-16", endDate: "2014-06-15", location: "Spain", targetFieldSize: 12, prizePool: 8000, regionEligibility: ["EU"], qualificationMode: "LEAGUE_STANDINGS", proPointTableId: "LEAGUE", weeks: 8, playoffSize: 4 },
  { id: "lvp_euromasters_2014", name: "LVP EuroMasters Cup 2014", eventType: "INVITATIONAL", tier: "B", startDate: "2014-06-29", endDate: "2014-06-29", location: "Madrid", targetFieldSize: 4, prizePool: 5445, regionEligibility: ["EU"], qualificationMode: "INVITATION", proPointTableId: "LAN_B", playoffSize: 4, bracketType: "DOUBLE_ELIMINATION" },
  { id: "egl13_blackpool", name: "European Gaming League 13: Blackpool", eventType: "OPEN_LAN", tier: "B", startDate: "2014-07-26", endDate: "2014-07-27", location: "Blackpool", targetFieldSize: 8, prizePool: 8497, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },
  { id: "gfinity_pro_league_s1", name: "Gfinity Pro League Season 1", eventType: "LEAGUE_SEASON", tier: "B", startDate: "2014-06-01", endDate: "2014-08-03", location: "Europe", targetFieldSize: 8, prizePool: 12000, regionEligibility: ["EU"], qualificationMode: "LEAGUE_STANDINGS", proPointTableId: "LEAGUE", weeks: 7, playoffSize: 4 },
  { id: "egl_star_series", name: "European Gaming League: Star Series", eventType: "OPEN_LAN", tier: "B", startDate: "2014-10-06", endDate: "2014-10-06", location: "Europe", targetFieldSize: 8, prizePool: 3754, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", playoffSize: 8, bracketType: "DOUBLE_ELIMINATION" },

  // ── Optional throwback (after the Ghosts title year) ──
  { id: "gfinity_london_open_2015", name: "Gfinity London Open (Ghosts Throwback)", eventType: "THROWBACK_EVENT", tier: "B", startDate: "2015-04-04", endDate: "2015-04-05", location: "London", targetFieldSize: 28, prizePool: 14831, regionEligibility: ["EU"], qualificationMode: "OPEN_ENTRY", proPointTableId: "LAN_B", poolSize: 4, playoffSize: 8, bracketType: "DOUBLE_ELIMINATION", throwback: true },
];

// ── Online 2K/5K cup schedule config ──────────────────────────────────────────
// Cups are generated deterministically (see engine/openCircuit/calendar.js) so
// save reloads never move them. A 2K/5K cup awards its point table to each
// player on the winning locked roster.
export const GHOSTS_ONLINE_CUP_SCHEDULE = {
  // 2K cups roughly every other week across the active window.
  online2k: { proPointTableId: "ONLINE_2K", intervalDays: 14, fieldSize: 16, regionEligibility: ["NA"], label: "Online 2K" },
  // 5K cups less frequent, timed before big LAN qualification windows.
  online5k: { proPointTableId: "ONLINE_5K", intervalDays: 35, fieldSize: 16, regionEligibility: ["NA"], label: "Online 5K" },
  windowStart: "2013-11-01",
  windowEnd: "2014-10-20",
};

// Map codEras ecosystem → competition ecosystem type. MLG/CWL are open-circuit;
// CDL/future are franchised.
export function ecosystemTypeForEra(era) {
  const eco = era?.ecosystem;
  if (eco === ECOSYSTEM.MLG || eco === ECOSYSTEM.CWL) return "OPEN_CIRCUIT";
  return "FRANCHISED_CDL";
}

// Build the full competition profile for an era id. This is the single source of
// truth the UI and simulation read for a season's format.
export function buildCompetitionProfile(eraId) {
  const era = getEra(eraId);
  const ecosystemType = ecosystemTypeForEra(era);
  const isOpen = ecosystemType === "OPEN_CIRCUIT";
  // Only Ghosts ships a curated event catalogue today. Other open-circuit eras
  // inherit the Ghosts-style structure (catalogue can be added per era later).
  const eventTemplates = eraId === "ghosts" ? GHOSTS_EVENT_CATALOGUE : (isOpen ? GHOSTS_EVENT_CATALOGUE : []);
  return {
    seasonId: era.id,
    gameTitle: era.gameTitle,
    ecosystemType,
    rosterSize: era.rosterSize || 4,
    usesChallengers: !isOpen, // no separate Challengers division in the open era
    usesProPoints: isOpen,
    usesModernMajors: !isOpen,
    eventTemplates,
    onlineCupSchedule: isOpen ? GHOSTS_ONLINE_CUP_SCHEDULE : null,
  };
}

export function profileUsesOpenCircuit(profile) {
  return profile?.ecosystemType === "OPEN_CIRCUIT";
}
