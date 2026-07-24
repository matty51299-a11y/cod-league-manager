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

// Assemble the persisted openCircuit object from an engine run. This carries
// both the UI-facing summary (results, ranking, calendar) and the compact resume
// payload (`sim`: raw results + Pro Points store) that lets the season advance
// one event at a time across saves/reloads without regenerating fixtures.
function assembleOpenCircuit(run, buildKey) {
  const world = run.world;
  const profile = run.profile;
  const seasonId = run.season.seasonId;
  const rawResults = run.season.results;
  const proStore = migrateProPointsStore(run.season.proStore);
  const userTeamId = world.userTeamId;
  const named = (teamId) => world.teams[teamId]?.name || teamId;

  const results = {};
  for (const [id, r] of Object.entries(rawResults)) {
    if (!r.completed) continue;
    // The user's own finish (kept explicitly — the placements list below is
    // truncated to the top 8, so a >8th finish must not read as "not in field").
    const userPl = (r.placements || []).find((p) => p.teamId === userTeamId);
    const userAward = userPl && (r.awards || []).find((a) => a.placement === userPl.placement);
    // Full final placements + a safe champion fallback so a batch-completed event
    // is never left without a champion / placements (the completion object is the
    // same shape as the live tournament's — one source of truth for both surfaces).
    const orderedPlacements = (r.placements || []).slice().sort((a, b) => a.placement - b.placement);
    const finalPlacements = orderedPlacements.map((p) => ({ rank: p.placement, teamId: p.teamId, name: named(p.teamId) }));
    const championTeamId = (r.bracket && r.bracket.champion)
      || (orderedPlacements[0] && orderedPlacements[0].teamId) || null;
    results[id] = {
      // identity
      eventId: id, eventName: r.name, name: r.name,
      eraId: seasonId, gameTitle: profile.gameTitle || null,
      eventType: r.eventType, eventTier: r.tier, tier: r.tier, startDate: r.startDate, fieldSize: r.fieldSize || 0,
      // status
      completed: true, skipped: !!r.skipped, status: r.skipped ? "skipped" : "complete", summaryReady: !r.skipped,
      // champion
      championTeamId: r.skipped ? null : championTeamId,
      championTeamName: r.skipped || !championTeamId ? null : named(championTeamId),
      // user
      userTeamId,
      userInField: !!userPl,
      userPlacement: userPl ? userPl.placement : null,
      userPoints: userAward ? userAward.pointsPerPlayer : 0,
      userProPointsEarned: userAward ? userAward.pointsPerPlayer : 0,
      userPrize: userAward ? userAward.teamPrize : 0,
      phases: (r.phases || []).map((p) => p.phase),
      placements: finalPlacements.slice(0, 8),
      finalPlacements,
      proPointsAwarded: !r.skipped && !!(r.awards && r.awards.length),
      completedMatches: (r.userMatches || []).length,
      awards: (r.awards || []).slice(0, 3).map((a) => ({ placement: a.placement, teamId: a.teamId, name: named(a.teamId), pointsPerPlayer: a.pointsPerPlayer, teamPrize: a.teamPrize })),
      userMatches: (r.userMatches || []).map((m) => ({ phase: m.phase, opponent: named(m.opponent), won: m.won, score: m.score, maps: m.maps || [] })),
      bracket: r.bracket ? {
        type: r.bracket.type, title: r.bracket.title, champion: r.bracket.champion ? named(r.bracket.champion) : null,
        rounds: (r.bracket.rounds || []).map((rd) => ({
          name: rd.name,
          matches: (rd.matches || []).map((m) => ({
            a: m.a ? named(m.a) : null, b: m.b ? named(m.b) : null,
            winner: m.winner ? named(m.winner) : null,
            aIsUser: m.a === userTeamId, bIsUser: m.b === userTeamId,
          })),
        })),
      } : null,
    };
  }

  const all = run.season.calendar.all
    .map((e) => ({ id: e.id, name: e.name, eventType: e.eventType, tier: e.tier, startDate: e.startDate, endDate: e.endDate, location: e.location, prizePool: e.prizePool, qualificationMode: e.qualificationMode, targetFieldSize: e.targetFieldSize }))
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || String(a.id).localeCompare(String(b.id)));
  const nextEvent = all.find((e) => !rawResults[e.id]?.completed) || null;

  return {
    buildKey,
    seasonId,
    userTeamId: world.userTeamId,
    ecosystemType: profile.ecosystemType,
    usesChallengers: profile.usesChallengers,
    usesProPoints: profile.usesProPoints,
    calendar: {
      events: run.season.calendar.events.map((e) => ({ id: e.id, name: e.name, eventType: e.eventType, tier: e.tier, startDate: e.startDate, endDate: e.endDate, location: e.location, prizePool: e.prizePool, qualificationMode: e.qualificationMode, targetFieldSize: e.targetFieldSize, regionEligibility: e.regionEligibility })),
      cupCount: run.season.calendar.cups.length,
      throwbacks: run.season.calendar.throwbacks.map((e) => ({ id: e.id, name: e.name, startDate: e.startDate })),
      overlaps: run.season.calendar.overlaps,
      all,
    },
    results,
    ranking: run.season.ranking.slice(0, 32).map((r) => ({ rank: r.rank, teamId: r.teamId, name: r.name, points: r.points, roster: r.roster })),
    teamsById: Object.fromEntries(Object.values(world.teams).filter((t) => t.isActive).map((t) => [t.id, { name: t.name, region: t.region, roster: t.roster, isUserControlled: !!t.isUserControlled }])),
    playersById: Object.fromEntries(Object.values(world.players).map((p) => [p.id, { name: p.name, gamertag: p.gamertag, overall: p.overall, teamId: p.teamId }])),
    conflicts: run.reconciliationConflicts || [],
    warnings: [...(run.warnings || []), ...((world.regionWarnings) || [])],
    proPoints: proStore.playerSeasonProPoints[seasonId] || {},
    // Progression cursor + resume payload.
    playedCount: Object.values(rawResults).filter((r) => r.completed && !r.skipped).length,
    totalEvents: all.length,
    nextEventId: nextEvent ? nextEvent.id : null,
    seasonComplete: !nextEvent,
    sim: { results: rawResults, proStore },
  };
}

