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
import { CDL_TEAMS } from "../data/teams.js";
import { runProgression } from "./progression.js";
import { runAIMajorRosterWindow, runAIOffseasonRosterWindow } from "./rosterAI.js";

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
    ],
    standings:      initStandings(teamIds),  // cumulative season W/L/pts
    stageStandings: initStandings(teamIds),  // per-stage; kept as bracket snapshot, reset on Major→Stage
    stageIdx:        0,     // current stage index (0–3)
    majorIdx:        null,  // current major index (0–4); null when not in major phase
    phase:           "stage",  // "stage" | "major" | "preChamps" | "offseason"
    currentMatchday: 0,
    matchLog:        [],
  };
}

// ── Build major bracket ───────────────────────────────────────────────────────
// Accepts any standings object with { [teamId]: { points, ... } }.
// Regular Majors pass stageStandings; Champs passes cumulative standings.
function buildMajorBracket(standings) {
  const sorted = Object.entries(standings)
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 8)
    .map(([id]) => id);

  return {
    seeds: sorted,
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
    champion:  null,
  };
}

// ── Internal: play exactly ONE unplayed major match ───────────────────────────
// Mutates schedule in place. Returns { roundIdx, allComplete }.
function _simOneMajorMatch(schedule, gameState) {
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
function _advanceMajorPhase(schedule, gameState) {
  const majorIdx = schedule.majorIdx;
  let nextState = gameState;

  // AI roster window after each regular major (not after Champs)
  if (majorIdx <= 3) nextState = runAIMajorRosterWindow(nextState, majorIdx);

  const teamIds = CDL_TEAMS.map(t => t.id);

  if (majorIdx <= 2) {
    // Major 1/2/3 → next Stage
    // Reset stageStandings now (entering new stage, not when building the bracket)
    schedule.stageStandings = initStandings(teamIds);
    schedule.phase    = "stage";
    schedule.stageIdx = majorIdx + 1;
    schedule.majorIdx = null;
    schedule.currentMatchday = 0;
  } else if (majorIdx === 3) {
    // Major 4 → Pre-Champs roster window
    schedule.stageStandings = initStandings(teamIds);
    schedule.phase    = "preChamps";
    schedule.majorIdx = null;
  } else {
    // Champs → Offseason
    schedule.phase    = "offseason";
    schedule.majorIdx = null;
  }

  return nextState;
}

// ── PUBLIC: Begin Championship (triggered by user from preChamps window) ───────
export function beginChamps(gameState) {
  const schedule = gameState.schedule;
  if (schedule.phase !== "preChamps") return gameState;

  // Champs bracket seeded by cumulative season standings.points
  schedule.phase    = "major";
  schedule.majorIdx = 4;
  schedule.majors[4].bracket = buildMajorBracket(schedule.standings);
  return { ...gameState, schedule: { ...schedule } };
}

// ── PUBLIC: Simulate one major match ──────────────────────────────────────────
export function simNextMajorMatch(gameState) {
  const schedule = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const major = schedule.majors[schedule.majorIdx];
  if (!major || major.completed) return gameState;

  const { allComplete } = _simOneMajorMatch(schedule, gameState);
  let nextState = gameState;
  if (allComplete) nextState = _advanceMajorPhase(schedule, gameState);

  return { ...nextState, schedule: { ...schedule } };
}

// ── PUBLIC: Simulate all remaining matches in the current round ───────────────
export function simMajorRound(gameState) {
  const schedule = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const major = schedule.majors[schedule.majorIdx];
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

  let safety = 0;
  while (safety++ < 20) {
    const bracket = schedule.majors[schedule.majorIdx].bracket;
    const rnd     = bracket.rounds[startRound];
    if (!rnd || rnd.matches.every(m => m.played)) break;

    const { allComplete } = _simOneMajorMatch(schedule, gameState);
    if (allComplete) {
      gameState = _advanceMajorPhase(schedule, gameState);
      break;
    }
  }

  return { ...gameState, schedule: { ...schedule } };
}

// ── PUBLIC: Simulate the entire remaining bracket ─────────────────────────────
export function simMajor(gameState) {
  const schedule  = gameState.schedule;
  if (schedule.phase !== "major") return gameState;

  const targetIdx = schedule.majorIdx;
  const major     = schedule.majors[targetIdx];
  if (!major || major.completed) return gameState;

  let safety = 0;
  while (!schedule.majors[targetIdx].completed && safety++ < 100) {
    const { allComplete } = _simOneMajorMatch(schedule, gameState);
    if (allComplete) {
      gameState = _advanceMajorPhase(schedule, gameState);
      break;
    }
  }

  return { ...gameState, schedule: { ...schedule } };
}

// ── Stage simulation ───────────────────────────────────────────────────────────
export function simNextMatch(gameState) {
  const schedule = gameState.schedule;
  if (!schedule || schedule.phase !== "stage") return gameState;

  const stage    = schedule.stages[schedule.stageIdx];
  const unplayed = stage.matches.findIndex(m => !m.played);

  if (unplayed === -1) {
    // Stage done → build Major bracket from stageStandings (keep snapshot intact)
    schedule.phase    = "major";
    schedule.majorIdx = schedule.stageIdx;  // Stage N → Major N (indices align)
    schedule.majors[schedule.majorIdx].bracket = buildMajorBracket(schedule.stageStandings);
    return { ...gameState, schedule: { ...schedule } };
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
    // Stage done → build bracket from stageStandings, keep snapshot intact
    schedule.phase    = "major";
    schedule.majorIdx = schedule.stageIdx;
    schedule.majors[schedule.majorIdx].bracket = buildMajorBracket(schedule.stageStandings);
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
    schedule.phase    = "major";
    schedule.majorIdx = schedule.stageIdx;
    schedule.majors[schedule.majorIdx].bracket = buildMajorBracket(schedule.stageStandings);
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

  // Old unsigned challengers can also age out
  const activeProspects = prospects.filter(p => {
    const age = p.age || 20;
    if (age < 29) return true;
    return Math.random() > 0.55; // ~55 % of old unsigned prospects retire
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

  return {
    ...gameState,
    players,
    schedule: { ...schedule, phase: "contracts" },
  };
}

// ── Offseason ─────────────────────────────────────────────────────────────────
export function advanceOffseason(gameState) {
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
  // AI teams auto-renew any player on a 1-year contract (contractYears === 1)
  // before the decrement so stars don't flood free agency every offseason.
  // User's expiring players were already handled in the contracts phase.
  const withAIRenewals = (gameState.players || []).map(p => {
    if (!p.teamId || p.teamId === gameState.userTeamId) return p;
    const years = p.contractYears ?? 2;
    if (years === 1) return { ...p, contractYears: 2 };  // AI auto-renew
    return p;
  });

  // Decrement contractYears by 1 for every signed player
  const withDecrement = withAIRenewals.map(p => {
    if (!p.teamId) return p;
    return { ...p, contractYears: Math.max(0, (p.contractYears ?? 2) - 1) };
  });

  // Release players whose contracts hit 0 — they become free agents
  const withExpiry = withDecrement.map(p => {
    if (p.teamId && (p.contractYears ?? 1) === 0) {
      return { ...p, teamId: null, isSub: false };
    }
    return p;
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

  // ── Refresh prospect pool for the incoming season ─────────────────────────
  // Runs after progression so newly-aged prospects are evaluated with their
  // updated overalls. Only touches unsigned challengers (updatedProspects).
  // Signed former-prospects are in updatedPlayers and are never affected.
  const refreshedProspects = refreshProspectPool(updatedProspects, newSeason);

  const withProgression = {
    ...gameState,
    players:          updatedPlayers,
    prospects:        refreshedProspects,
    progressionLog,
    playerSeasonStats,
    retiredPlayers:   [...(gameState.retiredPlayers || []), ...retired],
    schedule:         buildSeason(newSeason),
    season:           newSeason,
  };

  return runAIOffseasonRosterWindow(withProgression);
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

  // Age — mostly 18–20 for all tiers; ~15 % chance of 21
  const age = Math.random() < 0.85 ? ri(18, 20) : 21;

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
  let overall, potential;
  if (tier === "elite") {
    overall   = ri(75, 83);
    potential = clamp(overall + ri(10, 15), 87, 95);
  } else if (tier === "mid") {
    overall   = ri(65, 74);
    potential = clamp(overall + ri(8, 14), 75, 88);
  } else {
    overall   = ri(56, 68);
    potential = clamp(overall + ri(5, 12), 65, 80);
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

// Cleans up stale unsigned challengers and injects a fresh ~20-player class.
// Only operates on the prospects array (unsigned challengers).
// Signed prospects are in gameState.players and are never touched here.
export function refreshProspectPool(prospects, season) {
  // ── Step 1: Remove old / weak unsigned challengers ───────────────────────
  const cleaned = prospects.filter(p => {
    const age = p.age || 20;
    const ovr = p.overall || 70;
    // Hard rule: age 26+ and below 70 OVR — always retired out
    if (age >= 26 && ovr < 70) return false;
    // Soft rule: age 25+ and below 67 OVR — 70 % chance to remove
    if (age >= 25 && ovr < 67 && Math.random() < 0.70) return false;
    // Soft rule: age 24+ and below 62 OVR — 80 % chance to remove
    if (age >= 24 && ovr < 62 && Math.random() < 0.80) return false;
    return true;
  });

  // ── Step 2: Generate this season's incoming class ────────────────────────
  // Elite count: 2–4 per year (rare but guaranteed presence)
  const eliteCount = Math.floor(Math.random() * 3) + 2;   // 2–4
  const midCount   = Math.floor(Math.random() * 3) + 4;   // 4–6
  const lowCount   = Math.max(0, 20 - eliteCount - midCount);

  const newClass = [];
  let idx = 0;
  for (let i = 0; i < eliteCount; i++) newClass.push(_buildFreshProspect("elite", idx++, season));
  for (let i = 0; i < midCount;   i++) newClass.push(_buildFreshProspect("mid",   idx++, season));
  for (let i = 0; i < lowCount;   i++) newClass.push(_buildFreshProspect("low",   idx++, season));

  // ── Step 3: Combine + enforce pool cap (max 60) ──────────────────────────
  const combined = [...cleaned, ...newClass];
  if (combined.length <= 60) return combined;

  // Over cap: sort oldest-and-weakest to front, then trim excess from there
  const sorted = [...combined].sort((a, b) => {
    const ageA = a.age || 20, ageB = b.age || 20;
    if (ageA !== ageB) return ageB - ageA;              // older → front (removed first)
    return (a.overall || 70) - (b.overall || 70);       // lower OVR → front
  });
  return sorted.slice(combined.length - 60);
}

// ── Helper ────────────────────────────────────────────────────────────────────
function buildTeamObj(teamId, gameState) {
  const meta    = CDL_TEAMS.find(t => t.id === teamId) ?? { id: teamId, name: teamId };
  const players = (gameState.players || []).filter(p => p.teamId === teamId);
  return { id: meta.id, name: meta.name, players };
}
