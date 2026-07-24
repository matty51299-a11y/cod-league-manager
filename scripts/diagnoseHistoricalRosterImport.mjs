import assert from "node:assert/strict";
import { createHistoricalCareer } from "../src/engine/historicalDynasty.js";

const historical = createHistoricalCareer("ghosts", { userTeamId: "optic-gaming" });
assert.ok(historical.players.length > 0, "Historical Dynasty should import its player database");
assert.ok(historical.teams.length > 0, "Historical Dynasty should import its teams");
assert.ok(historical.players.every((p) => p.teamId?.startsWith("historical:")), "Historical players must remain in the historical namespace");
console.log("✓ Historical Dynasty roster import smoke test passed.");
