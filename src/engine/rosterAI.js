import { CDL_TEAMS } from "../data/teams.js";
import { buildCdlRosterNameSet, isCdlTeamId, isInactivePlayer, normalizePlayerName, shouldExcludeFromChallengers } from "../utils/playerIdentity.js";
import { calcChemistry } from "./chemistry.js";
import { getMajorPlacementMap } from "../utils/historyProfiles.js";
import { getEra } from "../data/codEras.js";

// Era-aware required active-starter count (roster-size transitions: 4 ↔ 5).
function requiredStartersFor(state) {
  const size = getEra(state?.currentEraId)?.rosterSize;
  return Number.isFinite(size) ? size : 4;
}

const PHILOSOPHIES = ["win_now", "youth_upside", "chemistry_stability", "balanced_value", "high_risk_gamble"];

// ── User Challenger team protection ───────────────────────────────────────────
// In Challenger manager mode the user's Challenger roster must not be silently
// signed/poached by CDL AI teams — those players are only available through the
// explicit buyout offer flow. We compute the protected id-set once per AI entry
// point (synchronous, non-reentrant) and exclude them from every candidate pool.
let _lockedChallengerIds = new Set();
function computeLockedChallengerIds(state) {
  const ids = new Set();
  if (state?.userTeamType === "challenger" && state.userTeamId) {
    for (const p of [...(state.players || []), ...(state.prospects || [])]) {
      if (p?.challengerTeamId === state.userTeamId) ids.add(p.id);
    }
  }
  return ids;
}
function isLockedChallengerCandidate(candidate) {
  return !!candidate && _lockedChallengerIds.has(candidate.id);
}

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

// Re-sign salary demand for deal lengths 1, 2, or 3 seasons.
// dealLength 1 = +1 yr (cheapest), 2 = baseline market, 3 = premium/discount.
// Deterministic — no randomness. Uses getSigningCost as the base.
export function getResignDemand(player, dealLength, playerSeasonStats, season) {
  let base = getSigningCost(player);

  // K/D modifier: current season performance shifts demand up or down
  const entry = (playerSeasonStats?.[player.id] ?? []).find(e => e.season === season);
  if (entry && entry.deaths > 0) {
    const kd = entry.kills / entry.deaths;
    if      (kd >= 1.5) base *= 1.10;
    else if (kd >= 1.3) base *= 1.05;
    else if (kd < 0.7)  base *= 0.90;
    else if (kd < 0.9)  base *= 0.95;
  }

  // Age modifier
  const age = player.age ?? 23;
  if      (age <= 22) base *= 1.05;
  else if (age >= 29) base *= 0.90;
  else if (age >= 27) base *= 0.95;

  // High-potential young player premium
  const pot = player.potential ?? 75;
  if (age <= 25) {
    if      (pot >= 92) base *= 1.08;
    else if (pot >= 85) base *= 1.03;
  }

  // Ego premium
  const ego = player.ego ?? 50;
  if      (ego >= 90) base *= 1.10;
  else if (ego >= 75) base *= 1.05;

  // Work ethic + leadership stability discount
  const stability = ((player.workEthic ?? 50) + (player.leadership ?? 50)) / 2;
  if (stability >= 75) base *= 0.98;

  // Contract length modifier relative to 2-yr baseline
  const isDecline = (age >= 28) && ((player.overall ?? 75) < 80);
  if (dealLength === 1) {
    base *= 0.90;                          // shorter → cheaper
  } else if (dealLength === 3) {
    base *= isDecline ? 0.95 : 1.12;      // declining → slight discount; others → premium
  }

  return Math.round(base / 5000) * 5000;
}


function getCurrentKD(player, playerSeasonStats, season) {
  if (!player?.id || !playerSeasonStats || season == null) return 1;
  const rows = (playerSeasonStats[player.id] || []).filter(r => r.season === season && (r.matches || 0) > 0);
  if (!rows.length) return 1;
  const kills = rows.reduce((sum, r) => sum + (r.kills || 0), 0);
  const deaths = rows.reduce((sum, r) => sum + (r.deaths || 0), 0);
  return deaths > 0 ? kills / deaths : kills > 0 ? kills : 1;
}

