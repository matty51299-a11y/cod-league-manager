import { CDL_TEAMS } from "../data/teams.js";
import { calcChemistry } from "./chemistry.js";

const PHILOSOPHIES = ["win_now", "youth_upside", "chemistry_stability", "balanced_value", "high_risk_gamble"];

// ── 1. Budget system ──────────────────────────────────────────────────────────
// Each franchise has a budgetTier (2–6) defined in teams.js.
// BUDGET_CAPS is the maximum combined signing cost for a 4-player starting lineup.
//
// getSigningCost() uses a power curve (exponent 2.5) that keeps low/mid players
// affordable while making elite signings genuinely expensive:
//   70 OVR → ~$25k   75 OVR → ~$32k   80 OVR → ~$65k
//   85 OVR → ~$136k  88 OVR → ~$200k  90 OVR → ~$252k
//   93 OVR → ~$347k  99 OVR → $600k
//
// Challenger prospects remain cheap ($15k–$65k) so small orgs can build
// viable rosters through the challenger path.

const BUDGET_CAPS = {
  6: 1_500_000, // Riyadh Falcons only — highest budget in the CDL
  5: 1_150_000, // Top spenders (OpTic, FaZe, Paris) — star-heavy rosters
  4:   850_000, // Upper-mid orgs (LAT, Toronto, Miami, G2) — one star + depth
  3:   680_000, // (fallback default — no teams currently assigned here)
  2:   580_000, // Budget orgs (Boston, Carolina, Cloud9, VAN) — challenger path
};

export function getTeamBudgetTier(teamId) {
  return CDL_TEAMS.find(t => t.id === teamId)?.budgetTier ?? 3;
}

export function getTeamCap(teamId) {
  return BUDGET_CAPS[getTeamBudgetTier(teamId)] ?? 680_000;
}

// AI signing cost assessment (not the stored salary — a separate "market value").
// Uses the same power-curve formula as the displayed salary so AI budget logic
// and the free agency UI stay consistent.
export function getSigningCost(player) {
  const ovr = player.overall || 70;
  if (player.isProspect) {
    return Math.round((ovr / 99) * 50 + 15) * 1000; // $15k–$65k
  }
  const t = Math.max(0, ovr - 70) / 29;
  return Math.round((Math.pow(t, 2.5) * 575 + 25)) * 1000;
}

