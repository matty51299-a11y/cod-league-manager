// src/engine/seasonEngine.js
// Drives the CDL season structure:
//   Stage 1 → Major 1 → Stage 2 → Major 2 → Stage 3 → Major 3 →
//   Stage 4 → Major 4 → Pre-Champs Window → Champs → Offseason
//
// schedule.stageIdx  — index into stages[] (0–3), meaningful during phase "stage"
// schedule.majorIdx  — index into majors[] (0–4), meaningful during phase "major"
// schedule.standings      — cumulative season W/L/pts (never reset mid-season)
// schedule.stageStandings — per-stage W/L/pts; snapshot kept during active Major,
//                           reset when transitioning Major → next Stage
//
// Regular Majors (1–4) seeded by stageStandings.points
// Champs seeded by standings.points (cumulative season total)

import { simMatch } from "./matchSim.js";
import { getTeamMapProfile, buildTeamMapProfile } from "./mapProfile.js";
import { CDL_TEAMS } from "../data/teams.js";
import omitBrooklynLogo from "../assets/logos/challengers/omit-brooklyn.png";
import omitNoirLogo from "../assets/logos/challengers/Omit_Noir_logo.png";
import projectNotoriousLogo from "../assets/logos/challengers/Project_Notorious_lightmode.png";
import deathByCabalLogo from "../assets/logos/challengers/DeathByCabal_logo.png";
import huntsmenLogo from "../assets/logos/challengers/Huntsmen.png";
import stallionsLogo from "../assets/logos/challengers/Stallionslogo.png";
import tellurideBushLogo from "../assets/logos/challengers/Telluride_Bush_Gaming_lightmode.png";
import fiveFearsLogo from "../assets/logos/challengers/FiveFears_logo.png";
import fazeFalconsLogo from "../assets/logos/challengers/FazeFalconslogo.png";
import forFunEsportsLogo from "../assets/logos/challengers/ForFunEsports.png";
import { placementText, qualifierPlacementLabel } from "../utils/placementDisplay.js";
import { archiveCompletedSeason } from "../utils/seasonArchive.js";
import { calculateSeasonAwards, mergeSeasonAwards } from "../utils/seasonAwards.js";
import { advanceHistoricalEraIfNeeded } from "./historicalDynasty.js";
import { getEra } from "../data/codEras.js";

const CHALLENGER_QUALIFIER_TEAMS = 4;
const CHALLENGERS_FINALS_TEAMS = 16;
const CHALLENGERS_FINALS_ESWC_SPOTS = 4;
const ESWC_MAJOR_IDX = 5;
const CHALLENGER_REGIONS = {
  omit_brooklyn: "NA", omit_noir: "NA", project_notorious: "NA", project_7: "EU",
  death_by_cabal: "EU", huntsmen: "NA", stallions: "NA", telluride_bush: "NA",
  next_threat_black: "NA", stallions_x_bush: "NA", omnia_ggs: "EU", five_fears: "EU",
  faze_falcons: "MENA", for_fun_esports: "EU", high_treason: "NA", for_fun_black: "EU",
  // New teams (Season 2 expansion)
  carolina_reapers: "NA", torn_esports: "NA", confide_esports: "NA",
  falcons_academy_white: "MENA", death_penalty: "NA", treaty1_gaming: "EU",
  dark_horse_esports: "NA", belfast_storm: "EU",
};
const CHALLENGER_TEAM_POOL = [
  { id: "omit_brooklyn", name: "Omit Brooklyn", tag: "OBK", color: "#c084fc", logo: omitBrooklynLogo },
  { id: "omit_noir", name: "Omit Noir", tag: "ONR", color: "#a78bfa", logo: omitNoirLogo },
  { id: "project_notorious", name: "Project Notorious", tag: "PNT", color: "#8b5cf6", logo: projectNotoriousLogo },
  { id: "project_7", name: "Project 7", tag: "P7", color: "#7c3aed" },
  { id: "death_by_cabal", name: "Death by Cabal", tag: "DBC", color: "#9333ea", logo: deathByCabalLogo },
  { id: "huntsmen", name: "Huntsmen", tag: "HNT", color: "#f43f5e", logo: huntsmenLogo },
  { id: "stallions", name: "Stallions", tag: "STL", color: "#fb7185", logo: stallionsLogo },
  { id: "telluride_bush", name: "Telluride Bush", tag: "TB", color: "#22c55e", logo: tellurideBushLogo },
  { id: "next_threat_black", name: "Next Threat Black", tag: "NTB", color: "#0ea5e9" },
  { id: "stallions_x_bush", name: "Stallions x Bush", tag: "SXB", color: "#14b8a6" },
  { id: "omnia_ggs", name: "Omnia GGs", tag: "OMG", color: "#06b6d4" },
  { id: "five_fears", name: "Five Fears", tag: "5FR", color: "#f59e0b", logo: fiveFearsLogo },
  { id: "faze_falcons", name: "Faze Falcons", tag: "FF", color: "#ef4444", logo: fazeFalconsLogo },
  { id: "for_fun_esports", name: "For Fun Esports", tag: "FFE", color: "#38bdf8", logo: forFunEsportsLogo },
  { id: "high_treason", name: "High Treason", tag: "HT", color: "#7f1d1d" },
  { id: "for_fun_black", name: "For Fun Black", tag: "FFB", color: "#334155" },
  // 8 new teams expanding to 24
  { id: "carolina_reapers", name: "Carolina Reapers", tag: "CAR", color: "#dc2626" },
  { id: "torn_esports", name: "Torn Esports", tag: "TORN", color: "#f97316" },
  { id: "confide_esports", name: "Confide Esports", tag: "CNFD", color: "#0891b2" },
  { id: "falcons_academy_white", name: "Falcons Academy White", tag: "FAW", color: "#65a30d" },
  { id: "death_penalty", name: "Death Penalty", tag: "DP", color: "#1e1e2e" },
  { id: "treaty1_gaming", name: "Treaty1 Gaming", tag: "T1G", color: "#7e22ce" },
  { id: "dark_horse_esports", name: "Dark Horse Esports", tag: "DH", color: "#374151" },
  { id: "belfast_storm", name: "Belfast Storm", tag: "BFS", color: "#1d4ed8" },
];
import { runProgression } from "./progression.js";
import { runAIMajorRosterWindow, runAIOffseasonRosterWindow, runAIFreeAgencyMarket, getResignDemand, getSigningCost, getTeamCap, ensureCdlRosterIntegrity } from "./rosterAI.js";
import { buildCdlRosterNameSet, isCdlTeamId, isInactivePlayer, normalizePlayerName, shouldExcludeFromChallengers } from "../utils/playerIdentity.js";

// ── PRNG / helpers ────────────────────────────────────────────────────────────
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildRoundRobin(teamIds) {
  const pairs = [];
  for (let i = 0; i < teamIds.length; i++)
    for (let j = i + 1; j < teamIds.length; j++)
      pairs.push([teamIds[i], teamIds[j]]);
  return pairs;
}

function withCdlRosterIntegrity(gameState, windowType) {
  return ensureCdlRosterIntegrity(gameState, { windowType });
}

// In Challenger manager mode the user's own Challenger team is hand-managed:
// it must NOT be silently auto-filled, poached from, or cannibalized by the
// repair/fill passes. Returns the protected team id, or null in CDL mode.
function userChallengerTeamId(gameState) {
  return gameState?.userTeamType === "challenger" ? gameState.userTeamId : null;
}

function standingsRank(standings, teamId) {
  const sorted = Object.entries(standings || {}).sort((a, b) => (b[1]?.points || 0) - (a[1]?.points || 0));
  const idx = sorted.findIndex(([id]) => id === teamId);
  return idx >= 0 ? idx + 1 : 8;
}

function shouldAIRenewExpiringPlayer(player, allPlayers, gameState, outgoingSeason) {
  const teamId = player.teamId;
  if (!teamId) return false;
  const demand = getResignDemand(player, 1, gameState.playerSeasonStats, outgoingSeason);
  const starters = (allPlayers || []).filter(p => p.teamId === teamId && !p.isSub && !isInactivePlayer(p));
  const committedWithoutPlayer = starters
    .filter(p => p.id !== player.id)
    .reduce((sum, p) => sum + (p.salary ?? getSigningCost(p)), 0);
  const capPressure = Math.max(0, committedWithoutPlayer + demand - getTeamCap(teamId));
  const rank = standingsRank(gameState.schedule?.standings, teamId);
  const seed = hashString(`${outgoingSeason}_${teamId}_${player.id}_ai_contract`);
  const rng = seededRng(seed);
  const ovr = player.overall ?? 70;
  const pot = player.potential ?? ovr;
  const age = player.age ?? 24;
  let score = 48;
  score += (ovr - 78) * 2.8;
  score += Math.max(-6, Math.min(12, pot - ovr));
  score -= Math.max(0, age - 28) * 4.5;
  score += rank <= 4 ? 8 : rank >= 10 ? -5 : 0;
  score -= player.isSub ? 18 : 0;
  score -= Math.min(24, capPressure / 20000);
  score += rng() * 34;

  // Keep franchise-level players most of the time, but do not make them
  // impossible to hit the market when age/cap pressure is ugly.
  if (ovr >= 90 && age <= 29 && capPressure <= 75000) score += 12;
  return score >= 68;
}

// Deterministic seed for a specific major match (no seed collisions)
function majorSeed(season, majorIdx, roundIdx, matchIdx) {
  return season * 1_000_000 + majorIdx * 100_000 + (roundIdx + 1) * 10_000 + (matchIdx + 1) * 100 + 7;
}

function challengerQualifierSeed(season, majorIdx, roundIdx, matchIdx, matchNumber = 0) {
  return season * 2_000_000 + (majorIdx + 1) * 200_000 + (roundIdx + 1) * 2_000 + (matchIdx + 1) * 37 + matchNumber * 17 + 97;
}

// ── Initial standings ─────────────────────────────────────────────────────────
export function initStandings(teamIds) {
  return Object.fromEntries(teamIds.map(id => [id, { wins: 0, losses: 0, points: 0 }]));
}

// ── Build season schedule ─────────────────────────────────────────────────────
export const MAJOR_PLACEMENT_POINTS = {
  1: 100,
  2: 75,
  3: 60,
  4: 45,
  5: 30,
  6: 30,
  7: 15,
  8: 15,
  9: 0,
  10: 0,
  11: 0,
  12: 0,
};

export function computeDE16Placements(bracket) {
  if (!bracket?.rounds?.length) return {};
  const placements = {};
  const claimed = new Set();
  const place = (teamId, p) => {
    if (!teamId || claimed.has(teamId)) return;
    placements[teamId] = p;
    claimed.add(teamId);
  };

  // Anchor top 4 explicitly from bracket structure. The bug we're fixing:
  // when the LB Final winner wins the Grand Final, the WB Champion only ever
  // accrues a single loss, so they never entered the generic "2-losses-elim"
  // list and 2nd place was being skipped.
  const gfRound = bracket.rounds.find(r => r.type === "GF") ?? bracket.rounds[bracket.rounds.length - 1];
  const gfMatch = gfRound?.matches?.[0];
  if (gfMatch?.played && gfMatch.result) {
    place(gfMatch.result.winnerId, 1);
    place(gfMatch.result.loserId, 2);
  } else if (bracket.champion) {
    place(bracket.champion, 1);
  }

  const lbFinalRound = bracket.rounds.find(r => r.name === "LB Final");
  const lbFinalMatch = lbFinalRound?.matches?.[0];
  if (lbFinalMatch?.played && lbFinalMatch.result) place(lbFinalMatch.result.loserId, 3);

  const lbR5Round = bracket.rounds.find(r => r.name === "LB Round 5");
  const lbR5Match = lbR5Round?.matches?.[0];
  if (lbR5Match?.played && lbR5Match.result) place(lbR5Match.result.loserId, 4);

  // 5–6: LB Round 4 losers; 7–8: LB Round 3 losers; 9–12: LB Round 2 losers; 13–16: LB Round 1 losers
  const bucketize = (roundName, places) => {
    const round = bracket.rounds.find(r => r.name === roundName);
    const losers = (round?.matches ?? [])
      .filter(m => m.played && m.result?.loserId)
      .map(m => m.result.loserId);
    losers.forEach((id, i) => place(id, places[Math.min(i, places.length - 1)]));
  };
  bucketize("LB Round 4", [5, 6]);
  bucketize("LB Round 3", [7, 8]);
  bucketize("LB Round 2", [9, 10, 11, 12]);
  bucketize("LB Round 1", [13, 14, 15, 16]);

  return placements;
}

function awardMajorPlacementPoints(schedule, majorIdx) {
  if (majorIdx < 0 || majorIdx > 3) return;
  const major = schedule.majors?.[majorIdx];
  const bracket = major?.bracket;
  if (!major?.completed || bracket?.type !== "DE16" || major.pointsAwarded) return;

  const placements = computeDE16Placements(bracket);
  const cdlIds = new Set(CDL_TEAMS.map(t => t.id));
  const awards = [];

  for (const [teamId, place] of Object.entries(placements)) {
    if (!cdlIds.has(teamId)) continue;
    const pts = MAJOR_PLACEMENT_POINTS[place] ?? 0;
    if (!schedule.standings?.[teamId]) continue;
    schedule.standings[teamId].points += pts;
    awards.push({ teamId, place, points: pts });
  }

  major.pointsAwards = awards.sort((a, b) => a.place - b.place);
  major.pointsAwarded = true;
}

export function buildSeason(season) {
  const teamIds = CDL_TEAMS.map(t => t.id);
  const rng = seededRng(season * 9999 + 1);
  const mkStage = name => ({
    name,
    matches: shuffle(buildRoundRobin(teamIds), rng)
      .map(([a, b]) => ({ a, b, played: false, result: null })),
  });

  return {
    season,
    stages: [
      mkStage("Stage 1"),
      mkStage("Stage 2"),
      mkStage("Stage 3"),
      mkStage("Stage 4"),
    ],
    majors: [
      { name: "Major 1", bracket: null, completed: false },
      { name: "Major 2", bracket: null, completed: false },
      { name: "Major 3", bracket: null, completed: false },
      { name: "Major 4", bracket: null, completed: false },
      { name: "Champs",  bracket: null, completed: false },
      { name: "ESWC",    bracket: null, completed: false, eventType: "eswc", pointsAwarded: true },
    ],
    standings:      initStandings(teamIds),  // cumulative season W/L/pts
    stageStandings: initStandings(teamIds),  // per-stage; kept as bracket snapshot, reset on Major→Stage
    stageIdx:        0,     // current stage index (0–3)
    majorIdx:        null,  // current major index; null when not in major phase
    phase:           "stage",  // "stage" | "challengerQualifier" | "major" | "preChamps" | "offseason"
    currentMatchday: 0,
    matchLog:        [],
    challengerQualifierResults: [],
    currentChallengerQualifier: null,
    currentMajorEventTeams: null,
  };
}

// ── Build major bracket ───────────────────────────────────────────────────────
// Accepts any standings object with { [teamId]: { points, ... } }.
// Regular Majors pass stageStandings; Champs passes cumulative standings.
// userTeamId: if provided, user's QF match is moved to first so "Play Match" always triggers.
function buildMajorBracket(standings, userTeamId) {
  const sorted = Object.entries(standings)
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 8)
    .map(([id]) => id);

  const matches = [
    { a: sorted[0], b: sorted[7], seedA: 1, seedB: 8, played: false, result: null },
    { a: sorted[1], b: sorted[6], seedA: 2, seedB: 7, played: false, result: null },
    { a: sorted[2], b: sorted[5], seedA: 3, seedB: 6, played: false, result: null },
    { a: sorted[3], b: sorted[4], seedA: 4, seedB: 5, played: false, result: null },
  ];

  // Move user's match to the front so their "Play Match" is always the next to sim
  if (userTeamId) {
    const userIdx = matches.findIndex(m => m.a === userTeamId || m.b === userTeamId);
    if (userIdx > 0) {
      const [userMatch] = matches.splice(userIdx, 1);
      matches.unshift(userMatch);
    }
  }

  return {
    seeds: sorted,
    rounds: [
      { name: "Quarterfinals", matches },
      { name: "Semifinals",    matches: [] },
      { name: "Grand Final",   matches: [] },
    ],
    completed: false,
    champion:  null,
  };
}


export function buildMajorBracketDE16(majorSeeds) {
  const s = majorSeeds;
  const wbR1Matches = [
    { a: s[0], b: s[15], seedA: 1, seedB: 16, played: false, result: null },
    { a: s[7], b: s[8],  seedA: 8, seedB: 9,  played: false, result: null },
    { a: s[3], b: s[12], seedA: 4, seedB: 13, played: false, result: null },
    { a: s[4], b: s[11], seedA: 5, seedB: 12, played: false, result: null },
    { a: s[1], b: s[14], seedA: 2, seedB: 15, played: false, result: null },
    { a: s[6], b: s[9],  seedA: 7, seedB: 10, played: false, result: null },
    { a: s[2], b: s[13], seedA: 3, seedB: 14, played: false, result: null },
    { a: s[5], b: s[10], seedA: 6, seedB: 11, played: false, result: null },
  ];
  return {
    seeds: majorSeeds,
    type: "DE16",
    rounds: [
      { name: "WB Round 1", type: "WB", matches: wbR1Matches },
      { name: "LB Round 1", type: "LB", matches: [] },
      { name: "WB Round 2", type: "WB", matches: [] },
      { name: "LB Round 2", type: "LB", matches: [] },
      { name: "LB Round 3", type: "LB", matches: [] },
      { name: "WB Semifinals", type: "WB", matches: [] },
      { name: "LB Round 4", type: "LB", matches: [] },
      { name: "WB Final", type: "WB", matches: [] },
      { name: "LB Round 5", type: "LB", matches: [] },
      { name: "LB Final", type: "LB", matches: [] },
      { name: "Grand Final", type: "GF", matches: [] },
    ],
    completed: false,
    champion: null,
    _wbChampion: null,
    _wbFLoser: null,
    _lbr3Winners: null,
  };
}

const CHALLENGER_QUALIFIER_POINTS = {
  1: 25,
  2: 20,
  3: 15,
  4: 10,
  5: 5,
  6: 5,
  7: 5,
  8: 5,
};

function challengerPointsForPlacement(placement) {
  return CHALLENGER_QUALIFIER_POINTS[placement] ?? 0;
}

function challengerFinalsPointsForPlacement(placement) {
  const base = challengerPointsForPlacement(placement);
  if (placement === 1) return 40;
  if (placement === 2) return 30;
  if (placement === 3) return 24;
  if (placement === 4) return 18;
  return base;
}

