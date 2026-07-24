// scripts/historicalCircuitHarness.mjs
// Shared, non-test helper: build a fresh Cod Dynasty (Ghosts open-circuit) save
// and play the whole season the way the app does, mirroring the store reducer's
// circuit-live routing (START_CIRCUIT_EVENT / SIM_NEXT_CIRCUIT_EVENT). Used by the
// event-completion / stability / readability / season-flow diagnostics so they
// all exercise the same real code paths.

import { createHistoricalCareer, createHistoricalStateFields } from "../src/engine/historicalDynasty.js";
import { ensureOpenCircuitSeason, advanceOpenCircuitEvent } from "../src/engine/openCircuitCareer.js";
import {
  buildCircuitTournament, simCircuitAiUntilUser, simCircuitToEnd,
  finalizeCircuitTournament, isInteractiveCircuitEvent,
} from "../src/engine/circuitTournament.js";
import { migrateBoardState } from "../src/engine/boardEngine.js";

export { isInteractiveCircuitEvent };

export function makeHistoricalState(userTeamId, seed) {
  const historical = createHistoricalCareer("ghosts", { userTeamId });
  const state = {
    userTeamId: `historical:${userTeamId}`, userTeamType: "historical", season: 1,
    notifications: [], feed: [], saveExists: true, playerSeasonStats: {},
    eventCentre: { events: [], nextId: 1 }, boardState: migrateBoardState(null),
    ...createHistoricalStateFields("historical", { dynastySeed: seed }), ...historical,
  };
  return ensureOpenCircuitSeason(state);
}

// Reducer mirror: open the live tournament for an interactive event.
export function startCircuitLive(state, eventId) {
  const t = buildCircuitTournament(state, eventId);
  if (!t) return null;
  const eventTeams = Object.fromEntries(Object.entries(t.teamsById).map(([id, m]) => [id, {
    id, name: m.name, tag: m.tag, color: m.color,
    players: (state.players || []).filter((p) => p.teamId === id && !p.isSub).sort((a, b) => (b.overall || 0) - (a.overall || 0)).slice(0, 4),
  }]));
  const withTeams = { ...state, schedule: { ...state.schedule, currentMajorEventTeams: eventTeams } };
  const step = simCircuitAiUntilUser(t, withTeams);
  if (step.done) return { ...finalizeCircuitTournament(withTeams, t), circuitTournament: { ...t, status: "complete" } };
  return { ...withTeams, circuitTournament: t };
}

export function maybeStartCircuitLive(prevState, nextState) {
  const oc = nextState?.openCircuit;
  if (!oc || oc.error || oc.seasonComplete || nextState.circuitTournament) return nextState;
  const playedNew = (oc.playedCount || 0) > (prevState?.openCircuit?.playedCount || 0);
  if (playedNew) return nextState;
  const nextEv = (oc.calendar?.all || []).find((e) => e.id === oc.nextEventId);
  if (nextEv && isInteractiveCircuitEvent(nextEv.eventType)) return startCircuitLive(nextState, oc.nextEventId) || nextState;
  return nextState;
}

function finishLiveTournament(state) {
  const t = JSON.parse(JSON.stringify(state.circuitTournament));
  simCircuitToEnd(t, state);
  return { ...finalizeCircuitTournament(state, t), circuitTournament: { ...t, status: "complete" } };
}

// Play the whole season; return { state, records }. Each record:
//   { id, type, interactive, path: "live"|"batch", popup, champion, userPlacement }
export function playWholeSeason(userTeamId, seed) {
  let state = makeHistoricalState(userTeamId, seed);
  const records = [];
  let guard = 0;
  while (!state.openCircuit.seasonComplete && guard++ < 400) {
    const oc = state.openCircuit;
    const nextId = oc.nextEventId;
    const nextEv = oc.calendar.all.find((e) => e.id === nextId);
    if (!nextEv) break;

    if (isInteractiveCircuitEvent(nextEv.eventType)) {
      let next = startCircuitLive(state, nextId);
      if (!next) { state = advanceOpenCircuitEvent(state); continue; }
      state = next;
      if (state.circuitTournament.status !== "complete") state = finishLiveTournament(state);
      const bracket = state.circuitTournament.bracket;
      const result = state.openCircuit.results[nextId];
      records.push({
        id: nextId, type: nextEv.eventType, interactive: true, path: "live",
        popup: state.circuitTournament.status === "complete" && !!bracket.champion,
        champion: bracket.champion, userPlacement: result?.userPlacement ?? null, result,
      });
      state = { ...state, circuitTournament: null, schedule: { ...state.schedule, currentMajorEventTeams: null } };
    } else {
      const prev = state;
      state = maybeStartCircuitLive(prev, advanceOpenCircuitEvent(prev));
      if (state.circuitTournament) continue; // auto-opened a live event; handle next loop
      const played = state.openCircuit.lastPlayedEventId;
      const r = state.openCircuit.results[played];
      if (r && !r.skipped) {
        records.push({
          id: played, type: r.eventType, interactive: isInteractiveCircuitEvent(r.eventType),
          path: "batch", popup: !!r.summaryReady, champion: r.championTeamId,
          userPlacement: r.userPlacement ?? null, result: r,
        });
      }
    }
  }
  return { state, records };
}
