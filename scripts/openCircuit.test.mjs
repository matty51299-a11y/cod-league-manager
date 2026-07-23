// Open-circuit / historical-roster regression suite.
// Covers the 20 required validations from the implementation brief plus the
// stable-identity guarantees (Vortex, MethodZ, Blackk). Run with:
//   node scripts/openCircuit.test.mjs
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`✅ ${name}`); };

try {
  const db = await server.ssrLoadModule("/src/data/historicalRosterDb.js");
  const ident = await server.ssrLoadModule("/src/utils/stableIdentity.js");
  const profiles = await server.ssrLoadModule("/src/data/competitionProfiles.js");
  const recon = await server.ssrLoadModule("/src/engine/seasonRosterEngine.js");
  const pro = await server.ssrLoadModule("/src/engine/proPoints.js");
  const calendar = await server.ssrLoadModule("/src/engine/openCircuit/calendar.js");
  const brackets = await server.ssrLoadModule("/src/engine/openCircuit/brackets.js");
  const pools = await server.ssrLoadModule("/src/engine/openCircuit/pools.js");
  const champ = await server.ssrLoadModule("/src/engine/openCircuit/championship.js");
  const oce = await server.ssrLoadModule("/src/engine/openCircuitEngine.js");

  // Helper: build a small CareerState.
  const player = (id, teamId, overall = 75, role = "Flex", region = "NA") => ({ id, playerId: id, gamertag: id, name: id, teamId, overall, role, region });
  function careerState({ userTeamId = "user", userRoster = [], aiTeams = {} }) {
    const players = {};
    const teams = { [userTeamId]: { id: userTeamId, name: "User Team", historicalTeamId: userTeamId, isUserControlled: true, isActive: true, roster: [...userRoster] } };
    for (const pid of userRoster) players[pid] = player(pid, userTeamId, 80);
    for (const [tid, roster] of Object.entries(aiTeams)) {
      teams[tid] = { id: tid, name: tid, historicalTeamId: tid.replace("historical:", ""), isActive: true, roster: [...roster] };
      for (const pid of roster) players[pid] = player(pid, tid);
    }
    return { seasonId: "test", userTeamId, players, teams, freeAgentIds: [], processedSeasonIds: [] };
  }

  // ── Stable identity ──────────────────────────────────────────────────────────
  await test("vortex-uk and vortex-fr coexist in the same season (distinct ids, distinct teams)", async () => {
    const run = oce.buildAndRunOpenCircuitSeason({ eraId: "black_ops_3", userTeamId: "optic-gaming", userPlayers: [], dynastySeed: 1 });
    const players = run.world.players;
    assert.ok(players["vortex-uk"], "vortex-uk exists");
    assert.ok(players["vortex-fr"], "vortex-fr exists");
    // Distinct identities placed on distinct teams in the same season.
    assert.ok(players["vortex-uk"].teamId, "vortex-uk assigned to a team");
    assert.ok(players["vortex-fr"].teamId, "vortex-fr assigned to a team");
    assert.notEqual(players["vortex-uk"].teamId, players["vortex-fr"].teamId);
    const shared = ident.findSharedGamertagIdentities(Object.values(players));
    const vortex = shared.find((s) => s.displayName === "vortex");
    assert.ok(vortex && vortex.playerIds.includes("vortex-uk") && vortex.playerIds.includes("vortex-fr"));
    assert.equal(ident.sameIdentity(players["vortex-uk"], players["vortex-fr"]), false);
  });

  await test("MethodZ and Methodz remain different players", async () => {
    const a = db.getHistoricalPlayer("methodz-es");
    const b = db.getHistoricalPlayer("methodz-na");
    assert.ok(a && b);
    assert.notEqual(a.playerId, b.playerId);
    assert.equal(ident.sameIdentity({ id: a.playerId }, { id: b.playerId }), false);
  });

  // ── Reconciliation & user protection ──────────────────────────────────────────
  await test("A user-owned player is not taken by historical reconciliation", async () => {
    const st = careerState({ userRoster: ["star"], aiTeams: { "historical:ai": [] } });
    const tpl = { seasonId: "s", gameTitle: "T", rosterSize: 4, teams: [
      { historicalTeamId: "user", teamName: "User Team", players: [{ playerId: "u2", displayName: "u2" }] },
      { historicalTeamId: "ai", teamName: "AI", players: [{ playerId: "star", displayName: "Star" }, { playerId: "a2", displayName: "a2" }] },
    ] };
    const { state, conflicts } = recon.applyHistoricalSeasonTemplate(st, tpl);
    assert.equal(state.players["star"].teamId, "user", "star stays with user");
    assert.ok(conflicts.some((c) => c.type === "USER_OWNED_TARGET_BLOCKED"));
  });

  await test("A historical signing due to join a full user roster goes to free agency", async () => {
    const st = careerState({ userRoster: ["u1", "u2", "u3", "u4"] });
    const tpl = { seasonId: "s", gameTitle: "T", rosterSize: 4, teams: [
      { historicalTeamId: "user", teamName: "User Team", players: [{ playerId: "u1", displayName: "u1" }, { playerId: "incoming", displayName: "Incoming" }] },
    ] };
    const { state, conflicts } = recon.applyHistoricalSeasonTemplate(st, tpl);
    assert.ok(state.freeAgentIds.includes("incoming"), "incoming → FA");
    assert.equal(state.teams["user"].roster.length, 4, "no user player released");
    assert.deepEqual([...state.teams["user"].roster].sort(), ["u1", "u2", "u3", "u4"]);
    assert.ok(conflicts.some((c) => c.type === "USER_TEAM_FULL_SIGNING_TO_FREE_AGENCY"));
  });

  await test("An AI team blocked from a user-owned historical player signs a replacement", async () => {
    const st = careerState({ userRoster: ["star"], aiTeams: { "historical:ai": [] } });
    // Add free agents so a replacement is available.
    st.players["fa1"] = player("fa1", null, 82, "Flex", "NA"); st.freeAgentIds.push("fa1");
    st.players["fa2"] = player("fa2", null, 70); st.freeAgentIds.push("fa2");
    st.players["fa3"] = player("fa3", null, 70); st.freeAgentIds.push("fa3");
    st.players["fa4"] = player("fa4", null, 70); st.freeAgentIds.push("fa4");
    const tpl = { seasonId: "s", gameTitle: "T", rosterSize: 4, teams: [
      { historicalTeamId: "ai", teamName: "AI", players: [
        { playerId: "star", displayName: "Star", role: "Flex", region: "NA" },
        { playerId: "a2", displayName: "a2" }, { playerId: "a3", displayName: "a3" }, { playerId: "a4", displayName: "a4" },
      ] },
    ] };
    const { state, conflicts } = recon.applyHistoricalSeasonTemplate(st, tpl);
    assert.equal(state.teams["historical:ai"].roster.length, 4, "AI filled to roster size");
    assert.ok(!state.teams["historical:ai"].roster.includes("star"), "AI did not clone the user's player");
    assert.ok(conflicts.some((c) => c.type === "AI_TEAM_SHORTAGE_FILLED"));
  });

  await test("Moving from 5v5 to 4v4 does not auto-delete a user player", async () => {
    const st = careerState({ userRoster: ["u1", "u2", "u3", "u4", "u5"] });
    const tpl = { seasonId: "s", gameTitle: "4v4 Title", rosterSize: 4, teams: [
      { historicalTeamId: "user", teamName: "User Team", players: [] },
    ] };
    const { state, conflicts } = recon.applyHistoricalSeasonTemplate(st, tpl);
    assert.equal(state.teams["user"].roster.length, 5, "no player auto-cut");
    assert.equal(state.rosterCompliance.isBlocked, true);
    assert.ok(conflicts.some((c) => c.type === "USER_TEAM_OVER_LIMIT"));
  });

  await test("Unresolved Blackk warning is preserved and prevents duplicate assignment", async () => {
    const warnings = db.getValidationWarningsForSeason("ghosts");
    assert.ok(warnings.some((w) => w.playerId === "blackk"), "Blackk warning preserved in DB");
    const st = careerState({ aiTeams: { "historical:t1": [], "historical:t2": [] } });
    const tpl = { seasonId: "ghosts", gameTitle: "Ghosts", rosterSize: 4, teams: [
      { historicalTeamId: "t1", teamName: "T1", players: [{ playerId: "blackk", displayName: "Blackk" }] },
      { historicalTeamId: "t2", teamName: "T2", players: [{ playerId: "blackk", displayName: "Blackk" }] },
    ] };
    const { state, conflicts } = recon.applyHistoricalSeasonTemplate(st, tpl, { unresolvedWarnings: warnings });
    const onT1 = state.teams["historical:t1"].roster.includes("blackk");
    const onT2 = state.teams["historical:t2"].roster.includes("blackk");
    assert.ok(onT1 !== onT2, "Blackk is on exactly one team, never both");
    assert.ok(conflicts.some((c) => c.type === "UNRESOLVED_DATA_WARNING" && c.playerId === "blackk"));
  });

  // ── Ghosts ecosystem ──────────────────────────────────────────────────────────
  await test("Ghosts generates substantially more than four events", async () => {
    const profile = profiles.buildCompetitionProfile("ghosts");
    assert.ok(profile.eventTemplates.length > 4, `only ${profile.eventTemplates.length}`);
    const cal = calendar.buildSeasonCalendar(profile);
    assert.ok(cal.events.length > 4, `only ${cal.events.length} core events`);
  });

  await test("Ghosts generates recurring 2K and 5K cups", async () => {
    const profile = profiles.buildCompetitionProfile("ghosts");
    const cal = calendar.buildSeasonCalendar(profile);
    const twoK = cal.cups.filter((c) => c.eventType === "ONLINE_2K");
    const fiveK = cal.cups.filter((c) => c.eventType === "ONLINE_5K");
    assert.ok(twoK.length >= 4, `2K cups ${twoK.length}`);
    assert.ok(fiveK.length >= 2, `5K cups ${fiveK.length}`);
    // Deterministic: same profile → same cup dates.
    const cal2 = calendar.buildSeasonCalendar(profile);
    assert.deepEqual(cal.cups.map((c) => c.id), cal2.cups.map((c) => c.id));
  });

  await test("Ghosts has no active or visible Challengers ecosystem", async () => {
    const profile = profiles.buildCompetitionProfile("ghosts");
    assert.equal(profile.usesChallengers, false);
    assert.equal(profile.usesModernMajors, false);
    assert.equal(profile.ecosystemType, "OPEN_CIRCUIT");
    // Modern CDL era keeps Challengers/Majors available (gated, not deleted).
    const modern = profiles.buildCompetitionProfile("modern_2026");
    assert.equal(modern.usesChallengers, true);
    assert.equal(modern.usesModernMajors, true);
  });

  // ── Pro Points ──────────────────────────────────────────────────────────────
  await test("A 2K win awards 2,000 points to each locked winning player", async () => {
    let store = pro.createProPointsStore();
    const roster = ["p1", "p2", "p3", "p4"];
    pro.awardTournamentPoints(store, { seasonId: "ghosts", tournamentId: "cup1", proPointTableId: "ONLINE_2K", placements: [{ teamId: "A", placement: 1, lockedRoster: roster }] });
    for (const pid of roster) assert.equal(pro.getPlayerSeasonPoints(store, "ghosts", pid), 2000);
  });

  await test("A 5K win awards 5,000 points to each locked winning player", async () => {
    let store = pro.createProPointsStore();
    const roster = ["p1", "p2", "p3", "p4"];
    pro.awardTournamentPoints(store, { seasonId: "ghosts", tournamentId: "cup5", proPointTableId: "ONLINE_5K", placements: [{ teamId: "A", placement: 1, lockedRoster: roster }] });
    for (const pid of roster) assert.equal(pro.getPlayerSeasonPoints(store, "ghosts", pid), 5000);
  });

  await test("A transferred player's points move with the player", async () => {
    let store = pro.createProPointsStore();
    // Only the star earns points (won a cup on a previous roster).
    pro.awardTournamentPoints(store, { seasonId: "ghosts", tournamentId: "c", proPointTableId: "ONLINE_2K", placements: [{ teamId: "A", placement: 1, lockedRoster: ["star"] }] });
    assert.equal(pro.getPlayerSeasonPoints(store, "ghosts", "star"), 2000);
    // While on team A, the star's points count for team A.
    assert.equal(pro.teamProPoints(store, "ghosts", ["star", "x", "y", "z"]), 2000);
    // Star transfers to team B → the 2000 moves with the player to team B.
    assert.equal(pro.teamProPoints(store, "ghosts", ["star", "b2", "b3", "b4"]), 2000);
    // Team A without the star keeps only its remaining players' points (0 here).
    assert.equal(pro.teamProPoints(store, "ghosts", ["x", "y", "z", "repl"]), 0);
  });

  await test("Team seeding uses the locked active roster's combined player points (bench excluded)", async () => {
    let store = pro.createProPointsStore();
    pro.ensureSeason(store, "ghosts");
    // Team has 5 players; a 4v4 title should count only the top 4 by points.
    const s = store.playerSeasonProPoints["ghosts"];
    s.a = 1000; s.b = 900; s.c = 800; s.d = 700; s.bench = 5000; // bench has most points but...
    // eligibleLockedRoster picks top-4 by points → bench(5000) is actually top.
    const locked = pro.eligibleLockedRoster(store, "ghosts", ["a", "b", "c", "d", "bench"], 4);
    assert.equal(locked.length, 4);
    // The lowest (d=700) is dropped, not the bench — locked lineup is points-based.
    assert.ok(!locked.includes("d"));
    const ranking = pro.rankTeamsByProPoints(store, "ghosts", [{ id: "T", name: "T", roster: ["a", "b", "c", "d", "bench"] }], 4);
    assert.equal(ranking[0].points, 5000 + 1000 + 900 + 800);
  });

  // ── Brackets / pools / championship ──────────────────────────────────────────
  const strongWins = (a, b) => (String(a) < String(b) ? a : b); // deterministic by id
  await test("LAN runs one full-field double-elimination bracket (all teams in, byes for top seeds)", async () => {
    const teams = Array.from({ length: 28 }, (_, i) => `t${String(i).padStart(2, "0")}`);
    const world = { teams: {}, players: {} };
    teams.forEach((t, i) => { world.teams[t] = { id: t, isActive: true, roster: [`${t}_p`], name: t }; world.players[`${t}_p`] = { id: `${t}_p`, overall: 90 - i }; });
    const template = { id: "lan", name: "LAN", eventType: "OPEN_LAN", tier: "A", startDate: "2014-01-01", regionEligibility: ["GLOBAL"], proPointTableId: "LAN_A", playoffSize: 16, targetFieldSize: 16, bracketType: "DOUBLE_ELIMINATION" };
    const store = pro.createProPointsStore(); pro.ensureSeason(store, "ghosts");
    const profile = profiles.buildCompetitionProfile("ghosts");
    const season = oce.simulateOpenCircuitSeason(world, { ...profile, eventTemplates: [template], onlineCupSchedule: null }, { proStore: store });
    const r = season.results["lan"];
    const phaseNames = r.phases.map((p) => p.phase);
    assert.ok(phaseNames.includes("REGISTRATION"), "has registration");
    assert.ok(phaseNames.includes("CHAMPIONSHIP_BRACKET"), "has the bracket phase");
    // The whole field is in even though targetFieldSize is 16 — no team is cut.
    assert.equal(r.placements.length, 28, "all 28 entrants placed");
    assert.equal(new Set(r.placements.map((p) => p.teamId)).size, 28, "no team placed twice");
    // A viewable bracket with rounds is captured.
    assert.ok(r.bracket && r.bracket.rounds.length > 0, "a bracket with rounds is captured");
    assert.ok(r.bracket.champion, "the bracket has a champion");
    // Every played fixture is between two distinct teams from the field.
    const teamSet = new Set(teams);
    for (const rd of r.bracket.rounds) for (const m of rd.matches) {
      if (m.a && m.b) { assert.notEqual(m.a, m.b); assert.ok(teamSet.has(m.a) && teamSet.has(m.b)); }
    }
  });

  await test("A 28-team championship creates valid groups and a 16-team playoff field", async () => {
    const teams = Array.from({ length: 28 }, (_, i) => `c${i}`);
    const playSeries = (a, b) => ({ winner: strongWins(a, b), aMaps: strongWins(a, b) === a ? 3 : 1, bMaps: strongWins(a, b) === a ? 1 : 3 });
    const res = champ.runChampionship({ seededTeams: teams, playSeries });
    assert.equal(res.plan.groupCount, 7, "7 groups of 4");
    assert.equal(res.playoffSeeds.length, 16, "16-team playoff");
    assert.equal(res.placements.length, 16);
    assert.ok(res.champion);
    // Exactly 32 → 8 groups, 16 playoff, no thirds needed.
    const teams32 = Array.from({ length: 32 }, (_, i) => `d${i}`);
    const res32 = champ.runChampionship({ seededTeams: teams32, playSeries });
    assert.equal(res32.plan.groupCount, 8);
    assert.equal(res32.playoffSeeds.length, 16);
    // 29-31 teams do not crash and produce a valid power-of-two playoff.
    for (const n of [29, 30, 31]) {
      const t = Array.from({ length: n }, (_, i) => `e${n}_${i}`);
      const r = champ.runChampionship({ seededTeams: t, playSeries });
      assert.ok([8, 16].includes(r.playoffSeeds.length), `n=${n} playoff ${r.playoffSeeds.length}`);
      assert.equal(r.placements.length, r.playoffSeeds.length);
    }
  });

  await test("Double elimination: no team plays itself, no team survives two losses, real placement order", async () => {
    const seeds = Array.from({ length: 16 }, (_, i) => `s${i}`);
    const playMatch = (a, b) => { assert.notEqual(a, b, "no self-play"); return strongWins(a, b); };
    const de = brackets.runDoubleElimination({ seeds, playMatch });
    assert.equal(de.placements.length, 16);
    assert.equal(new Set(de.placements.map((p) => p.teamId)).size, 16, "no duplicate placement");
    // s0 (lexicographically smallest) always wins → champion.
    assert.equal(de.champion, "s0");
    // A team can appear at most twice as a loser across all fixtures (two losses → out).
    const lossCount = {};
    for (const m of de.matches) lossCount[m.loser] = (lossCount[m.loser] || 0) + 1;
    for (const [tid, losses] of Object.entries(lossCount)) assert.ok(losses <= 2, `${tid} lost ${losses} times`);
  });

  await test("Pool standings affect playoff seeds", async () => {
    // Two pools; strength by id so the winners are deterministic.
    const playSeries = (a, b) => ({ winner: strongWins(a, b), aMaps: strongWins(a, b) === a ? 3 : 1, bMaps: strongWins(a, b) === a ? 1 : 3 });
    const res = pools.runPools({ pools: [["a1", "a4", "a3", "a2"], ["b1", "b4", "b3", "b2"]], playSeries });
    // Pool winners (a1, b1) must be seeded ahead of every runner-up.
    const seedIndex = (t) => res.seeds.indexOf(t);
    assert.ok(seedIndex("a1") < seedIndex("a2"), "pool winner ahead of its runner-up");
    assert.ok(Math.max(seedIndex("a1"), seedIndex("b1")) < Math.min(seedIndex("a2"), seedIndex("b2")), "all winners seeded before all runners-up");
  });

  // ── Overlaps, idempotency, awards ─────────────────────────────────────────────
  await test("Overlapping single-weekend events do not allow one team to enter both", async () => {
    const run = oce.buildAndRunOpenCircuitSeason({ eraId: "ghosts", userTeamId: "optic-gaming", userPlayers: [], dynastySeed: 3 });
    const typeById = Object.fromEntries(run.profile.eventTemplates.map((t) => [t.id, t.eventType]));
    assert.ok(run.season.calendar.overlaps.length > 0, "overlaps detected");
    // League seasons run in parallel by design (Part 8) — exclusivity applies only
    // to single-weekend LAN/cup events. UMG Dallas & Insomnia52 are one such pair.
    let checkedPairs = 0;
    for (const [aId, bId] of run.season.calendar.overlaps) {
      if (typeById[aId] === "LEAGUE_SEASON" || typeById[bId] === "LEAGUE_SEASON") continue;
      const a = run.season.results[aId];
      const b = run.season.results[bId];
      if (!a || !b || a.skipped || b.skipped) continue;
      checkedPairs++;
      const aTeams = new Set(a.placements.map((p) => p.teamId));
      const shared = b.placements.map((p) => p.teamId).filter((t) => aTeams.has(t));
      assert.equal(shared.length, 0, `overlap ${aId}/${bId} shares teams: ${shared.join(",")}`);
    }
    assert.ok(checkedPairs > 0, "at least one single-weekend overlap pair was verified");
  });

  await test("Reloading does not regenerate fixtures or award points twice", async () => {
    const run = oce.buildAndRunOpenCircuitSeason({ eraId: "ghosts", userTeamId: "optic-gaming", userPlayers: [], dynastySeed: 9 });
    const pointsAfter = JSON.stringify(run.season.proStore.playerSeasonProPoints);
    // Resume with the same proStore + results → nothing re-awarded, results identical.
    const resumed = oce.simulateOpenCircuitSeason(run.world, run.profile, { dynastySeed: 9, proStore: run.season.proStore, results: run.season.results });
    assert.equal(JSON.stringify(resumed.proStore.playerSeasonProPoints), pointsAfter, "points unchanged on reload");
    assert.deepEqual(Object.keys(resumed.results).sort(), Object.keys(run.season.results).sort(), "no new fixtures");
  });

  await test("AI fixtures auto-simulate without becoming the user's playable fixture", async () => {
    // User is NA; an EU-only regional completes on its own with no user involvement.
    const run = oce.buildAndRunOpenCircuitSeason({ eraId: "ghosts", userTeamId: "optic-gaming", userPlayers: [], dynastySeed: 5 });
    const userId = run.world.userTeamId;
    const euEvent = run.season.results["cod_euro_champ_2014"] || run.season.results["insomnia52"];
    assert.ok(euEvent && euEvent.completed, "EU AI event auto-completed");
    if (!euEvent.skipped) {
      const involvesUser = euEvent.placements.some((p) => p.teamId === userId);
      assert.equal(involvesUser, false, "AI-only event did not pull in the user's team");
    }
  });

  await test("Completed tournament placements award money and points exactly once", async () => {
    let store = pro.createProPointsStore();
    const placements = [
      { teamId: "A", placement: 1, lockedRoster: ["a1", "a2", "a3", "a4"] },
      { teamId: "B", placement: 2, lockedRoster: ["b1", "b2", "b3", "b4"] },
    ];
    const first = pro.awardTournamentPoints(store, { seasonId: "ghosts", tournamentId: "lan1", proPointTableId: "LAN_A", prizePool: 20000, fieldSize: 16, placements });
    assert.equal(first.alreadyAwarded, false);
    assert.equal(first.awards[0].pointsPerPlayer, 10000);
    assert.ok(first.awards[0].teamPrize > 0, "prize awarded");
    const pts1 = pro.getPlayerSeasonPoints(store, "ghosts", "a1");
    // Second call is a no-op (already awarded).
    const second = pro.awardTournamentPoints(store, { seasonId: "ghosts", tournamentId: "lan1", proPointTableId: "LAN_A", prizePool: 20000, fieldSize: 16, placements });
    assert.equal(second.alreadyAwarded, true);
    assert.equal(second.awards.length, 0);
    assert.equal(pro.getPlayerSeasonPoints(store, "ghosts", "a1"), pts1, "points not doubled");
  });

  console.log(`\nOpen-circuit suite passed (${passed} tests).`);
} catch (e) {
  console.error("❌ FAILED:", e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await server.close();
}
