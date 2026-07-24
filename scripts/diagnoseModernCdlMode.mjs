import assert from "node:assert/strict";
import { buildInitialRoster } from "../src/data/players.js";
import { applyChallengerRatingOverride } from "../src/data/challengerRatingOverrides.js";
import { applyModernCdlRatingUpdates } from "../src/data/modernCdlRatingUpdates.js";
import { buildSeason } from "../src/engine/seasonEngine.js";

const players = applyModernCdlRatingUpdates(buildInitialRoster().map(applyChallengerRatingOverride));
const schedule = buildSeason(1);
assert.ok(players.filter((p) => p.teamId).length === 48, "Modern CDL should have 48 active starters");
assert.ok(schedule?.stages?.length === 4, "Modern CDL should build its four-stage schedule");
console.log("✓ Modern CDL mode starts with the updated roster and schedule.");