// Build (or rebuild for a new season) the open-circuit season for a state — the
// schedule is created but NOTHING is played yet (Pro Points start at zero); the
// user plays through it event by event via advanceOpenCircuitEvent. Idempotent
// per era+season build key, so reloads never regenerate or re-simulate.
export function ensureOpenCircuitSeason(state) {
  if (!stateUsesOpenCircuit(state)) return state;
  const buildKey = `${state.currentEraId}:${state.season ?? 1}`;
  if (state.openCircuit?.buildKey === buildKey) return state; // already built (idempotent)

  const dynastySeed = (state.dynastySeed ?? 0) >>> 0;
  const profile = buildCompetitionProfile(state.currentEraId);
  const userPlayers = getUserRosterForCircuit(state);

  // Provisional world just to resolve the user's DB team id (nothing simulated).
  const probe = buildAndRunOpenCircuitSeason({
    eraId: state.currentEraId, userTeamId: state.userTeamId, userPlayers, dynastySeed, maxNewEvents: 0,
  });
  const userDbTeamId = probe.world ? resolveUserDbTeamId(state, probe.world) : state.userTeamId;

  const run = buildAndRunOpenCircuitSeason({
    eraId: state.currentEraId, userTeamId: userDbTeamId, userPlayers, dynastySeed, maxNewEvents: 0,
  });
  if (!run.world) {
    return { ...state, competitionProfile: profile, openCircuit: { buildKey, error: run.error || "no_data" } };
  }

  const openCircuit = assembleOpenCircuit(run, buildKey);
  let next = { ...state, competitionProfile: profile, openCircuit };
  next = pushOpenCircuitInbox(next, openCircuit);
  return next;
}

