// scripts/diagnoseModernCdlEventCompletion.mjs
//
// Modern CDL event-completion popup diagnostic. Drives a full Modern CDL season
// through Majors 1–4 and Champs and verifies that the final-placements completion
// popup/table appears for EVERY major (including Major 4 and Champs), that the
// Challengers Qualifier / ESWC entry never hijacks or suppresses it, and that a
// unified completion summary object is produced.
//
// The bug: when Major 4 completes the engine opens the Challengers Finals
// qualifier (phase → challengerQualifier) and when Champs completes it immediately
// builds ESWC (phase → "major" for idx 5). The Challengers-Qualifier overlay / the
// ESWC entry overlay then rendered OVER the Major-4/Champs champion screen, so its
// completion popup never appeared. This diagnostic reproduces the exact overlay
// visibility logic to prove the popup now takes priority.
//
// Run:
//   node --loader ./scripts/asset-loader.mjs scripts/diagnoseModernCdlEventCompletion.mjs
//   node --import ./scripts/register-assets.mjs scripts/diagnoseModernCdlEventCompletion.mjs

import { buildInitialRoster } from "../src/data/players.js";
import { generateProspects } from "../src/data/prospects.js";
import { applyChallengerRatingOverride } from "../src/data/challengerRatingOverrides.js";
import {
  buildSeason, beginChamps, ensureChallengerTeams, buildChallengerRostersForNewGame,
  simStage, simMajor, simChallengerQualifier, continueFromChallengerQualifier,
} from "../src/engine/seasonEngine.js";
import { ensureCdlRosterIntegrity } from "../src/engine/rosterAI.js";
import { createHistoricalCareer, createHistoricalStateFields } from "../src/engine/historicalDynasty.js";
import { ensureOpenCircuitSeason } from "../src/engine/openCircuitCareer.js";
import { migrateBoardState } from "../src/engine/boardEngine.js";

let failures = 0;
const fail = (l, d = "") => { console.log(`❌ ${l}${d ? ` — ${d}` : ""}`); failures++; };
const ok = (l, d = "") => console.log(`✅ ${l}${d ? ` — ${d}` : ""}`);
const check = (l, c, d = "") => (c ? ok(l, d) : fail(l, d));

// ── Pure predicates that mirror the React overlay render conditions ─────────────
// MajorTournamentOverlay champion screen.
function showChampionScreen(state) {
  const enteredIdx = state.enteredMajorIdx;
  if (enteredIdx == null) return false;
  const sch = state.schedule;
  const isMajorPhase = sch.phase === "major";
  const activeMajorIdx = isMajorPhase ? (sch.majorIdx ?? null) : null;
  const isEntered = activeMajorIdx !== null && enteredIdx === activeMajorIdx;
  const showLive = isEntered && isMajorPhase;
  const enteredMajor = sch.majors?.[enteredIdx];
  return !!enteredMajor?.completed && !showLive;
}
// ChallengerQualifierOverlay.
function showChallengerQualifier(state) {
  const sch = state.schedule;
  if (sch?.phase !== "challengerQualifier") return false;
  const pendingIdx = state.enteredMajorIdx ?? null;
  if (pendingIdx != null && sch.majors?.[pendingIdx]?.completed) return false; // yields to popup
  return !!sch.currentChallengerQualifier;
}
// MajorEntryOverlay (next-major entry gate, e.g. ESWC after Champs).
function showMajorEntry(state) {
  const sch = state.schedule;
  if (sch.phase !== "major") return false;
  const majorIdx = sch.majorIdx ?? 0;
  const bracket = sch.majors?.[majorIdx]?.bracket;
  const isEntered = (state.enteredMajorIdx ?? null) === majorIdx;
  if (!bracket || isEntered) return false;
  if (!Array.isArray(bracket.seeds) || !bracket.seeds.length) return false;
  const pendingIdx = state.enteredMajorIdx ?? null;
  if (pendingIdx != null && pendingIdx !== majorIdx && sch.majors?.[pendingIdx]?.completed) return false; // yields to popup
  return true;
}

// Reducer mirrors.
const enterMajor = (state) => ({ ...state, enteredMajorIdx: state.schedule.majorIdx });
const dismissMajor = (state) => ({ ...state, enteredMajorIdx: null });

function makeState(seed = 555) {
  const state = {
    userTeamId: "optic", season: 1,
    players: buildInitialRoster().map(applyChallengerRatingOverride),
    prospects: generateProspects(seed).map(applyChallengerRatingOverride),
    schedule: buildSeason(1),
    notifications: [], feed: [], playerSeasonStats: {}, playerOvrHistory: {},
    retiredPlayers: [], challengersLog: [], challengerTransactions: [],
    seenAwardsSeasons: [], enteredMajorIdx: null,
    boardState: migrateBoardState(null),
  };
  buildChallengerRostersForNewGame(state, seed);
  ensureChallengerTeams(state);
  return ensureCdlRosterIntegrity(state, { windowType: "diagnose_modern_cdl_completion" });
}

function validateSummary(tag, summary, userTeamId) {
  if (!summary) return fail(`${tag}: completion summary created`, "missing lastCompletedCdlEvent");
  check(`${tag}: summary mode is modern_cdl + status complete + summaryReady`,
    summary.mode === "modern_cdl" && summary.status === "complete" && summary.summaryReady === true);
  check(`${tag}: summary has champion`, !!summary.championTeamId && !!summary.championTeamName, summary.championTeamName);
  check(`${tag}: summary has placements`, Array.isArray(summary.placements) && summary.placements.length > 0, `${summary.placements?.length} teams`);
  check(`${tag}: summary has user placement`, Number.isFinite(summary.userPlacement), `${summary.userPlacement}`);
  check(`${tag}: summary identity fields (eventId/eventName/eventType)`, !!(summary.eventId && summary.eventName && summary.eventType));
}