function getChallengerRoster(team, gameState, cdlNames = buildCdlRosterNameSet(gameState.players || [])) {
  return (team?.playerIds || [])
    .map(pid => gameState.prospects.find(p => p.id === pid) || gameState.players.find(p => p.id === pid))
    .filter(p => p && !isInactivePlayer(p) && !cdlNames.has(normalizePlayerName(p.name)));
}

function calcChallengerTeamOvr(team, gameState, cdlNames) {
  const roster = getChallengerRoster(team, gameState, cdlNames);
  const ovr = Math.round(roster.reduce((s, p) => s + (p.overall ?? 65), 0) / Math.max(1, roster.length));
  return { roster, ovr };
}


function buildChallengerQualifierField(gameState, schedule) {
  // Repair every Challenger team to 4 real players before the field is seeded so
  // captured rosterIds carry real players (not "Sub N" placeholders) into the
  // qualifier / Challengers Finals / ESWC that read from this field.
  repairChallengerRosters(gameState);
  const rng = seededRng(schedule.season * 8191 + ((schedule.majorIdx ?? schedule.stageIdx ?? 0) + 1) * 131 + 23);
  const cdlNames = buildCdlRosterNameSet(gameState.players || []);
  const rows = (gameState.challengerTeams || []).map((team) => {
    const { roster, ovr } = calcChallengerTeamOvr(team, gameState, cdlNames);
    const prevPlacement = team.lastQualifierPlacement ?? 9;
    const prevBonus = Math.max(0, 9 - prevPlacement) * 1.25;
    const seedScore = (team.circuitPoints ?? 0)
      + (ovr - 65) * 1.35
      + (team.form ?? 0) * 2.2
      + prevBonus
      + (rng() * 4 - 2);
    return {
      seed: 0,
      teamId: team.id,
      teamName: team.name,
      tag: team.tag,
      color: team.color,
      logo: team.logo,
      region: team.region ?? CHALLENGER_REGIONS[team.id] ?? "NA",
      teamOvr: ovr,
      rosterIds: roster.map(p => p.id),
      circuitPointsBefore: team.circuitPoints ?? 0,
      formBefore: team.form ?? 0,
      previousQualifierPlacement: team.lastQualifierPlacement ?? null,
      seedScore: Number(seedScore.toFixed(2)),
    };
  }).sort((a, b) => b.seedScore - a.seedScore);

  return rows.map((row, idx) => ({ ...row, seed: idx + 1 }));
}

function getExistingQualifierForMajor(schedule, majorIdx = schedule?.majorIdx, source = "visibleQualifier") {
  return (schedule?.challengerQualifierResults || []).find(r =>
    r?.season === schedule?.season &&
    r?.majorIdx === majorIdx &&
    r?.source === source
  );
}

// Build a true 24-team double-elimination qualifier bracket. Seeds 1–8
// receive byes into WB Round 2; seeds 9–24 play WB Round 1. Crucially,
// WB Round 1 losers drop to LB Round 1 after WB Round 2 is played — nobody
// is eliminated until their second loss.
function buildChallengerBracketDE24(seeds) {
  const wbR1Matches = [];
  for (let i = 0; i < 8; i++) {
    const hiIdx = 8 + i;       // seeds 9–16 (indices 8–15)
    const loIdx = 23 - i;      // seeds 24–17 (indices 23–16)
    wbR1Matches.push({ a: seeds[hiIdx], b: seeds[loIdx], seedA: 9 + i, seedB: 24 - i, played: false, result: null });
  }
  return {
    seeds,
    type: "DE24",
    byes: seeds.slice(0, 8),
    rounds: [
      { name: "WB Round 1", type: "WB", matches: wbR1Matches },
      { name: "WB Round 2", type: "WB", matches: [] },
      { name: "LB Round 1", type: "LB", matches: [] },
      { name: "WB Round 3", type: "WB", matches: [] },
      { name: "LB Round 2", type: "LB", matches: [] },
      { name: "LB Round 3", type: "LB", matches: [] },
      { name: "WB Semifinals", type: "WB", matches: [] },
      { name: "LB Round 4", type: "LB", matches: [] },
      { name: "LB Round 5", type: "LB", matches: [] },
      { name: "WB Final", type: "WB", matches: [] },
      { name: "LB Round 6", type: "LB", matches: [] },
      { name: "LB Final", type: "LB", matches: [] },
      { name: "Grand Final", type: "GF", matches: [] },
    ],
    completed: false,
    champion: null,
    _wbChampion: null,
    _wbFLoser: null,
    _wbR1Losers: null,
    _wbR3Losers: null,
    _wbSemiLosers: null,
  };
}

function _tryPopulateLBFinalDE24(bracket) {
  const lbR6 = bracket.rounds[10]; // LB Round 6
  if (!lbR6.matches.length || !lbR6.matches[0]?.played) return;
  if (!bracket._wbFLoser) return;
  bracket.rounds[11].matches = [
    { a: bracket._wbFLoser, b: lbR6.matches[0].result.winnerId, played: false, result: null },
  ];
}

function _advanceQualifierBracketDE24(bracket, roundIdx) {
  const round = bracket.rounds[roundIdx];
  if (!round.matches.every(m => m.played)) return false;
  const winners = round.matches.map(m => m.result.winnerId);
  const losers  = round.matches.map(m => m.result.loserId);

  switch (roundIdx) {
    case 0: { // WB Round 1 → seeds 1–8 enter WB Round 2; losers wait for LB Round 1.
      bracket._wbR1Losers = losers;
      const s = bracket.seeds;
      bracket.rounds[1].matches = [
        { a: s[0], b: winners[7], seedA: 1, seedB: 16, played: false, result: null },
        { a: s[7], b: winners[0], seedA: 8, seedB: 9,  played: false, result: null },
        { a: s[3], b: winners[4], seedA: 4, seedB: 13, played: false, result: null },
        { a: s[4], b: winners[3], seedA: 5, seedB: 12, played: false, result: null },
        { a: s[1], b: winners[6], seedA: 2, seedB: 15, played: false, result: null },
        { a: s[6], b: winners[1], seedA: 7, seedB: 10, played: false, result: null },
        { a: s[2], b: winners[5], seedA: 3, seedB: 14, played: false, result: null },
        { a: s[5], b: winners[2], seedA: 6, seedB: 11, played: false, result: null },
      ];
      break;
    }
    case 1: { // WB Round 2 → WB Round 3 + LB Round 1 (all teams now have at most one loss)
      const wbR1Losers = bracket._wbR1Losers || [];
      bracket.rounds[3].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
        { a: winners[2], b: winners[3], played: false, result: null },
        { a: winners[4], b: winners[5], played: false, result: null },
        { a: winners[6], b: winners[7], played: false, result: null },
      ];
      bracket.rounds[2].matches = [
        { a: wbR1Losers[0], b: losers[1], played: false, result: null },
        { a: wbR1Losers[1], b: losers[0], played: false, result: null },
        { a: wbR1Losers[2], b: losers[3], played: false, result: null },
        { a: wbR1Losers[3], b: losers[2], played: false, result: null },
        { a: wbR1Losers[4], b: losers[5], played: false, result: null },
        { a: wbR1Losers[5], b: losers[4], played: false, result: null },
        { a: wbR1Losers[6], b: losers[7], played: false, result: null },
        { a: wbR1Losers[7], b: losers[6], played: false, result: null },
      ];
      break;
    }
    case 2: { // LB Round 1 → LB Round 2
      bracket.rounds[4].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
        { a: winners[2], b: winners[3], played: false, result: null },
        { a: winners[4], b: winners[5], played: false, result: null },
        { a: winners[6], b: winners[7], played: false, result: null },
      ];
      break;
    }
    case 3: { // WB Round 3 → WB Semis; losers wait for LB Round 3
      bracket._wbR3Losers = losers;
      bracket.rounds[6].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
        { a: winners[2], b: winners[3], played: false, result: null },
      ];
      break;
    }
    case 4: { // LB Round 2 → LB Round 3 vs WB Round 3 losers
      const wbR3Losers = bracket._wbR3Losers || [];
      bracket.rounds[5].matches = [
        { a: winners[0], b: wbR3Losers[0], played: false, result: null },
        { a: winners[1], b: wbR3Losers[1], played: false, result: null },
        { a: winners[2], b: wbR3Losers[2], played: false, result: null },
        { a: winners[3], b: wbR3Losers[3], played: false, result: null },
      ];
      break;
    }
    case 5: { // LB Round 3 → LB Round 4
      bracket.rounds[7].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
        { a: winners[2], b: winners[3], played: false, result: null },
      ];
      break;
    }
    case 6: { // WB Semis → WB Final; losers wait for LB Round 5
      bracket._wbSemiLosers = losers;
      bracket.rounds[9].matches = [{ a: winners[0], b: winners[1], played: false, result: null }];
      break;
    }
    case 7: { // LB Round 4 → LB Round 5 vs WB Semi losers
      const wbSemiLosers = bracket._wbSemiLosers || [];
      bracket.rounds[8].matches = [
        { a: winners[0], b: wbSemiLosers[0], played: false, result: null },
        { a: winners[1], b: wbSemiLosers[1], played: false, result: null },
      ];
      break;
    }
    case 8: { // LB Round 5 → LB Round 6
      bracket.rounds[10].matches = [{ a: winners[0], b: winners[1], played: false, result: null }];
      break;
    }
    case 9: { // WB Final → store WB champ + loser; try LB Final after LB Round 6
      bracket._wbChampion = winners[0];
      bracket._wbFLoser = losers[0];
      _tryPopulateLBFinalDE24(bracket);
      break;
    }
    case 10: { // LB Round 6 → LB Final once WB Final is known
      _tryPopulateLBFinalDE24(bracket);
      break;
    }
    case 11: { // LB Final → Grand Final
      bracket.rounds[12].matches = [{ a: bracket._wbChampion, b: winners[0], played: false, result: null }];
      break;
    }
    case 12: {
      bracket.champion = winners[0];
      return true;
    }
  }
  return false;
}

function computeDE24Placements(bracket) {
  const placements = {};
  const claimed = new Set();
  const place = (teamId, p) => {
    if (!teamId || claimed.has(teamId)) return;
    placements[teamId] = p;
    claimed.add(teamId);
  };

  const gfRound = bracket.rounds.find(r => r.type === "GF") ?? bracket.rounds[bracket.rounds.length - 1];
  const gfMatch = gfRound?.matches?.[0];
  if (gfMatch?.played && gfMatch.result) {
    place(gfMatch.result.winnerId, 1);
    place(gfMatch.result.loserId, 2);
  } else if (bracket.champion) {
    place(bracket.champion, 1);
  }

  const lbFinalMatch = bracket.rounds.find(r => r.name === "LB Final")?.matches?.[0];
  if (lbFinalMatch?.played && lbFinalMatch.result) place(lbFinalMatch.result.loserId, 3);

  const lbR6Match = bracket.rounds.find(r => r.name === "LB Round 6")?.matches?.[0];
  if (lbR6Match?.played && lbR6Match.result) place(lbR6Match.result.loserId, 4);

  const bucketize = (roundName, places) => {
    const round = bracket.rounds.find(r => r.name === roundName);
    const losers = (round?.matches ?? []).filter(m => m.played && m.result?.loserId).map(m => m.result.loserId);
    losers.forEach((id, i) => place(id, places[Math.min(i, places.length - 1)]));
  };

  bucketize("LB Round 5", [5, 6]);
  bucketize("LB Round 4", [7, 8]);
  bucketize("LB Round 3", [9, 10, 11, 12]);
  bucketize("LB Round 2", [13, 14, 15, 16]);
  bucketize("LB Round 1", [17, 18, 19, 20, 21, 22, 23, 24]);

  return placements;
}

function buildChallengerQualifierBracket(field) {
  const sorted = (field || []).slice().sort((a, b) => a.seed - b.seed).map(row => row.teamId);
  if (sorted.length >= 24) return buildChallengerBracketDE24(sorted.slice(0, 24));
  return buildMajorBracketDE16(sorted.slice(0, 16));
}

function createChallengerQualifierEvent(gameState, schedule) {
  const majorIdx = schedule.stageIdx ?? schedule.majorIdx ?? 0;
  const existing = schedule.currentChallengerQualifier;
  if (existing?.season === schedule.season && existing?.majorIdx === majorIdx) {
    if (!existing.bracket && !existing.completed) {
      const field = existing.field?.length ? existing.field : buildChallengerQualifierField(gameState, { ...schedule, majorIdx });
      return { ...existing, field, bracket: buildChallengerQualifierBracket(field), matchLog: existing.matchLog || [] };
    }
    return existing;
  }
  const field = buildChallengerQualifierField(gameState, { ...schedule, majorIdx });
  return {
    season: schedule.season,
    majorIdx,
    name: `Major ${majorIdx + 1} Qualifier`,
    completed: false,
    field,
    bracket: buildChallengerQualifierBracket(field),
    matchLog: [],
    results: [],
  };
}

function createChallengersFinalsEvent(gameState, schedule) {
  const existing = schedule.currentChallengerQualifier;
  if (existing?.season === schedule.season && existing?.eventType === "challengersFinals") {
    if (!existing.bracket && !existing.completed) {
      const field = existing.field?.length ? existing.field : buildChallengerQualifierField(gameState, schedule).slice(0, CHALLENGERS_FINALS_TEAMS).map((row, idx) => ({ ...row, seed: idx + 1 }));
      return { ...existing, field, bracket: buildMajorBracketDE16(field.map(row => row.teamId)), matchLog: existing.matchLog || [] };
    }
    return existing;
  }
  const field = buildChallengerQualifierField(gameState, schedule)
    .slice(0, CHALLENGERS_FINALS_TEAMS)
    .map((row, idx) => ({ ...row, seed: idx + 1 }));
  return {
    season: schedule.season,
    majorIdx: 4,
    eventType: "challengersFinals",
    name: "Challengers Finals",
    completed: false,
    field,
    bracket: buildMajorBracketDE16(field.map(row => row.teamId)),
    matchLog: [],
    results: [],
  };
}

function enterChallengerQualifierPhase(gameState, schedule) {
  const majorIdx = schedule.stageIdx ?? 0;
  schedule.phase = "challengerQualifier";
  schedule.majorIdx = majorIdx;
  schedule.currentChallengerQualifier = createChallengerQualifierEvent(gameState, schedule);
  return { ...gameState, schedule: { ...schedule } };
}

function enterChallengersFinalsPhase(gameState, schedule) {
  schedule.phase = "challengerQualifier";
  schedule.majorIdx = null;
  schedule.currentChallengerQualifier = createChallengersFinalsEvent(gameState, schedule);
  return { ...gameState, schedule: { ...schedule } };
}

function challengerTeamObj(teamId, gameState, field = []) {
  const row = field.find(r => r.teamId === teamId);
  const base = (gameState.challengerTeams || []).find(t => t.id === teamId) || row || { id: teamId, name: teamId };
  const cdlNames = buildCdlRosterNameSet(gameState.players || []);
  const roster = resolveEventRoster(base, row, gameState, cdlNames);
  // Derive a map profile from the qualifier roster (no staff) so qualifier
  // series also show real CDL 2026 map names. Players carry challenger ids, so
  // tag them with this teamId for the starter filter.
  const tagged = (roster || []).map(p => ({ ...p, teamId }));
  const mapProfile = buildTeamMapProfile(teamId, tagged, [], gameState?.season ?? 1);
  return { id: teamId, name: row?.teamName || base.name || teamId, players: roster, mapProfile };
}

export function findNextBracketMatch(bracket) {
  for (let r = 0; r < (bracket?.rounds || []).length; r++) {
    const round = bracket.rounds[r];
    const idx = (round.matches || []).findIndex(m => !m.played && m.a && m.b);
    if (idx !== -1) return { roundIdx: r, round, matchIdx: idx, match: round.matches[idx] };
  }
  return null;
}

export function _advanceQualifierBracket(bracket, roundIdx) {
  if (bracket.type === "DE24") return _advanceQualifierBracketDE24(bracket, roundIdx);
  const round = bracket.rounds[roundIdx];
  if (!round.matches.every(m => m.played)) return false;
  const winners = round.matches.map(m => m.result.winnerId);
  const losers = round.matches.map(m => m.result.loserId);
  switch (roundIdx) {
    case 0:
      bracket.rounds[1].matches = [{ a: losers[0], b: losers[1], played:false,result:null},{ a: losers[2], b: losers[3], played:false,result:null},{ a: losers[4], b: losers[5], played:false,result:null},{ a: losers[6], b: losers[7], played:false,result:null}];
      bracket.rounds[2].matches = [{ a:winners[0], b:winners[1], played:false,result:null},{ a:winners[2], b:winners[3], played:false,result:null},{ a:winners[4], b:winners[5], played:false,result:null},{ a:winners[6], b:winners[7], played:false,result:null}];
      break;
    case 1: break;
    case 2: {
      bracket.rounds[5].matches = [{ a:winners[0], b:winners[1], played:false,result:null},{ a:winners[2], b:winners[3], played:false,result:null}];
      const lb1w = bracket.rounds[1].matches.map(m=>m.result.winnerId);
      bracket.rounds[3].matches = [{a:lb1w[0], b:losers[0], played:false,result:null},{a:lb1w[1], b:losers[1], played:false,result:null},{a:lb1w[2], b:losers[2], played:false,result:null},{a:lb1w[3], b:losers[3], played:false,result:null}];
      break;
    }
    case 3: bracket.rounds[4].matches = [{a:winners[0],b:winners[1],played:false,result:null},{a:winners[2],b:winners[3],played:false,result:null}]; break;
    case 4: bracket._lbr3Winners = winners; break;
    case 5:
      bracket.rounds[7].matches = [{ a:winners[0], b:winners[1], played:false,result:null }];
      bracket.rounds[6].matches = [{ a: bracket._lbr3Winners[0], b: losers[0], played:false,result:null},{ a: bracket._lbr3Winners[1], b: losers[1], played:false,result:null}];
      break;
    case 6: bracket.rounds[8].matches = [{ a:winners[0], b:winners[1], played:false,result:null }]; break;
    case 7: bracket._wbChampion=winners[0]; bracket._wbFLoser=losers[0]; _tryPopulateLBFinal(bracket); break;
    case 8: _tryPopulateLBFinal(bracket); break;
    case 9: bracket.rounds[10].matches = [{ a:bracket._wbChampion, b:winners[0], played:false,result:null }]; break;
    case 10: bracket.champion=winners[0]; return true;
  }
  return false;
}

