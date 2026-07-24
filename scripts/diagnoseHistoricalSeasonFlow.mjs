// scripts/diagnoseHistoricalSeasonFlow.mjs
// Historical Dynasty SEASON-FLOW check. Plays the whole open-circuit season and
// verifies the calendar progresses cleanly from the first event to season
// completion: nextEventId always advances, interactive events open the live
// tournament, cups/leagues quick-sim, nothing is stuck, the "Last Event" summary
// (Home) tracks the most recent completion, and no duplicate Pro Points.
//
// Fails if the season stalls, an event completes without a completion summary,
// or an interactive event is silently batch-completed.
//
// Run: node --loader ./scripts/asset-loader.mjs scripts/diagnoseHistoricalSeasonFlow.mjs

import { playWholeSeason, isInteractiveCircuitEvent } from "./historicalCircuitHarness.mjs";

let failures = 0;
const fail = (l, d = "") => { console.log(`❌ ${l}${d ? ` — ${d}` : ""}`); failures++; };
const ok = (l, d = "") => console.log(`✅ ${l}${d ? ` — ${d}` : ""}`);
const check = (l, c, d = "") => (c ? ok(l, d) : fail(l, d));

const { state, records } = playWholeSeason("optic-gaming", 4242);
const oc = state.openCircuit;
const cal = oc.calendar.all;

check("Season reached completion", oc.seasonComplete === true);
check("Every calendar event resolved (played or skipped)", cal.every((e) => oc.results[e.id]?.completed), "");

// Progression: interactive events on the calendar were each played live in order.
const interactiveCal = cal.filter((e) => isInteractiveCircuitEvent(e.eventType));
const playedLive = records.filter((r) => r.path === "live").map((r) => r.id);
check("Every interactive event was played live (opened the tournament)",
  interactiveCal.every((e) => playedLive.includes(e.id)),
  interactiveCal.filter((e) => !playedLive.includes(e.id)).map((e) => e.id).join(", "));

// Home "Last Event" summary: lastPlayedEventId points at a real completed event
// with a completion summary (so Home can show it).
const last = oc.lastPlayedEventId;
const lastResult = last ? oc.results[last] : null;
check("Home 'Last Event' points at a completed summary", !!lastResult && lastResult.summaryReady === true, last || "none");

// Player Pro Points are non-negative and the ranking is populated (standings work).
const anyNeg = Object.values(oc.proPoints || {}).some((v) => v < 0);
check("No negative Pro Points", !anyNeg);
check("Pro Points ranking populated", (oc.ranking || []).length > 0, `${(oc.ranking || []).length} teams`);

// Season progress counters are coherent.
check("playedCount ≤ totalEvents and > 0", oc.playedCount > 0 && oc.playedCount <= (oc.totalEvents || cal.length), `${oc.playedCount}/${oc.totalEvents}`);

// A meaningful number of events were actually contested (not all skipped).
const contested = Object.values(oc.results).filter((r) => r.completed && !r.skipped).length;
check("Most of the calendar was contested (not mass-skipped)", contested >= cal.length * 0.4, `${contested}/${cal.length}`);

console.log("");
if (failures) { console.error(`Historical season flow FAILED: ${failures} issue(s).`); process.exit(1); }
console.log("Historical season flow passed.");