console.log("=== Modern CDL Event Completion Diagnostic ===\n");
let state = makeState();
check("Modern CDL season starts (stage phase)", state.schedule.phase === "stage");
check("CDL rosters loaded", (state.players || []).filter(p => p.teamId === "optic").length >= 4);

// Track user standings points to prove no duplicate awards.
const userPoints = () => state.schedule.standings?.[state.userTeamId]?.points ?? 0;

// ── Majors 1–4 ──
for (let m = 0; m < 4; m++) {
  const label = `Major ${m + 1}`;
  console.log(`\n── ${label} ──`);
  state = simStage(state);
  state = simChallengerQualifier(state);
  state = continueFromChallengerQualifier(state);
  check(`${label}: reached major phase after its qualifier`, state.schedule.phase === "major" && state.schedule.majorIdx === m);

  // Pre-major qualifier must be dismissable / not blocking the entry.
  state = enterMajor(state);
  const ptsBefore = userPoints();
  state = simMajor(state); // plays to completion → engine advances phase

  check(`${label}: bracket completed`, !!state.schedule.majors[m]?.completed);
  check(`${label}: completion popup/table appears`, showChampionScreen(state));
  validateSummary(label, state.schedule.lastCompletedCdlEvent, state.userTeamId);
  check(`${label}: summary is for this major`, state.schedule.lastCompletedCdlEvent?.majorIdx === m);

  if (m === 3) {
    // Major 4 → Challengers Finals qualifier is now live underneath, but must be
    // SUPPRESSED while the Major 4 completion popup is up.
    check("Major 4: Challengers Qualifier is SUPPRESSED while popup is up", !showChallengerQualifier(state));
    check("Major 4: popup takes priority over Challengers Qualifier", showChampionScreen(state) && !showChallengerQualifier(state));
  }

  // Continue → popup dismissed → next event routes.
  state = dismissMajor(state);
  check(`${label}: popup dismissed`, !showChampionScreen(state));
  if (m === 3) {
    check("Major 4: Challengers Qualifier appears AFTER Continue", showChallengerQualifier(state));
  }

  // Points awarded exactly once (idempotency guard).
  const ptsAfter = userPoints();
  const before2 = ptsAfter;
  // Re-invoking sim on a completed major must not re-award.
  const reSim = simMajor(state);
  check(`${label}: no duplicate pro points on re-sim`, (reSim.schedule.standings?.[state.userTeamId]?.points ?? 0) === before2, `${before2}`);

  // For Major 4, play the Challengers Finals to reach Pre-Champs.
  if (m === 3) {
    state = simChallengerQualifier(state);
    state = continueFromChallengerQualifier(state);
    check("Major 4: reached Pre-Champs after Challengers Finals", state.schedule.phase === "preChamps");
  }
  void ptsBefore;
}

// ── Champs ──
console.log("\n── Champs ──");
state = beginChamps(state);
check("Champs started (major idx 4)", state.schedule.phase === "major" && state.schedule.majorIdx === 4);
state = enterMajor(state);
state = simMajor(state); // Champs completes → engine immediately begins ESWC

check("Champs bracket completed", !!state.schedule.majors[4]?.completed);
check("Champs completion popup/table appears", showChampionScreen(state));
check("Champs: ESWC entry is SUPPRESSED while Champs popup is up", !showMajorEntry(state));
check("Champs: popup takes priority over ESWC entry", showChampionScreen(state) && !showMajorEntry(state));
validateSummary("Champs", state.schedule.lastCompletedCdlEvent, state.userTeamId);
check("Champs: summary is for Champs (idx 4)", state.schedule.lastCompletedCdlEvent?.majorIdx === 4);
check("Champs: engine still advanced to ESWC underneath (flow intact)", state.schedule.phase === "major" && state.schedule.majorIdx === 5);

// Continue → Champs popup dismissed → ESWC entry now shows.
state = dismissMajor(state);
check("Champs: popup dismissed", !showChampionScreen(state));
check("Champs: ESWC entry appears AFTER Continue", showMajorEntry(state));

// Home/season state reflects the last completed event.
check("Last completed CDL event recorded for Home summary", state.schedule.lastCompletedCdlEvent?.eventName?.length > 0);

// ── Historical Dynasty must still start ──
console.log("\n── Historical Dynasty smoke ──");
try {
  const historical = createHistoricalCareer("ghosts", { userTeamId: "optic-gaming" });
  let hist = {
    userTeamId: "historical:optic-gaming", userTeamType: "historical", season: 1,
    notifications: [], feed: [], playerSeasonStats: {}, eventCentre: { events: [], nextId: 1 },
    boardState: migrateBoardState(null),
    ...createHistoricalStateFields("historical", { dynastySeed: 4242 }), ...historical,
  };
  hist = ensureOpenCircuitSeason(hist);
  check("Historical Dynasty still starts (open circuit built)", !hist.openCircuit?.error && (hist.openCircuit?.calendar?.all?.length ?? 0) > 0);
} catch (e) {
  fail("Historical Dynasty start", e.message);
}

console.log("");
if (failures) { console.error(`Modern CDL event completion FAILED: ${failures} issue(s).`); process.exit(1); }
console.log("Modern CDL event completion passed — Major 4 and Champs show their completion popup/table.");