function _simOneChallengerQualifierMatch(current, gameState, schedule) {
  const bracket = current.bracket ?? buildChallengerQualifierBracket(current.field || []);
  current.bracket = bracket;
  const next = findNextBracketMatch(bracket);
  if (!next) return { allComplete: !!bracket.champion, roundIdx: -1 };
  const { roundIdx, round, matchIdx, match } = next;
  const result = simMatch(
    challengerTeamObj(match.a, gameState, current.field || []),
    challengerTeamObj(match.b, gameState, current.field || []),
    challengerQualifierSeed(schedule.season, current.majorIdx ?? schedule.majorIdx ?? 0, roundIdx, matchIdx, (current.matchLog || []).length)
  );
  match.played = true;
  match.result = result;
  // Store the full result (mapResults + playerStats) so the qualifier overlay
  // can render the same per-map / per-player breakdown as Match Center / MajorBracket.
  current.matchLog = [...(current.matchLog || []), {
    roundIdx,
    roundName: round.name,
    matchIdx,
    teamAId: result.teamAId,
    teamAName: result.teamAName,
    teamBId: result.teamBId,
    teamBName: result.teamBName,
    winnerId: result.winnerId,
    winnerName: result.winnerName,
    loserId: result.loserId,
    loserName: result.loserName,
    score: result.score,
    result,
  }];
  const complete = _advanceQualifierBracket(bracket, roundIdx);
  return { allComplete: complete, roundIdx };
}

function finalizeChallengerQualifier(gameState, schedule, current) {
  if (current.completed && current.results?.length) return current;
  const isFinals = current.eventType === "challengersFinals";
  const majorIdx = current.majorIdx ?? schedule.majorIdx ?? schedule.stageIdx ?? 0;
  const placements = current.bracket?.type === "DE24"
    ? computeDE24Placements(current.bracket)
    : computeDE16Placements(current.bracket);
  const records = {};
  for (const match of current.matchLog || []) {
    records[match.winnerId] = records[match.winnerId] || { wins: 0, losses: 0 };
    records[match.loserId] = records[match.loserId] || { wins: 0, losses: 0 };
    records[match.winnerId].wins += 1;
    records[match.loserId].losses += 1;
  }
  const qualifyLimit = isFinals ? CHALLENGERS_FINALS_ESWC_SPOTS : CHALLENGER_QUALIFIER_TEAMS;
  const results = (current.field || []).map(row => {
    const placement = placements[row.teamId] ?? (current.field?.length || 16);
    const circuitPointsAwarded = isFinals ? challengerFinalsPointsForPlacement(placement) : challengerPointsForPlacement(placement);
    const qualified = placement <= qualifyLimit;
    const rec = records[row.teamId] || { wins: 0, losses: 0 };
    const formAfter = Math.max(-10, Math.min(10, (row.formBefore ?? 0) + (qualified ? 2 : placement <= 8 ? 0 : -1)));
    return {
      ...row,
      placement,
      qualified,
      placementLabel: isFinals ? placementText(placement) : qualifierPlacementLabel(placement),
      circuitPointsAwarded,
      circuitPointsAfter: (row.circuitPointsBefore ?? 0) + circuitPointsAwarded,
      formAfter,
      matchRecord: rec,
      bracketResult: `${rec.wins}-${rec.losses}`,
      performanceScore: `${rec.wins}-${rec.losses}`,
    };
  }).sort((a, b) => a.placement - b.placement || a.seed - b.seed);

  const completed = { ...current, results, completed: true };
  const source = isFinals ? "challengersFinals" : "visibleQualifier";
  const historyEntry = {
    season: schedule.season,
    majorIdx,
    eventType: current.eventType ?? "majorQualifier",
    name: current.name ?? (isFinals ? "Challengers Finals" : `Major ${majorIdx + 1} Qualifier`),
    source,
    completed: true,
    bracketType: current.bracket?.type ?? "DE16",
    matchLog: completed.matchLog || [],
    teams: results.map(r => ({
      season: schedule.season,
      majorIdx,
      eventType: current.eventType ?? "majorQualifier",
      seed: r.seed,
      placement: r.placement,
      teamId: r.teamId,
      teamName: r.teamName,
      teamOvr: r.teamOvr,
      region: r.region,
      circuitPointsBefore: r.circuitPointsBefore,
      circuitPointsAwarded: r.circuitPointsAwarded,
      circuitPointsAfter: r.circuitPointsAfter,
      formBefore: r.formBefore,
      formAfter: r.formAfter,
      qualified: r.qualified,
      matchRecord: r.matchRecord,
      bracketResult: r.bracketResult,
      score: r.performanceScore,
    })),
  };
  const alreadyStored = getExistingQualifierForMajor(schedule, majorIdx, source);
  schedule.challengerQualifierResults = alreadyStored
    ? (schedule.challengerQualifierResults || []).map(r => (r === alreadyStored ? historyEntry : r))
    : [...(schedule.challengerQualifierResults || []), historyEntry];
  gameState.challengerTeams = (gameState.challengerTeams || []).map(t => {
    const row = results.find(x => x.teamId === t.id);
    return row ? {
      ...t,
      circuitPoints: row.circuitPointsAfter,
      form: row.formAfter,
      lastQualifierPlacement: row.placement,
      finalsPlacement: isFinals ? row.placement : t.finalsPlacement,
      qualifiedEswcSeason: isFinals && row.qualified ? schedule.season : t.qualifiedEswcSeason,
      qualifiedMajorIdxs: (!isFinals && row.qualified) ? [...new Set([...(t.qualifiedMajorIdxs || []), majorIdx])] : (t.qualifiedMajorIdxs || []),
    } : t;
  });
  return completed;
}

export function simNextChallengerQualifierMatch(gameState) {
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "challengerQualifier") return gameState;
  // Repair before simming: the post-Major AI window may have signed a captured
  // qualifier player to a CDL team since the field was built, which would leave
  // that Challenger team short at sim time. Re-repairing keeps every match 4v4.
  repairChallengerRosters(gameState);
  const current = schedule.currentChallengerQualifier ?? createChallengerQualifierEvent(gameState, schedule);
  if (current.completed) return { ...gameState, schedule: { ...schedule, currentChallengerQualifier: current } };
  const working = { ...current, bracket: current.bracket ?? buildChallengerQualifierBracket(current.field || []), matchLog: [...(current.matchLog || [])] };
  const { allComplete } = _simOneChallengerQualifierMatch(working, gameState, schedule);
  schedule.currentChallengerQualifier = allComplete ? finalizeChallengerQualifier(gameState, schedule, working) : working;
  return { ...gameState, schedule: { ...schedule } };
}

// Sim qualifier matches in order until the user's Challenger team has played
// its next match (or the event completes). Lets a Challenger user "Play your
// match" without manually clicking through every other match in the round.
export function simUserChallengerQualifierMatch(gameState) {
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "challengerQualifier") return gameState;
  const userId = gameState.userTeamId;
  repairChallengerRosters(gameState);
  let current = schedule.currentChallengerQualifier ?? createChallengerQualifierEvent(gameState, schedule);
  if (current.completed) return { ...gameState, schedule: { ...schedule, currentChallengerQualifier: current } };
  current = { ...current, bracket: current.bracket ?? buildChallengerQualifierBracket(current.field || []), matchLog: [...(current.matchLog || [])] };
  let safety = 0;
  while (!current.bracket?.champion && safety++ < 120) {
    const next = findNextBracketMatch(current.bracket);
    if (!next) break;
    const involvesUser = next.match.a === userId || next.match.b === userId;
    const { allComplete } = _simOneChallengerQualifierMatch(current, gameState, schedule);
    if (involvesUser) break;
    if (allComplete) break;
    // If the user has no remaining matches (eliminated/not in field), stop after
    // simming one match so the UI stays responsive rather than finishing silently.
    const stillAlive = (current.field || []).some(r => r.teamId === userId)
      && (current.matchLog || []).filter(m => m.loserId === userId).length < 2;
    if (!stillAlive) break;
  }
  schedule.currentChallengerQualifier = current.bracket?.champion
    ? finalizeChallengerQualifier(gameState, schedule, current)
    : current;
  return { ...gameState, schedule: { ...schedule } };
}

export function simChallengerQualifierRound(gameState) {
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "challengerQualifier") return gameState;
  repairChallengerRosters(gameState);
  let current = schedule.currentChallengerQualifier ?? createChallengerQualifierEvent(gameState, schedule);
  if (current.completed) return { ...gameState, schedule: { ...schedule, currentChallengerQualifier: current } };
  current = { ...current, bracket: current.bracket ?? buildChallengerQualifierBracket(current.field || []), matchLog: [...(current.matchLog || [])] };
  const next = findNextBracketMatch(current.bracket);
  if (!next) return { ...gameState, schedule: { ...schedule, currentChallengerQualifier: finalizeChallengerQualifier(gameState, schedule, current) } };
  const startRound = next.roundIdx;
  let safety = 0;
  while (safety++ < 30) {
    const still = findNextBracketMatch(current.bracket);
    if (!still || still.roundIdx !== startRound) break;
    const { allComplete } = _simOneChallengerQualifierMatch(current, gameState, schedule);
    if (allComplete) break;
  }
  schedule.currentChallengerQualifier = current.bracket?.champion ? finalizeChallengerQualifier(gameState, schedule, current) : current;
  return { ...gameState, schedule: { ...schedule } };
}

export function simChallengerQualifier(gameState) {
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "challengerQualifier") return gameState;
  repairChallengerRosters(gameState);
  let current = schedule.currentChallengerQualifier ?? createChallengerQualifierEvent(gameState, schedule);
  if (current.completed) return { ...gameState, schedule: { ...schedule, currentChallengerQualifier: current } };
  current = { ...current, bracket: current.bracket ?? buildChallengerQualifierBracket(current.field || []), matchLog: [...(current.matchLog || [])] };
  let safety = 0;
  while (!current.bracket?.champion && safety++ < 120) _simOneChallengerQualifierMatch(current, gameState, schedule);
  schedule.currentChallengerQualifier = finalizeChallengerQualifier(gameState, schedule, current);
  return { ...gameState, schedule: { ...schedule } };
}

function qualifierRowsToEventTeams(rows, gameState, schedule, eventKey = "major") {
  const cdlNames = buildCdlRosterNameSet(gameState.players || []);
  return rows.slice(0, CHALLENGER_QUALIFIER_TEAMS).map((row, i) => {
    const base = (gameState.challengerTeams || []).find(t => t.id === row.teamId) || row;
    const roster = resolveEventRoster(base, row, gameState, cdlNames);
    return {
      id: `${eventKey}_qual_${schedule.season}_${(schedule.majorIdx ?? 0) + 1}_${i + 1}`,
      ...base,
      name: row.teamName ?? base.name,
      region: row.region ?? base.region,
      ovr: row.teamOvr,
      qualifierPlacement: row.placement,
      qualifierSeed: row.seed,
      qualifierLabel: row.placementLabel ?? qualifierPlacementLabel(row.placement),
      players: roster,
      playerIds: roster.map(p => p.id),
    };
  });
}

export function continueFromChallengerQualifier(gameState) {
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "challengerQualifier") return gameState;
  const qualifier = schedule.currentChallengerQualifier;
  if (!qualifier?.completed || !qualifier?.results?.length) return gameState;

  if (qualifier.eventType === "challengersFinals") {
    schedule.phase = "preChamps";
    schedule.majorIdx = null;
    return { ...gameState, schedule: { ...schedule } };
  }

  const majorIdx = schedule.majorIdx ?? schedule.stageIdx ?? 0;
  // Repair before baking the Major's 4 Challenger event teams so their frozen
  // rosters are 4 real players (a qualifier player may have been signed to CDL
  // since the field was built).
  repairChallengerRosters(gameState);
  const cdlSeeds = Object.entries(schedule.stageStandings)
    .sort((a,b)=>b[1].points-a[1].points)
    .map(([id])=>id);
  const qualifiedRows = qualifier.results.filter(r => r.qualified).sort((a, b) => a.placement - b.placement);
  const eventTeams = qualifierRowsToEventTeams(qualifiedRows, gameState, { ...schedule, majorIdx });
  const majorSeeds = [...cdlSeeds, ...eventTeams.map(t=>t.id)];
  schedule.currentMajorEventTeams = Object.fromEntries(eventTeams.map(t => [t.id, t]));
  schedule.majors[majorIdx].bracket = schedule.majors[majorIdx].bracket ?? buildMajorBracketDE16(majorSeeds);
  schedule.phase = "major";
  schedule.majorIdx = majorIdx;
  return { ...gameState, schedule: { ...schedule } };
}

function simulateChallengerQualifier(gameState, schedule, eventKey = "major") {
  // Legacy/Champs-only hidden qualifier path. Regular Majors now use the visible
  // challengerQualifier phase and continueFromChallengerQualifier() so seeds 13–16
  // come from the player's completed event.
  ensureChallengerTeams(gameState);
  const rng = seededRng(schedule.season * 9991 + ((schedule.majorIdx ?? 0) + 1) * 71 + (eventKey === "champs" ? 17 : 0));
  const field = buildChallengerQualifierField(gameState, schedule);
  const fieldSize = field.length;
  const results = field.map((row) => ({
    ...row,
    performanceScore: Number(((row.teamOvr ?? 65) + (row.formBefore ?? 0) * 0.9 + (fieldSize + 1 - row.seed) * 0.25 + (rng() * 10 - 5)).toFixed(2)),
  })).sort((a, b) => b.performanceScore - a.performanceScore || a.seed - b.seed)
    .map((r, i) => ({ ...r, placement: i + 1, qualified: i < CHALLENGER_QUALIFIER_TEAMS, circuitPointsAwarded: challengerPointsForPlacement(i + 1), formAfter: Math.max(-10, Math.min(10, (r.formBefore ?? 0) + (i < 4 ? 2 : i < 8 ? 0 : -1))) }));

  const resObj = { season: schedule.season, majorIdx: schedule.majorIdx, source: eventKey === "champs" ? "hiddenChampsQualifier" : "legacyHiddenQualifier", teams: results.map(r => ({ teamId: r.teamId, teamName: r.teamName, seed: r.seed, placement: r.placement, teamOvr: r.teamOvr, region: r.region, rosterIds: r.rosterIds || [], score: r.performanceScore, qualified: r.qualified, circuitPointsBefore: r.circuitPointsBefore, circuitPointsAwarded: r.circuitPointsAwarded, circuitPointsAfter: r.circuitPointsBefore + r.circuitPointsAwarded, formBefore: r.formBefore, formAfter: r.formAfter })) };
  schedule.challengerQualifierResults = [...(schedule.challengerQualifierResults || []), resObj];
  gameState.challengerTeams = (gameState.challengerTeams || []).map(t => {
    const row = resObj.teams.find(x => x.teamId === t.id);
    return row ? { ...t, circuitPoints: row.circuitPointsAfter, form: row.formAfter, lastQualifierPlacement: row.placement, qualifiedMajorIdxs: row.qualified ? [...(t.qualifiedMajorIdxs || []), schedule.majorIdx] : (t.qualifiedMajorIdxs || []) } : t;
  });
  return qualifierRowsToEventTeams(results.filter(r => r.qualified), gameState, schedule, eventKey);
}

// Org reputation tiers: higher = slightly more attractive to top players in the snake draft.
// Scale 1–3: 3 = premium, 2 = established, 1 = developing.
const CHALLENGER_ORG_TIER = {
  omit_brooklyn: 3, omit_noir: 3, project_notorious: 3, project_7: 3,
  telluride_bush: 3, faze_falcons: 3, five_fears: 2, for_fun_esports: 2,
  huntsmen: 2, stallions: 2, death_by_cabal: 2, next_threat_black: 1,
  stallions_x_bush: 1, omnia_ggs: 1, high_treason: 1, for_fun_black: 1,
  // New teams start at developing tier
  carolina_reapers: 1, torn_esports: 1, confide_esports: 1, falcons_academy_white: 1,
  death_penalty: 1, treaty1_gaming: 1, dark_horse_esports: 1, belfast_storm: 1,
};

function _buildMergedChallengerTeams(gameState) {
  const existing = gameState.challengerTeams || [];
  const byId = new Map(existing.map(t => [t.id, t]));
  const mkTeam = (base) => ({
    ...base,
    region: CHALLENGER_REGIONS[base.id] ?? "NA",
    playerIds: [],
    circuitPoints: 0,
    form: 0,
    lastQualifierPlacement: null,
    qualifiedMajorIdxs: [],
  });
  return CHALLENGER_TEAM_POOL.map(base => {
    const cur = byId.get(base.id);
    return cur ? { ...mkTeam(base), ...cur, ...base, region: cur.region ?? CHALLENGER_REGIONS[base.id] ?? "NA" } : mkTeam(base);
  });
}

