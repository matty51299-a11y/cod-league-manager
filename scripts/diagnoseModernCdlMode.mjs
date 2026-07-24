// scripts/diagnoseModernCdlMode.mjs
// Modern CDL mode smoke test — the historical event-completion fix must NOT touch
// the modern franchised CDL career. Verifies the modern world still builds and a
// season still simulates through Champs (which continues to use its own major
// overlay, not the open circuit).
//
// Run: node --loader ./scripts/asset-loader.mjs scripts/diagnoseModernCdlMode.mjs

import { buildInitialRoster } from "../src/data/players.js";
import { generateProspects } from "../src/data/prospects.js";
import { CDL_TEAMS } from "../src/data/teams.js";
import { buildSeason, simStage, simMajor, beginChamps } from "../src/engine/seasonEngine.js";
import { ecosystemTypeForEra } from "../src/data/competitionProfiles.js";
import { getEra, MODERN_ERA_ID } from "../src/data/codEras.js";

let failures = 0;
const fail = (l, d = "") => { console.log(`❌ ${l}${d ? ` — ${d}` : ""}`); failures++; };
const ok = (l, d = "") => console.log(`✅ ${l}${d ? ` — ${d}` : ""}`);
const check = (l, c, d = "") => (c ? ok(l, d) : fail(l, d));

// Modern era is franchised (NOT open circuit) — the historical fix is scoped away.
check("Modern era is FRANCHISED_CDL (not open-circuit)", ecosystemTypeForEra(getEra(MODERN_ERA_ID)) === "FRANCHISED_CDL", ecosystemTypeForEra(getEra(MODERN_ERA_ID)));

const players = buildInitialRoster();
const prospects = generateProspects(4242);
check("Modern CDL roster builds", players.length > 0, `${players.length} players`);
check("12 CDL franchises present", CDL_TEAMS.length === 12, `${CDL_TEAMS.length}`);

let state = {
  userTeamId: "optic", season: 1, players, prospects,
  schedule: buildSeason(1), notifications: [], feed: [],
  playerSeasonStats: {}, playerOvrHistory: {},
};
check("Modern season built (stage phase)", state.schedule.phase === "stage", state.schedule.phase);

// Simulate a modern season through to Champs completion (burst sim).
let guard = 0;
try {
  while (guard++ < 200) {
    const phase = state.schedule.phase;
    if (phase === "stage") state = simStage(state);
    else if (phase === "major") state = simMajor(state);
    else if (phase === "preChamps") state = beginChamps(state);
    else break; // reached offseason/awards etc.
  }
  ok("Modern season simulated without crashing", `stopped at phase=${state.schedule.phase}`);
} catch (e) {
  fail("Modern season simulation", e.message);
}

const matchesPlayed = (state.schedule.matchLog || []).length;
check("Modern season produced matches", matchesPlayed > 0, `${matchesPlayed} matches`);

console.log("");
if (failures) { console.error(`Modern CDL mode FAILED: ${failures} issue(s).`); process.exit(1); }
console.log("Modern CDL mode passed.");
