import assert from "node:assert/strict";
import { buildInitialRoster } from "../src/data/players.js";
import { applyChallengerRatingOverride } from "../src/data/challengerRatingOverrides.js";
import { applyModernCdlRatingUpdates, MODERN_CDL_RATING_UPDATES } from "../src/data/modernCdlRatingUpdates.js";
import { generateProspects, syncModernCdlChallengers } from "../src/data/prospects.js";
import { buildSeason } from "../src/engine/seasonEngine.js";
import { calcTeamOvr } from "../src/engine/teamOvr.js";
import { createHistoricalCareer } from "../src/engine/historicalDynasty.js";
import { normalizePlayerName } from "../src/utils/playerIdentity.js";

const check = (label, value) => { assert.ok(value, label); console.log(`✓ ${label}`); };
const requestedRoles = new Map(MODERN_CDL_RATING_UPDATES.filter((p) => p.primary).map((p) => [p.id, p.primary]));
const before = buildInitialRoster().map(applyChallengerRatingOverride);
const beforeById = new Map(before.map((p) => [p.id, p]));
const players = applyModernCdlRatingUpdates(before);
const byId = new Map(players.map((p) => [p.id, p]));

check("Modern CDL mode starts", !!buildSeason(1) && players.length > 0);
const historicalBefore = createHistoricalCareer("ghosts", { userTeamId: "optic-gaming" });
const historicalAfter = createHistoricalCareer("ghosts", { userTeamId: "optic-gaming" });
check("Historical Dynasty mode still starts", historicalAfter.players.length > 0);
check("Historical Dynasty player data remains unchanged", JSON.stringify(historicalAfter.players) === JSON.stringify(historicalBefore.players));
check("All 20 requested players are found", MODERN_CDL_RATING_UPDATES.length === 20 && MODERN_CDL_RATING_UPDATES.every((u) => byId.has(u.id)));

for (const update of MODERN_CDL_RATING_UPDATES) {
  const oldPlayer = beforeById.get(update.id);
  const player = byId.get(update.id);
  check(`${update.name}: potential is unchanged`, player.potential === oldPlayer.potential);
  check(`${update.name}: team assignment is unchanged`, player.teamId === oldPlayer.teamId);
  if (update.overall == null) check(`${update.name}: retains previous overall`, player.overall === oldPlayer.overall);
  else check(`${update.name}: overall is ${update.overall}`, player.overall === update.overall);
  if (requestedRoles.has(update.id)) check(`${update.name}: role is ${update.primary}`, player.primary === update.primary);
  else check(`${update.name}: retains existing role`, player.primary === oldPlayer.primary);
}

check("Alluka remains named Alluka", byId.get("riyadh_aliuka")?.name === "Alluka");
check("Lunarz remains named Lunarz", byId.get("vancouver_lunarz")?.name === "Lunarz");
const prospects = syncModernCdlChallengers(generateProspects(90210), players, normalizePlayerName);
const allNames = [...players, ...prospects].map((p) => normalizePlayerName(p.name));
check("No Challengers assignments changed for requested players", MODERN_CDL_RATING_UPDATES.every((u) => !byId.get(u.id).challengerTeamId));
check("No duplicate player records were created", allNames.length === new Set(allNames).size);
check("No active CDL player is in the Challengers pool", players.filter((p) => p.teamId).every((p) => !prospects.some((q) => normalizePlayerName(q.name) === normalizePlayerName(p.name))));

const affectedTeams = new Set(MODERN_CDL_RATING_UPDATES.map((u) => byId.get(u.id).teamId));
for (const teamId of affectedTeams) {
  const roster = players.filter((p) => p.teamId === teamId && !p.isSub);
  const expected = Math.round(roster.reduce((sum, p) => sum + p.overall, 0) / roster.length);
  check(`${teamId}: team overall recalculates correctly`, calcTeamOvr(teamId, players) === expected);
}

const progressed = applyModernCdlRatingUpdates(before.map((p) => p.id === "vancouver_tjhaly" ? { ...p, overall: 83 } : p), { preserveProgress: true });
check("Existing-save migration preserves rating progression", progressed.find((p) => p.id === "vancouver_tjhaly").overall === 80);
console.log("Modern CDL rating-update diagnostics passed.");