// Used for new-game only: randomized snake draft across all 24 teams.
// seed must be a non-zero integer unique to this save creation.
export function buildChallengerRostersForNewGame(gameState, seed) {
  const merged = _buildMergedChallengerTeams(gameState);
  const rng = seededRng(seed);

  const cdlNames = buildCdlRosterNameSet(gameState.players || []);
  const byPlayerId = new Map([...(gameState.players || []), ...(gameState.prospects || [])].map(p => [p.id, p]));

  // Gather all eligible unsigned prospects
  const eligible = (gameState.prospects || [])
    .filter(p => !p.teamId && !isInactivePlayer(p) && !cdlNames.has(normalizePlayerName(p.name)))
    .map(p => ({ ...p }));

  // Sort into rating bands, shuffle within each band
  const elite  = shuffle(eligible.filter(p => (p.overall ?? 0) >= 75), rng);
  const strong = shuffle(eligible.filter(p => (p.overall ?? 0) >= 70 && (p.overall ?? 0) < 75), rng);
  const solid  = shuffle(eligible.filter(p => (p.overall ?? 0) >= 63 && (p.overall ?? 0) < 70), rng);
  const filler = shuffle(eligible.filter(p => (p.overall ?? 0) < 63), rng);
  const pool = [...elite, ...strong, ...solid, ...filler];

  // Shuffle team order by region, with org-tier bias applied as a small rating bump
  // so premium orgs tend to end up with a slightly earlier draft slot but are not fixed.
  const regions = ["NA", "EU", "MENA"];
  const teamsByRegion = {};
  for (const r of regions) teamsByRegion[r] = [];
  for (const t of merged) {
    const r = t.region in teamsByRegion ? t.region : "NA";
    teamsByRegion[r].push(t);
  }
  // Within each region, sort by (tier + small noise), then shuffle slightly by tier
  for (const r of regions) {
    teamsByRegion[r] = teamsByRegion[r]
      .map(t => ({ t, sortKey: (CHALLENGER_ORG_TIER[t.id] ?? 1) + rng() * 1.2 }))
      .sort((a, b) => b.sortKey - a.sortKey)
      .map(({ t }) => t);
  }
  // Interleave regions: NA, EU, MENA, NA, EU, MENA... to spread talent across regions
  const draftOrder = [];
  const regionQueues = regions.map(r => [...teamsByRegion[r]]);
  let i = 0;
  while (draftOrder.length < merged.length) {
    const queue = regionQueues[i % regions.length];
    if (queue.length) draftOrder.push(queue.shift());
    i++;
  }

  // Snake draft: round 1 forward, round 2 reverse, round 3 forward, round 4 reverse
  const usedIds = new Set();
  const usedNames = new Set();
  const assignments = new Map(draftOrder.map(t => [t.id, []]));

  for (let round = 0; round < 4; round++) {
    const order = round % 2 === 0 ? draftOrder : [...draftOrder].reverse();
    for (const team of order) {
      if (assignments.get(team.id).length >= 4) continue;
      // Find best available player: prefer same-region, then any
      const teamRegion = team.region;
      const pick =
        pool.find(p => !usedIds.has(p.id) && !usedNames.has(normalizePlayerName(p.name)) && (p.region === teamRegion)) ||
        pool.find(p => !usedIds.has(p.id) && !usedNames.has(normalizePlayerName(p.name)));
      if (!pick) continue;
      usedIds.add(pick.id);
      usedNames.add(normalizePlayerName(pick.name));
      assignments.get(team.id).push(pick.id);
    }
  }

  // Apply assignments and set challengerTeamId on prospects
  for (const team of merged) {
    team.playerIds = assignments.get(team.id) || [];
    for (const pid of team.playerIds) {
      const p = byPlayerId.get(pid);
      if (p) {
        p.challengerTeamId = team.id;
        if (!p.region) p.region = team.region;
      }
    }
  }

  gameState.challengerTeams = merged;
}

export function ensureChallengerTeams(gameState) {
  const existing = gameState.challengerTeams || [];
  const byId = new Map(existing.map(t => [t.id, t]));
  const mkTeam = (base) => ({
    ...base,
    region: CHALLENGER_REGIONS[base.id] ?? "NA",
    playerIds: [],
    circuitPoints: 0,
    form: 0,
    lastQualifierPlacement: null,
    qualifiedMajorIdxs: [],
  });
  const merged = CHALLENGER_TEAM_POOL.map(base => {
    const cur = byId.get(base.id);
    return cur ? { ...mkTeam(base), ...cur, ...base, region: cur.region ?? CHALLENGER_REGIONS[base.id] ?? "NA" } : mkTeam(base);
  });

  const cdlNames = buildCdlRosterNameSet(gameState.players || []);
  const byPlayerId = new Map([...(gameState.players || []), ...(gameState.prospects || [])].map(p => [p.id, p]));
  const used = new Set();
  const usedNames = new Set();
  for (const team of merged) {
    const current = [];
    for (const pid of team.playerIds || []) {
      const player = byPlayerId.get(pid);
      const key = normalizePlayerName(player?.name);
      if (!player || shouldExcludeFromChallengers(player, cdlNames, used, usedNames)) continue;
      current.push(pid);
      used.add(pid);
      usedNames.add(key);
      if (player.challengerTeamId == null) player.challengerTeamId = team.id;
    }
    team.playerIds = current.slice(0, 4);
  }

  const free = (gameState.prospects || [])
    .filter(p => !p.teamId && !isInactivePlayer(p))
    .sort((a,b)=>(b.overall??0)-(a.overall??0));
  const protectedTeamId = userChallengerTeamId(gameState);
  for (const team of merged) {
    if (team.id === protectedTeamId) continue; // user manages this roster manually
    if (team.playerIds.length >= 4) continue;
    const need = 4 - team.playerIds.length;
    const same = free.filter(p => !shouldExcludeFromChallengers(p, cdlNames, used, usedNames) && ((p.region || team.region) === team.region)).slice(0, need);
    let picks = same;
    if (picks.length < need) picks = [...picks, ...free.filter(p => !shouldExcludeFromChallengers(p, cdlNames, used, usedNames) && !picks.find(x => x.id === p.id)).slice(0, need - picks.length)];
    team.playerIds = [...team.playerIds, ...picks.map(p => p.id)];
    for (const p of picks) {
      used.add(p.id);
      usedNames.add(normalizePlayerName(p.name));
      p.challengerTeamId = team.id;
      if (!p.region) p.region = team.region;
    }
  }
  gameState.challengerTeams = merged;
}

// Generate a believable last-resort Challenger player. Uses the same gamertag
// pool as the prospect refresh so it is indistinguishable from a real player in
// the UI — never "Sub N". Pushed into prospects so profile clicks resolve.
function makeEmergencyChallengerPlayer(teamId, slot, season, avoidNames = new Set()) {
  const seed = hashString(`${teamId}_${season}_${slot}_challenger_emergency`);
  let name = FRESH_PROSPECT_NAMES[seed % FRESH_PROSPECT_NAMES.length];
  let tries = 0;
  while (avoidNames.has(normalizePlayerName(name)) && tries < FRESH_PROSPECT_NAMES.length) {
    tries += 1;
    name = FRESH_PROSPECT_NAMES[(seed + tries) % FRESH_PROSPECT_NAMES.length];
  }
  const overall = 58 + (seed % 7); // 58–64 filler depth
  const role = ["SMG", "AR", "Flex", "OBJ"][slot % 4];
  return {
    id: `challenger_emergency_${teamId}_${season}_${slot}_${seed.toString(36)}`,
    name,
    age: 19 + (seed % 5),
    region: CHALLENGER_REGIONS[teamId] ?? "NA",
    primary: role,
    secondary: "AR",
    overall,
    potential: Math.max(overall + 6, 70 + (seed % 8)),
    gunny: 50 + (seed % 20), awareness: 50, objective: 50, searchIQ: 50,
    clutch: 45 + (seed % 25), teamwork: 55, composure: 50, adaptability: 50,
    ego: 40, workEthic: 60, tiltResistance: 3, leadership: 45, metaDependence: 50,
    form: 60, experience: 0,
    isProspect: true,
    isEmergencyGenerated: true,
    challengerTeamId: teamId,
    status: "challengers",
    teamId: null,
  };
}

// ── Challenger roster integrity / repair pipeline ─────────────────────────────
// Ensures every Challenger team carries 4 real, valid players before event play.
// Pipeline (each step only runs if the previous one left holes):
//   1. clean invalid references + prospect fill   (ensureChallengerTeams)
//   2. fill from the real pool (free agents + free unsigned prospects)
//   3. seed-aware poaching from lower-priority teams (donors backfill in turn)
//   4. emergency generated player with a realistic gamertag — true last resort.
// Mutates `gameState` (challengerTeams / players / prospects) and returns it.
export function repairChallengerRosters(gameState, options = {}) {
  const { seeds = null, allowEmergency = true, includeFreeAgents = true } = options;
  const diag = {
    teams: 0, filledFromPool: 0, poaches: [], emergencies: [],
    donorTeamsRepaired: new Set(), poolSize: 0, freeAgentCandidates: 0,
    prospectCandidates: 0,
  };

  // Step 1: validate references + prospect fill (existing pass).
  ensureChallengerTeams(gameState);

  const teams = gameState.challengerTeams || [];
  diag.teams = teams.length;
  const cdlNames = buildCdlRosterNameSet(gameState.players || []);
  const byPlayerId = new Map(
    [...(gameState.players || []), ...(gameState.prospects || [])].map(p => [p.id, p])
  );

  // Track everything already on a Challenger roster (ids + names).
  const used = new Set();
  const usedNames = new Set();
  for (const t of teams) {
    for (const pid of t.playerIds || []) {
      used.add(pid);
      const p = byPlayerId.get(pid);
      if (p) usedNames.add(normalizePlayerName(p.name));
    }
  }

  // Step 2: build the real candidate pool — free agents + free unsigned prospects.
  const isEligibleFree = (p) => {
    if (!p || isInactivePlayer(p)) return false;            // not retired/inactive
    if (p.teamId && isCdlTeamId(p.teamId)) return false;    // active on a CDL team
    if (p.teamId) return false;                             // signed somewhere else
    if (used.has(p.id)) return false;                       // already on a Challenger roster
    const key = normalizePlayerName(p.name);
    if (!key || usedNames.has(key)) return false;           // duplicate name in pool
    if (cdlNames.has(key)) return false;                    // shares a name w/ an active CDL player
    return true;
  };
  const freeAgents = includeFreeAgents
    ? (gameState.players || []).filter(p => p.status === "freeAgent" || (!p.teamId && !p.challengerTeamId))
    : [];
  diag.freeAgentCandidates = freeAgents.filter(isEligibleFree).length;
  diag.prospectCandidates = (gameState.prospects || []).filter(isEligibleFree).length;
  const candidatePool = [...(gameState.prospects || []), ...freeAgents]
    .filter(isEligibleFree)
    .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i)
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  diag.poolSize = candidatePool.length;

  // Priority order: explicit seeds when supplied, else the same season-long
  // seeding score the qualifier/finals use (circuit points + OVR + form + form).
  const priorityOf = (team) => {
    const { ovr } = calcChallengerTeamOvr(team, gameState, cdlNames);
    const prevPlacement = team.lastQualifierPlacement ?? 9;
    const prevBonus = Math.max(0, 9 - prevPlacement) * 1.25;
    return (team.circuitPoints ?? 0) + (ovr - 65) * 1.35 + (team.form ?? 0) * 2.2 + prevBonus;
  };
  let order;
  if (Array.isArray(seeds) && seeds.length) {
    const rankById = new Map(seeds.map((id, i) => [id, i]));
    order = [...teams].sort((a, b) =>
      (rankById.has(a.id) ? rankById.get(a.id) : 999) - (rankById.has(b.id) ? rankById.get(b.id) : 999)
    );
  } else {
    order = [...teams].sort((a, b) => priorityOf(b) - priorityOf(a));
  }

  const rosterLen = (t) => (t.playerIds || []).length;
  const assignFromPool = (team, player) => {
    team.playerIds = [...(team.playerIds || []), player.id].slice(0, 4);
    used.add(player.id);
    usedNames.add(normalizePlayerName(player.name));
    player.challengerTeamId = team.id;
    if (player.status === "freeAgent") player.status = "challengers";
    if (!player.region) player.region = team.region;
    diag.filledFromPool += 1;
  };
  const takeFromPool = (region) => {
    if (!candidatePool.length) return null;
    let idx = region ? candidatePool.findIndex(p => (p.region || region) === region) : -1;
    if (idx === -1) idx = 0;
    return candidatePool.splice(idx, 1)[0];
  };

  // The user-managed Challenger team is hand-curated — never auto-fill, poach
  // from, or emergency-pad it. The sim gate blocks events while it is < 4.
  const protectedTeamId = userChallengerTeamId(gameState);

  // Step 3a: fill every team from the real pool, highest priority first.
  for (const team of order) {
    if (team.id === protectedTeamId) continue;
    while (rosterLen(team) < 4) {
      const pick = takeFromPool(team.region);
      if (!pick) break;
      assignFromPool(team, pick);
    }
  }

  // Step 3b: seed-aware poaching. Pool is exhausted; top teams that are still
  // short take the best player from the LOWEST-priority team that still has one,
  // pushing the shortage down toward the bottom/backfill teams. Each donor is
  // processed later in the same top-down loop and refills from teams below it,
  // so only the very bottom teams can reach the emergency fallback.
  const rankIndex = new Map(order.map((t, i) => [t.id, i]));
  for (const team of order) {
    if (team.id === protectedTeamId) continue;
    let guard = 0;
    while (rosterLen(team) < 4 && guard++ < 64) {
      let donor = null;
      for (let i = order.length - 1; i >= 0; i--) {
        const d = order[i];
        if (d.id === team.id) continue;
        if (d.id === protectedTeamId) continue; // never poach the user's players
        if (rankIndex.get(d.id) <= rankIndex.get(team.id)) continue; // must be lower priority
        if (rosterLen(d) < 1) continue;
        donor = d;
        break;
      }
      if (!donor) break;
      const donorPlayers = (donor.playerIds || [])
        .map(id => byPlayerId.get(id))
        .filter(Boolean)
        .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
      const poached = donorPlayers[0];
      if (!poached) break;
      donor.playerIds = (donor.playerIds || []).filter(id => id !== poached.id);
      team.playerIds = [...(team.playerIds || []), poached.id];
      poached.challengerTeamId = team.id;
      diag.poaches.push({ from: donor.id, to: team.id, playerId: poached.id, playerName: poached.name });
      diag.donorTeamsRepaired.add(donor.id);
    }
  }

  // Step 4: emergency generated player (realistic gamertag) — true last resort.
  if (allowEmergency) {
    const avoid = new Set([...usedNames, ...cdlNames]);
    for (const team of order) {
      if (team.id === protectedTeamId) continue; // user signs their own players
      while (rosterLen(team) < 4) {
        const slot = rosterLen(team);
        const emergency = makeEmergencyChallengerPlayer(team.id, slot, gameState.season ?? gameState.schedule?.season ?? 1, avoid);
        gameState.prospects = [...(gameState.prospects || []), emergency];
        byPlayerId.set(emergency.id, emergency);
        team.playerIds = [...(team.playerIds || []), emergency.id];
        used.add(emergency.id);
        usedNames.add(normalizePlayerName(emergency.name));
        avoid.add(normalizePlayerName(emergency.name));
        diag.emergencies.push({ teamId: team.id, playerId: emergency.id, playerName: emergency.name });
        if (typeof console !== "undefined" && console.warn) {
          console.warn(`[challenger-repair] LAST RESORT: generated emergency player "${emergency.name}" for ${team.name || team.id} — real candidate pool exhausted.`);
        }
      }
    }
  }

  diag.donorTeamsRepaired = [...diag.donorTeamsRepaired];
  gameState.challengerTeams = teams;
  gameState.__challengerRepairDiag = diag;
  return gameState;
}

// Integrity guard: a normalized player name must never be active on two CDL
// teams at once (e.g. a regenerated prospect signed under a name already on a
// roster). Keeps the highest-OVR holder, releases the rest to free agency so the
// downstream integrity pass can refill. Deterministic; only fires on the
// illegal duplicate-name state. Returns the (mutated) gameState.
function resolveDuplicateActiveCdlNames(gameState) {
  const byName = new Map();
  for (const p of gameState.players || []) {
    if (!p?.teamId || !isCdlTeamId(p.teamId) || p.isSub || isInactivePlayer(p)) continue;
    const key = normalizePlayerName(p.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }
  const userTeamId = gameState.userTeamId;
  const releaseIds = new Set();
  for (const group of byName.values()) {
    if (group.length <= 1) continue;
    // Keep the user team's player if involved (their roster is sacrosanct);
    // otherwise keep the highest-OVR holder. Release the rest to free agency.
    group.sort((a, b) => {
      const au = a.teamId === userTeamId ? 1 : 0;
      const bu = b.teamId === userTeamId ? 1 : 0;
      if (au !== bu) return bu - au;
      return (b.overall ?? 0) - (a.overall ?? 0) || String(a.id).localeCompare(String(b.id));
    });
    for (const p of group.slice(1)) releaseIds.add(p.id);
  }
  if (!releaseIds.size) return gameState;
  gameState.players = (gameState.players || []).map(p => releaseIds.has(p.id)
    ? { ...p, teamId: null, isSub: false, challengerTeamId: null, contractYears: 0, status: "freeAgent", previousTeamId: p.teamId }
    : p);
  return gameState;
}

// Resolve an event team's 4-man roster. Prefers the team's CURRENT repaired
// roster (playerIds), which the repair pass de-duplicates globally so two event
// teams can never share a player. Falls back to the captured rosterIds only if
// the current roster resolves short (defensive — keeps the team at 4).
function resolveEventRoster(base, row, gameState, cdlNames) {
  let roster = getChallengerRoster(base, gameState, cdlNames);
  if (roster.length < 4 && row?.rosterIds?.length) {
    const have = new Set(roster.map(p => p.id));
    const extra = getChallengerRoster({ ...base, playerIds: row.rosterIds }, gameState, cdlNames)
      .filter(p => !have.has(p.id));
    roster = [...roster, ...extra].slice(0, 4);
  }
  return roster;
}

// ── Build 12-team Double-Elimination bracket (Majors 1–4) ────────────────────
// Seeds 1–4 get a WB Round 1 bye; seeds 5–12 play WB Round 1.
// rounds[] order defines simulation order (each round's inputs are always ready).
function buildMajorBracketDE(standings) {
  const sorted = Object.entries(standings)
    .sort((a, b) => b[1].points - a[1].points)
    .map(([id]) => id); // all 12 teams, seed 1 = index 0

  const s = sorted;
  // WB Round 1: 5v12, 6v11, 7v10, 8v9
  const wbR1Matches = [
    { a: s[4], b: s[11], seedA: 5, seedB: 12, played: false, result: null },
    { a: s[5], b: s[10], seedA: 6, seedB: 11, played: false, result: null },
    { a: s[6], b: s[9],  seedA: 7, seedB: 10, played: false, result: null },
    { a: s[7], b: s[8],  seedA: 8, seedB:  9, played: false, result: null },
  ];

  return {
    seeds: sorted,
    type: "DE",
    rounds: [
      { name: "WB Round 1",    type: "WB", matches: wbR1Matches },
      { name: "LB Round 1",    type: "LB", matches: [] },
      { name: "WB Round 2",    type: "WB", matches: [] },
      { name: "LB Round 2",    type: "LB", matches: [] },
      { name: "LB Round 3",    type: "LB", matches: [] },
      { name: "WB Semifinals", type: "WB", matches: [] },
      { name: "LB Round 4",    type: "LB", matches: [] },
      { name: "WB Final",      type: "WB", matches: [] },
      { name: "LB Round 5",    type: "LB", matches: [] },
      { name: "LB Final",      type: "LB", matches: [] },
      { name: "Grand Final",   type: "GF", matches: [] },
    ],
    completed: false,
    champion: null,
    _wbr2LosersHigh: null,
    _lbr3Winners: null,
    _wbFLoser: null,
    _wbChampion: null,
  };
}

// ── Build 8-team Double-Elimination bracket (Champs) ─────────────────────────
// All 8 teams enter WB Round 1 — no byes. Seeded 1–8 from cumulative standings.
// Round order:  0=WBR1  1=LBR1  2=WBSemis  3=LBR2  4=WBFinal  5=LBSemis  6=LBFinal  7=GF
function buildChampsDE(standings, userTeamId) {
  const sorted = Object.entries(standings)
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 8)
    .map(([id]) => id);

  const s = sorted;
  const wbR1 = [
    { a: s[0], b: s[7], seedA: 1, seedB: 8, played: false, result: null },
    { a: s[1], b: s[6], seedA: 2, seedB: 7, played: false, result: null },
    { a: s[2], b: s[5], seedA: 3, seedB: 6, played: false, result: null },
    { a: s[3], b: s[4], seedA: 4, seedB: 5, played: false, result: null },
  ];

  if (userTeamId) {
    const ui = wbR1.findIndex(m => m.a === userTeamId || m.b === userTeamId);
    if (ui > 0) { const [um] = wbR1.splice(ui, 1); wbR1.unshift(um); }
  }

  return {
    seeds: sorted,
    type: "DE",
    rounds: [
      { name: "WB Round 1",    type: "WB", _tbd: 4, matches: wbR1 },
      { name: "LB Round 1",    type: "LB", _tbd: 2, matches: [] },
      { name: "WB Semifinals", type: "WB", _tbd: 2, matches: [] },
      { name: "LB Round 2",    type: "LB", _tbd: 2, matches: [] },
      { name: "WB Final",      type: "WB", _tbd: 1, matches: [] },
      { name: "LB Semifinals", type: "LB", _tbd: 1, matches: [] },
      { name: "LB Final",      type: "LB", _tbd: 1, matches: [] },
      { name: "Grand Final",   type: "GF", _tbd: 1, matches: [] },
    ],
    completed: false,
    champion:    null,
    _wbFLoser:   null,
    _wbChampion: null,
  };
}

