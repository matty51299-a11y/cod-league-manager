import { CDL_TEAMS } from "../data/teams.js";
import { calcChemistry } from "./chemistry.js";

const PHILOSOPHIES = ["win_now", "youth_upside", "chemistry_stability", "balanced_value", "high_risk_gamble"];

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── PLAYER TIERS ──────────────────────────────────────────────────────────────
// Classifies a player into a protection tier based on overall rating.
//   S  (≥90) – franchise cornerstone; almost never dropped
//   A  (≥85) – elite starter; rarely dropped
//   B  (≥78) – solid starter; normal candidate
//   C  (<78) – replaceable; first in line
function getPlayerTier(player) {
  const ovr = player.overall || 70;
  if (ovr >= 90) return "S";
  if (ovr >= 85) return "A";
  if (ovr >= 78) return "B";
  return "C";
}

// How much to subtract from cut-score per tier.
// S: -55 makes franchise players essentially impossible to cut via scoring alone.
// A: -28 makes elite starters rarely the highest cut candidate.
// B: -8  gives solid starters modest protection over pure C players.
const TIER_CUT_BONUS = { S: -55, A: -28, B: -8, C: 0 };

function ensureContexts(gameState) {
  const existing = gameState.teamContexts || {};
  const next = { ...existing };
  for (const team of CDL_TEAMS) {
    if (next[team.id]) continue;
    const base = hashString(team.id);
    const rng = seededRng(base);
    next[team.id] = {
      philosophy: PHILOSOPHIES[Math.floor(rng() * PHILOSOPHIES.length)],
      loyalty: 0.2 + rng() * 0.5,
      volatility: 0.1 + rng() * 0.8,
      challengerTrust: 0.15 + rng() * 0.7,
      pressure: 0,
    };
  }
  return next;
}

function getStarters(players, teamId) {
  const teamPlayers = players.filter(p => p.teamId === teamId && !p.isSub);
  if (teamPlayers.length <= 4) return teamPlayers;
  return [...teamPlayers].sort((a, b) => b.overall - a.overall).slice(0, 4);
}

function getMajorPlacement(schedule, teamId, majorIdx) {
  const major = schedule.majors?.[majorIdx];
  if (!major?.bracket) return 12;
  if (major.bracket.champion === teamId) return 1;

  const sfRound = major.bracket.rounds?.[1]?.matches || [];
  if (sfRound.some(m => m.played && (m.a === teamId || m.b === teamId) && m.result?.winnerId !== teamId)) return 3;

  const qfRound = major.bracket.rounds?.[0]?.matches || [];
  if (qfRound.some(m => m.played && (m.a === teamId || m.b === teamId))) return 5;

  return 9;
}

function evaluateTeam(teamId, gameState, windowType, majorIdx) {
  const starters = getStarters(gameState.players, teamId);
  const chemistry = starters.length ? calcChemistry(starters) : 40;
  const avgAge = starters.length ? starters.reduce((s, p) => s + (p.age || 22), 0) / starters.length : 22;
  const avgOverall = starters.length ? starters.reduce((s, p) => s + (p.overall || 70), 0) / starters.length : 70;
  const avgPotential = starters.length ? starters.reduce((s, p) => s + (p.potential || p.overall || 70), 0) / starters.length : 72;
  const upside = avgPotential - avgOverall;

  const standingsRows = Object.entries(gameState.schedule.standings || {}).sort((a, b) => b[1].points - a[1].points);
  const standingIdx = standingsRows.findIndex(([id]) => id === teamId);
  const standingRank = standingIdx === -1 ? 12 : standingIdx + 1;

  const majorPlacement = majorIdx == null ? 12 : getMajorPlacement(gameState.schedule, teamId, majorIdx);

  let pressure = 0;
  pressure += (standingRank - 1) * 4.5;
  pressure += majorPlacement <= 1 ? -18 : majorPlacement <= 3 ? -7 : majorPlacement <= 5 ? 3 : 12;
  pressure += chemistry >= 80 ? -9 : chemistry >= 68 ? -2 : chemistry >= 55 ? 6 : 13;
  pressure += avgAge >= 27 ? 8 : avgAge >= 25 ? 3 : -2;
  pressure += upside >= 7 ? -6 : upside >= 4 ? -2 : 6;
  pressure += avgOverall >= 88 ? -8 : avgOverall <= 80 ? 7 : 0;

  if (windowType === "major") pressure *= 0.6;
  return { standingRank, majorPlacement, chemistry, avgAge, avgOverall, upside, pressure };
}

