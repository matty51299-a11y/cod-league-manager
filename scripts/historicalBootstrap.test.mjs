import assert from "node:assert/strict";
import { createHistoricalCareer, createHistoricalStateFields } from "../src/engine/historicalDynasty.js";
import { buildHistoricalSeasonTemplate } from "../src/data/historicalRosterDb.js";
import { isValidGameState, isValidUserTeam } from "../src/store/gameValidation.js";
import { resolveUserTeamMeta } from "../src/utils/userTeam.js";

const template = buildHistoricalSeasonTemplate("ghosts");
const user = template.teams.find((t) => /faze red/i.test(t.teamName)) || template.teams[0];
const state = createHistoricalCareer("ghosts", { userTeamId: user.historicalTeamId });
assert.equal(state.teams.length, template.teams.length, "all usable Ghosts teams are created");
assert.equal(state.teams.some((t) => !t.id.startsWith("historical:")), false, "no modern default team exists");
for (const source of template.teams) {
  const team = state.teams.find((t) => t.historicalTeamId === source.historicalTeamId);
  assert.deepEqual(team.playerIds, source.players.map((p) => p.playerId), `${source.teamName} roster matches database`);
}
assert.deepEqual(state.teams.find((t) => t.isUserControlled).playerIds, user.players.map((p) => p.playerId));
assert.equal(state.openCircuit.conflicts.length, 0);
assert.equal(state.competitionProfile.usesChallengers, false);
assert.equal(state.challengerTeams.length, 0);
assert.equal(state.prospects.length, 0);
assert.equal(state.schedule.stages.length, 0);
assert.equal(state.schedule.majors.length, 0);
assert.ok(state.openCircuit.calendar.cups.some((e) => /Online 2K/.test(e.name)));
assert.ok(state.openCircuit.calendar.cups.some((e) => /Online 5K/.test(e.name)));
assert.ok(state.openCircuit.calendar.events.some((e) => e.eventType === "LEAGUE_SEASON"));
assert.ok(state.openCircuit.calendar.events.some((e) => e.eventType === "OPEN_LAN"));
assert.ok(Object.values(state.proPoints.playerSeasonProPoints.ghosts).every((points) => points === 0));
assert.ok(state.openCircuit.ranking.every((row) => row.points === 0));

// Regression: a freshly created Historical Dynasty save must pass isValidGameState
// so App renders the game instead of silently falling back to team-select. This
// is the assembled state shape the NEW_GAME reducer produces for careerMode
// "historical" (see createInitialGameState in gameStore.jsx).
const started = {
  userTeamId: `historical:${user.historicalTeamId}`, userTeamType: "historical", season: 1,
  notifications: [], feed: [], saveExists: true,
  ...createHistoricalStateFields("historical", {}), ...state,
};
assert.equal(isValidUserTeam(started), true, "historical user team resolves against state.teams");
assert.equal(isValidGameState(started), true, "fresh historical save is a valid, startable game state");
assert.ok(resolveUserTeamMeta(started)?.name, "historical user team meta resolves for rendering");

console.log(`historical bootstrap: ${state.teams.length} Ghosts teams, ${state.players.length} players, ${state.openCircuit.calendar.cups.length} online cups`);
console.log("historical bootstrap: fresh save passes isValidGameState ✓");
