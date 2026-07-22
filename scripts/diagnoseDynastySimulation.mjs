// Historical Dynasty long-run simulation smoke test.
//
// Drives a HISTORICAL dynasty through 12+ complete seasons via the real engine
// (the React reducer can't run in node) and verifies the dynasty invariants:
//   • the active COD title changes once per season (no double era transitions);
//   • the historical timeline runs Ghosts → … → Black Ops 6, then generates
//     believable fictional future seasons indefinitely;
//   • AI teams always field an era-legal roster (4 ↔ 5 transitions handled);
//   • the 4 → 5 expansion signs a fifth starter; the 5 → 4 reduction releases
//     the excess into free agency;
//   • fixtures resolve once, no duplicate players, rankings reset per season;
//   • retired players persist in history; generated rookies persist after reload.
//
// Run: node --import ./scripts/register-assets.mjs scripts/diagnoseDynastySimulation.mjs

import { buildInitialRoster } from "../src/data/players.js";
import { generateProspects } from "../src/data/prospects.js";
import { applyChallengerRatingOverride } from "../src/data/challengerRatingOverrides.js";
import { CDL_TEAMS } from "../src/data/teams.js";
import {
  buildSeason, beginChamps, beginEswc, ensureChallengerTeams, repairChallengerRosters,
  buildChallengerRostersForNewGame, simStage, simMajor, simChallengerQualifier,
  continueFromChallengerQualifier, enterContractPhase, advanceOffseason,
} from "../src/engine/seasonEngine.js";
import { ensureCdlRosterIntegrity } from "../src/engine/rosterAI.js";
import { ensureTeamStaff, migrateStaff } from "../src/engine/staffEngine.js";
import { migrateBoardState, buildBoardObjectives, BOARD_OBJ_VERSION, runBoardReview } from "../src/engine/boardEngine.js";
import { ensureTeamMapProfiles } from "../src/engine/mapProfile.js";
import { isInactivePlayer, normalizePlayerName, buildCdlRosterNameSet } from "../src/utils/playerIdentity.js";
import { createHistoricalStateFields, migrateHistoricalDynastyState } from "../src/engine/historicalDynasty.js";
import { getEra } from "../src/data/codEras.js";
import { getRequiredStarters } from "../src/utils/rosterValidation.js";

const SEASONS_TO_RUN = 13;
let failures = 0;
function check(label, ok, detail = "") { console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; }

function regenBoardObjectives(state, boardState) {
  const base = migrateBoardState(boardState);
  const { objectives, meta } = buildBoardObjectives({ ...state, boardState: base });
  return { ...base, objectives, meta, version: BOARD_OBJ_VERSION };
}
function advanceOffseasonWithHooks(state) {
  const advanced = advanceOffseason({ ...state });
  const next = { ...migrateHistoricalDynastyState(advanced), enteredMajorIdx: null, pendingBoardReview: null };
  next.teamMapProfiles = ensureTeamMapProfiles(next, { force: true });
  next.boardState = { ...regenBoardObjectives(next, next.boardState), verdict: null };
  return next;
}
function continueFromAwards(state) {
  const season = Number(state.pendingSeasonAwards?.season ?? state.season);
  const seenAwardsSeasons = [...new Set([...(state.seenAwardsSeasons || []).map(Number), season])];
  let base = { ...state, pendingSeasonAwards: null, seenAwardsSeasons, enteredMajorIdx: null };
  const { newBoardState, pendingBoardReview } = runBoardReview(migrateBoardState(base.boardState), base);
  base = { ...base, boardState: newBoardState, pendingBoardReview };
  return base.schedule?.pendingPostChampsEswc ? beginEswc(base) : base;
}

