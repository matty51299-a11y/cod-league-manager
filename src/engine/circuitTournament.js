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
  buildMajorBracketDE16, findNextBracketMatch, _advanceQualifierBracket, computeDE16Placements,
} from "./seasonEngine.js";
import { simMatch } from "./matchSim.js";
import {
  migrateProPointsStore, ensureSeason, awardTournamentPoints, rankTeamsByProPoints, eligibleLockedRoster,
} from "./proPoints.js";
import { buildCompetitionProfile } from "../data/competitionProfiles.js";

const INTERACTIVE_EVENT_TYPES = new Set(["OPEN_LAN", "WORLD_CHAMPIONSHIP", "INVITATIONAL", "REGIONAL_CHAMPIONSHIP"]);

function hashString(str) { let h = 2166136261; for (const ch of String(str || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function circuitTeamTag(name) { return String(name || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "HST"; }
export function circuitTeamColor(id) { return `hsl(${hashString(id) % 360} 62% 58%)`; }

export function isInteractiveCircuitEvent(eventType) { return INTERACTIVE_EVENT_TYPES.has(eventType); }

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

// Seed the field by current Pro Points ranking (already sorted); force the user
// into the top 16 so they always contest the playoff bracket.
function seedField(state) {
  const oc = state.openCircuit;
  const userTeamId = oc.userTeamId;
  const ranked = (oc.ranking || []).map((r) => r.teamId).filter((id) => (state.teams || []).some((t) => t.id === id));
  const all = ranked.length ? ranked : (state.teams || []).map((t) => t.id);
  const top16 = all.slice(0, 16);
  if (userTeamId && !top16.includes(userTeamId)) {
    if (top16.length >= 16) top16[15] = userTeamId; else top16.push(userTeamId);
  }
  const rest = all.filter((id) => !top16.includes(id));
  return { top16, rest };
}

// Build the live tournament for an event. Returns null when the event isn't an
// interactive bracket event.
export function buildCircuitTournament(state, eventId) {
  const oc = state.openCircuit;
  if (!oc || oc.error) return null;
  const template = findEventTemplate(state, eventId) || (oc.calendar?.all || []).find((e) => e.id === eventId);
  if (!template || !isInteractiveCircuitEvent(template.eventType)) return null;

  const { top16, rest } = seedField(state);
  const bracket = buildMajorBracketDE16(top16);
  const teamsById = {};
  for (const id of [...top16, ...rest]) {
    teamsById[id] = { name: teamName(state, id), tag: circuitTeamTag(teamName(state, id)), color: circuitTeamColor(id) };
  }
  return {
    eventId,
    name: template.name,
    eventType: template.eventType,
    tier: template.tier,
    prizePool: template.prizePool || 0,
    proPointTableId: template.proPointTableId,
    fieldSize: top16.length + rest.length,
    seeds: top16,
    outsideSeeds: rest,
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
  while (guard++ < 200) {
    const next = findNextBracketMatch(b);
    if (!next) return { userMatch: false, done: !!b.champion };
    const { roundIdx, round, matchIdx, match } = next;
    if (match.a === tournament.userTeamId || match.b === tournament.userTeamId) {
      return { userMatch: true, done: false, roundName: round.name };
    }
    const seed = dynastySeed ^ hashString(`${tournament.eventId}|${roundIdx}|${matchIdx}|${match.a}|${match.b}`);
    const result = simMatch(teamObj(state, match.a), teamObj(state, match.b), seed);
    match.played = true;
    match.result = result;
    recordMatch(tournament, roundIdx, round, matchIdx, result);
    _advanceQualifierBracket(b, roundIdx);
  }
  return { userMatch: false, done: !!b.champion };
}

// Apply the user's live Match Center result to their pending bracket match, then
// resume AI sim up to their next match or completion. Mutates `tournament`.
export function applyUserCircuitResult(tournament, state, result) {
  const b = tournament.bracket;
  const next = findNextBracketMatch(b);
  if (!next) return { userMatch: false, done: !!b.champion };
  const { roundIdx, round, matchIdx, match } = next;
  match.played = true;
  match.result = result;
  recordMatch(tournament, roundIdx, round, matchIdx, result);
  _advanceQualifierBracket(b, roundIdx);
  return simCircuitAiUntilUser(tournament, state);
}

function recordMatch(tournament, roundIdx, round, matchIdx, result) {
  tournament.matchLog.push({
    roundIdx, roundName: round.name, matchIdx,
    teamAId: result.teamAId, teamBId: result.teamBId,
    winnerId: result.winnerId, loserId: result.loserId,
    score: result.score, result,
  });
}

// The user's next opponent/match info, for the tournament overlay preview.
export function nextUserCircuitMatch(tournament) {
  const next = findNextBracketMatch(tournament.bracket);
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

  const de16 = computeDE16Placements(tournament.bracket); // { teamId: 1..16 }
  const allPlacements = [];
  for (const teamId of tournament.seeds) {
    allPlacements.push({ teamId, placement: de16[teamId] || 16, lockedRoster: topRosterIds(state, teamId) });
  }
  tournament.outsideSeeds.forEach((teamId, i) => {
    allPlacements.push({ teamId, placement: 17 + i, lockedRoster: topRosterIds(state, teamId) });
  });

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

  // Summary result for the Circuit / Standings / Dashboard.
  const summary = {
    completed: true, skipped: false,
    name: tournament.name, eventType: tournament.eventType, tier: tournament.tier,
    startDate: (oc.calendar?.all || []).find((e) => e.id === tournament.eventId)?.startDate,
    fieldSize: tournament.fieldSize,
    userInField: true,
    userPlacement: userPl ? userPl.placement : null,
    userPoints: userAward ? userAward.pointsPerPlayer : 0,
    userPrize: userAward ? userAward.teamPrize : 0,
    phases: ["Registration", "Championship Bracket"],
    placements: allPlacements.slice().sort((a, b) => a.placement - b.placement).slice(0, 8)
      .map((p) => ({ rank: p.placement, teamId: p.teamId, name: nm(p.teamId) })),
    awards: (award.awards || []).slice(0, 3)
      .map((a) => ({ placement: a.placement, teamId: a.teamId, name: nm(a.teamId), pointsPerPlayer: a.pointsPerPlayer, teamPrize: a.teamPrize })),
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
