// src/engine/seasonEngine.js
// Drives the CDL season structure:
//   Stage 1 → Major 1 → Stage 2 → Major 2 → Championship → Offseason
//
// Major bracket is single-elimination, 8 teams seeded by standings points.
// Three levels of major simulation are exposed:
//   simNextMajorMatch  – one match at a time
//   simMajorRound      – all matches in the current round
//   simMajor           – the full remaining bracket

import { simMatch } from "./matchSim.js";
import { CDL_TEAMS } from "../data/teams.js";
import { runProgression } from "./progression.js";
import { runAIMajorRosterWindow, runAIOffseasonRosterWindow } from "./rosterAI.js";

// ── Stat accumulation helper ──────────────────────────────────────────────────
// Merges one match's playerStats into the running season totals.
// result.playerStats = { [id]: { kills, deaths, kd, name, teamId } }
function accumulateMatchStats(existing, result) {
  if (!result?.playerStats) return existing;
  const updated = { ...existing };
  for (const [id, stat] of Object.entries(result.playerStats)) {
    const prev = updated[id] ?? { kills: 0, deaths: 0, matches: 0 };
    updated[id] = {
      kills:   prev.kills   + (stat.kills   || 0),
      deaths:  prev.deaths  + (stat.deaths  || 0),
      matches: prev.matches + 1,
    };
  }
  return updated;
}

// ── PRNG / helpers ────────────────────────────────────────────────────────────
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
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

// Deterministic seed for a specific major match (no seed collisions)
function majorSeed(season, majorIdx, roundIdx, matchIdx) {
  return season * 1_000_000 + majorIdx * 100_000 + (roundIdx + 1) * 10_000 + (matchIdx + 1) * 100 + 7;
}

// ── Initial standings ─────────────────────────────────────────────────────────
export function initStandings(teamIds) {
  return Object.fromEntries(teamIds.map(id => [id, { wins: 0, losses: 0, points: 0 }]));
}

// ── Build season schedule ─────────────────────────────────────────────────────
export function buildSeason(season) {
  const teamIds = CDL_TEAMS.map(t => t.id);
  const rng = seededRng(season * 9999 + 1);

  return {
    season,
    stages: [
      { name: "Stage 1", matches: shuffle(buildRoundRobin(teamIds), rng).map(([a, b]) => ({ a, b, played: false, result: null })) },
      { name: "Stage 2", matches: shuffle(buildRoundRobin(teamIds), rng).map(([a, b]) => ({ a, b, played: false, result: null })) },
    ],
    majors: [
      { name: "Major 1",      bracket: null, completed: false },
      { name: "Major 2",      bracket: null, completed: false },
      { name: "Championship", bracket: null, completed: false },
    ],
    standings: initStandings(teamIds),
    currentStage: 0,
    currentMatchday: 0,
    phase: "stage",   // "stage" | "major" | "offseason"
    matchLog: [],
  };
}

// ── Build major bracket ───────────────────────────────────────────────────────
// Seeds top 8 teams by standings points into a single-elim bracket.
// Seeding: 1v8, 2v7, 3v6, 4v5
function buildMajorBracket(standings) {
  const sorted = Object.entries(standings)
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 8)
    .map(([id]) => id);

  return {
    seeds: sorted,   // index 0 = seed 1, index 7 = seed 8
    rounds: [
      {
        name: "Quarterfinals",
        matches: [
          { a: sorted[0], b: sorted[7], seedA: 1, seedB: 8, played: false, result: null },
          { a: sorted[1], b: sorted[6], seedA: 2, seedB: 7, played: false, result: null },
          { a: sorted[2], b: sorted[5], seedA: 3, seedB: 6, played: false, result: null },
          { a: sorted[3], b: sorted[4], seedA: 4, seedB: 5, played: false, result: null },
        ],
      },
      { name: "Semifinals",  matches: [] },
      { name: "Grand Final", matches: [] },
    ],
    completed: false,
    champion: null,
  };
}

