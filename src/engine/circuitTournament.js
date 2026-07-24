// src/engine/circuitTournament.js
// A live, interactive open-circuit LAN/championship — the historical equivalent
// of the modern CDL major. Reuses the modern 16-team double-elimination bracket
// engine and the shared match simulator so the user PLAYS their matches (results
// are computed live in the Match Center, never pre-determined), AI matches sim
// as the bracket advances, and the final placements fold back into the open
// circuit's Pro Points.
//
// The full ~28-team field is scored: the top 16 seeds (the user always among
// them) contest the DE16 playoff bracket; seeds 17+ place below it.

import {
  createLiveDE, findNextLiveMatch, recordLiveMatch, computeLivePlacements,
} from "./openCircuit/liveDE.js";
import { simMatch } from "./matchSim.js";
import {
  migrateProPointsStore, ensureSeason, awardTournamentPoints, rankTeamsByProPoints, eligibleLockedRoster,
} from "./proPoints.js";
import { buildCompetitionProfile, isInteractiveCircuitEvent } from "../data/competitionProfiles.js";

function hashString(str) { let h = 2166136261; for (const ch of String(str || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function circuitTeamTag(name) { return String(name || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "HST"; }
export function circuitTeamColor(id) { return `hsl(${hashString(id) % 360} 62% 58%)`; }

// Re-exported from competitionProfiles (single source of truth) for callers that
// import it from the tournament engine.
export { isInteractiveCircuitEvent };

// Resolve the event template (for the point table + prize) for an era + id.
function findEventTemplate(state, eventId) {
  const profile = buildCompetitionProfile(state.currentEraId);
  return (profile.eventTemplates || []).find((t) => t.id === eventId) || null;
}

// A team object the match simulator understands: top-4 players + display meta.
function teamObj(state, teamId) {
  const t = (state.teams || []).find((x) => x.id === teamId);
  const name = t?.name || teamId;
  const players = (state.players || [])
    .filter((p) => p.teamId === teamId && !p.isSub)
    .sort((a, b) => (b.overall || 0) - (a.overall || 0))
    .slice(0, 4);
  return { id: teamId, name, tag: circuitTeamTag(name), color: circuitTeamColor(teamId), players };
}

function teamName(state, teamId) { return (state.teams || []).find((x) => x.id === teamId)?.name || teamId; }

// Top-4 roster ids for Pro Point locking / team OVR.
function topRosterIds(state, teamId) {
  return (state.players || [])
    .filter((p) => p.teamId === teamId && !p.isSub)
    .sort((a, b) => (b.overall || 0) - (a.overall || 0))
    .slice(0, 4)
    .map((p) => p.id);
}

// Seed the whole field by current Pro Points ranking (already sorted). Every
// eligible team is in the bracket; the top seeds get first-round byes.
function seedField(state) {
  const oc = state.openCircuit;
  const ranked = (oc.ranking || []).map((r) => r.teamId).filter((id) => (state.teams || []).some((t) => t.id === id));
  const seen = new Set(ranked);
  const rest = (state.teams || []).map((t) => t.id).filter((id) => !seen.has(id));
  return [...ranked, ...rest];
}

// Build the live tournament for an event. Returns null when the event isn't an
// interactive bracket event.
export function buildCircuitTournament(state, eventId) {
  const oc = state.openCircuit;
  if (!oc || oc.error) return null;
  const template = findEventTemplate(state, eventId) || (oc.calendar?.all || []).find((e) => e.id === eventId);
  if (!template || !isInteractiveCircuitEvent(template.eventType)) return null;

  const seeds = seedField(state);
  const bracket = createLiveDE(seeds);
  const teamsById = {};
  for (const id of seeds) {
    teamsById[id] = { name: teamName(state, id), tag: circuitTeamTag(teamName(state, id)), color: circuitTeamColor(id) };
  }
  return {
    eventId,
    name: template.name,
    eventType: template.eventType,
    tier: template.tier,
    prizePool: template.prizePool || 0,
    proPointTableId: template.proPointTableId,
    fieldSize: seeds.length,
    seeds,
    bracket,
    matchLog: [],
    teamsById,
    userTeamId: oc.userTeamId,
    status: "active",
    seasonId: oc.seasonId,
  };
}

// Simulate AI matches until the next playable match is the user's (so they can
// play it live) or the bracket is complete. Mutates `tournament`. Returns
// { userMatch, done }.
export function simCircuitAiUntilUser(tournament, state) {
  const b = tournament.bracket;
  const dynastySeed = (state.dynastySeed ?? 0) >>> 0;
  let guard = 0;
  while (guard++ < 400) {
    const next = findNextLiveMatch(b);
    if (!next) return { userMatch: false, done: b._de.phase === "done" };
    const { roundIdx, round, matchIdx, match } = next;
    if (match.a === tournament.userTeamId || match.b === tournament.userTeamId) {
      return { userMatch: true, done: false, roundName: round.name };
    }
    const seed = dynastySeed ^ hashString(`${tournament.eventId}|${roundIdx}|${matchIdx}|${match.a}|${match.b}`);
    const result = simMatch(teamObj(state, match.a), teamObj(state, match.b), seed);
    recordLiveMatch(b, roundIdx, matchIdx, result);
    logMatch(tournament, round.name, result);
  }
  return { userMatch: false, done: b._de.phase === "done" };
}

// Apply the user's live Match Center result to their pending bracket match, then
// resume AI sim up to their next match or completion. Mutates `tournament`.
export function applyUserCircuitResult(tournament, state, result) {
  const b = tournament.bracket;
  const next = findNextLiveMatch(b);
  if (!next) return { userMatch: false, done: b._de.phase === "done" };
  recordLiveMatch(b, next.roundIdx, next.matchIdx, result);
  logMatch(tournament, next.round.name, result);
  return simCircuitAiUntilUser(tournament, state);
}

function logMatch(tournament, roundName, result) {
  tournament.matchLog.push({
    roundName,
    teamAId: result.teamAId, teamBId: result.teamBId,
    winnerId: result.winnerId, loserId: result.loserId,
    score: result.score, result,
  });
}

// Auto-sim the user's pending match (when they'd rather not play it live), then
// resume AI up to their next match / completion.
export function simUserCircuitMatch(tournament, state) {
  const b = tournament.bracket;
  const next = findNextLiveMatch(b);
  if (!next || (next.match.a !== tournament.userTeamId && next.match.b !== tournament.userTeamId)) {
    return simCircuitAiUntilUser(tournament, state);
  }
  const dynastySeed = (state.dynastySeed ?? 0) >>> 0;
  const seed = dynastySeed ^ hashString(`${tournament.eventId}|user|${next.roundIdx}|${next.matchIdx}`);
  const result = simMatch(teamObj(state, next.match.a), teamObj(state, next.match.b), seed);
  recordLiveMatch(b, next.roundIdx, next.matchIdx, result);
  logMatch(tournament, next.round.name, result);
  return simCircuitAiUntilUser(tournament, state);
}

// Sim every remaining match (user included) to the champion.
export function simCircuitToEnd(tournament, state) {
  const b = tournament.bracket;
  const dynastySeed = (state.dynastySeed ?? 0) >>> 0;
  let guard = 0;
  while (guard++ < 400) {
    const next = findNextLiveMatch(b);
    if (!next) break;
    const seed = dynastySeed ^ hashString(`${tournament.eventId}|fin|${next.roundIdx}|${next.matchIdx}|${next.match.a}|${next.match.b}`);
    const result = simMatch(teamObj(state, next.match.a), teamObj(state, next.match.b), seed);
    recordLiveMatch(b, next.roundIdx, next.matchIdx, result);
    logMatch(tournament, next.round.name, result);
  }
  return { userMatch: false, done: b._de.phase === "done" };
}

// The user's next opponent/match info, for the tournament overlay preview.
export function nextUserCircuitMatch(tournament) {
  const next = findNextLiveMatch(tournament.bracket);
  if (!next) return null;
  const { round, match } = next;
  if (match.a !== tournament.userTeamId && match.b !== tournament.userTeamId) return null;
  const oppId = match.a === tournament.userTeamId ? match.b : match.a;
  return { roundName: round.name, opponentId: oppId };
}

// Build the CircuitBracket display view (names resolved, user highlighted).
export function circuitBracketView(tournament) {
  const { teamsById, userTeamId } = tournament;
  const nm = (id) => (id ? (teamsById[id]?.name || id) : null);
  return {
    type: "DE16",
    title: "Playoff Bracket",
    champion: tournament.bracket.champion ? nm(tournament.bracket.champion) : null,
    rounds: (tournament.bracket.rounds || [])
      .map((r) => ({
        name: r.name,
        matches: (r.matches || []).map((m) => ({
          a: nm(m.a), b: nm(m.b),
          winner: m.result ? nm(m.result.winnerId) : null,
          aIsUser: m.a === userTeamId, bIsUser: m.b === userTeamId,
        })),
      }))
      .filter((r) => r.matches.length > 0),
  };
}

// Finalize a completed tournament: compute placements across the full field,
// award Pro Points + prize once, and fold the result back into state.openCircuit
// (ranking, results, proPoints, resume payload, progression cursor).
export function finalizeCircuitTournament(state, tournament) {
  const oc = state.openCircuit;
  const seasonId = tournament.seasonId;
  const proStore = ensureSeason(migrateProPointsStore(oc.sim?.proStore), seasonId);

  const placeMap = computeLivePlacements(tournament.bracket); // { teamId: 1..N }
  const allPlacements = tournament.seeds.map((teamId) => ({
    teamId, placement: placeMap[teamId] || tournament.seeds.length, lockedRoster: topRosterIds(state, teamId),
  }));

  const award = awardTournamentPoints(proStore, {
    seasonId, tournamentId: tournament.eventId, placements: allPlacements,
    proPointTableId: tournament.proPointTableId, prizePool: tournament.prizePool || 0, fieldSize: tournament.fieldSize,
  });

  // Team list for ranking (top-4 rosters).
  const teamsForRank = (state.teams || []).map((t) => ({ id: t.id, name: t.name, roster: topRosterIds(state, t.id) }));
  const ranking = rankTeamsByProPoints(proStore, seasonId, teamsForRank, 4)
    .slice(0, 32)
    .map((r) => ({ rank: r.rank, teamId: r.teamId, name: r.name, points: r.points, roster: r.roster }));

  const nm = (id) => tournament.teamsById[id]?.name || teamName(state, id) || id;
  const userTeamId = tournament.userTeamId;
  const userPl = allPlacements.find((p) => p.teamId === userTeamId);
  const userAward = userPl && (award.awards || []).find((a) => a.placement === userPl.placement);

  // The user's series across the event, in the match-log display shape.
  const userMatches = tournament.matchLog
    .filter((m) => m.teamAId === userTeamId || m.teamBId === userTeamId)
    .map((m) => {
      const r = m.result;
      const isA = r.teamAId === userTeamId;
      const won = r.winnerId === userTeamId;
      const maps = (r.mapResults || []).map((mr) => ({
        mode: mr.mode,
        won: mr.winnerId === userTeamId,
        score: mr.winnerId === userTeamId ? `${mr.scoreWinner}-${mr.scoreLoser}` : `${mr.scoreLoser}-${mr.scoreWinner}`,
      }));
      return { phase: m.roundName, opponent: nm(isA ? r.teamBId : r.teamAId), won, score: r.score, maps };
    });

  const bracketView = circuitBracketView(tournament);

  // Full final placements (every team in the field, champion first) — the single
  // source of truth shared by the completion popup and any Placements tab.
  const finalPlacements = allPlacements.slice().sort((a, b) => a.placement - b.placement)
    .map((p) => ({ rank: p.placement, teamId: p.teamId, name: nm(p.teamId) }));
  const championTeamId = tournament.bracket.champion || (finalPlacements[0] && finalPlacements[0].teamId) || null;

  // Summary result for the Circuit / Standings / Dashboard. This is the unified
  // event-completion object: every completed event (interactive OR batch) exposes
  // the same minimum fields so any surface can render a safe completion screen.
  const summary = {
    // identity
    eventId: tournament.eventId,
    eventName: tournament.name,
    name: tournament.name,
    eraId: state.currentEraId || oc.seasonId || tournament.seasonId,
    gameTitle: state.currentGameTitle || null,
    eventType: tournament.eventType,
    eventTier: tournament.tier,
    tier: tournament.tier,
    // status
    completed: true, skipped: false, status: "complete", summaryReady: true,
    completedOrder: Object.values(oc.sim?.results || {}).filter((r) => r.completed && !r.skipped).length + 1,
    startDate: (oc.calendar?.all || []).find((e) => e.id === tournament.eventId)?.startDate,
    fieldSize: tournament.fieldSize,
    // champion
    championTeamId,
    championTeamName: championTeamId ? nm(championTeamId) : null,
    // user
    userTeamId,
    userInField: true,
    userPlacement: userPl ? userPl.placement : null,
    userPoints: userAward ? userAward.pointsPerPlayer : 0,
    userProPointsEarned: userAward ? userAward.pointsPerPlayer : 0,
    userPrize: userAward ? userAward.teamPrize : 0,
    // placements (top-8 kept as `placements` for existing readers; full ladder in
    // `finalPlacements` — both derive from the same computeLivePlacements source).
    phases: ["Registration", "Championship Bracket"],
    placements: finalPlacements.slice(0, 8),
    finalPlacements,
    proPointsAwarded: !!(award.awards && award.awards.length),
    awards: (award.awards || []).slice(0, 3)
      .map((a) => ({ placement: a.placement, teamId: a.teamId, name: nm(a.teamId), pointsPerPlayer: a.pointsPerPlayer, teamPrize: a.teamPrize })),
    completedMatches: (tournament.matchLog || []).length,
    userMatches,
    bracket: bracketView,
  };

  // Raw result for the resume payload (so reload / later logic stays consistent).
  const raw = {
    completed: true, name: tournament.name, eventType: tournament.eventType, tier: tournament.tier,
    startDate: summary.startDate, fieldSize: tournament.fieldSize,
    placements: allPlacements.map((p) => ({ teamId: p.teamId, placement: p.placement })),
    awards: award.awards, lockedRosters: {}, detail: {}, bracket: null, userMatches: [],
  };

  const results = { ...(oc.results || {}), [tournament.eventId]: summary };
  const simResults = { ...(oc.sim?.results || {}), [tournament.eventId]: raw };
  const all = oc.calendar?.all || [];
  const nextEvent = all.find((e) => !simResults[e.id]?.completed) || null;

  const newOc = {
    ...oc,
    ranking,
    results,
    proPoints: proStore.playerSeasonProPoints[seasonId] || {},
    sim: { results: simResults, proStore },
    playedCount: Object.values(simResults).filter((r) => r.completed && !r.skipped).length,
    nextEventId: nextEvent ? nextEvent.id : null,
    seasonComplete: !nextEvent,
    lastPlayedEventId: tournament.eventId,
  };
  return { ...state, openCircuit: newOc };
}