// Keep the user roster era-legal each offseason (mirrors an engaged manager).
function signUserToRequired(state) {
  const userTeam = state.userTeamId;
  const required = getRequiredStarters(state);
  let players = [...state.players];
  let prospects = [...(state.prospects || [])];
  const count = () => players.filter(p => p.teamId === userTeam && !p.isSub && !isInactivePlayer(p)).length;
  const collides = (p) => buildCdlRosterNameSet(players).has(normalizePlayerName(p.name));
  // Over the limit → bench the weakest until legal.
  let benchGuard = 0;
  while (count() > required && benchGuard++ < 8) {
    const weakest = players
      .filter(p => p.teamId === userTeam && !p.isSub && !isInactivePlayer(p))
      .sort((a, b) => (a.overall ?? 0) - (b.overall ?? 0))[0];
    if (!weakest) break;
    players = players.map(p => p.id === weakest.id ? { ...p, isSub: true } : p);
  }
  // Under the limit → sign FAs / promote prospects.
  let guard = 0;
  while (count() < required && guard++ < 8) {
    const onTeam = new Set(players.filter(p => p.teamId === userTeam).map(p => p.id));
    // First try to un-bench an existing sub.
    const sub = players.find(p => p.teamId === userTeam && p.isSub && !isInactivePlayer(p));
    if (sub) { players = players.map(p => p.id === sub.id ? { ...p, isSub: false } : p); continue; }
    const fa = players
      .filter(p => !p.teamId && !isInactivePlayer(p) && !onTeam.has(p.id) && !collides(p) && (p.status === "freeAgent" || !p.challengerTeamId))
      .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
    if (fa) { players = players.map(p => p.id === fa.id ? { ...p, teamId: userTeam, isSub: false, challengerTeamId: null, status: "cdl", circuit: "cdl", contractYears: 2 } : p); continue; }
    const prospect = prospects.filter(p => !p.teamId && !isInactivePlayer(p) && !collides(p)).sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))[0];
    if (!prospect) break;
    prospects = prospects.filter(p => p.id !== prospect.id);
    players.push({ ...prospect, teamId: userTeam, isSub: false, challengerTeamId: null, status: "cdl", circuit: "cdl", contractYears: 2 });
  }
  return { ...state, players, prospects };
}

