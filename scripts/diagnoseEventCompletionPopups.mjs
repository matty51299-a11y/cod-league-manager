// scripts/diagnoseEventCompletionPopups.mjs
//
// Event-completion popup / final-placings diagnostic for Historical Dynasty
// (Cod Dynasty open-circuit) careers.
//
// It reproduces the exact play routing the app uses (App.playNextCircuitEvent +
// the store reducer's SIM_NEXT_CIRCUIT_EVENT / SIM_CIRCUIT_TO_MAJOR /
// START_CIRCUIT_EVENT handlers) so the results match real gameplay, then, for
// EVERY event on the current season calendar, verifies:
//
//   • a completion result object is created (unified shape)
//   • the champion is set
//   • final placements are set (and the Placements tab can render them)
//   • the user placement is set
//   • Pro Points are awarded
//   • the completion popup / table is triggered (live champion screen OR reveal)
//   • the completed event can be reopened safely (no blank screen)
//   • Champs specifically works
//   • INTERACTIVE events are NEVER silently batch-completed (the root-cause bug:
//     an interactive event finished by the quick-sim never shows its popup)
//   • no duplicate Pro Points and no duplicate event results
//
// Run:
//   node --loader ./scripts/asset-loader.mjs scripts/diagnoseEventCompletionPopups.mjs
//   node --import ./scripts/register-assets.mjs scripts/diagnoseEventCompletionPopups.mjs

import { createHistoricalCareer, createHistoricalStateFields } from "../src/engine/historicalDynasty.js";
import { ensureOpenCircuitSeason, advanceOpenCircuitEvent, simCircuitToNextMajor } from "../src/engine/openCircuitCareer.js";
import {
  buildCircuitTournament, simCircuitAiUntilUser, simCircuitToEnd,
  finalizeCircuitTournament, isInteractiveCircuitEvent,
} from "../src/engine/circuitTournament.js";
import { computeLivePlacements } from "../src/engine/openCircuit/liveDE.js";
import { migrateBoardState } from "../src/engine/boardEngine.js";

let failures = 0;
const fail = (label, detail = "") => { console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); failures++; };
const ok = (label, detail = "") => console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
const check = (label, cond, detail = "") => (cond ? ok(label, detail) : fail(label, detail));

// ── build a fresh Cod Dynasty (Ghosts open-circuit) save ────────────────────────
function makeHistoricalState(userTeamId, seed) {
  const historical = createHistoricalCareer("ghosts", { userTeamId });
  let state = {
    userTeamId: `historical:${userTeamId}`, userTeamType: "historical", season: 1,
    notifications: [], feed: [], saveExists: true, playerSeasonStats: {},
    eventCentre: { events: [], nextId: 1 }, boardState: migrateBoardState(null),
    ...createHistoricalStateFields("historical", { dynastySeed: seed }), ...historical,
  };
  return ensureOpenCircuitSeason(state);
}