function getRosterSigningCost(players, teamId) {
  return getStarters(players, teamId)
    .reduce((sum, p) => sum + (p.salary ?? getSigningCost(p)), 0);
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


function safeKd(kills, deaths, fallback = 1) {
  if (!kills && !deaths) return fallback;
  return deaths > 0 ? kills / deaths : kills > 0 ? kills : fallback;
}

function majorIndexFromStageName(stageName) {
  const match = String(stageName || "").match(/Major\s+(\d+)/i);
  return match ? Number(match[1]) - 1 : null;
}

function isChallengerEventTeamId(teamId) {
  return typeof teamId === "string" && /(?:^|_)qual_/.test(teamId);
}

function addStatLine(target, ps, maps = 0) {
  if (!ps) return;
  target.kills += ps.kills || 0;
  target.deaths += ps.deaths || 0;
  target.matches += 1;
  target.maps += maps || 0;
}

function getChallengerTeamContext(player, state) {
  const teamId = player?.challengerTeamId;
  if (!teamId) return null;
  return (state?.challengerTeams || []).find(t => t.id === teamId) || null;
}

function getMajorPlacementForEventTeam(state, match, teamId) {
  const majorIdx = majorIndexFromStageName(match?.stage);
  if (majorIdx == null) return null;
  const major = state?.schedule?.majors?.[majorIdx];
  if (!major?.bracket) return null;
  return getMajorPlacementMap(major)[teamId] ?? null;
}

function collectChallengerPerformanceResume(player, state) {
  const id = String(player?.id ?? "");
  const resume = {
    qualifier: { kills: 0, deaths: 0, matches: 0, maps: 0 },
    major: { kills: 0, deaths: 0, matches: 0, maps: 0 },
    recent: [],
    qualifierPlacements: [],
    majorPlacements: [],
    qualifierAppearances: 0,
    qualifiedMajors: 0,
    cdlSeriesPlayed: 0,
    cdlSeriesWins: 0,
    cdlTeamsBeat: new Set(),
  };
  if (!id) return resume;
  const seenQualifierEvents = new Set();

  for (const q of state?.schedule?.challengerQualifierResults || []) {
    const row = (q.teams || []).find(r => (r.rosterIds || []).map(String).includes(id));
    if (row) {
      const key = `${q.season ?? ""}_${q.majorIdx ?? ""}_${row.teamId}`;
      if (!seenQualifierEvents.has(key)) {
        seenQualifierEvents.add(key);
        resume.qualifierAppearances += 1;
        if (Number.isFinite(row.placement)) resume.qualifierPlacements.push(row.placement);
        if (row.qualified) resume.qualifiedMajors += 1;
      }
    }
    for (const qMatch of q.matchLog || []) {
      const result = qMatch.result || qMatch;
      const ps = result.playerStats?.[id];
      if (!ps) continue;
      const maps = result.mapResults?.length || 0;
      addStatLine(resume.qualifier, ps, maps);
      resume.recent.push({ kills: ps.kills || 0, deaths: ps.deaths || 0, maps, eventType: "qualifier" });
      if (!row) {
        const teamId = ps.teamId;
        const statRow = (q.teams || []).find(r => r.teamId === teamId);
        const key = `${q.season ?? ""}_${q.majorIdx ?? ""}_${statRow?.teamId ?? teamId}`;
        if (statRow && !seenQualifierEvents.has(key)) {
          seenQualifierEvents.add(key);
          resume.qualifierAppearances += 1;
          if (statRow.placement != null) resume.qualifierPlacements.push(statRow.placement);
          if (statRow.qualified) resume.qualifiedMajors += 1;
        }
      }
    }
  }

  for (const match of state?.schedule?.matchLog || []) {
    const ps = match.playerStats?.[id];
    if (!ps) continue;
    const stage = String(match.stage || "");
    const isMajorStage = /Major|Champs/i.test(stage);
    const teamId = ps.teamId;
    const fromQualifierTeam = isChallengerEventTeamId(teamId) || !!state?.schedule?.currentMajorEventTeams?.[teamId];
    if (!isMajorStage || !fromQualifierTeam) continue;

    const maps = match.mapResults?.length || 0;
    addStatLine(resume.major, ps, maps);
    resume.recent.push({ kills: ps.kills || 0, deaths: ps.deaths || 0, maps, eventType: "major" });

    const place = getMajorPlacementForEventTeam(state, match, teamId);
    if (place != null) resume.majorPlacements.push(place);

    const opponentId = match.winnerId === teamId ? match.loserId : match.loserId === teamId ? match.winnerId : null;
    if (opponentId && isCdlTeamId(opponentId)) {
      resume.cdlSeriesPlayed += 1;
      if (match.winnerId === teamId) {
        resume.cdlSeriesWins += 1;
        resume.cdlTeamsBeat.add(opponentId);
      }
    }
  }

  return resume;
}

export function getChallengerPerformanceScore(player, state) {
  const resume = collectChallengerPerformanceResume(player, state);
  const qualifierKd = safeKd(resume.qualifier.kills, resume.qualifier.deaths);
  const majorKd = safeKd(resume.major.kills, resume.major.deaths);
  const recentLines = resume.recent.slice(-8);
  const recentKills = recentLines.reduce((sum, row) => sum + (row.kills || 0), 0);
  const recentDeaths = recentLines.reduce((sum, row) => sum + (row.deaths || 0), 0);
  const recentKd = safeKd(recentKills, recentDeaths);
  const totalMaps = resume.qualifier.maps + resume.major.maps;
  const bestMajor = resume.majorPlacements.length ? Math.min(...resume.majorPlacements) : null;
  const bestQualifier = resume.qualifierPlacements.length ? Math.min(...resume.qualifierPlacements) : null;
  const team = getChallengerTeamContext(player, state);

  let score = 0;
  score += clamp((qualifierKd - 1) * 24, -10, 16) * clamp(resume.qualifier.maps / 8, 0.35, 1);
  score += clamp((majorKd - 1) * 34, -12, 22) * clamp(resume.major.maps / 6, 0.35, 1);
  score += clamp((recentKd - 1) * 18, -8, 12) * clamp(recentLines.length / 4, 0.25, 1);
  score += Math.min(12, resume.qualifiedMajors * 4);
  score += Math.min(5, Math.max(0, resume.qualifierAppearances - 1) * 1.5);

  if (bestMajor != null) score += bestMajor <= 4 ? 14 : bestMajor <= 8 ? 9 : bestMajor <= 12 ? 5 : 2;
  if (bestQualifier != null) score += bestQualifier === 1 ? 10 : bestQualifier <= 2 ? 8 : bestQualifier <= 4 ? 6 : bestQualifier <= 8 ? 3 : -2;
  if (resume.qualifierAppearances > 0 && resume.qualifiedMajors === 0) score -= 6;

  score += Math.min(12, resume.cdlSeriesWins * 6 + Math.max(0, resume.cdlSeriesPlayed - resume.cdlSeriesWins) * 1.5);
  if (resume.cdlSeriesPlayed > 0 && majorKd >= 1.05) score += 5;

  if (team) {
    score += clamp((team.circuitPoints ?? 0) / 12, 0, 5);
    score += clamp((team.form ?? 0) * 1.2, -3, 5);
    if ((team.lastQualifierPlacement ?? 99) <= 4) score += 3;
  }

  if (totalMaps >= 18) score += 5;
  else if (totalMaps >= 9) score += 3;
  else if (totalMaps >= 3) score += 1;
  else if (resume.qualifierAppearances === 0 && resume.major.matches === 0) score -= 10;

  if (totalMaps > 0 && qualifierKd < 0.9 && majorKd < 0.9) score -= 5;

  return {
    score: Number(clamp(score, -18, 65).toFixed(2)),
    qualifierKd,
    majorKd,
    recentKd,
    qualifierMaps: resume.qualifier.maps,
    majorMaps: resume.major.maps,
    qualifierAppearances: resume.qualifierAppearances,
    qualifiedMajors: resume.qualifiedMajors,
    bestMajorPlacement: bestMajor,
    bestQualifierPlacement: bestQualifier,
    cdlSeriesPlayed: resume.cdlSeriesPlayed,
    cdlSeriesWins: resume.cdlSeriesWins,
    cdlTeamsBeat: resume.cdlTeamsBeat.size,
  };
}

// ── Per-save world nonce ───────────────────────────────────────────────────────
// Derives a unique integer from the prospect pool, which is seeded with
// Date.now() each new game (see gameStore newGameState). Mixing this into
// every team's roster seed breaks save-to-save determinism without requiring
// any changes to the game state structure.
function getWorldNonce(prospects) {
  if (!prospects || prospects.length === 0) return 0;
  return prospects.slice(0, 6).reduce((h, p) => (hashString(p.id) ^ ((h * 31) >>> 0)) >>> 0, 17);
}

// ── Philosophy-driven cut score modifier ─────────────────────────────────────
// Applied on top of the standard formula to make each team identity genuinely
// affect WHO they hold vs. who they release, not just who they sign.
//   youth_upside     → patient with young high-upside players
//   chemistry_stab.  → reluctant to cut high-teamwork players
//   win_now          → quicker to cut older/stagnant players
//   balanced_value   → mild patience with players showing upside
//   high_risk_gamble → no bias (relies on noise for variation)
function philosophyCutModifier(player, context) {
  const age     = player.age || 22;
  const overall = player.overall || 70;
  const upside  = (player.potential || overall) - overall;

  switch (context.philosophy) {
    case "youth_upside":
      if (age <= 21 && upside >= 5) return -15;
      if (age <= 23 && upside >= 5) return -8;
      if (age <= 23 && upside >= 3) return -4;
      return 0;

    case "chemistry_stability": {
      const tw = player.teamwork || 70;
      if (tw >= 82) return -10;
      if (tw >= 72) return -5;
      return 0;
    }

    case "win_now":
      if (age >= 28) return 5;
      if (overall <= 78 && age >= 26) return 4;
      return 0;

    case "balanced_value":
      return upside >= 4 ? -3 : 0;

    default:
      return 0;
  }
}

// ── Hesitation threshold ──────────────────────────────────────────────────────
// Minimum margin a player's score must exceed the eligibility threshold before
// a team acts confidently. Teams whose top cut candidate barely qualifies may
// hold instead of forcing the move. Philosophy shapes how decisive each team is.
function hesitationMargin(philosophy) {
  switch (philosophy) {
    case "chemistry_stability": return 10; // strong evidence required
    case "youth_upside":        return 7;
    case "balanced_value":      return 5;
    case "high_risk_gamble":    return 3;  // acts quickly on any weakness
    case "win_now":             return 2;  // most decisive
    default:                    return 5;
  }
}

// ── Weighted cut selection ────────────────────────────────────────────────────
// Picks `count` players to cut from the eligible pool using proportional
// weighting on cut score. Higher-scored players are still most likely to be
// cut, but players in similar score bands occasionally swap — preventing the
// same player from always being dropped across different saves.
function weightedCutSelect(eligibleWithScores, count, rng) {
  const pool     = [...eligibleWithScores];
  const selected = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((sum, e) => sum + Math.max(1, e.cutScore), 0);
    let roll = rng() * totalWeight;
    let pick = pool[pool.length - 1]; // fallback
    for (const entry of pool) {
      roll -= Math.max(1, entry.cutScore);
      if (roll <= 0) { pick = entry; break; }
    }
    selected.push(pick.player);
    pool.splice(pool.indexOf(pick), 1);
  }
  return selected;
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
  // Upside base weight reduced from 2.2 to 1.0.
  // Previously upside was counted twice: once here and again inside every
  // philosophy boost that includes upside (balanced_value, youth_upside,
  // high_risk_gamble). That stacked 4-7× per upside point, letting a
  // 62 OVR / 85-pot challenger outscore an 83 OVR proven FA by ~100 pts.
  // Philosophy boosts now carry the primary upside weight; the 1.0 base
  // preserves a small universal signal for philosophies that ignore upside.
  score += upside * 1.0;
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
    score += 4 + context.challengerTrust * 8 + callupNeed * 5 + budgetChallBonus + premiumBonus;

    // ── Below-roster-level penalty ──────────────────────────────────────────
    // A prospect rated well below the team's current average should not beat a
    // proven FA on upside math alone. Premium challengers (76+ OVR) have a small
    // gap and are barely affected; very weak challengers take a meaningful hit.
    const rosterGap = evaluation.avgOverall - overall;
    if (rosterGap > 5) score -= (rosterGap - 5) * 2.5;
  } else {
    score -= callupNeed * 2.8;

    // ── Proven-quality floor for established free agents ──────────────────────
    // Reliable mid-to-high OVR FAs get a direct quality bonus that reflects their
    // certainty over a prospect's theoretical upside. Without this, upside math
    // dominates and solid FAs sit unsigned while weak challengers fill slots.
    //   80 OVR → +7.2   83 OVR → +12.6   86 OVR → +18   90 OVR → +25.2
    if (overall >= 80) score += (overall - 76) * 1.8;

    // ── Upgrade urgency ────────────────────────────────────────────────────
    // Threshold lowered from > 3 to > 0 — any positive gap should be rewarded.
    // A team averaging 80 OVR signing an 83 OVR FA (gap=3) previously got zero
    // bonus; that is the exact case that caused proven FAs to sit unsigned.
    const upgradeGap = overall - evaluation.avgOverall;
    if (upgradeGap > 0) {
      const upgradeBonus = upgradeGap * 2.5;
      const urgencyMultiplier = evaluation.standingRank >= 9 ? 1.6 : evaluation.standingRank >= 7 ? 1.2 : 1.0;
      score += upgradeBonus * urgencyMultiplier;
    }
  }

  if (windowType === "major") score -= isProspect ? 2 : 0;
  score += (rng() - 0.5) * 4 * context.volatility;
  return score;
}