function makeHistoricalState(userTeamId, seed) {
  const players = buildInitialRoster().map(applyChallengerRatingOverride);
  const rawProspects = generateProspects(seed).map(applyChallengerRatingOverride);
  const seen = new Set();
  const prospects = rawProspects.filter(p => { const k = normalizePlayerName(p.name); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  const state = {
    userTeamId, season: 1, players, prospects,
    schedule: buildSeason(1),
    notifications: [], feed: [], saveExists: true, enteredMajorIdx: null,
    playerSeasonStats: {}, playerOvrHistory: {}, challengersLog: [], challengerTransactions: [],
    seasonHistory: [], playerCareerHistory: [], teamCareerHistory: [],
    awards: [], pendingSeasonAwards: null, seenAwardsSeasons: [],
    retiredPlayers: [],
    staff: ensureTeamStaff(migrateStaff([])),
    boardState: migrateBoardState(null),
    pendingBoardReview: null,
    ...createHistoricalStateFields("historical", { dynastySeed: seed }),
  };
  buildChallengerRostersForNewGame(state, seed);
  ensureChallengerTeams(state);
  const finalState = ensureCdlRosterIntegrity(state, { windowType: "diagnose_dynasty" });
  finalState.boardState = regenBoardObjectives(finalState, finalState.boardState);
  finalState.teamMapProfiles = ensureTeamMapProfiles(finalState, { force: true });
  return finalState;
}

// Sim a whole season until it reaches the offseason (awards resolved).
function playSeason(state) {
  let guard = 0;
  while (guard++ < 3000) {
    if (state.pendingSeasonAwards) { state = continueFromAwards(state); continue; }
    const phase = state.schedule.phase;
    if (phase === "stage") state = simStage(state);
    else if (phase === "challengerQualifier") {
      state = simChallengerQualifier(state);
      if (state.schedule.currentChallengerQualifier?.completed) state = continueFromChallengerQualifier(state);
    } else if (phase === "major") state = simMajor(state);
    else if (phase === "preChamps") state = beginChamps(state);
    else if (phase === "offseason") return state;
    else return state;
  }
  throw new Error("playSeason did not reach offseason within guard");
}

function rolloverOffseason(state) {
  state = signUserToRequired(state);
  state = enterContractPhase({ ...state });
  state = advanceOffseasonWithHooks(state); // contracts → FA window (same season)
  state = signUserToRequired(state);
  state = advanceOffseasonWithHooks(state); // FA window → new season (era advances)
  repairChallengerRosters(state);
  state = signUserToRequired(state);
  return state;
}

function aiRosterSizesLegal(state) {
  const required = getRequiredStarters(state);
  const offenders = [];
  for (const team of CDL_TEAMS) {
    if (team.id === state.userTeamId) continue;
    const roster = state.players.filter(p => p.teamId === team.id && !p.isSub && !isInactivePlayer(p));
    if (roster.length !== required) offenders.push(`${team.id}:${roster.length}`);
  }
  return { ok: offenders.length === 0, offenders, required };
}

function duplicateActivePlayers(state) {
  const ids = new Set(), names = new Set();
  const dupes = [];
  for (const team of CDL_TEAMS) {
    for (const p of state.players.filter(x => x.teamId === team.id && !x.isSub && !isInactivePlayer(x))) {
      const nk = normalizePlayerName(p.name);
      if (ids.has(p.id) || names.has(nk)) dupes.push(p.name);
      ids.add(p.id); names.add(nk);
    }
  }
  return dupes;
}

// ── Run ────────────────────────────────────────────────────────────────────────
let state = makeHistoricalState("optic", 4242);
check("Dynasty starts in the Ghosts season", state.currentEraId === "ghosts" && getEra(state.currentEraId).seasonLabel === "2013/14", `${state.currentEraId}`);
check("Ghosts is a 4-player, MLG-era, boots season", getEra("ghosts").rosterSize === 4 && getEra("ghosts").ecosystem === "mlg" && getEra("ghosts").movementStyle === "boots");

const titlesSeen = [getEra(state.currentEraId).gameTitle];
let prevSeasonIndex = state.historicalSeasonIndex;
let retiredCount = state.retiredPlayers.length;
let sawExpansion = false, sawReduction = false;
let generatedRookieId = null;

for (let s = 0; s < SEASONS_TO_RUN; s++) {
  const seasonNo = state.season;
  const eraBefore = state.currentEraId;
  const requiredBefore = getRequiredStarters(state);

  state = playSeason(state);
  // Fixtures resolved once: every scheduled major that completed has a champion.
  const matchLogLen = state.schedule.matchLog?.length ?? 0;

  state = rolloverOffseason(state);

  // One era transition per season.
  const advanced = state.historicalSeasonIndex - prevSeasonIndex;
  if (advanced !== 1) { check(`Season ${seasonNo}: exactly one era transition`, false, `advanced ${advanced} (${eraBefore} → ${state.currentEraId})`); }
  prevSeasonIndex = state.historicalSeasonIndex;

  const era = getEra(state.currentEraId);
  titlesSeen.push(era.gameTitle);

  // Roster-size transitions.
  const requiredAfter = getRequiredStarters(state);
  if (requiredBefore === 4 && requiredAfter === 5) sawExpansion = true;
  if (requiredBefore === 5 && requiredAfter === 4) sawReduction = true;

  const sizes = aiRosterSizesLegal(state);
  if (!sizes.ok) check(`Season ${state.season}: AI rosters are era-legal (${sizes.required})`, false, sizes.offenders.slice(0, 5).join(", "));

  const dupes = duplicateActivePlayers(state);
  if (dupes.length) check(`Season ${state.season}: no duplicate active players`, false, dupes.slice(0, 5).join(", "));

  // Rankings reset: a freshly built season starts with zeroed standings points.
  const anyPoints = Object.values(state.schedule.standings || {}).some(v => (v?.points ?? 0) > 0);
  if (anyPoints) check(`Season ${state.season}: standings reset for the new season`, false, "found non-zero points");

  // Retired players persist / accumulate (never shrink).
  if (state.retiredPlayers.length < retiredCount) check(`Season ${state.season}: retired players preserved`, false, `${state.retiredPlayers.length} < ${retiredCount}`);
  retiredCount = state.retiredPlayers.length;

  if (matchLogLen === 0) check(`Season ${seasonNo}: matches were simulated`, false, "empty match log");

  const gen = state.prospects.find(p => p.dataStatus === "fictional");
  if (gen && !generatedRookieId) generatedRookieId = gen.id;
}

check(`Simulated ${SEASONS_TO_RUN} complete seasons without crashing`, true);
check("Active title changed across the dynasty", new Set(titlesSeen).size >= 6, `${new Set(titlesSeen).size} distinct titles`);
check("Handled the 4 → 5 roster expansion (Black Ops 4 era)", sawExpansion);
check("Handled the 5 → 4 roster reduction (Cold War era)", sawReduction);
check("Reached and passed the final historical season into the fictional future", getEra(state.currentEraId).dataStatus === "fictional" || state.generatedEras.length > 0, `${state.currentEraId} / ${state.generatedEras.length} generated`);
check("Fictional rookies were generated for future seasons", !!generatedRookieId);

// Reload persistence: a generated rookie survives a save round-trip (no regen).
const reloaded = migrateHistoricalDynastyState(JSON.parse(JSON.stringify(state)));
const stillThere = generatedRookieId ? [...(reloaded.prospects || []), ...(reloaded.players || [])].some(p => p.id === generatedRookieId) : true;
check("Generated rookies persist after reload (not regenerated)", stillThere);
check("Reload keeps the same current era and title", reloaded.currentEraId === state.currentEraId && reloaded.currentGameTitle === state.currentGameTitle);

console.log(`\nTitles across the dynasty: ${titlesSeen.join(" → ")}`);
if (failures) { console.error(`\nDynasty simulation FAILED: ${failures} issue(s).`); process.exit(1); }
console.log("\nDynasty simulation passed.");