function decideMoveCount(evaluation, context, rng, windowType) {
  const loyaltyAnchor = context.loyalty * 18;
  const volatilityKick = (rng() - 0.5) * 20 * context.volatility;
  const pressureNow = context.pressure * 0.55 + evaluation.pressure + volatilityKick - loyaltyAnchor;

  const baseNoMove = windowType === "major" ? 0.72 : 0.42;
  const smallMoveRate = windowType === "major" ? 0.2 : 0.34;
  const twoMoveRate = windowType === "major" ? 0.07 : 0.19;
  const resetRate = windowType === "major" ? 0.01 : 0.05;

  let noMove = baseNoMove - pressureNow / 140;
  let oneMove = smallMoveRate + pressureNow / 180;
  let twoMove = twoMoveRate + pressureNow / 210;
  let reset = resetRate + pressureNow / 260;

  noMove = clamp(noMove, 0.05, 0.88);
  oneMove = clamp(oneMove, 0.08, 0.6);
  twoMove = clamp(twoMove, 0.02, 0.45);
  reset = clamp(reset, 0.005, 0.22);

  const total = noMove + oneMove + twoMove + reset;
  const roll = rng();
  const r0 = noMove / total;
  const r1 = r0 + oneMove / total;
  const r2 = r1 + twoMove / total;

  const moveCount = roll < r0 ? 0 : roll < r1 ? 1 : roll < r2 ? 2 : 3;
  return { moveCount, nextPressure: clamp(pressureNow * 0.65 + (moveCount === 0 ? 2 : -8), 0, 100) };
}

// playerCutScore — higher score = more likely to be cut.
// seasonStats (optional): { kills, deaths, matches } from state.playerSeasonStats
function playerCutScore(player, evaluation, seasonStats) {
  const ovr = player.overall || 70;

  // Tier protection is the primary guard against elite players being dropped.
  // S-tier gets -55, making their total score far below any normal player.
  const tierProtection = TIER_CUT_BONUS[getPlayerTier(player)];

  const agePenalty    = (player.age || 22) >= 27 ? 10 : (player.age || 22) >= 25 ? 5 : 0;
  const upside        = (player.potential || ovr) - ovr;
  const lowUpsidePenalty = upside <= 2 ? 7 : upside <= 4 ? 3 : -2;
  const roleFitPenalty   = player.primary === "Flex" ? 1 : 0;

  // Season K/D modifier — only activates after ≥5 matches so early-season
  // variance doesn't unfairly punish or protect players.
  let perfPenalty = 0;
  if (seasonStats && seasonStats.matches >= 5) {
    const kd = seasonStats.deaths > 0 ? seasonStats.kills / seasonStats.deaths : 1.0;
    if      (kd < 0.80) perfPenalty =  10;  // clearly underperforming
    else if (kd < 0.90) perfPenalty =   5;  // slightly below average
    else if (kd > 1.20) perfPenalty =  -5;  // standout performer
  }

  return 100 - ovr
       + agePenalty
       + lowUpsidePenalty
       + roleFitPenalty
       + (60 - evaluation.chemistry) * 0.14
       + tierProtection
       + perfPenalty;
}

function roleFitScore(candidate, neededRole) {
  if (!neededRole) return 6;
  if (candidate.primary === neededRole) return 14;
  if (candidate.secondary === neededRole) return 8;

  const bothSmg = [candidate.primary, candidate.secondary, neededRole].some(r => r?.includes("SMG"));
  if (bothSmg && neededRole.includes("SMG")) return 4;
  return -4;
}

function candidateScore(candidate, teamPlayers, context, evaluation, neededRole, rng, windowType) {
  const age = candidate.age || 22;
  const overall = candidate.overall || 70;
  const upside = (candidate.potential || overall) - overall;
  const isProspect = !!candidate.isProspect;
  const roleFit = roleFitScore(candidate, neededRole);

  const baseChem = calcChemistry(teamPlayers);
  const testChem = calcChemistry([...teamPlayers, candidate].slice(-4));
  const chemDelta = testChem - baseChem;

  const philosophyBoost = {
    win_now: overall * 0.9 + (age <= 23 ? 2 : 0),
    youth_upside: upside * 5 + (24 - age) * 1.8,
    chemistry_stability: chemDelta * 3 + (candidate.teamwork || 70) * 0.22,
    balanced_value: overall * 0.55 + upside * 2.1 + chemDelta * 1.5,
    high_risk_gamble: upside * 4.4 + (rng() - 0.5) * 6,
  }[context.philosophy] || (overall * 0.5 + upside * 2);

  let score = 0;
  score += roleFit;
  score += overall * 0.45;
  score += upside * 2.2;
  score += chemDelta * 2;
  score += philosophyBoost;

  // Encourage call-ups for pressured/aging/low-upside rosters.
  const callupNeed = clamp((context.pressure + evaluation.pressure) / 70 + (evaluation.avgAge - 24) * 0.18 + (4 - evaluation.upside) * 0.2, -1, 3);
  if (isProspect) {
    score += 6 + context.challengerTrust * 10 + callupNeed * 7;
  } else {
    score -= callupNeed * 2.8;
  }

  if (windowType === "major") score -= isProspect ? 2 : 0;
  score += (rng() - 0.5) * 4 * context.volatility;
  return score;
}

