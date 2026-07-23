import assert from "node:assert/strict";
import { createHistoricalCareer, createHistoricalStateFields } from "../src/engine/historicalDynasty.js";
import { ensureOpenCircuitSeason } from "../src/engine/openCircuitCareer.js";
import { buildHistoricalSeasonTemplate } from "../src/data/historicalRosterDb.js";
import { isValidGameState, isValidUserTeam } from "../src/store/gameValidation.js";
import { resolveUserTeamMeta } from "../src/utils/userTeam.js";

const template = buildHistoricalSeasonTemplate("ghosts");
const user = template.teams.find((t) => /optic/i.test(t.teamName)) || template.teams[0];

// ── createHistoricalCareer: identity + real ratings ────────────────────────────
const career = createHistoricalCareer("ghosts", { userTeamId: user.historicalTeamId });
assert.equal(career.teams.length, template.teams.length, "all usable Ghosts teams are created");
assert.equal(career.teams.some((t) => !t.id.startsWith("historical:")), false, "no modern default team exists");
for (const source of template.teams) {
  const team = career.teams.find((t) => t.historicalTeamId === source.historicalTeamId);
  assert.deepEqual(team.playerIds, source.players.map((p) => p.playerId), `${source.teamName} roster matches database`);
}
assert.deepEqual(career.teams.find((t) => t.isUserControlled).playerIds, user.players.map((p) => p.playerId));
assert.equal(career.competitionProfile.usesChallengers, false);
assert.equal(career.challengerTeams.length, 0);
assert.equal(career.prospects.length, 0);
assert.equal(career.schedule.stages.length, 0);
assert.equal(career.schedule.majors.length, 0);

// Ratings must be real and varied — regression against the "everyone is 70" bug.
const ovrs = career.players.map((p) => p.overall);
assert.ok(ovrs.every((o) => Number.isFinite(o)), "every player has a numeric overall");
assert.ok(new Set(ovrs).size > 5, "player overalls are varied, not a single flat value");
assert.ok(!career.players.every((p) => p.overall === 70), "not every player is 70-rated");
assert.ok(career.players.every((p) => Number.isFinite(p.gunny) && Number.isFinite(p.awareness)), "players have full stat blocks (no NaN chemistry inputs)");
const scump = career.players.find((p) => /scump/i.test(p.name));
if (scump) assert.ok(scump.overall >= 80, "recognisable stars are rated as stars");

// ── Full new-game state: the real open circuit is built + simulated ────────────
let started = {
  userTeamId: `historical:${user.historicalTeamId}`, userTeamType: "historical", season: 1,
  notifications: [], feed: [], saveExists: true, eventCentre: { events: [], nextId: 1 },
  ...createHistoricalStateFields("historical", { dynastySeed: 4242 }), ...career,
};
started = ensureOpenCircuitSeason(started);

assert.ok(started.openCircuit && !started.openCircuit.error, "open circuit built without error");
assert.equal(started.openCircuit.ranking.length, template.teams.length, "the full historical field is ranked");
assert.equal(started.openCircuit.usesChallengers, false, "no Challengers division");
assert.ok(started.openCircuit.calendar.events.some((e) => e.eventType === "LEAGUE_SEASON"), "league events generated");
assert.ok(started.openCircuit.calendar.events.some((e) => e.eventType === "OPEN_LAN"), "open LAN events generated");
assert.ok(started.openCircuit.calendar.cupCount > 0, "online 2K/5K cups generated");
// Simulating the season awards points, and the completed events carry the flag
// the Circuit tab reads to show a finished result.
assert.ok(Object.values(started.openCircuit.proPoints).some((v) => v > 0), "playing the circuit awards Pro Points");
assert.ok(Object.values(started.openCircuit.results).some((r) => r.completed), "completed events are flagged for the UI");

// ── Regression: a freshly created save must pass isValidGameState ──────────────
assert.equal(isValidUserTeam(started), true, "historical user team resolves against state.teams");
assert.equal(isValidGameState(started), true, "fresh historical save is a valid, startable game state");
assert.ok(resolveUserTeamMeta(started)?.name, "historical user team meta resolves for rendering");

console.log(`historical bootstrap: ${career.teams.length} Ghosts teams, ${career.players.length} players, OVR spread ${Math.min(...ovrs)}–${Math.max(...ovrs)}`);
console.log(`historical bootstrap: circuit ranks ${started.openCircuit.ranking.length} teams, ${started.openCircuit.calendar.cupCount} cups ✓`);
console.log("historical bootstrap: fresh save passes isValidGameState ✓");