export function getChallengerStockLabel(candidate, gameState = null) {
  const ovr = candidate.overall ?? 70;
  const pot = candidate.potential ?? ovr;
  const age = candidate.age ?? 22;
  const form = candidate.form ?? 0;
  const showcase = candidate.challengerShowcase?.slice(-1)[0];
  const performance = gameState ? getChallengerPerformanceScore(candidate, gameState) : null;
  if ((candidate.ego ?? 50) >= 80 && (candidate.composure ?? 70) <= 60) return "High Risk";
  if ((performance?.majorMaps ?? 0) >= 6 && ((performance?.majorKd ?? 1) >= 1.08 || (performance?.cdlSeriesWins ?? 0) > 0)) return "Pro-Am Standout";
  if (showcase && (showcase.kd ?? 0) >= 1.12) return "Pro-Am Standout";
  if ((performance?.score ?? 0) >= 32 && (performance?.qualifiedMajors ?? 0) >= 1) return "CDL Ready";
  if (ovr >= 80 && pot >= 88) return "Blue Chip";
  if (ovr >= 78 || (ovr >= 75 && pot >= 86)) return "CDL Ready";
  if (age >= 28 && !candidate.teamId) return "Veteran";
  if (form >= 2 || (candidate.lastQualifierPlacement ?? 99) <= 4 || (performance?.bestQualifierPlacement ?? 99) <= 4) return "Rising";
  if (form <= -2 || (performance?.score ?? 0) <= -10) return "Falling";
  return "Stable";
}

function scoreChallengerPickupCandidate(candidate, teamPlayers, evaluation, neededRole, gameState) {
  const ovr = candidate.overall ?? 70;
  const pot = candidate.potential ?? ovr;
  const age = candidate.age ?? 22;
  const fit = roleFitScore(candidate, neededRole);
  const slot = teamPlayers.filter(p => p.primary === neededRole).sort((a, b) => (a.overall ?? 0) - (b.overall ?? 0))[0];
  const slotKd = getCurrentKD(slot || {}, gameState.playerSeasonStats, gameState.season);
  const showcase = candidate.challengerShowcase?.slice(-1)[0];
  const performance = getChallengerPerformanceScore(candidate, gameState);
  const stock = getChallengerStockLabel(candidate, gameState);
  let score = ovr * 0.65 + (pot - ovr) * 1.25 + fit;
  score += age <= 23 ? 7 : age <= 26 ? 3 : -2;
  score += (candidate.form ?? 0) * 2.4;
  score += slotKd < 0.92 ? 6 : 0;
  if (slot) score += Math.max(0, ovr - (slot.overall ?? 70)) * 1.2;
  if (showcase) score += (showcase.kd ?? 1) >= 1.05 ? 6 : -2;
  if (showcase) score += (showcase.placement ?? 16) <= 8 ? 3 : 0;
  score += performance.score;
  if ((performance.qualifierMaps + performance.majorMaps) < 3 && performance.qualifierAppearances === 0) score -= 5;
  if (performance.qualifiedMajors === 0 && performance.qualifierAppearances > 0) score -= 4;
  score += stock === "Blue Chip" ? 8 : stock === "CDL Ready" ? 7 : stock === "Pro-Am Standout" ? 9 : stock === "Falling" ? -5 : 0;
  score += evaluation.standingRank >= 9 ? 6 : evaluation.standingRank <= 3 ? -6 : 0;
  return score;
}

function signCandidate(candidate, teamId, players, prospects) {
  const key = normalizePlayerName(candidate?.name);
  const duplicateCdlName = key && players.some(p => p.id !== candidate.id && p.teamId && isCdlTeamId(p.teamId) && !isInactivePlayer(p) && normalizePlayerName(p.name) === key);
  if (!candidate || isInactivePlayer(candidate) || duplicateCdlName) return { players, prospects, rejected: true };
  if (candidate.isProspect) {
    const signed = normalizeSignedCdlPlayer(candidate, teamId);
    return {
      players: [...players, signed],
      prospects: prospects.filter(p => p.id !== candidate.id),
    };
  }

  return {
    players: players.map(p => p.id === candidate.id ? normalizeSignedCdlPlayer(p, teamId) : p),
    prospects,
  };
}