function getRosterSigningCost(players, teamId) {
  return getStarters(players, teamId)
    .reduce((sum, p) => sum + getSigningCost(p), 0);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

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

// ── Champion status detection ─────────────────────────────────────────────────
// Returns flags used to apply winning-team stability bias throughout the AI.
//   recentMajorWinner — won the specific major that just concluded
//   isChampion        — won any major this season (including earlier ones)
function getChampionStatus(teamId, gameState, majorIdx) {
  const majors = gameState.schedule?.majors || [];

  // Check the just-concluded major
  if (majorIdx != null) {
    const recent = getMajorPlacement(gameState.schedule, teamId, majorIdx);
    if (recent === 1) return { recentMajorWinner: true, isChampion: true };
  }

  // Check all other majors this season
  for (let i = 0; i < majors.length; i++) {
    if (i === majorIdx) continue;
    if (majors[i]?.bracket?.champion === teamId) {
      return { recentMajorWinner: false, isChampion: true };
    }
  }

  return { recentMajorWinner: false, isChampion: false };
}

// teamId is included in the returned object so downstream functions (budget
// checks, destination penalty) can look up franchise-specific data.
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

  // Champion/winner status flags
  const { recentMajorWinner, isChampion } = getChampionStatus(teamId, gameState, majorIdx);
  const isTopPerformer = standingRank <= 4;

  let pressure = 0;
  pressure += (standingRank - 1) * 4.5;
  pressure += majorPlacement <= 1 ? -18 : majorPlacement <= 3 ? -7 : majorPlacement <= 5 ? 3 : 12;
  pressure += chemistry >= 80 ? -9 : chemistry >= 68 ? -2 : chemistry >= 55 ? 6 : 13;
  pressure += avgAge >= 27 ? 8 : avgAge >= 25 ? 3 : -2;
  pressure += upside >= 7 ? -6 : upside >= 4 ? -2 : 6;
  pressure += avgOverall >= 88 ? -8 : avgOverall <= 80 ? 7 : 0;

  // ── Winning-team stability bonus ─────────────────────────────────────────
  // Champions and top performers get significant extra pressure reduction so
  // the AI correctly models successful teams staying intact.
  if (recentMajorWinner) pressure -= 28;
  else if (isChampion) pressure -= 16;
  else if (isTopPerformer) pressure -= 8;

  // Chemistry / success protection: well-performing teams with good chemistry
  // should rarely make changes — penalise the pressure score further.
  if (chemistry >= 72 && isTopPerformer) pressure -= 6;

  if (windowType === "major") pressure *= 0.6;
  return {
    teamId, standingRank, majorPlacement, chemistry, avgAge, avgOverall, upside, pressure,
    recentMajorWinner, isChampion, isTopPerformer,
  };
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

  // ── Winning-team stability floors ────────────────────────────────────────
  // A team that just won a Major should almost never make roster changes.
  // Champions from earlier this season also get a strong stability floor.
  if (evaluation.recentMajorWinner) {
    noMove = Math.max(noMove, 0.93);
  } else if (evaluation.isChampion) {
    noMove = Math.max(noMove, 0.85);
  } else if (evaluation.isTopPerformer) {
    noMove = Math.max(noMove, 0.78);
  }

  noMove = clamp(noMove, 0.05, 0.95);
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

// ── Drop protection ───────────────────────────────────────────────────────────
// A player is protected from being cut if:
//   • OVR >= 87 (elite tier — stars should almost never be released)
//   • OR they are in the team's top 2 starters by OVR (top 3 for champion teams)
//   • OR the team is a recent major winner and the player is a core piece
//
// Protected players receive a near-zero or negative cut score.
// This ensures they can only be released when there is literally nobody else
// worse on the roster, preventing unrealistic star releases.
//
// Recent season K/D adds a performance modifier for unprotected players:
//   underperformers (< 0.88 K/D) cut more readily; strong performers less so.
function playerCutScore(player, evaluation, starters, playerSeasonStats, season) {
  const overall = player.overall || 70;
  const age     = player.age || 22;

  // ── Protection check ──────────────────────────────────────────────────────
  const sortedByOvr = [...starters].sort((a, b) => (b.overall || 70) - (a.overall || 70));

  // Champion teams protect their top 3 starters; all others protect top 2
  const protectedCount = evaluation.recentMajorWinner ? 3 : evaluation.isChampion ? 3 : 2;
  const isCorePlayer = sortedByOvr.slice(0, protectedCount).some(p => p.id === player.id);

  // Elite OVR threshold: 87+ is always fully protected regardless of team status
  const isElite = overall >= 87;

  if (isElite || isCorePlayer) {
    // Recent major winners: give their core players a strongly negative score
    // so they are genuinely last in line and virtually never cut
    if (evaluation.recentMajorWinner) return -20;
    if (evaluation.isChampion) return -10;
    // Allow only age-based micro-increases so truly ancient stars can eventually rotate out
    const ageMod = age >= 31 ? 6 : age >= 29 ? 3 : 0;
    return ageMod; // 0–6: will never win over a normal-range player (scores 16+)
  }

  // ── Performance modifier for K/D (strong performers are harder to cut) ───
  let perfPenalty = 0;
  if (playerSeasonStats && season != null) {
    const stats = (playerSeasonStats[player.id] || [])
      .filter(s => s.season === season && (s.matches || 0) > 2);
    if (stats.length > 0) {
      const kills  = stats.reduce((s, r) => s + (r.kills  || 0), 0);
      const deaths = stats.reduce((s, r) => s + (r.deaths || 0), 0);
      if (deaths > 0) {
        const kd = kills / deaths;
        if (kd < 0.88)  perfPenalty = Math.round((0.88 - kd) * 25); // up to +12
        else if (kd > 1.15) perfPenalty = -5; // stronger protection for strong performers
      }
    }
  }

  // ── Standard formula ──────────────────────────────────────────────────────
  const agePenalty      = age >= 27 ? 8 : age >= 25 ? 4 : 0;
  const upside          = (player.potential || overall) - overall;
  const lowUpsidePenalty = upside <= 2 ? 7 : upside <= 4 ? 3 : -2;
  const roleFitPenalty  = player.primary === "Flex" ? 1 : 0;

  return 100 - overall + agePenalty + lowUpsidePenalty + roleFitPenalty
    + (60 - evaluation.chemistry) * 0.14 + perfPenalty;
}

function roleFitScore(candidate, neededRole) {
  if (!neededRole) return 6;
  if (candidate.primary === neededRole) return 14;
  if (candidate.secondary === neededRole) return 8;

  const bothSmg = [candidate.primary, candidate.secondary, neededRole].some(r => r?.includes("SMG"));
  if (bothSmg && neededRole.includes("SMG")) return 4;
  return -4;
}

// ── 3. Star destination preference ───────────────────────────────────────────
// Elite players (86+ OVR) strongly prefer competitive, well-ranked teams.
// The penalty grows with the player's quality and the team's weakness, making
// it very difficult for bottom-tier rosters to land genuine stars.
//
// UPGRADE URGENCY exception: teams in the bottom half of the league with a
// weak roster rating get a 50% reduction in the destination penalty — the
// league's best remaining FA talent can realistically be picked up when a
// struggling team badly needs an upgrade.
//
// Examples for a 93 OVR star:
//   Top team (rank 1–2, avg 90 OVR): near-zero penalty
//   Mid team (rank 6–8, avg 84 OVR): ~20–30 penalty
//   Weak team needing upgrade (rank 9–12, avg <83 OVR): penalty halved
function getDestinationPenalty(candidate, evaluation) {
  const overall = candidate.overall || 70;
  if (candidate.isProspect || overall < 86) return 0;

  // Team attractiveness: standing (0–30.8) + roster quality (0–12+)
  const rankScore   = Math.max(0, 12 - evaluation.standingRank) * 2.8;
  const rosterScore = Math.max(0, evaluation.avgOverall - 80) * 1.2;
  const attractiveness = rankScore + rosterScore;

  // Star's bar rises steeply: 86=5, 90=25, 93=40, 96=55, 99=70
  const starBar = (overall - 85) * 5;
  const gap = starBar - attractiveness;
  if (gap <= 0) return 0;

  // Upgrade urgency: bottom-half teams with a weak roster get penalty relief
  // so desperately-needed stars can actually be acquired.
  const needsUpgrade = evaluation.standingRank >= 9 && evaluation.avgOverall < 83;
  const penaltyMultiplier = needsUpgrade ? 0.5 : 1.0;

  return gap * 2.0 * penaltyMultiplier;
}

// ── 2. Budget affordability ───────────────────────────────────────────────────
// Applies a score penalty when signing this candidate would push the team over
// its budget cap. Scales from -5 to -50 based on overspend amount.
// teamPlayers should be the current starters AFTER releasing the player being
// replaced (so the slot is open before costing the new signing).
function getAffordabilityPenalty(candidate, evaluation, teamPlayers) {
  const cap     = getTeamCap(evaluation.teamId);
  const current = getRosterSigningCost(teamPlayers, evaluation.teamId);
  const cost    = getSigningCost(candidate);
  const over    = cost - (cap - current);
  if (over <= 0) return 0;

  // Soften affordability penalty slightly for bottom-4 teams signing clear upgrades —
  // allow some budget flexibility so needed improvements can go through.
  const needsUpgrade = evaluation.standingRank >= 9;
  const divisor = needsUpgrade ? 10000 : 8000;
  return -clamp(over / divisor, 0, 50);
}

// ── Combined candidate scoring ────────────────────────────────────────────────
function candidateScore(candidate, teamPlayers, context, evaluation, neededRole, rng, windowType) {
  const age     = candidate.age || 22;
  const overall = candidate.overall || 70;
  const upside  = (candidate.potential || overall) - overall;
  const isProspect = !!candidate.isProspect;
  const roleFit = roleFitScore(candidate, neededRole);

  const baseChem = calcChemistry(teamPlayers);
  const testChem = calcChemistry([...teamPlayers, candidate].slice(-4));
  const chemDelta = testChem - baseChem;

  const philosophyBoost = {
    win_now:              overall * 0.9 + (age <= 23 ? 2 : 0),
    youth_upside:         upside * 5 + (24 - age) * 1.8,
    chemistry_stability:  chemDelta * 3 + (candidate.teamwork || 70) * 0.22,
    balanced_value:       overall * 0.55 + upside * 2.1 + chemDelta * 1.5,
    high_risk_gamble:     upside * 4.4 + (rng() - 0.5) * 6,
  }[context.philosophy] || (overall * 0.5 + upside * 2);

  let score = 0;
  score += roleFit;
  score += overall * 0.45;
  score += upside * 2.2;
  score += chemDelta * 2;
  score += philosophyBoost;

  // ── Budget affordability ─────────────────────────────────────────────────
  score += getAffordabilityPenalty(candidate, evaluation, teamPlayers);

  // ── Star destination preference ──────────────────────────────────────────
  score -= getDestinationPenalty(candidate, evaluation);

  // ── 4. Challenger market dynamics ────────────────────────────────────────
  // Base call-up need (pressure + aging + low-upside roster).
  // Clamp lower for top-performing teams so they don't over-rely on prospects.
  const callupNeed = clamp(
    (context.pressure + evaluation.pressure) / 70 +
    (evaluation.avgAge - 24) * 0.18 +
    (4 - evaluation.upside) * 0.2,
    -1, evaluation.isTopPerformer ? 0.8 : 3
  );

  // Small-budget teams lean more heavily on challengers
  const budgetTier       = getTeamBudgetTier(evaluation.teamId);
  const budgetChallBonus = Math.max(0, 3 - budgetTier) * 10; // +10 tier-2, +20 tier-1

  // Premium challengers (76+ OVR, 86+ potential) are genuine starter options
  const isPremiumChallenger = isProspect && overall >= 76 && (candidate.potential || overall) >= 86;
  const premiumBonus = isPremiumChallenger ? 8 : 0;

  if (isProspect) {
    // Reduced base bonus (4 vs. old 6) to prevent challengers always beating
    // elite free agents who are a clear upgrade.
    score += 4 + context.challengerTrust * 10 + callupNeed * 7 + budgetChallBonus + premiumBonus;
  } else {
    score -= callupNeed * 2.8;

    // ── Upgrade urgency ────────────────────────────────────────────────────
    // If a free agent is significantly better than the current roster average,
    // reward signing them — especially for struggling teams.
    // This ensures high-rated FAs get picked up by teams that need them most.
    const upgradeGap = overall - evaluation.avgOverall;
    if (upgradeGap > 3) {
      // Base upgrade bonus scales with how much better the FA is
      const upgradeBonus = upgradeGap * 1.8;
      // Bottom-4 teams get 60% extra urgency to actually land the upgrade
      const urgencyMultiplier = evaluation.standingRank >= 9 ? 1.6 : evaluation.standingRank >= 7 ? 1.2 : 1.0;
      score += upgradeBonus * urgencyMultiplier;
    }
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

    // ── Cut eligibility gate ──────────────────────────────────────────────
    // Compute cut scores up front and filter out players who are too strong /
    // protected to be legitimately dropped. This prevents the AI from cutting
    // elite or champion-roster players simply because moveCount > 0.
    //
    // Thresholds:
    //   recentMajorWinner — only drop players with score >= 20 (very weak slot)
    //   isChampion        — only drop players with score >= 16
    //   isTopPerformer    — only drop players with score >= 13
    //   everyone else     — only drop players with score >= 10
    const cutThreshold = evaluation.recentMajorWinner ? 20
                       : evaluation.isChampion        ? 16
                       : evaluation.isTopPerformer    ? 13
                       : 10;

    const startersWithScores = starters.map(p => ({
      player: p,
      cutScore: playerCutScore(p, evaluation, starters, gameState.playerSeasonStats, gameState.season),
    })).sort((a, b) => b.cutScore - a.cutScore);

    const eligibleToCut = startersWithScores
      .filter(({ cutScore }) => cutScore >= cutThreshold)
      .slice(0, moveCount)
      .map(({ player }) => player);

    // If no players are genuinely weak enough to cut, skip this team's window
    if (eligibleToCut.length === 0) {
      rosterMovesLog.push({ season: gameState.season, teamId: team.id, windowType, moveCount: 0, philosophy: context.philosophy });
      continue;
    }

    const additions = [];
    for (const cut of eligibleToCut) {
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