function signCandidate(candidate, teamId, players, prospects) {
  if (candidate.isProspect) {
    const signed = { ...candidate, teamId, scouted: true, isSub: false };
    return {
      players: [...players, signed],
      prospects: prospects.filter(p => p.id !== candidate.id),
    };
  }

  return {
    players: players.map(p => p.id === candidate.id ? { ...p, teamId, isSub: false, scouted: true } : p),
    prospects,
  };
}

function releasePlayer(player, players, prospects) {
  if (player.isProspect) {
    return {
      players: players.filter(p => p.id !== player.id),
      prospects: [...prospects, { ...player, teamId: null, isSub: false }],
    };
  }

  return {
    players: players.map(p => p.id === player.id ? { ...p, teamId: null, isSub: false } : p),
    prospects,
  };
}

function runRosterWindow(gameState, { windowType, majorIdx }) {
  const teamContexts = ensureContexts(gameState);
  let players = [...(gameState.players || [])];
  let prospects = [...(gameState.prospects || [])];
  const rosterMovesLog = [...(gameState.rosterMovesLog || [])];

  for (const team of CDL_TEAMS) {
    if (team.id === gameState.userTeamId) continue;

    const seed = hashString(`${team.id}_${gameState.season}_${windowType}_${majorIdx ?? -1}`);
    const rng = seededRng(seed);
    const context = { ...teamContexts[team.id] };
    const evaluation = evaluateTeam(team.id, { ...gameState, players, prospects }, windowType, majorIdx);
    const { moveCount, nextPressure } = decideMoveCount(evaluation, context, rng, windowType);

    context.pressure = nextPressure;
    teamContexts[team.id] = context;

    if (moveCount === 0) {
      rosterMovesLog.push({ season: gameState.season, teamId: team.id, windowType, moveCount: 0, philosophy: context.philosophy });
      continue;
    }

    let starters = getStarters(players, team.id);
    const seasonStatsMap = gameState.playerSeasonStats || {};

    // Rank starters by cut-score (higher = more likely to go).
    // Tier protection and season K/D are factored in here.
    const rankedForCut = [...starters]
      .map(p => ({ p, score: playerCutScore(p, evaluation, seasonStatsMap[p.id]) }))
      .sort((a, b) => b.score - a.score);

    // Hard drop-protection rules applied after scoring:
    //   S-tier (OVR ≥90): never cut, period.
    //   A-tier team peak: only released under extreme pressure (>65).
    // These are belt-and-suspenders guards on top of the tier score bonus.
    const teamPeak = starters.length ? Math.max(...starters.map(p => p.overall || 70)) : 0;
    const toCut = rankedForCut
      .slice(0, moveCount)
      .filter(({ p }) => {
        const tier = getPlayerTier(p);
        if (tier === "S") return false;
        if (tier === "A" && (p.overall || 70) >= teamPeak) return evaluation.pressure > 65;
        return true;
      })
      .map(({ p }) => p);

    const additions = [];
    for (const cut of toCut) {
      const afterRelease = releasePlayer(cut, players, prospects);
      players = afterRelease.players;
      prospects = afterRelease.prospects;

      const teamNow = getStarters(players, team.id);
      const candidates = [
        ...players.filter(p => p.teamId == null),
        ...prospects,
      ];

      if (!candidates.length) continue;

      const neededRole = cut.primary;
      const ranked = candidates
        .filter(c => c.id !== cut.id)
        .map(c => ({ c, score: candidateScore(c, teamNow, context, evaluation, neededRole, rng, windowType) }))
        .sort((a, b) => b.score - a.score);

      const pickPool = ranked.slice(0, Math.min(6, ranked.length));
      const pick = pickPool[Math.floor(rng() * pickPool.length)]?.c;
      if (!pick) continue;

      const afterSign = signCandidate(pick, team.id, players, prospects);
      players = afterSign.players;
      prospects = afterSign.prospects;
      additions.push({ out: cut.name, in: pick.name, fromChallengers: !!pick.isProspect });
      starters = getStarters(players, team.id);
    }

    rosterMovesLog.push({
      season: gameState.season,
      teamId: team.id,
      windowType,
      moveCount: additions.length,
      philosophy: context.philosophy,
      additions,
      pressure: Math.round(context.pressure),
      standingRank: evaluation.standingRank,
      chemistry: Math.round(evaluation.chemistry),
    });
  }

  return {
    ...gameState,
    players,
    prospects,
    teamContexts,
    rosterMovesLog,
  };
}

export function runAIMajorRosterWindow(gameState, majorIdx) {
  return runRosterWindow(gameState, { windowType: "major", majorIdx });
}

export function runAIOffseasonRosterWindow(gameState) {
  return runRosterWindow(gameState, { windowType: "offseason", majorIdx: null });
}