function txKey(tx) {
  return [
    tx.season ?? "",
    tx.stageIdx ?? "",
    tx.majorIdx ?? "",
    tx.type ?? "",
    tx.playerId ?? normalizePlayerName(tx.playerName),
    normalizePlayerName(tx.playerName),
    tx.fromTeamId ?? "",
    tx.toTeamId ?? "",
  ].join("|");
}

function pushTx(transactions, gameState, entry) {
  if (!entry?.type || !entry?.playerName) return transactions;
  const tx = {
    season: gameState.season,
    stageIdx: gameState.schedule?.stageIdx ?? null,
    majorIdx: gameState.schedule?.majorIdx ?? null,
    ...entry,
  };
  return transactions.some(existing => txKey(existing) === txKey(tx)) ? transactions : [...transactions, tx];
}

function refillAllChallengerRosters(challengerTeams, players, prospects, protectedTeamId = null) {
  const teams = (challengerTeams || []).map(t => ({ ...t, playerIds: [...(t.playerIds || [])] }));
  const cdlNames = buildCdlRosterNameSet(players);
  const byId = new Map([...players, ...prospects].map(p => [p.id, p]));
  const assigned = new Set();
  const usedNames = new Set();
  for (const team of teams) {
    const cleanIds = [];
    for (const pid of team.playerIds) {
      const player = byId.get(pid);
      const key = normalizePlayerName(player?.name);
      if (!player || shouldExcludeFromChallengers(player, cdlNames, assigned, usedNames)) continue;
      cleanIds.push(pid);
      assigned.add(pid);
      usedNames.add(key);
    }
    team.playerIds = cleanIds.slice(0, 4);
  }
  const allPool = [...players.filter(p => !p.teamId && p.status !== "freeAgent" && !isInactivePlayer(p)), ...prospects.filter(p => !p.teamId && !isInactivePlayer(p))]
    .sort((a, b) => ((b.overall ?? 0) + (b.potential ?? 0) * 0.35) - ((a.overall ?? 0) + (a.potential ?? 0) * 0.35));
  for (const team of teams) {
    if (team.id === protectedTeamId) continue; // user manages this roster manually
    while (team.playerIds.length < 4) {
      const sameRegion = allPool.find(p => !shouldExcludeFromChallengers(p, cdlNames, assigned, usedNames) && (p.challengerTeamId == null) && (p.region === team.region));
      const fallback = allPool.find(p => !shouldExcludeFromChallengers(p, cdlNames, assigned, usedNames) && (p.challengerTeamId == null));
      const pick = sameRegion || fallback;
      if (!pick) break;
      pick.challengerTeamId = team.id;
      team.playerIds.push(pick.id);
      assigned.add(pick.id);
      usedNames.add(normalizePlayerName(pick.name));
    }
  }
  return teams;
}

function releasePlayer(player, players, prospects) {
  const shouldRetire = (player.age ?? 25) >= 33 || ((player.age ?? 25) >= 30 && (player.overall ?? 70) < 70);
  // With 24 Challenger teams more viable CDL vets can land on Challenger rosters.
  // Lower primary threshold from 76 to 73, and widen secondary (OVR 70+ under 30).
  const shouldGoChall = (player.overall ?? 70) >= 73 || ((player.overall ?? 70) >= 70 && (player.age ?? 25) < 30);
  const shouldGoInactive = !shouldRetire && !shouldGoChall;
  if (player.isProspect) {
    if (shouldRetire) return { players: players.filter(p => p.id !== player.id), prospects };
    return {
      players: players.filter(p => p.id !== player.id),
      prospects: [...prospects, { ...player, teamId: null, isSub: false, status: "challengers" }],
    };
  }
  if (shouldRetire) {
    return {
      players: players.filter(p => p.id !== player.id),
      prospects,
      retired: { ...player, teamId: null, isSub: false, status: "retired" },
    };
  }
  if (shouldGoChall) {
    const toProspect = { ...player, teamId: null, isSub: false, challengerTeamId: null, contractYears: 0, status: "challengers" };
    return {
      players: players.filter(p => p.id !== player.id),
      prospects: [...prospects, toProspect],
      movedToChallengers: toProspect,
    };
  }
  if (shouldRetire) {
    return {
      players: players.filter(p => p.id !== player.id),
      prospects,
      retired: { ...player, teamId: null, isSub: false },
    };
  }
  if (shouldGoChall) {
    const toProspect = { ...player, teamId: null, isSub: false, challengerTeamId: null, contractYears: 0 };
    return {
      players: players.filter(p => p.id !== player.id),
      prospects: [...prospects, toProspect],
      movedToChallengers: toProspect,
    };
  }

  if (shouldGoInactive) {
    return {
      players: players.map(p => p.id === player.id ? { ...p, teamId: null, isSub: false, challengerTeamId: null, status: "inactive" } : p),
      prospects,
      inactive: { ...player, teamId: null, status: "inactive" },
    };
  }
  return { players, prospects };
}

// ── Minimum roster guarantee ──────────────────────────────────────────────────
// After retirements or failed signings a team may have fewer than 4 starters.
// This pass runs once per team at the end of every roster window and fills any
// open starter slots with the best affordable candidate available.
//
// Rules:
//   • Skips the user's team (user fills their own gaps manually)
//   • Respects the hard budget cap — never signs over budget
//   • Prefers highest-OVR affordable option (no philosophy weighting — this is
//     emergency fill, not a considered decision)
//   • Stops if no affordable candidate exists rather than leaving > 4 (better
//     to have 3 strong players than 4 where one is terrible and over budget)
function fillMinimumRoster(teamId, players, prospects, rosterMovesLog, season, windowType) {
  let cur = { players, prospects };
  const additions = [];
  let safety = 0;

  while (safety++ < 4) {
    const starters = getStarters(cur.players, teamId);
    if (starters.length >= 4) break;

    const committed   = starters.reduce((s, p) => s + (p.salary ?? getSigningCost(p)), 0);
    const budgetLeft  = getTeamCap(teamId) - committed;

    const cdlNames = buildCdlRosterNameSet(cur.players);
    const pool = [
      ...cur.players.filter(p => !p.teamId && !p.isProspect),
      ...cur.prospects.filter(p => !p.teamId),
    ]
      .filter(c => !isInactivePlayer(c))
      .filter(c => !isLockedChallengerCandidate(c))
      .filter(c => !cdlNames.has(normalizePlayerName(c.name)));

    // Preferred: best affordable candidate.
    let pick = pool
      .filter(c => getSigningCost(c) <= budgetLeft)
      .sort((a, b) => (b.overall || 70) - (a.overall || 70))[0];
    let reason = "roster_fill";

    // Emergency: if nothing is affordable we still MUST get to 4 starters —
    // running a match sim with a thin roster crashes simMap. Sign the
    // cheapest remaining candidate even if it goes over cap; logged so the
    // analytics screens can show this happened.
    if (!pick) {
      pick = pool
        .slice()
        .sort((a, b) => getSigningCost(a) - getSigningCost(b))[0];
      if (pick) reason = "roster_fill_over_cap";
    }

    if (!pick) break; // genuinely no candidate available anywhere

    const signed = signCandidate(pick, teamId, cur.players, cur.prospects);
    if (signed.rejected) break;
    cur = signed;
    additions.push({ out: null, in: pick.name, fromChallengers: !!pick.isProspect, reason });
  }

  if (additions.length > 0) {
    rosterMovesLog.push({
      season, teamId, windowType,
      moveCount: additions.length,
      philosophy: "roster_fill",
      additions,
    });
  }

  return cur;
}