// ── Internal: play exactly ONE unplayed major match ───────────────────────────
// Mutates schedule in place (consistent with the rest of the engine).
// Returns { roundIdx, allComplete }
function _simOneMajorMatch(schedule, gameState) {
  const majorIdx = schedule.currentStage;
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
  if (roundIdx === -1) return { roundIdx: -1, allComplete: true, result: null };

  const round    = bracket.rounds[roundIdx];
  const matchIdx = round.matches.findIndex(m => !m.played);
  const match    = round.matches[matchIdx];

  const seed  = majorSeed(schedule.season, majorIdx, roundIdx, matchIdx);
  const teamA = buildTeamObj(match.a, gameState);
  const teamB = buildTeamObj(match.b, gameState);
  const result = simMatch(teamA, teamB, seed);

  match.played = true;
  match.result = result;

  schedule.matchLog.push({
    ...result,
    stage: `${major.name} – ${round.name}`,
  });

  // If this round is now fully played, wire up the next round
  const roundDone = round.matches.every(m => m.played);
  if (roundDone) {
    const winners = round.matches.map(m => m.result.winnerId);

    if (roundIdx + 1 < bracket.rounds.length) {
      // Build next round matchups from this round's winners
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
      return { roundIdx, allComplete: true, result };
    }
  }

  return { roundIdx, allComplete: false, result };
}

// Internal: advance season phase after a major completes
function _advanceMajorPhase(schedule, gameState) {
  const majorIdx = schedule.currentStage;
  let nextState = gameState;

  if (majorIdx <= 1) nextState = runAIMajorRosterWindow(nextState, majorIdx);
  if (majorIdx === 0) {
    // Major 1 → Stage 2
    schedule.phase = "stage";
    schedule.currentStage = 1;
    schedule.currentMatchday = 0;
  } else if (majorIdx === 1) {
    // Major 2 → Championship
    schedule.phase = "major";
    schedule.currentStage = 2;
    schedule.majors[2].bracket = buildMajorBracket(schedule.standings);
  } else {
    // Championship → Offseason
    schedule.phase = "offseason";
  }

  return nextState;
}

// ── PUBLIC: Simulate one major match ─────────────────────────────────────────
export function simNextMajorMatch(gameState) {
  const schedule = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const major = schedule.majors[schedule.currentStage];
  if (!major || major.completed) return gameState;

  const { allComplete, result } = _simOneMajorMatch(schedule, gameState);
  const updatedStats = accumulateMatchStats(gameState.playerSeasonStats ?? {}, result);
  let nextState = { ...gameState, playerSeasonStats: updatedStats };
  if (allComplete) nextState = _advanceMajorPhase(schedule, nextState);

  return { ...nextState, schedule: { ...schedule } };
}

// ── PUBLIC: Simulate all remaining matches in the current round ───────────────
export function simMajorRound(gameState) {
  const schedule = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const major = schedule.majors[schedule.currentStage];
  if (!major || major.completed) return gameState;

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

  let accStats = gameState.playerSeasonStats ?? {};
  let safety = 0;
  while (safety++ < 20) {
    const bracket = schedule.majors[schedule.currentStage].bracket;
    const rnd     = bracket.rounds[startRound];
    if (!rnd || rnd.matches.every(m => m.played)) break;

    const { allComplete, result } = _simOneMajorMatch(schedule, gameState);
    if (result) accStats = accumulateMatchStats(accStats, result);
    if (allComplete) {
      gameState = _advanceMajorPhase(schedule, { ...gameState, playerSeasonStats: accStats });
      break;
    }
  }

  return { ...gameState, playerSeasonStats: accStats, schedule: { ...schedule } };
}

// ── PUBLIC: Simulate the entire remaining bracket ─────────────────────────────
export function simMajor(gameState) {
  const schedule  = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const targetIdx = schedule.currentStage;   // the major we want to complete
  const major     = schedule.majors[targetIdx];
  if (!major || major.completed) return gameState;

  let accStats = gameState.playerSeasonStats ?? {};
  let safety = 0;
  while (!schedule.majors[targetIdx].completed && safety++ < 100) {
    const { allComplete, result } = _simOneMajorMatch(schedule, gameState);
    if (result) accStats = accumulateMatchStats(accStats, result);
    if (allComplete) {
      gameState = _advanceMajorPhase(schedule, { ...gameState, playerSeasonStats: accStats });
      break;
    }
  }

  return { ...gameState, playerSeasonStats: accStats, schedule: { ...schedule } };
}

// ── Stage simulation (unchanged) ──────────────────────────────────────────────

