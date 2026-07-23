// src/engine/openCircuitCareer.js
// Wires the open-circuit ecosystem into the real career flow. This is called
// from the game store at new-game, on load, and at every season transition, so
// a Ghosts-era (open-circuit) historical season is driven by the data-driven
// circuit instead of the modern four-Major / Challengers structure.
//
// Everything is idempotent: the circuit for a given era+season is built once
// (guarded by a build key), and Pro Points are awarded exactly once, so
// reloading a save never regenerates fixtures, awards points twice, or repeats
// inbox stories.

import { getEra } from "../data/codEras.js";
import { buildCompetitionProfile, ecosystemTypeForEra } from "../data/competitionProfiles.js";
import { hasHistoricalSeason } from "../data/historicalRosterDb.js";
import { brandSetForEra } from "../data/historicalTeams.js";
import { buildAndRunOpenCircuitSeason } from "./openCircuitEngine.js";
import { migrateProPointsStore } from "./proPoints.js";
import { makeEvent } from "./eventCentreEngine.js";

export function isOpenCircuitEra(eraId) {
  const era = getEra(eraId);
  return ecosystemTypeForEra(era) === "OPEN_CIRCUIT" && hasHistoricalSeason(era.id);
}

// Does the active career season use the open circuit (no modern Majors, no
// Challengers division)?
export function stateUsesOpenCircuit(state) {
  return state?.careerMode === "historical" && isOpenCircuitEra(state?.currentEraId);
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Map the user's stable team slot to a historical DB team id for the era, using
// the era's brand org name. Falls back to the raw slot id (the circuit engine
// then represents the user as a standalone team — a user exception).
function resolveUserDbTeamId(state, world) {
  const brands = brandSetForEra(state.currentEraId);
  const org = brands?.[state.userTeamId]?.org || brands?.[state.userTeamId]?.name || state.userTeamId;
  const target = norm(org);
  const first = target.slice(0, 5);
  let best = null;
  for (const team of Object.values(world.teams)) {
    const n = norm(team.name);
    if (n === target) return team.historicalTeamId;
    if (!best && (n.startsWith(first) || target.startsWith(n.slice(0, 5)))) best = team.historicalTeamId;
  }
  return best || state.userTeamId;
}

// The user's protected roster, mapped to the circuit's player shape.
function getUserRosterForCircuit(state) {
  return (state.players || [])
    .filter((p) => p.teamId === state.userTeamId && !p.isSub)
    .map((p) => ({ id: p.id, name: p.name, overall: p.overall, primary: p.primary || p.role, region: p.region }));
}

// Compact, serialisable summary of a simulated event for the save/UI.
function summariseResults(results, world) {
  const named = (teamId) => world.teams[teamId]?.name || teamId;
  const out = {};
  for (const [id, r] of Object.entries(results)) {
    if (!r.completed) continue;
    out[id] = {
      name: r.name, eventType: r.eventType, tier: r.tier, startDate: r.startDate,
      skipped: !!r.skipped, fieldSize: r.fieldSize || 0,
      phases: (r.phases || []).map((p) => p.phase),
      placements: (r.placements || []).slice(0, 8).map((p) => ({ rank: p.placement, teamId: p.teamId, name: named(p.teamId) })),
      awards: (r.awards || []).slice(0, 3).map((a) => ({ placement: a.placement, teamId: a.teamId, name: named(a.teamId), pointsPerPlayer: a.pointsPerPlayer, teamPrize: a.teamPrize })),
    };
  }
  return out;
}

// Build (or rebuild for a new season) the open-circuit season for a state.
// Returns a NEW state; a no-op (same object semantics) when already built.
export function ensureOpenCircuitSeason(state) {
  if (!stateUsesOpenCircuit(state)) return state;
  const buildKey = `${state.currentEraId}:${state.season ?? 1}`;
  if (state.openCircuit?.buildKey === buildKey) return state; // already built (idempotent)

  const dynastySeed = (state.dynastySeed ?? 0) >>> 0;
  const profile = buildCompetitionProfile(state.currentEraId);

  // Provisional world just to resolve the user's DB team id.
  const probe = buildAndRunOpenCircuitSeason({
    eraId: state.currentEraId, userTeamId: state.userTeamId,
    userPlayers: getUserRosterForCircuit(state), dynastySeed,
  });
  const userDbTeamId = probe.world ? resolveUserDbTeamId(state, probe.world) : state.userTeamId;

  const run = buildAndRunOpenCircuitSeason({
    eraId: state.currentEraId, userTeamId: userDbTeamId,
    userPlayers: getUserRosterForCircuit(state), dynastySeed,
  });
  if (!run.world) {
    return { ...state, competitionProfile: profile, openCircuit: { buildKey, error: run.error || "no_data" } };
  }

  const proStore = migrateProPointsStore(run.season.proStore);
  const openCircuit = {
    buildKey,
    seasonId: run.season.seasonId,
    userTeamId: run.world.userTeamId,
    ecosystemType: profile.ecosystemType,
    usesChallengers: profile.usesChallengers,
    usesProPoints: profile.usesProPoints,
    calendar: {
      events: run.season.calendar.events.map((e) => ({ id: e.id, name: e.name, eventType: e.eventType, tier: e.tier, startDate: e.startDate, endDate: e.endDate, location: e.location, prizePool: e.prizePool, qualificationMode: e.qualificationMode, targetFieldSize: e.targetFieldSize, regionEligibility: e.regionEligibility })),
      cupCount: run.season.calendar.cups.length,
      throwbacks: run.season.calendar.throwbacks.map((e) => ({ id: e.id, name: e.name, startDate: e.startDate })),
      overlaps: run.season.calendar.overlaps,
    },
    results: summariseResults(run.season.results, run.world),
    ranking: run.season.ranking.slice(0, 32).map((r) => ({ rank: r.rank, teamId: r.teamId, name: r.name, points: r.points, roster: r.roster })),
    teamsById: Object.fromEntries(Object.values(run.world.teams).filter((t) => t.isActive).map((t) => [t.id, { name: t.name, region: t.region, roster: t.roster, isUserControlled: !!t.isUserControlled }])),
    playersById: Object.fromEntries(Object.values(run.world.players).map((p) => [p.id, { name: p.name, gamertag: p.gamertag, overall: p.overall, teamId: p.teamId }])),
    conflicts: run.reconciliationConflicts || [],
    warnings: [...(run.warnings || []), ...((run.world.regionWarnings) || [])],
    proPoints: proStore.playerSeasonProPoints[run.season.seasonId] || {},
  };

  let next = { ...state, competitionProfile: profile, openCircuit };
  next = pushOpenCircuitInbox(next, openCircuit);
  return next;
}

// Inbox stories for major roster changes surfaced by reconciliation. Deduped by
// key so reloads / rebuilds never repeat a message.
function pushOpenCircuitInbox(state, oc) {
  const season = state.season ?? 1;
  const events = [];
  const seen = new Set((state.eventCentre?.events || []).map((e) => e.dedupKey).filter(Boolean));
  const add = (ev) => { if (ev.dedupKey && seen.has(ev.dedupKey)) return; seen.add(ev.dedupKey); events.push(ev); };

  const conflicts = oc.conflicts || [];
  const toFa = conflicts.filter((c) => c.type === "USER_TEAM_FULL_SIGNING_TO_FREE_AGENCY");
  for (const c of toFa) {
    const p = oc.playersById?.[c.playerId];
    add(makeEvent({
      type: "circuit_signing_to_fa", category: "Transfers", severity: "medium",
      title: "Historical signing sent to free agency",
      summary: `${p?.name || c.playerId} was historically due to join your team, but your roster is full — they entered free agency. No current player was released.`,
      season, phase: "stage", targetScreen: "circuit",
      dedupKey: `oc_fa:${oc.buildKey}:${c.playerId}`, actions: ["dismiss"],
    }));
  }
  const unresolved = conflicts.filter((c) => c.type === "UNRESOLVED_DATA_WARNING");
  for (const c of unresolved) {
    add(makeEvent({
      type: "circuit_data_warning", category: "Tournament", severity: "low",
      title: "Unresolved historical roster warning",
      summary: c.message, season, phase: "stage", targetScreen: "circuit",
      dedupKey: `oc_warn:${oc.buildKey}:${c.playerId}`, actions: ["dismiss"],
    }));
  }
  // Season-open circuit announcement (once per season).
  add(makeEvent({
    type: "circuit_season_open", category: "Tournament", severity: "medium",
    title: `Open Circuit — ${getEra(state.currentEraId).gameTitle}`,
    summary: `${oc.calendar.events.length} LAN & league events plus ${oc.calendar.cupCount} online 2K/5K Pro Point cups make up this season's open circuit. Pro Points decide seeding and Championship qualification. There is no separate Challengers division this era.`,
    season, phase: "stage", targetScreen: "circuit",
    dedupKey: `oc_open:${oc.buildKey}`, actions: ["dismiss"],
  }));

  if (!events.length) return state;
  return { ...state, eventCentre: { ...(state.eventCentre || { events: [], nextId: 1 }), events: [...(state.eventCentre?.events || []), ...events] } };
}