function getActiveCdlRoster(players, teamId) {
  return (players || []).filter(p => p.teamId === teamId && !p.isSub && !isInactivePlayer(p));
}

function normalizeSignedCdlPlayer(player, teamId, salary = null) {
  return {
    ...player,
    teamId,
    challengerTeamId: null,
    status: "cdl",
    circuit: "cdl",
    isSub: false,
    scouted: true,
    contractYears: Math.max(1, player.contractYears ?? 2),
    salary: salary ?? player.salary ?? getSigningCost(player),
  };
}

function makeEmergencyReplacement(teamId, slot, season) {
  const seed = hashString(`${teamId}_${season}_${slot}_emergency_replacement`);
  const first = ["Ace", "Blaze", "Dash", "Kilo", "Nero", "Rook", "Sage", "Vex"][seed % 8];
  const last = ["Mercer", "Cross", "Vale", "Stone", "Reed", "Wolfe", "Price", "Knox"][(seed >>> 3) % 8];
  const overall = 64 + (seed % 8);
  return {
    id: `emergency_${teamId}_${season}_${slot}_${seed.toString(36)}`,
    name: `${first} ${last}`,
    age: 20 + (seed % 5),
    region: CDL_TEAMS.find(t => t.id === teamId)?.region ?? "NA",
    primary: ["SMG", "AR", "Flex", "OBJ"][slot % 4],
    overall,
    potential: Math.max(overall + 4, 72 + (seed % 10)),
    teamwork: 60 + (seed % 25),
    leadership: 45 + (seed % 20),
    workEthic: 60 + ((seed >>> 4) % 25),
    ego: 35 + ((seed >>> 6) % 25),
    clutch: 45 + ((seed >>> 8) % 30),
    form: 65,
    isEmergencyReplacement: true,
    isProspect: true,
  };
}

function candidatePoolForIntegrity(players, prospects, teamId, usedIds, usedNames) {
  const team = CDL_TEAMS.find(t => t.id === teamId);
  return [
    ...players.filter(p => !p.teamId),
    ...prospects.filter(p => !p.teamId),
  ].filter(c => c && !isInactivePlayer(c))
    .filter(c => !isLockedChallengerCandidate(c))
    .filter(c => !usedIds.has(c.id))
    .filter(c => {
      const key = normalizePlayerName(c.name);
      return key && !usedNames.has(key);
    })
    .map(c => {
      const sameRegion = team?.region && c.region === team.region ? 1 : 0;
      const roleFit = c.primary ? 1 : 0;
      return { c, sameRegion, roleFit, cost: getSigningCost(c) };
    });
}

function appendIntegrityTx(transactions, state, team, player, source, overCap) {
  const fromTeamId = player.challengerTeamId ?? null;
  const note = source === "generated"
    ? `${team.name} signed emergency replacement ${player.name} to complete roster.`
    : `${team.name} promoted ${player.name}${fromTeamId ? " from Challengers" : ""} to complete roster.`;
  return pushTx(transactions || [], state, {
    type: source === "generated" ? "EMERGENCY_ROSTER_FILL" : "CDL_SIGNING",
    playerId: player.id,
    playerName: player.name,
    fromTeamId,
    toTeamId: team.id,
    note: overCap ? `${note} Emergency budget exception used.` : note,
  });
}

export function ensureCdlRosterIntegrity(gameState, options = {}) {
  const state = gameState || {};
  _lockedChallengerIds = computeLockedChallengerIds(state);
  let players = [...(state.players || [])];
  let prospects = [...(state.prospects || [])];
  let challengerTeams = (state.challengerTeams || []).map(t => ({ ...t, playerIds: [...(t.playerIds || [])] }));
  let challengerTransactions = [...(state.challengerTransactions || [])];
  const rosterMovesLog = [...(state.rosterMovesLog || [])];
  const repairs = [];
  const season = state.season ?? state.schedule?.season ?? 1;
  const windowType = options.windowType ?? "integrity";
  const fillAiRosters = options.fillAiRosters ?? windowType !== "open_free_agency";
  const required = requiredStartersFor(state);

  const seenIds = new Set();
  const seenNames = new Set();
  players = players.map(player => {
    if (!player?.teamId || !isCdlTeamId(player.teamId) || player.isSub) return player;
    const key = normalizePlayerName(player.name);
    const invalid = isInactivePlayer(player) || !key || seenIds.has(player.id) || seenNames.has(key);
    if (invalid) {
      repairs.push({ type: "removed_invalid_cdl_reference", teamId: player.teamId, playerId: player.id, playerName: player.name });
      return { ...player, teamId: null, challengerTeamId: null, isSub: false, status: isInactivePlayer(player) ? player.status : "freeAgent" };
    }
    seenIds.add(player.id);
    seenNames.add(key);
    if (player.status !== "cdl" || player.circuit !== "cdl" || player.challengerTeamId) {
      repairs.push({ type: "normalized_cdl_player", teamId: player.teamId, playerId: player.id, playerName: player.name });
      return normalizeSignedCdlPlayer(player, player.teamId, player.salary ?? getSigningCost(player));
    }
    return player;
  });

  for (const team of CDL_TEAMS) {
    if (team.id === state.userTeamId) {
      const roster = getActiveCdlRoster(players, team.id);
      if (roster.length < required) {
        repairs.push({ type: "user_thin_cdl_roster_allowed", teamId: team.id, count: roster.length, required });
      }
      // The user must resolve their own over-size roster (roster-compliance block).
      continue;
    }

    let roster = getActiveCdlRoster(players, team.id);

    // Roster-size reduction (e.g. 5 → 4): release the weakest excess starters
    // into free agency. Sensible cuts favour ability, salary and depth — the
    // lowest-value starter is let go so displaced players re-enter the market.
    if (roster.length > required) {
      const rankedExcess = [...roster].sort((a, b) =>
        (a.overall ?? 60) - (b.overall ?? 60) ||
        (b.salary ?? 0) - (a.salary ?? 0)
      );
      const cutCount = roster.length - required;
      for (let i = 0; i < cutCount; i++) {
        const cut = rankedExcess[i];
        if (!cut) break;
        players = players.map(p => p.id === cut.id
          ? { ...p, teamId: null, challengerTeamId: null, isSub: false, contractYears: 0, status: "freeAgent", previousTeamId: team.id }
          : p);
        challengerTransactions = pushTx(challengerTransactions, state, {
          type: "ROSTER_SIZE_RELEASE", playerId: cut.id, playerName: cut.name, fromTeamId: team.id, toTeamId: null,
          note: `${team.name} released ${cut.name} to comply with the ${required}-player roster limit.`,
        });
        repairs.push({ type: "roster_size_reduction_release", teamId: team.id, playerId: cut.id, playerName: cut.name, required });
      }
      roster = getActiveCdlRoster(players, team.id);
    }

    if (!fillAiRosters) {
      if (roster.length < required) repairs.push({ type: "ai_thin_cdl_roster_deferred", teamId: team.id, count: roster.length, required });
      continue;
    }

    let fillSlot = 0;
    while (roster.length < required && fillSlot++ < 8) {
      const committed = roster.reduce((sum, p) => sum + (p.salary ?? getSigningCost(p)), 0);
      const budgetLeft = getTeamCap(team.id) - committed;
      const usedIds = new Set(players.filter(p => p.teamId && isCdlTeamId(p.teamId) && !p.isSub && !isInactivePlayer(p)).map(p => p.id));
      const usedNames = buildCdlRosterNameSet(players);
      let source = "pool";
      let overCap = false;
      const pool = candidatePoolForIntegrity(players, prospects, team.id, usedIds, usedNames);
      let pick = pool
        .filter(x => x.cost <= budgetLeft)
        .sort((a, b) => (b.sameRegion - a.sameRegion) || (b.roleFit - a.roleFit) || ((b.c.overall ?? 70) - (a.c.overall ?? 70)))[0]?.c;
      if (!pick) {
        pick = pool.slice().sort((a, b) => (a.cost - b.cost) || (b.sameRegion - a.sameRegion) || ((b.c.overall ?? 70) - (a.c.overall ?? 70)))[0]?.c;
        if (pick) overCap = getSigningCost(pick) > budgetLeft;
      }
      if (!pick) {
        pick = makeEmergencyReplacement(team.id, roster.length, season);
        source = "generated";
        overCap = true;
      }

      const salary = source === "generated" ? 15_000 : (pick.salary ?? getSigningCost(pick));
      const signed = normalizeSignedCdlPlayer(pick, team.id, salary);
      if (players.some(p => p.id === signed.id)) {
        players = players.map(p => p.id === signed.id ? signed : p);
      } else {
        players.push(signed);
      }
      prospects = prospects.filter(p => p.id !== signed.id);
      challengerTeams = challengerTeams.map(t => ({ ...t, playerIds: (t.playerIds || []).filter(id => id !== signed.id) }));
      challengerTransactions = appendIntegrityTx(challengerTransactions, state, team, pick, source, overCap);
      repairs.push({ type: source === "generated" ? "generated_emergency_replacement" : "filled_cdl_roster", teamId: team.id, playerId: signed.id, playerName: signed.name, overCap });
      roster = getActiveCdlRoster(players, team.id);
    }

    if (roster.length < required) {
      repairs.push({ type: "unrepairable_thin_cdl_roster", teamId: team.id, count: roster.length, required });
    }
  }

  if (repairs.length) {
    rosterMovesLog.push({ season, windowType, moveCount: repairs.filter(r => r.type === "filled_cdl_roster" || r.type === "generated_emergency_replacement").length, philosophy: "integrity_repair", repairs });
  }

  const repairedState = { ...state, players, prospects, challengerTeams, challengerTransactions, rosterMovesLog };
  if (options.returnRepairs) return { state: repairedState, repairs };
  return repairedState;
}

