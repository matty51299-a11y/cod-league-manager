import assert from "node:assert/strict";
import { createHistoricalCareer, createHistoricalStateFields } from "../src/engine/historicalDynasty.js";
import { ensureOpenCircuitSeason } from "../src/engine/openCircuitCareer.js";
import { buildHistoricalSeasonTemplate } from "../src/data/historicalRosterDb.js";
import { buildCircuitTournament, simCircuitAiUntilUser, applyUserCircuitResult, finalizeCircuitTournament } from "../src/engine/circuitTournament.js";
import { simMatch } from "../src/engine/matchSim.js";

const template = buildHistoricalSeasonTemplate("ghosts");
const user = template.teams.find((t) => /optic/i.test(t.teamName));
const career = createHistoricalCareer("ghosts", { userTeamId: user.historicalTeamId });
let state = {
  userTeamId: `historical:${user.historicalTeamId}`, userTeamType: "historical", season: 1,
  eventCentre: { events: [], nextId: 1 }, ...createHistoricalStateFields("historical", { dynastySeed: 55 }), ...career,
};
state = ensureOpenCircuitSeason(state);

const teamObj = (teamId) => ({
  id: teamId, name: state.teams.find((x) => x.id === teamId)?.name,
  players: state.players.filter((p) => p.teamId === teamId).sort((a, b) => (b.overall || 0) - (a.overall || 0)).slice(0, 4),
});

// A LAN builds an interactive DE16 tournament with the user always seeded.
const tourney = buildCircuitTournament(state, "mlg_fall_champ_2013");
assert.ok(tourney, "LAN builds an interactive tournament");
assert.equal(tourney.seeds.length, 16, "16-team playoff bracket");
assert.ok(tourney.seeds.includes(state.userTeamId), "the user is always seeded into the playoff");
assert.equal(tourney.fieldSize, template.teams.length, "the full field is scored");

// Online cups do NOT build an interactive tournament (they quick-sim).
const cupId = state.openCircuit.calendar.all.find((e) => /ONLINE/.test(e.eventType))?.id;
assert.equal(buildCircuitTournament(state, cupId), null, "online cups are not interactive tournaments");

// Play the bracket: AI sims to the user's match; the user's result comes from a
// live series (here a real simMatch stands in for the Match Center).
let step = simCircuitAiUntilUser(tourney, state);
let userMatches = 0, guard = 0;
while (step.userMatch && guard++ < 40) {
  let pend = null;
  for (const r of tourney.bracket.rounds) {
    const m = (r.matches || []).find((x) => !x.played && x.a && x.b && (x.a === state.userTeamId || x.b === state.userTeamId));
    if (m) { pend = m; break; }
  }
  const result = simMatch(teamObj(pend.a), teamObj(pend.b), 9000 + guard);
  userMatches += 1;
  step = applyUserCircuitResult(tourney, state, result);
}
assert.ok(step.done, "the bracket completes");
assert.ok(tourney.bracket.champion, "a champion is crowned");
assert.ok(userMatches >= 2, "the user played multiple live matches");

// Finalising folds the real placements + Pro Points back into the open circuit.
const finalState = finalizeCircuitTournament(state, tourney);
const res = finalState.openCircuit.results["mlg_fall_champ_2013"];
assert.ok(res.completed && res.userInField, "the event is completed with the user in the field");
assert.ok(res.userPlacement >= 1 && res.userPlacement <= tourney.fieldSize, "the user has a real placement");
assert.ok(res.bracket.rounds.length > 0, "a viewable bracket is stored");
assert.ok(res.userMatches.length >= 2 && res.userMatches[0].maps.length > 0, "per-map box scores are recorded");
assert.equal(finalState.openCircuit.playedCount, 1, "the event counts as played");
const winnerPoints = Object.values(finalState.openCircuit.proPoints).some((v) => v > 0);
assert.ok(winnerPoints, "Pro Points are awarded");

console.log(`circuit tournament: 16-seed playoff of a ${tourney.fieldSize}-team field, user played ${userMatches} live matches`);
console.log(`circuit tournament: champion crowned, user finished ${res.userPlacement}th, points folded into the circuit ✓`);
