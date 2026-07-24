// scripts/diagnoseModernCdlMode.mjs
// Modern CDL mode smoke test — verifies the franchised CDL career still starts,
// team rosters load, and the whole event calendar progresses (Stage → Qualifier →
// Major ×4 → Challengers Finals → Champs → ESWC → Season Awards) with no route /
// phase crash. The historical event-completion work must not regress this.
//
// Run: node --loader ./scripts/asset-loader.mjs scripts/diagnoseModernCdlMode.mjs

import { buildInitialRoster } from "../src/data/players.js";
import { generateProspects } from "../src/data/prospects.js";
import { applyChallengerRatingOverride } from "../src/data/challengerRatingOverrides.js";
import { CDL_TEAMS } from "../src/data/teams.js";
import {
  buildSeason, beginChamps, ensureChallengerTeams, buildChallengerRostersForNewGame,
  simStage, simMajor, simChallengerQualifier, continueFromChallengerQualifier,
} from "../src/engine/seasonEngine.js";
import { ensureCdlRosterIntegrity } from "../src/engine/rosterAI.js";
import { ecosystemTypeForEra } from "../src/data/competitionProfiles.js";
import { getEra, MODERN_ERA_ID } from "../src/data/codEras.js";

let failures = 0;
const fail = (l, d = "") => { console.log(`❌ ${l}${d ? ` — ${d}` : ""}`); failures++; };
const ok = (l, d = "") => console.log(`✅ ${l}${d ? ` — ${d}` : ""}`);
const check = (l, c, d = "") => (c ? ok(l, d) : fail(l, d));

check("Modern era is FRANCHISED_CDL (not open-circuit)", ecosystemTypeForEra(getEra(MODERN_ERA_ID)) === "FRANCHISED_CDL");
check("12 CDL franchises present", CDL_TEAMS.length === 12, `${CDL_TEAMS.length}`);

function makeState(seed = 555) {
  const state = {
    userTeamId: "optic", season: 1,
    players: buildInitialRoster().map(applyChallengerRatingOverride),
    prospects: generateProspects(seed).map(applyChallengerRatingOverride),
    schedule: buildSeason(1),
    notifications: [], feed: [], playerSeasonStats: {}, playerOvrHistory: {},
    retiredPlayers: [], challengersLog: [], challengerTransactions: [], seenAwardsSeasons: [],
    enteredMajorIdx: null,
  };
  buildChallengerRostersForNewGame(state, seed);
  ensureChallengerTeams(state);
  return ensureCdlRosterIntegrity(state, { windowType: "diagnose_modern_cdl_mode" });
}

let state;
try {
  state = makeState();
  ok("Modern CDL career state built");
} catch (e) { fail("Modern CDL career build", e.message); process.exit(1); }

check("Season starts in stage phase", state.schedule.phase === "stage");
check("User roster loaded (≥4 starters)", state.players.filter(p => p.teamId === "optic" && !p.isSub).length >= 4);
check("All 12 CDL teams have a bracket-ready roster", CDL_TEAMS.every(t => state.players.filter(p => p.teamId === t.id && !p.isSub).length >= 4));

// Drive the whole competitive calendar; assert phases progress without crashing.
try {
  for (let m = 0; m < 4; m++) {
    state = simStage(state);
    state = simChallengerQualifier(state);
    state = continueFromChallengerQualifier(state);
    check(`Major ${m + 1}: entered major phase`, state.schedule.phase === "major" && state.schedule.majorIdx === m);
    state = simMajor(state);
    check(`Major ${m + 1}: completed`, !!state.schedule.majors[m]?.completed);
  }
  // Major 4 → Challengers Finals → Pre-Champs.
  state = simChallengerQualifier(state);
  state = continueFromChallengerQualifier(state);
  check("Reached Pre-Champs after Challengers Finals", state.schedule.phase === "preChamps");

  state = beginChamps(state);
  check("Champs started", state.schedule.phase === "major" && state.schedule.majorIdx === 4);
  state = simMajor(state);
  check("Champs completed", !!state.schedule.majors[4]?.completed);
  check("ESWC begins after Champs (idx 5)", state.schedule.phase === "major" && state.schedule.majorIdx === 5);

  state = simMajor(state); // ESWC
  check("ESWC completed", !!state.schedule.majors[5]?.completed);
  check("Season Awards gated after ESWC", !!state.pendingSeasonAwards || state.schedule.phase === "offseason");
} catch (e) {
  fail("Modern CDL calendar progression", `${e.message}`);
}

const matches = state.schedule.matchLog?.length ?? 0;
check("Matches were simulated across the season", matches > 0, `${matches} matches`);
check("A completion summary is recorded for the last event", !!state.schedule.lastCompletedCdlEvent?.summaryReady);

console.log("");
if (failures) { console.error(`Modern CDL mode FAILED: ${failures} issue(s).`); process.exit(1); }
console.log("Modern CDL mode passed.");