// Play the next event on the open-circuit calendar (rolling past any AI-only
// "no eligible field" skips), award Pro Points once, and record the user team's
// match log. Returns a NEW state; a no-op when the season is already complete.
export function advanceOpenCircuitEvent(state) {
  if (!stateUsesOpenCircuit(state)) return state;
  const oc = state.openCircuit;
  if (!oc || oc.error || oc.seasonComplete) return state;

  const dynastySeed = (state.dynastySeed ?? 0) >>> 0;
  const userPlayers = getUserRosterForCircuit(state);
  const run = buildAndRunOpenCircuitSeason({
    eraId: state.currentEraId, userTeamId: oc.userTeamId, userPlayers, dynastySeed,
    existing: oc.sim, maxNewEvents: 1, stopBeforeInteractive: true,
  });
  if (!run.world) return state;

  const before = new Set(Object.keys(oc.sim?.results || {}).filter((id) => oc.sim.results[id]?.completed && !oc.sim.results[id]?.skipped));
  const openCircuit = assembleOpenCircuit(run, oc.buildKey);
  const justPlayed = Object.entries(run.season.results)
    .filter(([id, r]) => r.completed && !r.skipped && !before.has(id))
    .map(([id, r]) => ({ id, name: r.name, placements: r.placements, awards: r.awards, userMatches: r.userMatches }));
  openCircuit.lastPlayedEventId = justPlayed.length ? justPlayed[justPlayed.length - 1].id : (oc.lastPlayedEventId || null);

  let next = { ...state, openCircuit };
  next = pushCircuitResultInbox(next, justPlayed, openCircuit);
  return next;
}

// Batch-play the online 2K/5K cups up to (but not including) the next LAN /
// league / championship, so the user can grind seeding quickly and then play the
// big events live. Stops at the next major event or season end.
export function simCircuitToNextMajor(state) {
  if (!stateUsesOpenCircuit(state)) return state;
  const isCup = (s, id) => {
    const e = (s.openCircuit?.calendar?.all || []).find((x) => x.id === id);
    return e && (e.eventType === "ONLINE_2K" || e.eventType === "ONLINE_5K");
  };
  let s = state;
  let guard = 0;
  // Always advance at least once; then keep going while the NEXT queued event is
  // an online cup. This lands the user on the next major (or season complete).
  do {
    s = advanceOpenCircuitEvent(s);
    guard += 1;
  } while (!s.openCircuit.seasonComplete && s.openCircuit.nextEventId && isCup(s, s.openCircuit.nextEventId) && guard < 200);
  return s;
}

// Inbox item summarising the user's finish at each freshly-played event.
function pushCircuitResultInbox(state, justPlayed, oc) {
  const season = state.season ?? 1;
  const events = [];
  const seen = new Set((state.eventCentre?.events || []).map((e) => e.dedupKey).filter(Boolean));
  for (const ev of justPlayed) {
    const placement = (ev.placements || []).find((p) => p.teamId === oc.userTeamId);
    if (!placement) continue;
    const award = (ev.awards || []).find((a) => a.placement === placement.placement);
    const dedupKey = `oc_result:${oc.buildKey}:${ev.id}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const rank = placement.placement;
    const finishTxt = rank === 1 ? "won" : `finished ${rank}${rank === 2 ? "nd" : rank === 3 ? "rd" : "th"} at`;
    events.push(makeEvent({
      type: "circuit_result", category: "Tournament", severity: rank <= 3 ? "medium" : "low",
      title: rank === 1 ? `Champions — ${ev.name}` : `${ev.name} result`,
      summary: `Your team ${finishTxt} ${ev.name}${award ? ` — +${award.pointsPerPlayer.toLocaleString()} Pro Points per player` : ""}.`,
      season, phase: "stage", targetScreen: "circuit",
      dedupKey, actions: ["dismiss"],
    }));
  }
  if (!events.length) return state;
  return { ...state, eventCentre: { ...(state.eventCentre || { events: [], nextId: 1 }), events: [...(state.eventCentre?.events || []), ...events] } };
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