function runRosterWindow(gameState, { windowType, majorIdx }) {
  _lockedChallengerIds = computeLockedChallengerIds(gameState);
  const teamContexts = ensureContexts(gameState);
  let players = [...(gameState.players || [])];
  let prospects = [...(gameState.prospects || [])];
  const rosterMovesLog = [...(gameState.rosterMovesLog || [])];
  let challengerTeams = [...(gameState.challengerTeams || [])];
  let challengerTransactions = [...(gameState.challengerTransactions || [])];

  for (const team of CDL_TEAMS) {
    if (team.id === gameState.userTeamId) continue;

    // Mix in the per-save world nonce (derived from randomly-seeded prospects)
    // so the same season/window produces different decisions across different saves.
    const worldNonce = getWorldNonce(gameState.prospects);
    const seed = hashString(`${team.id}_${gameState.season}_${windowType}_${majorIdx ?? -1}_${worldNonce}`);
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

    // ── Score each starter with philosophy modifier + controlled noise ────
    // Philosophy modifiers give each team identity a real effect on who they
    // keep (e.g. youth_upside retains young talent; chemistry_stability holds
    // high-teamwork players longer). Noise (scaled by volatility and philosophy)
    // ensures players in similar score bands don't always produce the same
    // ordering across different saves.
    const noiseScale = context.philosophy === "high_risk_gamble" ? 1.8
                     : context.philosophy === "chemistry_stability" ? 0.6
                     : context.philosophy === "win_now" ? 0.8
                     : 1.0;
    const noiseRange = 12 * clamp(context.volatility, 0.3, 1.0) * noiseScale;

    const startersWithScores = starters.map(p => {
      const base      = playerCutScore(p, evaluation, starters, gameState.playerSeasonStats, gameState.season);
      const philoMod  = philosophyCutModifier(p, context);
      const noise     = (rng() - 0.5) * noiseRange;
      return { player: p, cutScore: base + philoMod + noise };
    }).sort((a, b) => b.cutScore - a.cutScore);

    const eligiblePool = startersWithScores.filter(({ cutScore }) => cutScore >= cutThreshold);

    // If no players are genuinely weak enough to cut, skip this team's window
    if (eligiblePool.length === 0) {
      rosterMovesLog.push({ season: gameState.season, teamId: team.id, windowType, moveCount: 0, philosophy: context.philosophy });
      continue;
    }

    // ── Hesitation gate ───────────────────────────────────────────────────
    // If the top cut candidate barely clears the threshold, the team may hold
    // rather than always acting on marginal weakness. Philosophy governs how
    // much margin is needed before the team feels confident enough to move.
    // Loyal teams hesitate more; volatile teams second-guess less.
    const topCutScore = eligiblePool[0].cutScore;
    const margin      = topCutScore - cutThreshold;
    if (margin < hesitationMargin(context.philosophy)) {
      const holdChance = 0.30 + context.loyalty * 0.25; // 0.30–0.55
      if (rng() < holdChance) {
        rosterMovesLog.push({ season: gameState.season, teamId: team.id, windowType, moveCount: 0, philosophy: context.philosophy });
        continue;
      }
    }

    // ── Weighted cut selection ────────────────────────────────────────────
    // Pick cut candidates using proportional weighting rather than always
    // taking the top scorer(s). Players in similar bands get interchangeable
    // outcomes between saves; genuinely weak players are still most likely cut.
    const eligibleToCut = weightedCutSelect(eligiblePool, moveCount, rng);

    const additions = [];
    for (const cut of eligibleToCut) {
      const beforePlayers = players;
      const beforeProspects = prospects;
      const pendingReleaseTransactions = [];
      const afterRelease = releasePlayer(cut, players, prospects);
      players = afterRelease.players;
      prospects = afterRelease.prospects;
      if (afterRelease.movedToChallengers) {
        pendingReleaseTransactions.push({
          type: "CDL_RELEASE_TO_CHALLENGERS",
          playerId: cut.id,
          playerName: cut.name,
          fromTeamId: team.id,
          toTeamId: null,
          note: `${cut.name} moved to Challengers pool`,
        });
      }
      if (afterRelease.retired) {
        pendingReleaseTransactions.push({
          type: "RETIREMENT",
          playerId: cut.id,
          playerName: cut.name,
          fromTeamId: team.id,
          toTeamId: null,
          note: `${cut.name} retired after release`,
        });
      }
      if (afterRelease.inactive) {
        pendingReleaseTransactions.push({
          type: "INACTIVE",
          playerId: cut.id,
          playerName: cut.name,
          fromTeamId: team.id,
          toTeamId: null,
          note: `${cut.name} went inactive after release`,
        });
      }

      const teamNow = getStarters(players, team.id);

      // ── Hard budget filter ────────────────────────────────────────────────
      // Only consider candidates the team can actually afford after this
      // release. This is a hard cap: over-budget players are excluded before
      // scoring so the AI can never sign past its limit regardless of score.
      const committed     = teamNow.reduce((s, p) => s + (p.salary ?? getSigningCost(p)), 0);
      const budgetLeft    = getTeamCap(team.id) - committed;

      const cdlNames = buildCdlRosterNameSet(players);
      const candidates = [
        ...players.filter(p => p.teamId == null),
        ...prospects,
      ].filter(c => !isInactivePlayer(c))
        .filter(c => !isLockedChallengerCandidate(c))
        .filter(c => !cdlNames.has(normalizePlayerName(c.name)))
        .filter(c => !players.some(p => p.id !== c.id && p.teamId && isCdlTeamId(p.teamId) && normalizePlayerName(p.name) === normalizePlayerName(c.name)))
        .filter(c => getSigningCost(c) <= budgetLeft);

      if (!candidates.length) {
        players = beforePlayers;
        prospects = beforeProspects;
        continue;
      }

      const neededRole = cut.primary;
      const ranked = candidates
        .filter(c => c.id !== cut.id)
        .map(c => {
          const base = candidateScore(c, teamNow, context, evaluation, neededRole, rng, windowType);
          const chall = (c.isProspect || c.challengerTeamId) ? scoreChallengerPickupCandidate(c, teamNow, evaluation, neededRole, gameState) : 0;
          return { c, score: base + chall * 0.55 };
        })
        .sort((a, b) => b.score - a.score);

      const pickPool = ranked.slice(0, Math.min(6, ranked.length));
      const pick = pickPool[Math.floor(rng() * pickPool.length)]?.c;
      if (!pick) {
        players = beforePlayers;
        prospects = beforeProspects;
        continue;
      }

      const afterSign = signCandidate(pick, team.id, players, prospects);
      if (afterSign.rejected) {
        players = beforePlayers;
        prospects = beforeProspects;
        continue;
      }
      players = afterSign.players;
      prospects = afterSign.prospects;
      if (pick.challengerTeamId) {
        challengerTeams = challengerTeams.map(t => t.id === pick.challengerTeamId ? { ...t, playerIds: (t.playerIds || []).filter(pid => pid !== pick.id) } : t);
      }
      for (const tx of pendingReleaseTransactions) challengerTransactions = pushTx(challengerTransactions, gameState, tx);
      challengerTransactions = pushTx(challengerTransactions, gameState, {
        type: "CDL_SIGNING",
        playerId: pick.id,
        playerName: pick.name,
        fromTeamId: pick.challengerTeamId ?? null,
        toTeamId: team.id,
        note: `${team.tag} signed ${pick.name}${pick.challengerTeamId ? ` from ${challengerTeams.find(t => t.id === pick.challengerTeamId)?.name || "Challengers"}` : ""} as a ${neededRole} upgrade`,
      });
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

  // ── Mandatory roster fill ─────────────────────────────────────────────────
  // After all regular AI decisions, guarantee every AI team has 4 starters.
  // Catches gaps caused by retirements, failed signings, or budget constraints
  // in the window above. User's team is intentionally excluded — the player
  // fills their own gaps through Free Agency / Challengers screens.
  for (const team of CDL_TEAMS) {
    if (team.id === gameState.userTeamId) continue;
    const result = fillMinimumRoster(team.id, players, prospects, rosterMovesLog, gameState.season, windowType);
    players   = result.players;
    prospects = result.prospects;
  }
  challengerTeams = refillAllChallengerRosters(challengerTeams, players, prospects, gameState.userTeamType === "challenger" ? gameState.userTeamId : null);

  return ensureCdlRosterIntegrity({
    ...gameState,
    players,
    prospects,
    teamContexts,
    rosterMovesLog,
    challengerTeams,
    challengerTransactions,
  }, { windowType: `${windowType}_post_window` });
}

export function runAIMajorRosterWindow(gameState, majorIdx) {
  return runRosterWindow(gameState, { windowType: "major", majorIdx });
}


function freeAgentContractYears(player) {
  const age = player.age ?? 24;
  const overall = player.overall ?? 70;
  if (overall >= 88 && age <= 29) return 3;
  if (overall >= 82 && age <= 30) return 2;
  if ((player.potential ?? overall) - overall >= 8 && age <= 23) return 2;
  return 1;
}

function teamNeedForFreeAgent(teamPlayers, candidate) {
  const starters = teamPlayers.filter(p => !p.isSub && !isInactivePlayer(p));
  if (starters.length < 4) return { score: 55 + (4 - starters.length) * 16, replace: null, reason: "missing starter" };
  const sameRole = starters.filter(p => p.primary === candidate.primary || p.secondary === candidate.primary);
  const weakestRole = sameRole.sort((a, b) => (a.overall ?? 70) - (b.overall ?? 70))[0];
  const weakest = [...starters].sort((a, b) => (a.overall ?? 70) - (b.overall ?? 70))[0];
  const replace = weakestRole || weakest;
  const upgrade = (candidate.overall ?? 70) - (replace?.overall ?? 70);
  const roleBonus = weakestRole ? 12 : 3;
  return { score: upgrade * 6 + roleBonus, replace, reason: upgrade > 0 ? `upgrade over ${replace?.name}` : "depth check" };
}

export function runAIFreeAgencyMarket(gameState, options = {}) {
  _lockedChallengerIds = computeLockedChallengerIds(gameState);
  const teamContexts = ensureContexts(gameState);
  let players = [...(gameState.players || [])];
  let prospects = [...(gameState.prospects || [])];
  let challengerTeams = (gameState.challengerTeams || []).map(t => ({ ...t, playerIds: [...(t.playerIds || [])] }));
  let challengerTransactions = [...(gameState.challengerTransactions || [])];
  const rosterMovesLog = [...(gameState.rosterMovesLog || [])];
  const diagnostics = { enteringMarket: [], topFreeAgents: [], teamNeeds: [], offers: [], signings: [], leftUnsigned: [], marketExits: [], rosterSizes: [] };
  const season = gameState.season ?? gameState.schedule?.season ?? 1;
  const cdlNames = () => buildCdlRosterNameSet(players);

  const waves = [
    { name: "elite", min: 86, limitPerTeam: 1 },
    { name: "veteran", min: 78, limitPerTeam: 2 },
    { name: "depth", min: 70, limitPerTeam: 2 },
  ];

  diagnostics.enteringMarket = players.filter(p => !p.teamId && p.status === "freeAgent" && !isInactivePlayer(p)).map(p => ({ id: p.id, name: p.name, overall: p.overall, previousTeamId: p.previousTeamId ?? null }));
  diagnostics.topFreeAgents = [...diagnostics.enteringMarket].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)).slice(0, 20);

  for (const team of CDL_TEAMS) {
    if (team.id === gameState.userTeamId) continue;
    const starters = getStarters(players, team.id);
    const evaluation = evaluateTeam(team.id, { ...gameState, players, prospects }, "freeAgency", null);
    diagnostics.teamNeeds.push({ teamId: team.id, starters: starters.length, avgOverall: Number((evaluation.avgOverall ?? 0).toFixed(1)), standingRank: evaluation.standingRank });
  }

  for (const wave of waves) {
    const signedByTeam = new Map();
    let pool = players
      .filter(p => !p.teamId && p.status === "freeAgent" && !isInactivePlayer(p) && (p.overall ?? 70) >= wave.min)
      .filter(p => !cdlNames().has(normalizePlayerName(p.name)))
      .sort((a, b) => (b.overall ?? 70) - (a.overall ?? 70) || (b.potential ?? 70) - (a.potential ?? 70));

    for (const candidate of pool) {
      if (players.find(p => p.id === candidate.id)?.teamId) continue;
      const offers = [];
      for (const team of CDL_TEAMS) {
        if (team.id === gameState.userTeamId) continue;
        if ((signedByTeam.get(team.id) ?? 0) >= wave.limitPerTeam) continue;
        const roster = players.filter(p => p.teamId === team.id && !p.isSub && !isInactivePlayer(p));
        const committed = roster.reduce((sum, p) => sum + (p.salary ?? getSigningCost(p)), 0);
        const demand = getSigningCost(candidate);
        const budgetLeft = getTeamCap(team.id) - committed;
        const need = teamNeedForFreeAgent(roster, candidate);
        const evaluation = evaluateTeam(team.id, { ...gameState, players, prospects }, "freeAgency", null);
        const context = teamContexts[team.id] || { philosophy: "balanced_value", volatility: 0.4 };
        const contender = Math.max(0, 13 - (evaluation.standingRank ?? 8));
        const kd = getCurrentKD(candidate, gameState.playerSeasonStats, gameState.season);
        const stock = getChallengerStockLabel(candidate, gameState);
        const affordable = demand <= budgetLeft || roster.length < 4;
        if (!affordable) continue;
        let score = need.score + (candidate.overall ?? 70) * 1.15 + ((candidate.potential ?? candidate.overall ?? 70) - (candidate.overall ?? 70)) * 1.2;
        score += kd >= 1.1 ? 8 : kd < 0.9 ? -7 : 0;
        score += candidate.age <= 23 ? 5 : candidate.age >= 30 ? -6 : 0;
        score += contender * ((candidate.age ?? 24) >= 27 ? 1.4 : 0.7);
        score += context.philosophy === "win_now" ? 6 : context.philosophy === "youth_upside" && (candidate.age ?? 24) <= 23 ? 7 : 0;
        score += stock === "Blue Chip" ? 5 : stock === "Veteran" ? 2 : 0;
        score += Math.min(14, Math.max(0, budgetLeft - demand) / 25000);
        if (candidate.previousTeamId === team.id) score += 3;
        if (need.replace && need.score < 10 && roster.length >= 4) continue;
        offers.push({ teamId: team.id, playerId: candidate.id, playerName: candidate.name, salary: demand, years: freeAgentContractYears(candidate), score: Number(score.toFixed(2)), reason: need.reason });
      }
      offers.sort((a, b) => b.score - a.score || b.salary - a.salary);
      diagnostics.offers.push(...offers.slice(0, 3).map(o => ({ ...o, wave: wave.name })));
      const winner = offers[0];
      if (!winner || winner.score < (wave.name === "elite" ? 130 : wave.name === "veteran" ? 105 : 92)) continue;

      const team = CDL_TEAMS.find(t => t.id === winner.teamId);
      const currentRoster = players.filter(p => p.teamId === winner.teamId && !p.isSub && !isInactivePlayer(p));
      const need = teamNeedForFreeAgent(currentRoster, candidate);
      if (currentRoster.length >= 4 && need.replace) {
        players = players.map(p => p.id === need.replace.id ? { ...p, teamId: null, isSub: false, challengerTeamId: null, contractYears: 0, status: "freeAgent", previousTeamId: winner.teamId } : p);
        challengerTransactions = pushTx(challengerTransactions, gameState, { type: "FREE_AGENT_ENTERED", playerId: need.replace.id, playerName: need.replace.name, fromTeamId: winner.teamId, toTeamId: null, note: `${need.replace.name} entered free agency after leaving ${team?.name || winner.teamId}.` });
      }
      const salary = winner.salary;
      players = players.map(p => p.id === candidate.id ? normalizeSignedCdlPlayer({ ...p, contractYears: winner.years, salary }, winner.teamId, salary) : p);
      challengerTeams = challengerTeams.map(t => ({ ...t, playerIds: (t.playerIds || []).filter(id => id !== candidate.id) }));
      signedByTeam.set(winner.teamId, (signedByTeam.get(winner.teamId) ?? 0) + 1);
      challengerTransactions = pushTx(challengerTransactions, gameState, { type: "FREE_AGENT_SIGNING", playerId: candidate.id, playerName: candidate.name, fromTeamId: candidate.previousTeamId ?? null, toTeamId: winner.teamId, note: `${team?.name || winner.teamId} signed ${candidate.name} to a ${winner.years}-year free-agent deal.` });
      diagnostics.signings.push({ playerId: candidate.id, playerName: candidate.name, teamId: winner.teamId, salary, years: winner.years, wave: wave.name });
    }
  }

  players = players.map(p => {
    if (p.teamId || p.status !== "freeAgent" || isInactivePlayer(p)) return p;
    const age = p.age ?? 24;
    const overall = p.overall ?? 70;
    if (age >= 33 && overall < 78) {
      diagnostics.marketExits.push({ playerId: p.id, playerName: p.name, status: "retired" });
      challengerTransactions = pushTx(challengerTransactions, gameState, { type: "FREE_AGENT_RETIRED", playerId: p.id, playerName: p.name, fromTeamId: p.previousTeamId ?? null, toTeamId: null, note: `${p.name} retired after going unsigned.` });
      return { ...p, status: "retired", teamId: null, challengerTeamId: null };
    }
    // With 24 Challenger teams there are more slots. Players below elite CDL threshold
    // (OVR < 84) who went unsigned should land on a Challenger team rather than
    // sitting as inactive free agents with no realistic CDL offers coming.
    if (overall < 84 && age <= 31) {
      diagnostics.marketExits.push({ playerId: p.id, playerName: p.name, status: "challengers" });
      challengerTransactions = pushTx(challengerTransactions, gameState, { type: "FREE_AGENT_TO_CHALLENGERS", playerId: p.id, playerName: p.name, fromTeamId: p.previousTeamId ?? null, toTeamId: null, note: `${p.name} joined Challengers after going unsigned.` });
      prospects.push({ ...p, teamId: null, challengerTeamId: null, contractYears: 0, status: "challengers" });
      return null;
    }
    diagnostics.leftUnsigned.push({ playerId: p.id, playerName: p.name, overall: p.overall });
    return p;
  }).filter(Boolean);

  // Immediately fill any open Challenger slots with newly-added Challengers prospects
  // so released CDL players get team assignments without waiting for the next qualifier.
  challengerTeams = refillAllChallengerRosters(challengerTeams, players, prospects, gameState.userTeamType === "challenger" ? gameState.userTeamId : null);

  diagnostics.rosterSizes = CDL_TEAMS.map(t => ({ teamId: t.id, count: players.filter(p => p.teamId === t.id && !p.isSub && !isInactivePlayer(p)).length }));
  rosterMovesLog.push({ season, windowType: "freeAgency", moveCount: diagnostics.signings.length, philosophy: "open_market", diagnostics });
  return { ...gameState, players, prospects, teamContexts, challengerTeams, challengerTransactions, rosterMovesLog, offseasonFreeAgencyDiagnostics: diagnostics };
}

export function runAIOffseasonRosterWindow(gameState) {
  return runRosterWindow(gameState, { windowType: "offseason", majorIdx: null });
}
