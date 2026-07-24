// scripts/diagnoseHistoricalEventStability.mjs
// Historical Dynasty event-completion STABILITY sweep. Plays the full open-circuit
// season for several teams/seeds and asserts every completed event is stable:
// completes with a champion + non-empty placements, the completion popup/table is
// triggered for interactive events (never silently batch-completed), and Champs
// works — so the completed-event screen can always render.
//
// Fails if: an event completes without placements, without a champion, Champs
// completes without a popup, or an interactive event is batch-completed.
//
// Run: node --loader ./scripts/asset-loader.mjs scripts/diagnoseHistoricalEventStability.mjs

import { playWholeSeason, isInteractiveCircuitEvent } from "./historicalCircuitHarness.mjs";

let failures = 0;
const fail = (l, d = "") => { console.log(`❌ ${l}${d ? ` — ${d}` : ""}`); failures++; };
const ok = (l, d = "") => console.log(`✅ ${l}${d ? ` — ${d}` : ""}`);
const check = (l, c, d = "") => (c ? ok(l, d) : fail(l, d));

const RUNS = [
  ["optic-gaming", 4242], ["faze-clan", 7], ["envy", 99], ["complexity", 2024], ["rise-nation", 555],
];

for (const [team, seed] of RUNS) {
  console.log(`\n── ${team} (seed ${seed}) ──`);
  const { state, records } = playWholeSeason(team, seed);
  const cal = state.openCircuit.calendar.all;
  const results = state.openCircuit.results;

  // Every completed non-skipped event has a champion + placements.
  const completed = Object.entries(results).filter(([, r]) => r.completed && !r.skipped);
  const noChamp = completed.filter(([, r]) => !r.championTeamName);
  const noPlace = completed.filter(([, r]) => !(r.finalPlacements || []).length);
  check(`${team}: every completed event has a champion`, noChamp.length === 0, noChamp.map(([id]) => id).join(", "));
  check(`${team}: every completed event has placements`, noPlace.length === 0, noPlace.map(([id]) => id).join(", "));

  // Interactive events → live popup, never batch-completed.
  const interactiveCal = cal.filter((e) => isInteractiveCircuitEvent(e.eventType));
  const missingPopup = interactiveCal.filter((e) => {
    const rec = records.find((r) => r.id === e.id);
    return !(rec && rec.path === "live" && rec.popup);
  });
  check(`${team}: all interactive events open the live completion popup`, missingPopup.length === 0, missingPopup.map((e) => e.id).join(", "));

  // Champs specifically.
  const champs = results["cod_champs_2014"];
  const champsRec = records.find((r) => r.id === "cod_champs_2014");
  check(`${team}: Champs completes with popup + champion + placements`,
    !!champs && !champs.skipped && !!(champsRec && champsRec.path === "live" && champsRec.popup) && !!champs.championTeamName && (champs.finalPlacements || []).length > 0,
    champs ? `champion=${champs.championTeamName} userFinish=${champs.userPlacement}` : "no champs result");

  // No event stuck incomplete (only skips allowed).
  const stuck = cal.filter((e) => !results[e.id]?.completed);
  check(`${team}: no event left incomplete`, stuck.length === 0, stuck.map((e) => e.id).join(", "));
}

console.log("");
if (failures) { console.error(`Historical event stability FAILED: ${failures} issue(s).`); process.exit(1); }
console.log("Historical event stability passed.");