// ── Internal: try to populate LB Final once both prerequisites are ready ──────
function _tryPopulateLBFinal(bracket) {
  const lbR5 = bracket.rounds[8];
  if (!lbR5.matches.length || !lbR5.matches[0]?.played) return;
  if (!bracket._wbFLoser) return;
  const lbR5Winner = lbR5.matches[0].result.winnerId;
  bracket.rounds[9].matches = [
    { a: bracket._wbFLoser, b: lbR5Winner, played: false, result: null },
  ];
}

// Same helper for the 8-team Champs bracket (LB Semis at idx 5, LB Final at idx 6)
function _tryPopulateChampsLBFinal(bracket) {
  const lbSemis = bracket.rounds[5];
  if (!lbSemis.matches.length || !lbSemis.matches[0]?.played) return;
  if (!bracket._wbFLoser) return;
  bracket.rounds[6].matches = [
    { a: bracket._wbFLoser, b: lbSemis.matches[0].result.winnerId, played: false, result: null },
  ];
}

// ── Internal: play one match in the 8-team Champs DE bracket ─────────────────
function _simOneChampsMatchDE(schedule, gameState, precomputedResult = null) {
  const major   = schedule.majors[4];
  const bracket = major.bracket;

  let roundIdx = -1;
  for (let r = 0; r < bracket.rounds.length; r++) {
    const rnd = bracket.rounds[r];
    if (rnd.matches.length > 0 && rnd.matches.some(m => !m.played)) { roundIdx = r; break; }
  }
  if (roundIdx === -1) return { roundIdx: -1, allComplete: true };

  const round    = bracket.rounds[roundIdx];
  const matchIdx = round.matches.findIndex(m => !m.played);
  const match    = round.matches[matchIdx];

  const result = precomputedResult ?? (() => {
    const seed  = majorSeed(schedule.season, 4, roundIdx, matchIdx);
    const teamA = buildTeamObj(match.a, gameState);
    const teamB = buildTeamObj(match.b, gameState);
    return simMatch(teamA, teamB, seed);
  })();

  match.played = true;
  match.result = result;
  schedule.matchLog.push({ ...result, stage: `${major.name} – ${round.name}` });

  const roundDone = round.matches.every(m => m.played);
  if (!roundDone) return { roundIdx, allComplete: false };

  const winners = round.matches.map(m => m.result.winnerId);
  const losers  = round.matches.map(m => m.result.loserId);

  switch (roundIdx) {
    case 0: { // WB R1 → LB R1 + WB Semis
      bracket.rounds[1].matches = [
        { a: losers[0], b: losers[3], played: false, result: null },
        { a: losers[1], b: losers[2], played: false, result: null },
      ];
      bracket.rounds[2].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
        { a: winners[2], b: winners[3], played: false, result: null },
      ];
      break;
    }
    case 1: break; // LB R1 done — LB R2 populated when WB Semis finishes

    case 2: { // WB Semis → WB Final + LB R2 (using stored LB R1 winners)
      bracket.rounds[4].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
      ];
      const lbR1W = bracket.rounds[1].matches.map(m => m.result.winnerId);
      bracket.rounds[3].matches = [
        { a: lbR1W[0], b: losers[0], played: false, result: null },
        { a: lbR1W[1], b: losers[1], played: false, result: null },
      ];
      break;
    }
    case 3: { // LB R2 → LB Semis
      bracket.rounds[5].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
      ];
      break;
    }
    case 4: { // WB Final → store champ + loser; try LB Final
      bracket._wbChampion = winners[0];
      bracket._wbFLoser   = losers[0];
      _tryPopulateChampsLBFinal(bracket);
      break;
    }
    case 5: { // LB Semis → try LB Final
      _tryPopulateChampsLBFinal(bracket);
      break;
    }
    case 6: { // LB Final → Grand Final
      bracket.rounds[7].matches = [
        { a: bracket._wbChampion, b: winners[0], played: false, result: null },
      ];
      break;
    }
    case 7: { // Grand Final → champion
      bracket.champion = winners[0];
      major.completed  = true;
      return { roundIdx, allComplete: true };
    }
  }

  return { roundIdx, allComplete: false };
}


function _resolveMajorCompletion(major) {
  const bracket = major?.bracket;
  if (!major || !bracket) return false;
  if (major.completed) return true;

  const rounds = bracket.rounds || [];
  const gfRound = rounds.find(r => r.type === "GF") || rounds[rounds.length - 1];
  const gfMatch = gfRound?.matches?.[0] || null;

  if (gfMatch?.played && gfMatch.result?.winnerId) {
    bracket.champion = bracket.champion || gfMatch.result.winnerId;
    major.completed = true;
    return true;
  }

  const hasUnplayed = rounds.some(r => (r.matches || []).some(m => !m.played));
  if (!hasUnplayed && bracket.champion) {
    major.completed = true;
    return true;
  }

  return false;
}

export function debugMajorBracketState(major, gameState = null) {
  const bracket = major?.bracket;
  const cdlIds = new Set(CDL_TEAMS.map(t => t.id));
  const eventIds = new Set(Object.keys(gameState?.schedule?.currentMajorEventTeams || {}));
  const playerTeamIds = new Set((gameState?.players || []).map(p => p.teamId).filter(Boolean));
  const prospectTeamIds = new Set((gameState?.prospects || []).map(p => p.teamId || p.challengerTeamId).filter(Boolean));
  const knownIds = new Set([...cdlIds, ...eventIds, ...playerTeamIds, ...prospectTeamIds, ...(bracket?.seeds || [])]);
  const rounds = bracket?.rounds || [];
  const matchRows = rounds.flatMap((round, roundIdx) => (round.matches || []).map((match, matchIdx) => ({ roundIdx, roundName: round.name, matchIdx, match })));
  const nextSimmable = matchRows.find(({ match }) => !match.played && match.a && match.b) || null;
  const blockedMatches = matchRows
    .filter(({ match }) => !match.played && (!match.a || !match.b))
    .map(({ roundIdx, roundName, matchIdx, match }) => ({ roundIdx, roundName, matchIdx, a: match.a ?? null, b: match.b ?? null }));
  const invalidTeamMatches = gameState ? matchRows
    .filter(({ match }) => [match.a, match.b].some(id => id && !knownIds.has(id)))
    .map(({ roundIdx, roundName, matchIdx, match }) => ({ roundIdx, roundName, matchIdx, a: match.a ?? null, b: match.b ?? null })) : [];

  return {
    bracketType: bracket?.type ?? null,
    majorCompleted: !!major?.completed,
    bracketCompleted: !!bracket?.completed,
    champion: major?.champion ?? bracket?.champion ?? null,
    totalMatches: matchRows.length,
    completedMatches: matchRows.filter(({ match }) => match.played).length,
    pendingMatches: matchRows.filter(({ match }) => !match.played).length,
    pendingMatchesWithBothTeams: matchRows
      .filter(({ match }) => !match.played && match.a && match.b)
      .map(({ roundIdx, roundName, matchIdx, match }) => ({ roundIdx, roundName, matchIdx, a: match.a, b: match.b })),
    blockedMatches,
    invalidTeamMatches,
    nextSimmableMatch: nextSimmable ? {
      roundIdx: nextSimmable.roundIdx,
      roundName: nextSimmable.roundName,
      matchIdx: nextSimmable.matchIdx,
      a: nextSimmable.match.a,
      b: nextSimmable.match.b,
    } : null,
    unresolvedRounds: rounds
      .map((round, roundIdx) => ({
        roundIdx,
        roundName: round.name,
        matchCount: round.matches?.length || 0,
        unresolvedSlots: (round.matches || []).filter(m => !m.played && (!m.a || !m.b)).length,
        unplayedReady: (round.matches || []).filter(m => !m.played && m.a && m.b).length,
      }))
      .filter(round => round.unresolvedSlots > 0 || round.unplayedReady > 0),
  };
}

function _simOneMajorMatchDE16(schedule, gameState, precomputedResult = null) {
  const majorIdx = schedule.majorIdx;
  const major = schedule.majors[majorIdx];
  const bracket = major.bracket;
  let roundIdx = -1;
  for (let r = 0; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r];
    if (round.matches.length > 0 && round.matches.some(m => !m.played)) { roundIdx = r; break; }
  }
  if (roundIdx === -1) return { roundIdx: -1, allComplete: true };
  const round = bracket.rounds[roundIdx];
  const matchIdx = round.matches.findIndex(m => !m.played);
  const match = round.matches[matchIdx];
  const result = precomputedResult ?? (() => {
    const seed = majorSeed(schedule.season, majorIdx, roundIdx, matchIdx);
    return simMatch(buildTeamObj(match.a, gameState), buildTeamObj(match.b, gameState), seed);
  })();
  match.played = true; match.result = result;
  schedule.matchLog.push({ ...result, stage: `${major.name} – ${round.name}` });
  if (!round.matches.every(m => m.played)) return { roundIdx, allComplete: false };
  const winners = round.matches.map(m => m.result.winnerId);
  const losers = round.matches.map(m => m.result.loserId);
  switch (roundIdx) {
    case 0:
      bracket.rounds[1].matches = [{ a: losers[0], b: losers[1], played:false,result:null},{ a: losers[2], b: losers[3], played:false,result:null},{ a: losers[4], b: losers[5], played:false,result:null},{ a: losers[6], b: losers[7], played:false,result:null}];
      bracket.rounds[2].matches = [{ a:winners[0], b:winners[1], played:false,result:null},{ a:winners[2], b:winners[3], played:false,result:null},{ a:winners[4], b:winners[5], played:false,result:null},{ a:winners[6], b:winners[7], played:false,result:null}];
      break;
    case 1: break;
    case 2: {
      bracket.rounds[5].matches = [{ a:winners[0], b:winners[1], played:false,result:null},{ a:winners[2], b:winners[3], played:false,result:null}];
      const lb1w = bracket.rounds[1].matches.map(m=>m.result.winnerId);
      bracket.rounds[3].matches = [{a:lb1w[0], b:losers[0], played:false,result:null},{a:lb1w[1], b:losers[1], played:false,result:null},{a:lb1w[2], b:losers[2], played:false,result:null},{a:lb1w[3], b:losers[3], played:false,result:null}];
      break;
    }
    case 3: bracket.rounds[4].matches = [{a:winners[0],b:winners[1],played:false,result:null},{a:winners[2],b:winners[3],played:false,result:null}]; break;
    case 4: bracket._lbr3Winners = winners; break;
    case 5:
      bracket.rounds[7].matches = [{ a:winners[0], b:winners[1], played:false,result:null }];
      bracket.rounds[6].matches = [{ a: bracket._lbr3Winners[0], b: losers[0], played:false,result:null},{ a: bracket._lbr3Winners[1], b: losers[1], played:false,result:null}];
      break;
    case 6: bracket.rounds[8].matches = [{ a:winners[0], b:winners[1], played:false,result:null }]; break;
    case 7: bracket._wbChampion=winners[0]; bracket._wbFLoser=losers[0]; _tryPopulateLBFinal(bracket); break;
    case 8: _tryPopulateLBFinal(bracket); break;
    case 9: bracket.rounds[10].matches = [{ a:bracket._wbChampion, b:winners[0], played:false,result:null }]; break;
    case 10: bracket.champion=winners[0]; major.completed=true; return { roundIdx, allComplete:true };
  }
  return { roundIdx, allComplete:false };
}

// ── Internal: play one DE major match ─────────────────────────────────────────
// precomputedResult: if provided, skips simMatch and uses it directly (interactive play).
function _simOneMajorMatchDE(schedule, gameState, precomputedResult = null) {
  const majorIdx = schedule.majorIdx;
  const major    = schedule.majors[majorIdx];
  const bracket  = major.bracket;

  let roundIdx = -1;
  for (let r = 0; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r];
    if (round.matches.length > 0 && round.matches.some(m => !m.played)) {
      roundIdx = r;
      break;
    }
  }
  if (roundIdx === -1) return { roundIdx: -1, allComplete: true };

  const round    = bracket.rounds[roundIdx];
  const matchIdx = round.matches.findIndex(m => !m.played);
  const match    = round.matches[matchIdx];

  const result = precomputedResult ?? (() => {
    const seed  = majorSeed(schedule.season, majorIdx, roundIdx, matchIdx);
    const teamA = buildTeamObj(match.a, gameState);
    const teamB = buildTeamObj(match.b, gameState);
    return simMatch(teamA, teamB, seed);
  })();

  match.played = true;
  match.result = result;
  schedule.matchLog.push({ ...result, stage: `${major.name} – ${round.name}` });

  const roundDone = round.matches.every(m => m.played);
  if (!roundDone) return { roundIdx, allComplete: false };

  const winners = round.matches.map(m => m.result.winnerId);
  const losers  = round.matches.map(m => m.result.loserId);
  const seeds   = bracket.seeds;

  switch (roundIdx) {
    case 0: { // WB Round 1 → populate LB R1 + WB R2
      bracket.rounds[1].matches = [
        { a: losers[0], b: losers[3], played: false, result: null },
        { a: losers[1], b: losers[2], played: false, result: null },
      ];
      bracket.rounds[2].matches = [
        { a: seeds[0], b: winners[3], seedA: 1, played: false, result: null },
        { a: seeds[1], b: winners[2], seedA: 2, played: false, result: null },
        { a: seeds[2], b: winners[1], seedA: 3, played: false, result: null },
        { a: seeds[3], b: winners[0], seedA: 4, played: false, result: null },
      ];
      break;
    }
    case 1: break; // LB R1 done — LB R2 populated after WB R2

    case 2: { // WB Round 2 → populate WB SF + LB R2; store high losers
      bracket.rounds[5].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
        { a: winners[2], b: winners[3], played: false, result: null },
      ];
      const lbR1W = bracket.rounds[1].matches.map(m => m.result.winnerId);
      bracket.rounds[3].matches = [
        { a: lbR1W[0], b: losers[2], played: false, result: null },
        { a: lbR1W[1], b: losers[3], played: false, result: null },
      ];
      bracket._wbr2LosersHigh = [losers[0], losers[1]];
      break;
    }
    case 3: { // LB R2 → populate LB R3
      const hl = bracket._wbr2LosersHigh;
      bracket.rounds[4].matches = [
        { a: winners[0], b: hl[0], played: false, result: null },
        { a: winners[1], b: hl[1], played: false, result: null },
      ];
      break;
    }
    case 4: { // LB R3 done — store for LB R4 (populated after WB SF)
      bracket._lbr3Winners = winners;
      break;
    }
    case 5: { // WB Semifinals → populate WB Final + LB R4
      bracket.rounds[7].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
      ];
      const lbR3W = bracket._lbr3Winners;
      bracket.rounds[6].matches = [
        { a: lbR3W[0], b: losers[0], played: false, result: null },
        { a: lbR3W[1], b: losers[1], played: false, result: null },
      ];
      break;
    }
    case 6: { // LB R4 → populate LB R5
      bracket.rounds[8].matches = [
        { a: winners[0], b: winners[1], played: false, result: null },
      ];
      break;
    }
    case 7: { // WB Final → store WB champ + loser; try GF
      bracket._wbChampion = winners[0];
      bracket._wbFLoser   = losers[0];
      _tryPopulateLBFinal(bracket);
      break;
    }
    case 8: { // LB R5 → try LB Final
      _tryPopulateLBFinal(bracket);
      break;
    }
    case 9: { // LB Final → populate Grand Final
      bracket.rounds[10].matches = [
        { a: bracket._wbChampion, b: winners[0], played: false, result: null },
      ];
      break;
    }
    case 10: { // Grand Final → champion
      bracket.champion  = winners[0];
      major.completed   = true;
      return { roundIdx, allComplete: true };
    }
  }

  return { roundIdx, allComplete: false };
}

// ── Internal: play exactly ONE unplayed major match ───────────────────────────
// Mutates schedule in place. Returns { roundIdx, allComplete }.
// precomputedResult: if provided, skips simMatch and uses it directly (interactive play).
function _simOneMajorMatch(schedule, gameState, precomputedResult = null) {
  const majorIdx = schedule.majorIdx;
  const major    = schedule.majors[majorIdx];
  const bracket  = major.bracket;

  // Find the first round that still has unplayed matches
  let roundIdx = -1;
  for (let r = 0; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r];
    if (round.matches.length > 0 && round.matches.some(m => !m.played)) {
      roundIdx = r;
      break;
    }
  }
  if (roundIdx === -1) return { roundIdx: -1, allComplete: true };

  const round    = bracket.rounds[roundIdx];
  const matchIdx = round.matches.findIndex(m => !m.played);
  const match    = round.matches[matchIdx];

  const result = precomputedResult ?? (() => {
    const seed  = majorSeed(schedule.season, majorIdx, roundIdx, matchIdx);
    const teamA = buildTeamObj(match.a, gameState);
    const teamB = buildTeamObj(match.b, gameState);
    return simMatch(teamA, teamB, seed);
  })();

  match.played = true;
  match.result = result;

  schedule.matchLog.push({
    ...result,
    stage: `${major.name} – ${round.name}`,
  });

  // If this round is fully played, wire up the next round
  const roundDone = round.matches.every(m => m.played);
  if (roundDone) {
    const winners = round.matches.map(m => m.result.winnerId);
    if (roundIdx + 1 < bracket.rounds.length) {
      const nextMatches = [];
      for (let w = 0; w < winners.length; w += 2) {
        if (w + 1 < winners.length)
          nextMatches.push({ a: winners[w], b: winners[w + 1], played: false, result: null });
      }
      bracket.rounds[roundIdx + 1].matches = nextMatches;
    } else {
      // Grand Final done → major complete
      bracket.champion = winners[0];
      major.completed  = true;
      return { roundIdx, allComplete: true };
    }
  }

  return { roundIdx, allComplete: false };
}