export function simNextMatch(gameState) {
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase === "offseason") return gameState;

  const stage    = schedule.stages[schedule.currentStage];
  const unplayed = stage.matches.findIndex(m => !m.played);

  if (unplayed === -1) {
    schedule.phase = "major";
    schedule.majors[schedule.currentStage].bracket = buildMajorBracket(schedule.standings);
    return { ...gameState, schedule: { ...schedule } };
  }

  const match = stage.matches[unplayed];
  const seed  = schedule.season * 100_000 + schedule.currentStage * 10_000 + unplayed;
  const teamA = buildTeamObj(match.a, gameState);
  const teamB = buildTeamObj(match.b, gameState);
  const result = simMatch(teamA, teamB, seed);

  match.played = true;
  match.result = result;

  schedule.standings[result.winnerId].wins++;
  schedule.standings[result.winnerId].points += 3;
  schedule.standings[result.loserId].losses++;
  schedule.standings[result.loserId].points += 1;

  schedule.matchLog.push({ ...result, stage: stage.name });
  schedule.currentMatchday++;

  const updatedStats = accumulateMatchStats(gameState.playerSeasonStats ?? {}, result);
  return { ...gameState, schedule: { ...schedule }, playerSeasonStats: updatedStats };
}

export function simMatchday(gameState) {
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "stage") return gameState;

  const stage           = schedule.stages[schedule.currentStage];
  const unplayedIndices = stage.matches.map((m, i) => !m.played ? i : -1).filter(i => i !== -1);

  if (unplayedIndices.length === 0) return simNextMatch(gameState);

  const usedTeams   = new Set();
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

  let updatedStats = gameState.playerSeasonStats ?? {};

  for (const idx of todayIndices) {
    const match  = stage.matches[idx];
    if (match.played) continue;
    const seed   = schedule.season * 100_000 + schedule.currentStage * 10_000 + idx;
    const teamA  = buildTeamObj(match.a, gameState);
    const teamB  = buildTeamObj(match.b, gameState);
    const result = simMatch(teamA, teamB, seed);

    match.played = true;
    match.result = result;

    schedule.standings[result.winnerId].wins++;
    schedule.standings[result.winnerId].points += 3;
    schedule.standings[result.loserId].losses++;
    schedule.standings[result.loserId].points += 1;

    schedule.matchLog.push({ ...result, stage: stage.name });
    updatedStats = accumulateMatchStats(updatedStats, result);
  }

  if (stage.matches.every(m => m.played)) {
    schedule.phase = "major";
    schedule.majors[schedule.currentStage].bracket = buildMajorBracket(schedule.standings);
  }

  schedule.currentMatchday++;
  return { ...gameState, schedule: { ...schedule }, playerSeasonStats: updatedStats };
}

export function simStage(gameState) {
  let state = gameState;
  let safety = 0;
  while (state.schedule.phase === "stage" && safety++ < 500)
    state = simMatchday(state);
  return state;
}

// ── Offseason ─────────────────────────────────────────────────────────────────
export function advanceOffseason(gameState) {
  const standings   = gameState.schedule?.standings ?? {};
  const endedSeason = gameState.schedule?.season ?? 1;
  const newSeason   = endedSeason + 1;

  // Archive current season stats into history before resetting
  const currentStats  = gameState.playerSeasonStats  ?? {};
  const priorHistory  = gameState.playerStatsHistory ?? {};
  const newHistory    = { ...priorHistory };
  for (const [id, s] of Object.entries(currentStats)) {
    if (!s.matches) continue;  // skip players who never played
    const kd = s.deaths > 0 ? +(s.kills / s.deaths).toFixed(2) : s.kills > 0 ? s.kills : 0;
    newHistory[id] = [...(newHistory[id] ?? []), { season: endedSeason, kills: s.kills, deaths: s.deaths, matches: s.matches, kd }];
  }

  // Step 1: age up all players and prospects, reset form
  const agedPlayers = (gameState.players || []).map(p => ({
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

  // Step 2: run progression/regression on the aged players
  const { updatedPlayers, updatedProspects, progressionLog } =
    runProgression(agedPlayers, agedProspects, standings, newSeason);

  const withProgression = {
    ...gameState,
    players:            updatedPlayers,
    prospects:          updatedProspects,
    progressionLog,                      // stored for OffseasonReport
    schedule:           buildSeason(newSeason),
    season:             newSeason,
    playerSeasonStats:  {},              // reset for new season
    playerStatsHistory: newHistory,      // persisted across seasons
  };

  return runAIOffseasonRosterWindow(withProgression);
}

// ── Helper ────────────────────────────────────────────────────────────────────
function buildTeamObj(teamId, gameState) {
  const meta    = CDL_TEAMS.find(t => t.id === teamId) ?? { id: teamId, name: teamId };
  const players = (gameState.players || []).filter(p => p.teamId === teamId);
  return { id: meta.id, name: meta.name, players };
}
