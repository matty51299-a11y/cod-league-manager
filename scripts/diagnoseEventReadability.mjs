// scripts/diagnoseEventReadability.mjs
// Historical Dynasty completed-event READABILITY check. Verifies that the unified
// completion object every event produces is human-readable on the completed-event
// screen / Placements tab: resolved team NAMES (not raw "historical:xyz" ids),
// ranked placements, a named champion, and a user finish + Pro Points line.
//
// Fails if a completed event would render a blank / id-only / undefined summary.
//
// Run: node --loader ./scripts/asset-loader.mjs scripts/diagnoseEventReadability.mjs

import { playWholeSeason, isInteractiveCircuitEvent } from "./historicalCircuitHarness.mjs";

let failures = 0;
const fail = (l, d = "") => { console.log(`❌ ${l}${d ? ` — ${d}` : ""}`); failures++; };
const ok = (l, d = "") => console.log(`✅ ${l}${d ? ` — ${d}` : ""}`);
const check = (l, c, d = "") => (c ? ok(l, d) : fail(l, d));

const looksLikeRawId = (s) => typeof s === "string" && /^historical:/.test(s);
const readableName = (s) => typeof s === "string" && s.length > 0 && !looksLikeRawId(s);

const { state, records } = playWholeSeason("optic-gaming", 4242);
const results = state.openCircuit.results;
const completed = Object.entries(results).filter(([, r]) => r.completed && !r.skipped);

console.log(`Checking readability of ${completed.length} completed events\n`);

let idOnlyChampions = 0, idOnlyPlacements = 0, missingFinishLine = 0;
for (const [id, r] of completed) {
  if (!readableName(r.championTeamName)) idOnlyChampions++;
  const placements = r.finalPlacements || [];
  if (placements.some((p) => !readableName(p.name))) idOnlyPlacements++;
  // Completed-event screen needs: Champion / Your Finish / Pro Points Earned.
  const hasFinishLine = r.championTeamName && (r.userPlacement != null || r.userInField === false) && Number.isFinite(r.userProPointsEarned ?? r.userPoints ?? NaN);
  if (r.userInField && !hasFinishLine) missingFinishLine++;
}

check("Every champion renders a readable team name (not a raw id)", idOnlyChampions === 0, `${idOnlyChampions} id-only`);
check("Every placements table renders readable team names", idOnlyPlacements === 0, `${idOnlyPlacements} events with id-only rows`);
check("Every user-in-field event has a Finish + Pro Points line", missingFinishLine === 0, `${missingFinishLine} missing`);

// The Placements tab and the popup must read the SAME source (finalPlacements is
// a superset of the top-8 `placements`; ranks must agree for shared entries).
let placementMismatch = 0;
for (const [, r] of completed) {
  const top8 = r.placements || [];
  const full = r.finalPlacements || [];
  for (const p of top8) {
    const inFull = full.find((f) => f.teamId === p.teamId);
    if (!inFull || inFull.rank !== p.rank) placementMismatch++;
  }
}
check("Popup top-8 placements match the full Placements-tab list (one source of truth)", placementMismatch === 0, `${placementMismatch} mismatches`);

// Champs readability spotlight.
const champs = results["cod_champs_2014"];
check("Champs: readable champion + placements + finish line",
  !!champs && readableName(champs.championTeamName) && (champs.finalPlacements || []).every((p) => readableName(p.name)) && Number.isFinite(champs.userPlacement),
  champs ? `Champion ${champs.championTeamName}, you ${champs.userPlacement}, +${champs.userProPointsEarned} PP` : "no champs");

console.log("");
if (failures) { console.error(`Event readability FAILED: ${failures} issue(s).`); process.exit(1); }
console.log("Event readability passed.");