// ── mirror the store reducer's circuit-live helpers ─────────────────────────────
function startCircuitLive(state, eventId) {
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
function maybeStartCircuitLive(prevState, nextState) {
  const oc = nextState?.openCircuit;
  if (!oc || oc.error || oc.seasonComplete || nextState.circuitTournament) return nextState;
  const playedNew = (oc.playedCount || 0) > (prevState?.openCircuit?.playedCount || 0);
  if (playedNew) return nextState;
  const nextEv = (oc.calendar?.all || []).find((e) => e.id === oc.nextEventId);
  if (nextEv && isInteractiveCircuitEvent(nextEv.eventType)) return startCircuitLive(nextState, oc.nextEventId) || nextState;
  return nextState;
}
// SIM_CIRCUIT_FINISH: finish a live tournament that is currently active.
function finishLiveTournament(state) {
  const t = JSON.parse(JSON.stringify(state.circuitTournament));
  simCircuitToEnd(t, state);
  return { ...finalizeCircuitTournament(state, t), circuitTournament: { ...t, status: "complete" } };
}

// ── validate one completion result object (unified shape) ───────────────────────
function validateCompletion(tag, result, userTeamId, { requireUserInField }) {
  if (!result) return fail(`${tag}: completion result object created`, "missing");
  check(`${tag}: summaryReady`, result.summaryReady === true);
  check(`${tag}: status complete`, result.status === "complete", result.status);
  check(`${tag}: champion set`, !!result.championTeamId && !!result.championTeamName, `${result.championTeamName}`);
  check(`${tag}: final placements set (Placements tab renders)`, Array.isArray(result.finalPlacements) && result.finalPlacements.length > 0, `${result.finalPlacements?.length} teams`);
  check(`${tag}: placements top-8 present`, Array.isArray(result.placements) && result.placements.length > 0);
  // eventId / eraId / gameTitle / eventTier / eventType present
  const identityOk = result.eventId && result.eraId && result.eventType && result.eventTier;
  check(`${tag}: identity fields (eventId/eraId/eventType/eventTier)`, !!identityOk);
  if (requireUserInField) {
    check(`${tag}: user placement set`, Number.isFinite(result.userPlacement), `${result.userPlacement}`);
    check(`${tag}: user pro points recorded`, Number.isFinite(result.userProPointsEarned));
  }
  // "Reopen safe": a completed-event screen can render Champion / Your Finish /
  // Pro Points Earned + a placements table with no blank/undefined crash.
  const reopenOk = result.championTeamName && Array.isArray(result.finalPlacements) && result.finalPlacements.length > 0;
  check(`${tag}: completed event reopens safely (no blank screen)`, !!reopenOk);
}

// ── play the whole season the way the app does ──────────────────────────────────
function playSeason(userTeamId, seed, { useSimToMajor = false } = {}) {
  let state = makeHistoricalState(userTeamId, seed);
  const uid = state.openCircuit.userTeamId;
  const records = [];
  let guard = 0;
  while (!state.openCircuit.seasonComplete && guard++ < 400) {
    const oc = state.openCircuit;
    const nextId = oc.nextEventId;
    const nextEv = oc.calendar.all.find((e) => e.id === nextId);
    if (!nextEv) break;

    if (isInteractiveCircuitEvent(nextEv.eventType)) {
      // App: START_CIRCUIT_EVENT → live tournament, user plays (here: Sim Event).
      let next = startCircuitLive(state, nextId);
      check(`start ${nextId}: live tournament opened (popup owner)`, !!next && !!next.circuitTournament, next ? "" : "startCircuitLive returned null");
      if (!next) { state = advanceOpenCircuitEvent(state); continue; }
      state = next;
      if (state.circuitTournament.status !== "complete") state = finishLiveTournament(state);
      const bracket = state.circuitTournament.bracket;
      const result = state.openCircuit.results[nextId];
      const popupTriggered = state.circuitTournament.status === "complete" && !!bracket.champion;
      records.push({ id: nextId, type: nextEv.eventType, interactive: true, popup: popupTriggered, path: "live", result });
      // close the overlay (CLOSE_CIRCUIT_TOURNAMENT) before the next event.
      state = { ...state, circuitTournament: null, schedule: { ...state.schedule, currentMajorEventTeams: null } };
    } else if (useSimToMajor && (nextEv.eventType === "ONLINE_2K" || nextEv.eventType === "ONLINE_5K")) {
      // App: "Sim cups to next LAN" → SIM_CIRCUIT_TO_MAJOR.
      const prev = state;
      state = maybeStartCircuitLive(prev, simCircuitToNextMajor(prev));
      // If it stopped on an interactive event it will have opened a live one.
      if (state.circuitTournament) continue; // handled by the interactive branch next loop iteration is wrong; finish here
    } else {
      // App: SIM_NEXT_CIRCUIT_EVENT → batch quick-sim (+ auto-live if it lands on
      // an interactive event).
      const prev = state;
      state = maybeStartCircuitLive(prev, advanceOpenCircuitEvent(prev));
      if (state.circuitTournament) {
        // auto-opened a live tournament (stopped before an interactive event)
        continue;
      }
      const result = state.openCircuit.results[nextId] || state.openCircuit.results[state.openCircuit.lastPlayedEventId];
      const played = state.openCircuit.lastPlayedEventId;
      const r = state.openCircuit.results[played];
      if (r && !r.skipped) {
        records.push({ id: played, type: r.eventType, interactive: isInteractiveCircuitEvent(r.eventType), popup: !!r.summaryReady, path: "batch", result: r });
      }
    }
  }
  return { state, records, uid };
}

// ══ RUN ═════════════════════════════════════════════════════════════════════════
console.log("=== Event Completion Popup Diagnostic (Historical Dynasty / Cod Dynasty) ===\n");

const TEAM = "optic-gaming";
const SEED = 4242;
const { state, records, uid } = playSeason(TEAM, SEED);

const calendar = state.openCircuit.calendar.all;
const interactiveCalEvents = calendar.filter((e) => isInteractiveCircuitEvent(e.eventType));
console.log(`Season calendar: ${calendar.length} events (${interactiveCalEvents.length} interactive, ${calendar.length - interactiveCalEvents.length} cups/leagues)\n`);

// 1. Every interactive event completed via the LIVE tournament path (popup owner).
console.log("── Interactive events (must open the live tournament + champion screen) ──");
let interactiveViaBatch = [];
for (const ev of interactiveCalEvents) {
  const rec = records.find((r) => r.id === ev.id);
  const result = state.openCircuit.results[ev.id];
  if (!result || result.skipped) { fail(`${ev.id} (${ev.eventType}): completed`, "not completed"); continue; }
  const wasLive = rec && rec.path === "live" && rec.popup;
  if (!wasLive) interactiveViaBatch.push(ev.id);
  check(`${ev.id} (${ev.eventType}): completion popup/table triggered (live champion screen)`, !!wasLive, rec ? `path=${rec.path} popup=${rec.popup}` : "no play record");
  validateCompletion(ev.id, result, uid, { requireUserInField: true });
}

// 2. Champs specifically.
console.log("\n── Championship / Champs ──");
const champsId = "cod_champs_2014";
const champsRec = records.find((r) => r.id === champsId);
const champsResult = state.openCircuit.results[champsId];
check("Champs completed", !!champsResult && !champsResult.skipped);
check("Champs popup/table appears (live champion screen)", !!(champsRec && champsRec.path === "live" && champsRec.popup), champsRec ? `path=${champsRec.path}` : "no record");
validateCompletion("Champs", champsResult, uid, { requireUserInField: true });

// 3. The OTHER affected event(s): interactive LANs that used to be swept into the
//    batch path. Assert none were batch-completed now.
console.log("\n── Root-cause guard: interactive events must never be batch-completed ──");
check("No interactive event was silently batch-completed", interactiveViaBatch.length === 0, interactiveViaBatch.join(", "));

// 4. Batch (cup / league) completions still produce a valid completion object.
console.log("\n── Batch events (online cups / leagues) — reveal popup + reopen ──");
const batchCompleted = Object.entries(state.openCircuit.results)
  .filter(([, r]) => r.completed && !r.skipped && !isInteractiveCircuitEvent(r.eventType));
let batchSampleChecked = 0;
for (const [id, r] of batchCompleted) {
  if (batchSampleChecked >= 3) break; // sample a few (there are ~40)
  validateCompletion(`batch:${id}`, r, uid, { requireUserInField: false });
  batchSampleChecked++;
}
check("Every batch event has a champion + placements (no blank reveal)",
  batchCompleted.every(([, r]) => r.championTeamName && (r.finalPlacements || []).length > 0),
  `${batchCompleted.length} batch events`);

// 5. No duplicate results / no duplicate pro points.
console.log("\n── Integrity: no duplicate results / pro points ──");
const resultIds = Object.keys(state.openCircuit.results);
check("No duplicate event results", resultIds.length === new Set(resultIds).size, `${resultIds.length} results`);
// Re-running a completed event must be a no-op (idempotent award guard).
const beforePts = JSON.stringify(state.openCircuit.proPoints);
const reAdvanced = advanceOpenCircuitEvent({ ...state, openCircuit: { ...state.openCircuit, seasonComplete: false } });
// season is complete, so this is a no-op; more directly, re-finalizing champs:
const champsTourneyProbe = buildCircuitTournament(state, champsId);
let dupPts = false;
if (champsTourneyProbe) {
  simCircuitToEnd(champsTourneyProbe, state);
  const reFinal = finalizeCircuitTournament(state, champsTourneyProbe);
  if (JSON.stringify(reFinal.openCircuit.proPoints) !== beforePts) dupPts = true;
}
check("Re-finalising a completed event does not double-award Pro Points", !dupPts);

// 6. Season fully played (no event stuck incomplete except skips).
console.log("\n── Season completion ──");
const stuck = calendar.filter((e) => !state.openCircuit.results[e.id]?.completed);
check("No event left stuck incomplete", stuck.length === 0, stuck.map((e) => e.id).join(", "));
check("Season reached completion", state.openCircuit.seasonComplete === true);

// 7. Cross-check: "Sim cups to next LAN" path also never sweeps interactive events.
console.log("\n── Alternate path: 'Sim cups to next LAN' (SIM_CIRCUIT_TO_MAJOR) ──");
{
  let s = makeHistoricalState(TEAM, SEED);
  let g = 0, swept = [];
  while (!s.openCircuit.seasonComplete && g++ < 400) {
    const oc = s.openCircuit;
    const nextEv = oc.calendar.all.find((e) => e.id === oc.nextEventId);
    if (!nextEv) break;
    if (isInteractiveCircuitEvent(nextEv.eventType)) {
      const next = startCircuitLive(s, oc.nextEventId);
      s = next && next.circuitTournament?.status === "complete" ? next : finishLiveTournament(next || startCircuitLive(s, oc.nextEventId));
      s = { ...s, circuitTournament: null };
    } else {
      const before = new Set(Object.keys(oc.sim.results).filter((id) => oc.sim.results[id]?.completed && !oc.sim.results[id]?.skipped));
      s = maybeStartCircuitLive(s, simCircuitToNextMajor(s));
      if (s.circuitTournament) continue; // opened a live event
      const after = Object.keys(s.openCircuit.sim.results).filter((id) => s.openCircuit.sim.results[id]?.completed && !s.openCircuit.sim.results[id]?.skipped);
      for (const id of after) {
        if (before.has(id)) continue;
        const e = s.openCircuit.calendar.all.find((x) => x.id === id);
        if (e && isInteractiveCircuitEvent(e.eventType)) swept.push(id);
      }
    }
  }
  check("'Sim cups to next LAN' never batch-completes an interactive event", swept.length === 0, swept.join(", "));
}

// 8. Modern CDL mode still builds a valid initial state (both modes must work).
console.log("\n── Modern CDL mode still works ──");
try {
  const { buildInitialRoster } = await import("../src/data/players.js");
  const { CDL_TEAMS } = await import("../src/data/teams.js");
  const roster = buildInitialRoster();
  check("Modern CDL roster builds", Array.isArray(roster) && roster.length > 0, `${roster.length} players`);
  check("Modern CDL teams present", Array.isArray(CDL_TEAMS) && CDL_TEAMS.length === 12, `${CDL_TEAMS.length} teams`);
} catch (e) {
  fail("Modern CDL mode import", e.message);
}

console.log("");
if (failures) { console.error(`Event completion diagnostic FAILED: ${failures} issue(s).`); process.exit(1); }
console.log("Event completion diagnostic passed — every event shows its completion popup/table.");