// ── Internal: advance season phase after a major completes ────────────────────
function latestChallengersFinals(schedule) {
  return [...(schedule?.challengerQualifierResults || [])]
    .reverse()
    .find(r => r?.season === schedule?.season && r?.source === "challengersFinals" && r?.completed && r?.teams?.length);
}

function buildEswcEventTeams(gameState, schedule) {
  const finals = latestChallengersFinals(schedule);
  const rows = (finals?.teams || [])
    .filter(t => t.qualified || (t.placement ?? 99) <= CHALLENGERS_FINALS_ESWC_SPOTS)
    .sort((a, b) => a.placement - b.placement)
    .slice(0, CHALLENGERS_FINALS_ESWC_SPOTS);
  const fallbackRows = rows.length >= CHALLENGERS_FINALS_ESWC_SPOTS
    ? rows
    : buildChallengerQualifierField(gameState, schedule).slice(0, CHALLENGERS_FINALS_ESWC_SPOTS);
  return qualifierRowsToEventTeams(
    fallbackRows.map((row, idx) => ({ ...row, placement: row.placement ?? idx + 1, placementLabel: row.placementLabel ?? placementText(row.placement ?? idx + 1), seed: row.seed ?? idx + 1 })),
    gameState,
    { ...schedule, majorIdx: ESWC_MAJOR_IDX },
    "eswc"
  );
}

export function beginEswc(gameState) {
  gameState = withCdlRosterIntegrity(gameState, "before_eswc_generation");
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "offseason") return gameState;
  if (!schedule.majors?.[ESWC_MAJOR_IDX]) {
    schedule.majors = [...(schedule.majors || []), { name: "ESWC", bracket: null, completed: false, eventType: "eswc", pointsAwarded: true }];
  }
  if (schedule.majors[ESWC_MAJOR_IDX]?.completed) return gameState;

  const cdlSeeds = Object.entries(schedule.standings ?? {})
    .sort((a, b) => b[1].points - a[1].points)
    .map(([id]) => id);
  for (const team of CDL_TEAMS) {
    if (!cdlSeeds.includes(team.id)) cdlSeeds.push(team.id);
  }
  // Repair Challenger teams before ESWC so the 4 ESWC Challenger seeds field
  // real players even if a finalist lost a player to CDL since the Finals.
  repairChallengerRosters(gameState);
  const eventTeams = buildEswcEventTeams(gameState, schedule);
  const eswcSeeds = [...cdlSeeds.slice(0, 12), ...eventTeams.map(t => t.id)].slice(0, 16);
  while (eswcSeeds.length < 16) {
    const padId = cdlSeeds[eswcSeeds.length % Math.max(1, cdlSeeds.length)] ?? CDL_TEAMS[0]?.id;
    if (!padId) break;
    eswcSeeds.push(padId);
  }

  schedule.currentMajorEventTeams = Object.fromEntries(eventTeams.map(t => [t.id, t]));
  schedule.majors[ESWC_MAJOR_IDX] = {
    ...(schedule.majors[ESWC_MAJOR_IDX] || {}),
    name: "ESWC",
    eventType: "eswc",
    pointsAwarded: true,
    bracket: buildMajorBracketDE16(eswcSeeds),
    completed: false,
  };
  schedule.pendingPostChampsEswc = false;
  schedule.phase = "major";
  schedule.majorIdx = ESWC_MAJOR_IDX;
  return { ...gameState, schedule: { ...schedule } };
}

function logChallengerTxDiagnostic(label, payload) {
  const enabled = typeof globalThis !== "undefined" && (globalThis.__CLM_DEBUG_CHALLENGER_TX__ || globalThis.__CLM_TRACE_CHALLENGER_TX__);
  if (enabled) console.debug(`[challenger-tx] ${label}`, payload);
}

// Archive the completed season, compute Season Awards (now including ESWC since
// it has finished), and gate them behind the awards overlay. Mutates `schedule`
// to land in the offseason; sets `pendingSeasonAwards` unless this season's
// awards were already shown (legacy saves that saw awards before ESWC).
function gateSeasonAwards(nextState, schedule) {
  schedule.phase    = "offseason";
  schedule.majorIdx = null;
  schedule.pendingPostChampsEswc = false;
  const archived = archiveCompletedSeason(nextState);
  const seasonAwards = calculateSeasonAwards(archived);
  const withAwards = mergeSeasonAwards(archived, seasonAwards);
  const seen = new Set((withAwards.seenAwardsSeasons || []).map(Number));
  return seen.has(Number(seasonAwards.season))
    ? withAwards
    : { ...withAwards, pendingSeasonAwards: seasonAwards };
}

function _advanceMajorPhase(schedule, gameState) {
  const majorIdx = schedule.majorIdx;
  let nextState = gameState;
  const txBeforeMajorCompletion = gameState?.challengerTransactions?.length ?? 0;
  logChallengerTxDiagnostic("before Major completion", { majorIdx, count: txBeforeMajorCompletion });

  // Award Major placement points to CDL teams only (regular majors).
  awardMajorPlacementPoints(schedule, majorIdx);

  const teamIds = CDL_TEAMS.map(t => t.id);

  // Event-team metadata is scoped to a single event. Clear it for every
  // major (regular AND Champs) so a stale entry can never leak into the
  // next phase's rendering or seeding.
  schedule.currentMajorEventTeams = null;
  // Same for the visible qualifier event — once we leave a Major, the
  // qualifier that fed it is done. Keep the historical record in
  // `challengerQualifierResults`.
  schedule.currentChallengerQualifier = null;

  if (majorIdx <= 2) {
    // Major 1/2/3 → next Stage
    // Reset stageStandings now (entering new stage, not when building the bracket)
    schedule.stageStandings = initStandings(teamIds);
    schedule.phase    = "stage";
    schedule.stageIdx = majorIdx + 1;
    schedule.majorIdx = null;
    schedule.currentMatchday = 0;
  } else if (majorIdx === 3) {
    // Major 4 → Challengers Finals → Pre-Champs roster window.
    schedule.stageStandings = initStandings(teamIds);
    schedule.phase = "challengerQualifier";
    schedule.majorIdx = null;
    schedule.currentChallengerQualifier = createChallengersFinalsEvent(nextState, schedule);
  } else if (majorIdx === 4) {
    // Champs → ESWC → Season Awards → Offseason.
    // After Champs the next competitive event is ESWC (if it hasn't run yet).
    // Season Awards are deferred until ESWC completes so they close the year.
    schedule.phase    = "offseason";
    schedule.majorIdx = null;
    const eswcDone = !!schedule.majors?.[ESWC_MAJOR_IDX]?.completed;
    schedule.pendingPostChampsEswc = !eswcDone;
    if (!eswcDone) {
      // Start ESWC immediately; the awards gate runs after ESWC completes.
      nextState = beginEswc(nextState);
    } else {
      // Legacy/edge save: ESWC already completed → straight to the awards gate.
      nextState = gateSeasonAwards(nextState, schedule);
    }
  } else if (majorIdx === ESWC_MAJOR_IDX) {
    // ESWC completes the competitive year → Season Awards → Offseason.
    nextState = gateSeasonAwards(nextState, schedule);
  } else {
    schedule.phase    = "offseason";
    schedule.majorIdx = null;
  }

  // AI roster window after each regular major (not after Champs), once the
  // schedule has safely left the Major phase.  Keep the completed Major index
  // available while the window runs so transaction records are stamped with the
  // event that caused them, then restore the already-advanced schedule.
  if (majorIdx <= 3) {
    const advancedSchedule = { ...schedule };
    const rosterWindowInput = { ...nextState, schedule: { ...advancedSchedule, majorIdx } };
    nextState = runAIMajorRosterWindow(rosterWindowInput, majorIdx);
    logChallengerTxDiagnostic("after runAIMajorRosterWindow", {
      majorIdx,
      before: txBeforeMajorCompletion,
      after: nextState?.challengerTransactions?.length ?? 0,
    });
    nextState = { ...nextState, schedule: advancedSchedule };
  }

  const integrityState = withCdlRosterIntegrity(nextState, majorIdx <= 3 ? "post_major_transition" : majorIdx === ESWC_MAJOR_IDX ? "post_eswc_transition" : "post_champs_transition");
  logChallengerTxDiagnostic("after _advanceMajorPhase returns", {
    majorIdx,
    before: txBeforeMajorCompletion,
    after: integrityState?.challengerTransactions?.length ?? 0,
  });
  return integrityState;
}

// ── PUBLIC: Begin Championship (triggered by user from preChamps window) ───────
export function beginChamps(gameState) {
  gameState = withCdlRosterIntegrity(gameState, "before_champs_generation");
  const schedule = gameState.schedule;
  if (schedule.phase !== "preChamps") return gameState;

  // Champs bracket seeded by cumulative season standings.points.
  // IMPORTANT: build the bracket BEFORE flipping phase/majorIdx so the UI
  // never sees a `phase === "major"` window with a missing or partial
  // bracket — that path used to crash MajorTournamentOverlay/MatchCenter.
  const cdlSeeds = Object.entries(schedule.standings ?? {})
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 12)
    .map(([id]) => id);

  // Defensive: every CDL team must have a standings entry so we end up with
  // exactly 12 CDL seeds. If the save is missing any (legacy/corrupted),
  // fill in zero-record placeholders so seeding doesn't fall short.
  if (cdlSeeds.length < 12) {
    for (const team of CDL_TEAMS) {
      if (!cdlSeeds.includes(team.id) && cdlSeeds.length < 12) cdlSeeds.push(team.id);
    }
  }

  // Repair before baking the Champs Challenger event teams so their rosters are
  // 4 real players at sim time.
  repairChallengerRosters(gameState);
  const eventTeams = simulateChallengerQualifier(gameState, schedule, "champs") ?? [];
  schedule.currentMajorEventTeams = Object.fromEntries(eventTeams.map(t => [t.id, t]));
  const challengerSeedIds = eventTeams.map(t => t.id);
  const champsSeeds = [...cdlSeeds, ...challengerSeedIds];

  // If the qualifier produced fewer than 4 entrants (shouldn't happen, but
  // we've now seen one save where it did), pad with CDL teams so the bracket
  // builder still gets 16 slots and `buildMajorBracketDE16` doesn't index
  // into undefined. Padding with CDL teams is harmless because those seeds
  // simply get a second appearance — far better than a blank screen.
  while (champsSeeds.length < 16) {
    const padId = cdlSeeds[champsSeeds.length - cdlSeeds.length] ?? cdlSeeds[0];
    if (!padId) break;
    champsSeeds.push(padId);
  }

  schedule.majors[4].bracket = buildMajorBracketDE16(champsSeeds);
  schedule.majors[4].completed = false;
  schedule.phase    = "major";
  schedule.majorIdx = 4;
  return { ...gameState, schedule: { ...schedule } };
}

// ── Internal: unified one-match dispatcher ────────────────────────────────────
function _dispatchOneMajorMatch(schedule, gameState) {
  const majorIdx = schedule.majorIdx;
  const bracket = schedule.majors[majorIdx]?.bracket;
  if (bracket?.type === "DE16") return _simOneMajorMatchDE16(schedule, gameState);
  return bracket?.type === "DE"
    ? _simOneMajorMatchDE(schedule, gameState)
    : _simOneMajorMatch(schedule, gameState);
}

// ── PUBLIC: Simulate one major match ──────────────────────────────────────────
export function simNextMajorMatch(gameState) {
  gameState = withCdlRosterIntegrity(gameState, "before_sim_major_match");
  const schedule = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const major = schedule.majors[schedule.majorIdx];
  if (!major) return gameState;
  if (major.completed) {
    const nextState = _advanceMajorPhase(schedule, gameState);
    return { ...nextState, schedule: { ...schedule } };
  }

  const { allComplete } = _dispatchOneMajorMatch(schedule, gameState);
  let nextState = gameState;
  if (allComplete || _resolveMajorCompletion(major)) nextState = _advanceMajorPhase(schedule, gameState);

  return { ...nextState, schedule: { ...schedule } };
}

// ── PUBLIC: Simulate all remaining matches in the current round ───────────────
export function simMajorRound(gameState) {
  gameState = withCdlRosterIntegrity(gameState, "before_sim_major_round");
  const schedule = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const major = schedule.majors[schedule.majorIdx];
  if (!major) return gameState;
  if (major.completed) {
    const nextState = _advanceMajorPhase(schedule, gameState);
    return { ...nextState, schedule: { ...schedule } };
  }

  // Snapshot which round we're starting in so we stop after it finishes
  let startRound = -1;
  for (let r = 0; r < major.bracket.rounds.length; r++) {
    const rnd = major.bracket.rounds[r];
    if (rnd.matches.length > 0 && rnd.matches.some(m => !m.played)) {
      startRound = r;
      break;
    }
  }
  if (startRound === -1) return gameState;

  let safety = 0;
  while (safety++ < 50) {
    const bracket = schedule.majors[schedule.majorIdx].bracket;
    const rnd     = bracket.rounds[startRound];
    if (!rnd || rnd.matches.every(m => m.played)) break;

    const { allComplete } = _dispatchOneMajorMatch(schedule, gameState);
    if (allComplete || _resolveMajorCompletion(schedule.majors[schedule.majorIdx])) {
      gameState = _advanceMajorPhase(schedule, gameState);
      break;
    }
  }

  return { ...gameState, schedule: { ...schedule } };
}

// ── PUBLIC: Simulate the entire remaining bracket ─────────────────────────────
export function simMajor(gameState) {
  gameState = withCdlRosterIntegrity(gameState, "before_sim_major");
  const schedule  = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const targetIdx = schedule.majorIdx;
  const major     = schedule.majors[targetIdx];
  if (!major) return gameState;
  if (major.completed) {
    const nextState = _advanceMajorPhase(schedule, gameState);
    return { ...nextState, schedule: { ...schedule } };
  }

  let safety = 0;
  while (!schedule.majors[targetIdx].completed && safety++ < 200) {
    const before = debugMajorBracketState(schedule.majors[targetIdx], gameState);
    const { allComplete } = _dispatchOneMajorMatch(schedule, gameState);
    const after = debugMajorBracketState(schedule.majors[targetIdx], gameState);
    if (after.completedMatches === before.completedMatches && !allComplete) {
      console.warn("Major simulation stopped without progress", after);
      break;
    }
    if (allComplete || _resolveMajorCompletion(schedule.majors[schedule.majorIdx])) {
      gameState = _advanceMajorPhase(schedule, gameState);
      break;
    }
  }

  if (safety >= 200 && !schedule.majors[targetIdx].completed) {
    console.warn("Major simulation hit safety limit", debugMajorBracketState(schedule.majors[targetIdx], gameState));
  }

  return { ...gameState, schedule: { ...schedule } };
}

// ── Stage simulation ───────────────────────────────────────────────────────────
export function simNextMatch(gameState) {
  gameState = withCdlRosterIntegrity(gameState, "before_sim_next_match");
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "stage") return gameState;

  const stage    = schedule.stages[schedule.stageIdx];
  const unplayed = stage.matches.findIndex(m => !m.played);

  if (unplayed === -1) {
    // Stage done → visible Challenger Qualifier before Major bracket entry.
    return enterChallengerQualifierPhase(gameState, schedule);
  }

  const match = stage.matches[unplayed];
  const seed  = schedule.season * 100_000 + schedule.stageIdx * 10_000 + unplayed;
  const teamA = buildTeamObj(match.a, gameState);
  const teamB = buildTeamObj(match.b, gameState);
  const result = simMatch(teamA, teamB, seed);

  match.played = true;
  match.result = result;

  // Update cumulative season standings
  schedule.standings[result.winnerId].wins++;
  schedule.standings[result.winnerId].points += 10;
  schedule.standings[result.loserId].losses++;

  // Update per-stage standings
  schedule.stageStandings[result.winnerId].wins++;
  schedule.stageStandings[result.winnerId].points += 10;
  schedule.stageStandings[result.loserId].losses++;

  schedule.matchLog.push({ ...result, stage: stage.name });
  schedule.currentMatchday++;

  return { ...gameState, schedule: { ...schedule } };
}

export function simMatchday(gameState) {
  gameState = withCdlRosterIntegrity(gameState, "before_sim_matchday");
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "stage") return gameState;

  const stage           = schedule.stages[schedule.stageIdx];
  const unplayedIndices = stage.matches.map((m, i) => !m.played ? i : -1).filter(i => i !== -1);

  if (unplayedIndices.length === 0) return simNextMatch(gameState);

  const usedTeams    = new Set();
  const todayIndices = [];
  for (const idx of unplayedIndices) {
    const { a, b } = stage.matches[idx];
    if (!usedTeams.has(a) && !usedTeams.has(b)) {
      todayIndices.push(idx);
      usedTeams.add(a);
      usedTeams.add(b);
    }
    if (todayIndices.length === 6) break;
  }

  if (todayIndices.length === 0) return simNextMatch(gameState);

  for (const idx of todayIndices) {
    const match  = stage.matches[idx];
    if (match.played) continue;
    const seed   = schedule.season * 100_000 + schedule.stageIdx * 10_000 + idx;
    const teamA  = buildTeamObj(match.a, gameState);
    const teamB  = buildTeamObj(match.b, gameState);
    const result = simMatch(teamA, teamB, seed);

    match.played = true;
    match.result = result;

    // Cumulative season standings
    schedule.standings[result.winnerId].wins++;
    schedule.standings[result.winnerId].points += 10;
    schedule.standings[result.loserId].losses++;

    // Per-stage standings
    schedule.stageStandings[result.winnerId].wins++;
    schedule.stageStandings[result.winnerId].points += 10;
    schedule.stageStandings[result.loserId].losses++;

    schedule.matchLog.push({ ...result, stage: stage.name });
  }

  if (stage.matches.every(m => m.played)) {
    // Stage done → visible Challenger Qualifier before Major bracket entry.
    enterChallengerQualifierPhase(gameState, schedule);
  }

  schedule.currentMatchday++;
  return { ...gameState, schedule: { ...schedule } };
}

export function simStage(gameState) {
  let state = gameState;
  let safety = 0;
  while (state.schedule.phase === "stage" && safety++ < 500)
    state = simMatchday(state);
  return state;
}

// ── Simulate a matchday that always includes the user's next match ─────────────
// Used by the "Play Matchday" overlay so the user's result is guaranteed.
// Fills remaining slots with non-overlapping league matches.
export function simUserMatchday(gameState) {
  gameState = withCdlRosterIntegrity(gameState, "before_sim_user_matchday");
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "stage") return gameState;

  const { userTeamId } = gameState;
  const stage      = schedule.stages[schedule.stageIdx];
  const allUnplayed = stage.matches
    .map((m, i) => (!m.played ? i : -1))
    .filter(i => i !== -1);

  if (allUnplayed.length === 0) return gameState;

  // Find the user's next unplayed match index
  const userMatchIdx = allUnplayed.find(
    i => stage.matches[i].a === userTeamId || stage.matches[i].b === userTeamId
  ) ?? -1;

  if (userMatchIdx < 0) {
    // User has no remaining matches — fall back to a normal matchday
    return simMatchday(gameState);
  }

  // Build today's batch: user's match first, then fill up to 6 with
  // non-overlapping matches from the rest of the unplayed list.
  const { a: ua, b: ub } = stage.matches[userMatchIdx];
  const usedTeams   = new Set([ua, ub]);
  const todayIndices = [userMatchIdx];

  for (const idx of allUnplayed) {
    if (idx === userMatchIdx) continue;
    const { a, b } = stage.matches[idx];
    if (!usedTeams.has(a) && !usedTeams.has(b)) {
      todayIndices.push(idx);
      usedTeams.add(a);
      usedTeams.add(b);
    }
    if (todayIndices.length === 6) break;
  }

  // Simulate each match in the batch
  for (const idx of todayIndices) {
    const match  = stage.matches[idx];
    if (match.played) continue;
    const seed   = schedule.season * 100_000 + schedule.stageIdx * 10_000 + idx;
    const teamA  = buildTeamObj(match.a, gameState);
    const teamB  = buildTeamObj(match.b, gameState);
    const result = simMatch(teamA, teamB, seed);

    match.played = true;
    match.result = result;

    schedule.standings[result.winnerId].wins++;
    schedule.standings[result.winnerId].points += 10;
    schedule.standings[result.loserId].losses++;

    schedule.stageStandings[result.winnerId].wins++;
    schedule.stageStandings[result.winnerId].points += 10;
    schedule.stageStandings[result.loserId].losses++;

    schedule.matchLog.push({ ...result, stage: stage.name });
  }

  // If stage is now complete, advance to major phase
  if (stage.matches.every(m => m.played)) {
    enterChallengerQualifierPhase(gameState, schedule);
  }

  schedule.currentMatchday++;
  return { ...gameState, schedule: { ...schedule } };
}

// ── Retirement ────────────────────────────────────────────────────────────────
// Called after players are aged but before progression runs.
// Returns the filtered player/prospect arrays and a list of retirees.
//
// Age curves (probability of retiring at that age):
//   < 27:  0     — too young to consider retirement
//   27:    3 %
//   28:    8 %
//   29:   20 %
//   30:   35 %
//   31:   50 %
//   32:   65 %
//   33+:  80 %
//
// Modifiers:
//   Elite (90+ OVR)    → ×0.25  (stars play longer)
//   Strong  (87–89)    → ×0.45
//   Solid   (83–86)    → ×0.65
//   Heavy decline      → ×1.5   (well below potential accelerates exit)
//
// Uses Math.random() intentionally so retirements vary between saves (genuine
// career uncertainty), unlike the seeded roster AI decisions.
function runRetirements(players, prospects, season) {
  const retired = [];

  const activePlayers = players.filter(p => {
    const age     = p.age || 22;
    const overall = p.overall || 70;

    if (age < 27) return true;

    let prob = age >= 33 ? 0.80
             : age >= 32 ? 0.65
             : age >= 31 ? 0.50
             : age >= 30 ? 0.35
             : age >= 29 ? 0.20
             : age >= 28 ? 0.08
             :              0.03; // 27

    // Elite players can sustain longer careers
    if      (overall >= 90) prob *= 0.25;
    else if (overall >= 87) prob *= 0.45;
    else if (overall >= 83) prob *= 0.65;

    // Players far below their potential are already declining — they go sooner
    const pot = p.potential || overall;
    if (overall < pot - 12) prob = Math.min(0.95, prob * 1.5);

    if (Math.random() < prob) {
      retired.push({ ...p, retiredSeason: season });
      return false;
    }
    return true;
  });

  // Old unsigned challengers can also age out.
  // Threshold raised to 30 so decent 29-year-olds stay visible.
  // Strong players (75+ OVR) resist retirement — they are still attractive signings.
  const activeProspects = prospects.filter(p => {
    const age = p.age || 20;
    const ovr = p.overall || 70;
    if (age < 30) return true;
    if (ovr >= 75) return Math.random() > 0.35; // strong veterans: ~35 % retire
    return Math.random() > 0.55;                // weak old prospects: ~55 % retire
  });

  return { activePlayers, activeProspects, retired };
}

// ── Contract phase entry ──────────────────────────────────────────────────────
// Transitions from "offseason" → "contracts" so the user can review expiring
// contracts before the offseason actually advances.
// Also migrates any legacy players that were saved without contractYears.
export function enterContractPhase(gameState) {
  const schedule = gameState.schedule;
  if (schedule.phase !== "offseason") return gameState;

  // Migrate legacy saves: assign contractYears to players who don't have it yet
  const players = (gameState.players || []).map(p => {
    if (p.contractYears != null) return p;
    const id = p.id || p.name || "";
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
    return { ...p, contractYears: (h % 3) + 1 };
  });

  return withCdlRosterIntegrity({
    ...gameState,
    players,
    schedule: { ...schedule, phase: "contracts" },
  }, "enter_contract_phase");
}

// ── Offseason ─────────────────────────────────────────────────────────────────
export function advanceOffseason(gameState) {
  if (gameState.schedule?.phase === "offseason" && gameState.offseason?.freeAgencyOpen) {
    const outgoingSeason = gameState.offseason?.outgoingSeason ?? gameState.schedule?.season ?? gameState.season ?? 1;
    const newSeason = gameState.offseason?.newSeason ?? outgoingSeason + 1;
    const marketState = runAIFreeAgencyMarket(gameState);
    // Release any duplicate-named CDL players created during AI moves before the
    // integrity pass refills, so the new season never starts with a name active
    // on two CDL teams.
    const withAiMoves = resolveDuplicateActiveCdlNames(runAIOffseasonRosterWindow(marketState));
    const newSeasonState = withCdlRosterIntegrity(advanceHistoricalEraIfNeeded({
      ...withAiMoves,
      schedule: buildSeason(newSeason),
      season: newSeason,
      offseason: { ...(withAiMoves.offseason || {}), freeAgencyOpen: false, completedFreeAgencySeason: outgoingSeason },
    }), "post_offseason");
    // Repair Challenger rosters at the start of the new season (spec: run after
    // offseason roster movement / at season start). This drops stale duplicate
    // references (e.g. a Challenger-pool player whose name now matches an active
    // CDL player) and backfills from the leftover free-agent / prospect pool, so
    // Challenger teams never carry dead-weight slots into the new season.
    repairChallengerRosters(newSeasonState);
    return newSeasonState;
  }

  const standings      = gameState.schedule?.standings ?? {};
  const newSeason      = (gameState.schedule?.season ?? 1) + 1;
  const outgoingSeason = gameState.schedule?.season ?? 1;
  const matchLog       = gameState.schedule?.matchLog ?? [];

  // Accumulate this season's matchLog into per-player season stats before wiping
  const playerSeasonStats = { ...(gameState.playerSeasonStats ?? {}) };
  for (const result of matchLog) {
    if (!result.playerStats) continue;
    for (const [playerId, stats] of Object.entries(result.playerStats)) {
      if (!playerSeasonStats[playerId]) playerSeasonStats[playerId] = [];
      let entry = playerSeasonStats[playerId].find(e => e.season === outgoingSeason);
      if (!entry) {
        entry = { season: outgoingSeason, kills: 0, deaths: 0, matches: 0 };
        playerSeasonStats[playerId].push(entry);
      }
      entry.kills   += stats.kills  ?? 0;
      entry.deaths  += stats.deaths ?? 0;
      entry.matches += 1;
    }
  }

  // ── Contract processing ────────────────────────────────────────────────────
  // AI teams no longer auto-renew every expiring contract. Each expiring AI
  // player gets a deterministic keep/release decision based on quality, age,
  // cap pressure, team standing and a small per-save/player roll. Non-renewed
  // players flow through the same decrement/expiry path as user let-walks.
  const sourcePlayers = gameState.players || [];
  const withAIRenewals = sourcePlayers.map(p => {
    if (!p.teamId || p.teamId === gameState.userTeamId) return p;
    const years = p.contractYears ?? 2;
    if (years === 1 && shouldAIRenewExpiringPlayer(p, sourcePlayers, gameState, outgoingSeason)) {
      const demand = getResignDemand(p, 1, gameState.playerSeasonStats, outgoingSeason);
      return { ...p, contractYears: 2, salary: demand };
    }
    return p;
  });

  // Decrement contractYears by 1 for every signed player
  const withDecrement = withAIRenewals.map(p => {
    if (!p.teamId) return p;
    return { ...p, contractYears: Math.max(0, (p.contractYears ?? 2) - 1) };
  });

  // Snapshot teamHistory: record each signed player's team for the outgoing season.
  // Captured pre-expiry so players whose contracts just hit 0 still get their
  // last season's team recorded. Deduplicates if SIGN_PLAYER already wrote it.
  const withTeamHistorySnapshot = withDecrement.map(p => {
    if (!p.teamId) return p;
    const history = p.teamHistory || [];
    if (history.some(e => e.season === outgoingSeason)) return p;
    return { ...p, teamHistory: [...history, { season: outgoingSeason, teamId: p.teamId }] };
  });

  const freeAgencyTransactions = [];
  // Release players whose contracts hit 0 into the open CDL free-agent market.
  // Challenger/inactive/retirement transitions happen only after AI/user market evaluation.
  const withExpiry = withTeamHistorySnapshot.map(p => {
    if (p.teamId && (p.contractYears ?? 1) === 0) {
      const prevTeam = CDL_TEAMS.find(t => t.id === p.teamId);
      freeAgencyTransactions.push({
        type: "FREE_AGENT_ENTERED",
        playerId: p.id,
        playerName: p.name,
        fromTeamId: p.teamId,
        toTeamId: null,
        note: `${p.name} entered free agency after leaving ${prevTeam?.name || p.teamId}.`,
      });
      return { ...p, teamId: null, challengerTeamId: null, isSub: false, contractYears: 0, status: "freeAgent", previousTeamId: p.teamId };
    }
    return p.teamId ? { ...p, status: "cdl", circuit: "cdl" } : p;
  });

  // Age up all players and prospects, reset form
  const agedPlayers = withExpiry.map(p => ({
    ...p,
    age:        (p.age || 18) + 1,
    experience: (p.experience || 0) + 1,
    form:       70,
  }));

  const agedProspects = (gameState.prospects || []).map(p => ({
    ...p,
    age:        (p.age || 18) + 1,
    experience: (p.experience || 0),
    form:       65,
  }));

  // Retire players who have aged out before running progression on survivors.
  // Retirees are removed from rosters and free agency; teams will fill vacated
  // slots through the AI offseason roster window that runs after this.
  const { activePlayers, activeProspects, retired } =
    runRetirements(agedPlayers, agedProspects, outgoingSeason);

  // Run progression/regression on the aged survivors
  const { updatedPlayers, updatedProspects, progressionLog } =
    runProgression(activePlayers, activeProspects, standings, newSeason);

  // ── Build playerOvrHistory from this season's progression ────────────────
  // Records the OVR each player *played at* during the outgoing season
  // (oldOverall = pre-progression OVR = what they were rated all season).
  const playerOvrHistory = { ...(gameState.playerOvrHistory ?? {}) };
  for (const entry of progressionLog) {
    if (!playerOvrHistory[entry.id]) playerOvrHistory[entry.id] = [];
    playerOvrHistory[entry.id] = [
      ...playerOvrHistory[entry.id],
      { season: outgoingSeason, overall: entry.oldOverall },
    ];
  }

  // ── Refresh prospect pool for the incoming season ─────────────────────────
  // Runs after progression so newly-aged prospects are evaluated with their
  // updated overalls. Only touches unsigned challengers (updatedProspects).
  // Signed former-prospects are in updatedPlayers and are never affected.
  const { prospects: refreshedProspects, metrics: poolMetrics } =
    refreshProspectPool(updatedProspects, newSeason);

  // ── Build a per-season challengers ecosystem snapshot ────────────────────
  // Stored in state.challengersLog for the Pool Health report panel.
  const retiredProspectCount = retired.filter(r => r.isProspect).length;
  const rp = refreshedProspects; // shorthand
  const challengersEntry = {
    season:              newSeason,
    poolSize:            rp.length,
    avgAge:              rp.length ? +(rp.reduce((s, p) => s + (p.age || 20), 0) / rp.length).toFixed(1) : 0,
    avgOvr:              rp.length ? +(rp.reduce((s, p) => s + (p.overall || 70), 0) / rp.length).toFixed(1) : 0,
    removedByRetirement: retiredProspectCount,
    removedByCleanup:    poolMetrics.removedByCleanup,
    annualIntake:        poolMetrics.annualIntake,
    topUpCount:          poolMetrics.topUpCount,
    removedByCap:        poolMetrics.removedByCap,
  };

  const txBase = [...(gameState.challengerTransactions || [])];
  const txKeys = new Set(txBase.map(tx => [tx.season ?? "", tx.type ?? "", tx.playerId ?? tx.playerName ?? "", tx.fromTeamId ?? "", tx.toTeamId ?? ""].join("|")));
  const challengerTransactions = [...txBase];
  for (const entry of freeAgencyTransactions) {
    const tx = { season: outgoingSeason, stageIdx: gameState.schedule?.stageIdx ?? null, majorIdx: gameState.schedule?.majorIdx ?? null, ...entry };
    const key = [tx.season ?? "", tx.type ?? "", tx.playerId ?? tx.playerName ?? "", tx.fromTeamId ?? "", tx.toTeamId ?? ""].join("|");
    if (!txKeys.has(key)) {
      txKeys.add(key);
      challengerTransactions.push(tx);
    }
  }

  const withProgression = {
    ...gameState,
    players:          updatedPlayers.map(p => (!p.teamId && !p.isProspect && !isInactivePlayer(p) && !p.status) ? { ...p, status: "freeAgent", contractYears: 0 } : p),
    prospects:        refreshedProspects,
    progressionLog,
    playerSeasonStats,
    playerOvrHistory,
    retiredPlayers:   [...(gameState.retiredPlayers || []), ...retired],
    challengersLog:   [...(gameState.challengersLog || []), challengersEntry],
    challengerTransactions,
    schedule:         { ...gameState.schedule, phase: "offseason" },
    offseason:        { ...(gameState.offseason || {}), freeAgencyOpen: true, contractsProcessed: true, outgoingSeason, newSeason },
  };

  if (gameState.schedule?.phase === "contracts") {
    // Contracts → free-agency window keeps the SAME season (no new schedule is
    // built yet), so the historical era must NOT advance here. The era/title
    // reveal happens exactly once, when the new season is built below (or in the
    // freeAgencyOpen finalize path). Advancing here as well would skip an era.
    return withCdlRosterIntegrity(withProgression, "open_free_agency");
  }

  const marketState = runAIFreeAgencyMarket(withProgression);
  const withAiMoves = runAIOffseasonRosterWindow(marketState);
  return withCdlRosterIntegrity(advanceHistoricalEraIfNeeded({
    ...withAiMoves,
    schedule: buildSeason(newSeason),
    season: newSeason,
    offseason: { ...(withAiMoves.offseason || {}), freeAgencyOpen: false, completedFreeAgencySeason: outgoingSeason },
  }), "post_offseason");
}

// ── Prospect Pool Refresh ─────────────────────────────────────────────────────
// Called each offseason after progression to:
//   1. Remove old/weak unsigned challengers so the pool doesn't bloat
//   2. Inject ~20 fresh young prospects for the coming season
//
// Tier breakdown per class (total ~20):
//   elite — 2–4 players: age 18–20, OVR 75–83, POT 87–95  (rare; 2–4 per year)
//   mid   — 4–6 players: age 18–21, OVR 65–74, POT 75–88
//   low   — remainder:   age 18–21, OVR 56–68, POT 65–80
//
// Cleanup rules:
//   • age 26+ AND overall < 70  → always removed
//   • age 25+ AND overall < 67  → 70 % chance to remove
//   • age 24+ AND overall < 62  → 80 % chance to remove
//   Pool hard-capped at 60 total after additions.

// CDL-style gamertag name pool for generated prospects
const FRESH_PROSPECT_NAMES = [
  "Ace","Akro","Alch","Ambit","Anvil","Apex","Arc","Arcen","Ardyn","Arkz",
  "Arrow","Ash","Astro","Atlas","Attax","Axen","Azek","Bane","Baron","Bash",
  "Beam","Blade","Blitz","Bloom","Bolt","Boxer","Brand","Brash","Briar","Brisk",
  "Calix","Calyx","Capo","Caste","Caven","Chalk","Chaos","Char","Chase","Cipher",
  "Clash","Clef","Clone","Cobal","Colt","Cruz","Cutt","Daven","Decim","Delta",
  "Demon","Derex","Devox","Dexon","Drake","Drive","Dusk","Echo","Edge","Eikon",
  "Elan","Ember","Emile","Enkil","Epoch","Ethos","Exile","Falco","Fang","Fate",
  "Faze","Felix","Fenix","Fiero","Final","Flare","Flex","Flint","Forge","Frost",
  "Ghost","Gild","Glaze","Glyph","Grind","Grit","Gust","Haze","Heft","Helm",
  "Hilt","Hydra","Jace","Jax","Jaxon","Jinx","Jolt","Kael","Kane","Kaos",
  "Lance","Laser","Leon","Locus","Logan","Lotus","Lumen","Mach","Macro","Mako",
  "Mars","Mave","Merge","Midas","Morph","Nash","Navex","Nexus","Nito","Onyx",
  "Optic","Orbit","Parse","Payne","Penta","Phase","Pivot","Pixel","Plax","Prime",
  "Probe","Proxy","Raze","Realm","Reflex","Reign","Renzo","Revo","Rimax","Rivet",
  "Rome","Rouse","Sabre","Saxon","Scale","Scope","Scout","Shade","Shift","Sigil",
  "Siren","Skill","Slash","Slade","Solar","Sonic","Spark","Spawn","Spike","Sprint",
  "Steel","Storm","Strike","Surge","Talon","Tempo","Thorn","Titan","Token","Torque",
  "Trace","Tron","Turbo","Valor","Vault","Vector","Venom","Vertex","Viper","Warden",
  "Warp","Wolf","Wren","Xeon","Xero","Zane","Zeal","Zephyr","Zero","Zinc",
  "Zion","Zulu","Arco","Axle","Grid","Iron","Knox","Lynx","Null","Peak",
  "Rex","Rush","Sage","Salt","Silk","Slab","Smog","Snap","Spec","Spin",
  "Sync","Tide","Tilt","Trix","Vale","Void","Wave","Yoke","Dash","Flair",
  "Crypt","Coal","Prism","Sear","Rend","Veil","Gale","Krux","Daze","Wick",
  "Axiom","Blaze","Breach","Crest","Dusk","Flick","Gloom","Havoc","Influx","Juke",
  "Krypt","Latch","Manor","Niche","Overt","Patch","Quill","Rinse","Shard","Thrax",
  "Umbra","Vault","Wraith","Xylon","Yardx","Zarak","Ardex","Brixon","Cadex","Devoc",
  "Eclip","Fovex","Gaven","Hilex","Idron","Javik","Kenvex","Laxon","Maxen","Noxen",
];

const _REGIONS = ["NA","NA","NA","NA","EU","EU","EU","MENA","MENA"];

// Build one generated prospect for the annual refresh class.
// Uses seeded RNG for stats (reproducible per season+idx) and Math.random() for
// name / region / age so each save's class feels different.
function _buildFreshProspect(tier, idx, season) {
  const tierSeed = tier === "elite" ? 1 : tier === "mid" ? 2 : 3;
  const rng = seededRng(season * 99991 + idx * 1301 + tierSeed * 37);

  const ri = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
  const clamp = (v, lo = 41, hi = 99) => Math.max(lo, Math.min(hi, Math.round(v)));

  // Name — Math.random() so classes vary between saves
  const name = FRESH_PROSPECT_NAMES[Math.floor(Math.random() * FRESH_PROSPECT_NAMES.length)];

  // Age — varies by tier:
  //   elite → always 18–20 (future stars enter young)
  //   mid   → 70 % chance 18–20, 30 % chance 21–22
  //   low   → 50 % chance 19–20, 50 % chance 21–22
  let age;
  if (tier === "elite") {
    age = ri(18, 20);
  } else if (tier === "mid") {
    age = Math.random() < 0.70 ? ri(18, 20) : ri(21, 22);
  } else {
    age = Math.random() < 0.50 ? ri(19, 20) : ri(21, 22);
  }

  // Role
  const role = Math.random() < 0.55 ? "SMG" : "AR";

  // Region — random draw from weighted pool
  const region = _REGIONS[Math.floor(Math.random() * _REGIONS.length)];

  // Primary role within the weapon class
  const smgPrimaries = ["Entry SMG", "Slayer SMG"];
  const arPrimaries  = ["Main AR", "Flex", "Objective", "Search Specialist"];
  const priPool = role === "SMG" ? smgPrimaries : arPrimaries;
  const primary = priPool[Math.floor(rng() * priPool.length)];

  const allPrimaries = ["Entry SMG","Slayer SMG","Flex","Main AR","Objective","Search Specialist"];
  const secondary = allPrimaries[Math.floor(rng() * allPrimaries.length)];

  // Archetype — skew toward raw_upside for youth
  const eliteArchPool = ["raw_upside","raw_upside","raw_upside","smg_heavy","ar_flex","risky_ego"];
  const midArchPool   = ["raw_upside","raw_upside","polished","smg_heavy","ar_flex","glue","search_spec"];
  const lowArchPool   = ["polished","polished","glue","obj_spec","ar_flex","smg_heavy"];
  const archPool = tier === "elite" ? eliteArchPool : tier === "mid" ? midArchPool : lowArchPool;
  const archetype = archPool[Math.floor(rng() * archPool.length)];

  // Development curve
  const curvePick = rng();
  const developmentCurve = curvePick < 0.25 ? "early" : curvePick < 0.75 ? "standard" : "late";

  // Overall + potential per tier
  // Tier A (elite): clear future-star profile — 76–82 OVR, 85+ potential
  // Tier B (mid):   solid prospects         — 68–75 OVR, 78–87 potential
  // Tier C (low):   filler depth            — 60–67 OVR, 65–78 potential
  let overall, potential;
  if (tier === "elite") {
    overall   = ri(76, 82);
    potential = clamp(overall + ri(8, 13), 85, 92);
  } else if (tier === "mid") {
    overall   = ri(68, 75);
    potential = clamp(overall + ri(8, 14), 78, 87);
  } else {
    overall   = ri(60, 67);
    potential = clamp(overall + ri(5, 12), 65, 78);
  }

  // Individual stats
  const isSmg    = primary === "Entry SMG" || primary === "Slayer SMG";
  const isSearch = primary === "Search Specialist";
  const isObj    = primary === "Objective";

  const gunny        = clamp(overall + (isSmg    ? ri(2, 10)  : ri(-7, 4)));
  const awareness    = clamp(overall + (isSearch ? ri(4, 12)  : ri(-6, 6)));
  const objective    = clamp(overall + (isObj    ? ri(4, 12)  : ri(-7, 5)));
  const searchIQ     = clamp(overall + (isSearch ? ri(6, 14)  : ri(-6, 6)));
  const clutch       = clamp(overall + ri(-8,  8));
  const teamwork     = clamp(overall + ri(-10, 10));
  const composure    = clamp(overall + ri(-10, 8));
  const adaptability = clamp(overall + ri(-8,  10));

  // Mental traits (1–5)
  const ego            = ri(1, 5);
  const workEthic      = ri(1, 5);
  const tiltResistance = ri(1, 5);
  const leadership     = ri(1, 5);
  const metaDependence = ri(1, 5);

  // Salary (prospect formula matching prospects.js)
  const salary = Math.round((overall / 99) * 50 + 15) * 1000;

  // Scouted estimates with noise
  const scoutedOverall   = clamp(overall   + ri(-8, 8),  40, 99);
  const scoutedPotential = clamp(potential + ri(-6, 6),  40, 99);

  return {
    id:              `prospect_gen_${season}_${idx}_${tierSeed}`,
    name,
    age,
    role,
    region,
    teamId:          null,
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
    scouted:         false,
    form:            65,
    experience:      0,
    isProspect:      true,
  };
}

// Cleans up stale unsigned challengers and injects a fresh annual class.
// Only operates on the prospects array (unsigned challengers).
// Signed prospects are in gameState.players and are never touched here.
//
// Pool targets: minimum 150  |  fill target 175  |  hard cap 200
// Cleanup removes only clearly weak older players; 75+ OVR are shielded until 32.
// Annual intake: ~15 youth (2–3 Tier A elite, 8–10 Tier B mid, 3–5 Tier C low).
// Top-up batch fires when pool < 150 after annual class, adds mid/low to reach 175.
export function refreshProspectPool(prospects, season) {
  // ── Step 1: Remove old / weak unsigned challengers ───────────────────────
  // Philosophy: only remove players who are clearly washed and too old to develop.
  // Strong unsigned challengers (75+ OVR) are kept regardless of age below 32
  // because they are still valuable signings and interesting for the ecosystem.
  const cleaned = prospects.filter(p => {
    const age = p.age || 20;
    const ovr = p.overall || 70;

    // Shield: strong (75+ OVR) unsigned players kept until 32 — still valuable depth
    if (ovr >= 75 && age < 32) return true;

    // Hard rules — always gone
    if (age >= 30 && ovr < 68) return false;   // old and washed
    if (age >= 28 && ovr < 63) return false;   // older and weak

    // Age 27+ and not strong: 80 % chance to leave the scene
    // (unsigned at 27 with sub-75 OVR — extremely unlikely to ever get signed)
    if (age >= 27 && Math.random() < 0.80) return false;

    // Age 25+ and OVR ≤ 62: clear dead-end, 70 % chance to walk away
    if (age >= 25 && ovr <= 62 && Math.random() < 0.70) return false;

    // Age 26+ and below 68 OVR — 60 % chance (existing soft rule)
    if (age >= 26 && ovr < 68 && Math.random() < 0.60) return false;

    // Age 24+ and below 60 OVR — 50 % chance (existing soft rule)
    if (age >= 24 && ovr < 60 && Math.random() < 0.50) return false;

    return true;
  });

  // ── Step 2: Generate this season's incoming class ────────────────────────
  // Annual youth intake: 2–4 elite, 4–6 mid, rest low — always runs.
  // If the pool is still below the minimum target after the class is added,
  // a top-up batch of mid/low players fills it up to the target fill level.
  const POOL_MIN    = 150; // trigger top-up below this
  const POOL_TARGET = 175; // fill up to this when topping up

  // Annual class: ~15 total in three tiers matching user spec
  //   Tier A (elite): 2–3 — rare future stars (18–20, OVR 76–82, POT 85+)
  //   Tier B (mid):   8–10 — main bulk of class (18–22, OVR 68–75)
  //   Tier C (low):   3–5 — depth filler (19–22, OVR 60–67)
  const eliteCount = Math.floor(Math.random() * 2) + 2;   // 2–3
  const midCount   = Math.floor(Math.random() * 3) + 8;   // 8–10
  const lowCount   = Math.floor(Math.random() * 3) + 3;   // 3–5

  const newClass = [];
  let idx = 0;
  for (let i = 0; i < eliteCount; i++) newClass.push(_buildFreshProspect("elite", idx++, season));
  for (let i = 0; i < midCount;   i++) newClass.push(_buildFreshProspect("mid",   idx++, season));
  for (let i = 0; i < lowCount;   i++) newClass.push(_buildFreshProspect("low",   idx++, season));

  // Top-up: if pool is below POOL_MIN, add a mix of mid/low prospects to reach
  // POOL_TARGET. No bonus elites — those are rare and only come via the annual class.
  const afterAnnual = cleaned.length + newClass.length;
  let topUpCount = 0;
  if (afterAnnual < POOL_MIN) {
    const needed = POOL_TARGET - afterAnnual;
    topUpCount = needed;
    for (let i = 0; i < needed; i++) {
      const tier = Math.random() < 0.30 ? "mid" : "low";
      newClass.push(_buildFreshProspect(tier, idx++, season));
    }
  }

  // ── Step 3: Combine + enforce pool cap (max 200) ─────────────────────────
  const HARD_CAP = 200;
  const combined = [...cleaned, ...newClass];

  let finalProspects;
  let removedByCap = 0;

  if (combined.length <= HARD_CAP) {
    finalProspects = combined;
  } else {
    removedByCap = combined.length - HARD_CAP;
    // Over cap: sort weakest-and-oldest to front so they are trimmed first.
    // Strong players (75+ OVR) are always protected — they sort to the back.
    const sorted = [...combined].sort((a, b) => {
      const ovrA = a.overall || 70, ovrB = b.overall || 70;
      const ageA = a.age    || 20, ageB = b.age    || 20;
      const strongA = ovrA >= 75 ? 1 : 0;
      const strongB = ovrB >= 75 ? 1 : 0;
      if (strongA !== strongB) return strongA - strongB;
      if (ageA !== ageB) return ageB - ageA;
      return ovrA - ovrB;
    });
    finalProspects = sorted.slice(combined.length - HARD_CAP);
  }

  return {
    prospects: finalProspects,
    metrics: {
      beforeCleanup:    prospects.length,
      removedByCleanup: prospects.length - cleaned.length,
      annualIntake:     eliteCount + midCount + lowCount,
      topUpCount,
      removedByCap,
      afterCount:       finalProspects.length,
    },
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────
function activeMatchPlayers(gameState, teamId) {
  const roster = (gameState.players || []).filter(p => p.teamId === teamId);
  const starters = roster.filter(p => !p.isSub);
  return [...starters, ...roster.filter(p => p.isSub)];
}

function buildTeamObj(teamId, gameState) {
  // Attach the team's CDL 2026 map profile so simMatch can derive the veto /
  // map-pool edge. getTeamMapProfile is read-only with a safe fallback, so this
  // works for CDL teams, temporary Challenger event teams, and legacy saves.
  // Active season's role-weight environment — lets the match sim value roster
  // roles by the current Call of Duty title (null for legacy/modern callers has
  // no effect). Only meaningful in Historical Dynasty; modern eras use neutral-ish
  // weights so behaviour is effectively unchanged.
  const eraRoleWeights = gameState.careerMode === "historical" ? (getEra(gameState.currentEraId)?.roleWeights ?? null) : null;
  const eventTeam = gameState.schedule?.currentMajorEventTeams?.[teamId];
  if (eventTeam) {
    return { id: eventTeam.id, name: eventTeam.name, players: eventTeam.players || [], mapProfile: getTeamMapProfile(gameState, teamId), eraRoleWeights };
  }
  const meta    = CDL_TEAMS.find(t => t.id === teamId) ?? { id: teamId, name: teamId };
  const players = activeMatchPlayers(gameState, teamId);
  return { id: meta.id, name: meta.name, players, mapProfile: getTeamMapProfile(gameState, teamId), eraRoleWeights };
}

// Non-seeded form update for interactive match results (mirrors updateForm logic).
function _updateFormSimple(players, won) {
  for (const p of players) {
    const base       = won ? (Math.floor(Math.random() * 7) + 2) : -(Math.floor(Math.random() * 7) + 2);
    const resistance = (p.tiltResistance || 2) - 1;
    const adjusted   = won ? base : Math.max(base + resistance * 2, -12);
    p.form = Math.max(30, Math.min(100, (p.form || 70) + adjusted));
  }
}

// ── Commit interactive user match result ──────────────────────────────────────
// Called after the MatchCenterOverlay finishes. Applies the user's match result
// to the game state exactly as simMatch would, then finishes the rest of the
// matchday / advances the bracket as appropriate.
//
// result — full simMatch-shaped object produced by MatchCenterOverlay
export function commitUserMatchResult(state, result) {
  const schedule = state.schedule;
  if (!schedule) return state;

  // ── Stage phase ─────────────────────────────────────────────────────────────
  if (schedule.phase === "stage") {
    const { userTeamId } = state;
    const stage = schedule.stages[schedule.stageIdx];

    // 1. Find and mark the user's match as played
    const allUnplayed = stage.matches
      .map((m, i) => (!m.played ? i : -1))
      .filter(i => i !== -1);

    const userMatchIdx = allUnplayed.find(
      i => stage.matches[i].a === userTeamId || stage.matches[i].b === userTeamId
    ) ?? -1;

    if (userMatchIdx >= 0) {
      const m = stage.matches[userMatchIdx];
      m.played = true;
      m.result = result;
    }

    // 2. Update standings for the user's match
    schedule.standings[result.winnerId].wins++;
    schedule.standings[result.winnerId].points += 10;
    schedule.standings[result.loserId].losses++;
    schedule.stageStandings[result.winnerId].wins++;
    schedule.stageStandings[result.winnerId].points += 10;
    schedule.stageStandings[result.loserId].losses++;

    // 3. Push user match to matchLog
    schedule.matchLog.push({ ...result, stage: stage.name });

    // 4. Update form on both teams' starters
    const teamAWon = result.winnerId === result.teamAId;
    _updateFormSimple(activeMatchPlayers(state, result.teamAId).slice(0, 4), teamAWon);
    _updateFormSimple(activeMatchPlayers(state, result.teamBId).slice(0, 4), !teamAWon);

    // 5. Sim the remaining non-user matches in the same matchday batch
    const stillUnplayed = stage.matches
      .map((m, i) => (!m.played ? i : -1))
      .filter(i => i !== -1);

    const usedTeams   = new Set([result.teamAId, result.teamBId]);
    const todayIndices = [];

    for (const idx of stillUnplayed) {
      const { a, b } = stage.matches[idx];
      if (!usedTeams.has(a) && !usedTeams.has(b)) {
        todayIndices.push(idx);
        usedTeams.add(a);
        usedTeams.add(b);
      }
      if (todayIndices.length === 5) break; // user was 1st of 6
    }

    for (const idx of todayIndices) {
      const match = stage.matches[idx];
      if (match.played) continue;
      const seed  = schedule.season * 100_000 + schedule.stageIdx * 10_000 + idx;
      const teamA = buildTeamObj(match.a, state);
      const teamB = buildTeamObj(match.b, state);
      const res   = simMatch(teamA, teamB, seed);

      match.played = true;
      match.result = res;

      schedule.standings[res.winnerId].wins++;
      schedule.standings[res.winnerId].points += 10;
      schedule.standings[res.loserId].losses++;
      schedule.stageStandings[res.winnerId].wins++;
      schedule.stageStandings[res.winnerId].points += 10;
      schedule.stageStandings[res.loserId].losses++;
      schedule.matchLog.push({ ...res, stage: stage.name });
    }

    // 6. Advance to major if stage is done
    if (stage.matches.every(m => m.played)) {
      enterChallengerQualifierPhase(state, schedule);
    }

    schedule.currentMatchday++;
    return { ...state, schedule: { ...schedule } };
  }

  // ── Major phase ─────────────────────────────────────────────────────────────
  if (schedule.phase === "major") {
    const bracket = schedule.majors[schedule.majorIdx]?.bracket;
    const isDE    = bracket?.type === "DE";

    const { allComplete } = bracket?.type === "DE16"
      ? _simOneMajorMatchDE16(schedule, state, result)
      : isDE
      ? _simOneMajorMatchDE(schedule, state, result)
      : _simOneMajorMatch(schedule, state, result);

    // Update form on both teams' starters
    const teamAWon = result.winnerId === result.teamAId;
    _updateFormSimple(activeMatchPlayers(state, result.teamAId).slice(0, 4), teamAWon);
    _updateFormSimple(activeMatchPlayers(state, result.teamBId).slice(0, 4), !teamAWon);

    let nextState = state;
    if (allComplete || _resolveMajorCompletion(schedule.majors[schedule.majorIdx])) nextState = _advanceMajorPhase(schedule, state);

    return { ...nextState, schedule: { ...schedule } };
  }

  return state;
}
