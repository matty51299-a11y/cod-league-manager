import { CDL_TEAMS } from "../data/teams.js";
import { isInactivePlayer, normalizePlayerName } from "../utils/playerIdentity.js";

const VALID_PHASES = new Set(["stage", "challengerQualifier", "major", "preChamps", "offseason", "contracts"]);

export function isValidTeamId(teamId) {
  return CDL_TEAMS.some(t => t.id === teamId);
}

// The user team may be a CDL team (default), a Challenger team, or — for a
// Historical Dynasty save — a historical organisation. A Challenger user is
// valid when userTeamType === "challenger" and the id resolves against the
// save's challengerTeams list.
export function isChallengerUser(state) {
  return state?.userTeamType === "challenger";
}

// Historical Dynasty careers are built directly from the era roster database:
// the user team id is a `historical:<orgId>` id that resolves against the
// save's teams[] list, not the modern CDL_TEAMS collection.
export function isHistoricalUser(state) {
  return state?.userTeamType === "historical" || state?.careerMode === "historical";
}

export function isValidUserTeam(state) {
  if (isHistoricalUser(state)) {
    return Array.isArray(state?.teams)
      && state.teams.some(t => t.id === state.userTeamId && t.isUserControlled);
  }
  if (isChallengerUser(state)) {
    return Array.isArray(state?.challengerTeams)
      && state.challengerTeams.some(t => t.id === state.userTeamId);
  }
  return isValidTeamId(state?.userTeamId);
}

export function isValidGameState(state) {
  if (!state) return false;
  // Historical Dynasty saves run the open-circuit engine, not the modern
  // stage/major schedule, so their schedule.phase is "openCircuit".
  const phaseOk = isHistoricalUser(state)
    ? state.schedule?.phase === "openCircuit"
    : VALID_PHASES.has(state.schedule?.phase);
  return Boolean(
    isValidUserTeam(state) &&
    state.schedule &&
    phaseOk &&
    Array.isArray(state.schedule.stages) &&
    Array.isArray(state.schedule.majors) &&
    Number.isFinite(state.season)
  );
}

// Phase-specific invariants. Returns an array of human-readable problem
// strings, or [] if everything is consistent.
//
// The intent is to catch transitions that left the schedule in a state where
// rendering would explode (e.g. phase=major but no bracket, bracket with
// unresolvable team ids, qualifier phase with no qualifier object).
export function findPhaseInvariantViolations(state) {
  const problems = [];
  if (!state || !state.schedule) return problems;

  const { schedule, userTeamId } = state;
  const { phase, majorIdx, stageIdx } = schedule;

  if (!isValidUserTeam(state)) {
    problems.push(`Invalid userTeamId: ${String(userTeamId)}`);
  }

  // Historical Dynasty saves use the open-circuit engine and the era roster
  // database rather than the modern CDL_TEAMS collection and stage/major
  // schedule, so the CDL-specific invariants below do not apply to them.
  if (isHistoricalUser(state)) return problems;

  if (!VALID_PHASES.has(phase)) {
    problems.push(`Invalid phase: ${String(phase)}`);
    return problems;
  }

  const cdlIds = new Set(CDL_TEAMS.map(t => t.id));
  const eventIds = new Set(Object.keys(schedule.currentMajorEventTeams || {}));

  if (phase === "stage") {
    const stage = schedule.stages?.[stageIdx];
    if (!stage) problems.push(`Stage phase but no stage at idx ${stageIdx}`);
    if (majorIdx != null) problems.push(`Stage phase but majorIdx is ${majorIdx} (should be null)`);
  }

  if (phase === "challengerQualifier") {
    if (!schedule.currentChallengerQualifier) {
      problems.push("challengerQualifier phase but no currentChallengerQualifier");
    } else if (!schedule.currentChallengerQualifier.field?.length) {
      problems.push("currentChallengerQualifier has empty field");
    }
  }

  if (phase === "major") {
    if (majorIdx == null) {
      problems.push("major phase but majorIdx is null");
    } else {
      const major = schedule.majors?.[majorIdx];
      if (!major) problems.push(`major phase but majors[${majorIdx}] is missing`);
      else if (!major.bracket) problems.push(`major phase but majors[${majorIdx}].bracket is null`);
      else {
        const seeds = major.bracket.seeds || [];
        if (!seeds.length) problems.push(`major ${majorIdx} bracket has no seeds`);
        const bad = seeds.filter(id => !cdlIds.has(id) && !eventIds.has(id));
        if (bad.length) {
          problems.push(`major ${majorIdx} bracket has ${bad.length} unresolvable seed(s): ${bad.join(", ")}`);
        }
        // Cross-check every team-id referenced by any match.
        for (const round of major.bracket.rounds || []) {
          for (const m of round.matches || []) {
            for (const id of [m.a, m.b]) {
              if (id && !cdlIds.has(id) && !eventIds.has(id)) {
                problems.push(`major ${majorIdx} ${round.name} references unresolvable team ${id}`);
              }
            }
          }
        }
      }
    }
  }

  if (phase === "preChamps") {
    if (majorIdx != null) problems.push(`preChamps phase but majorIdx is ${majorIdx}`);
  }

  // Roster integrity — every CDL team needs 4 valid active starters for match sim.
  if (Array.isArray(state.players)) {
    const activeIds = new Set();
    const activeNames = new Set();
    for (const team of CDL_TEAMS) {
      const starters = state.players.filter(p => p.teamId === team.id && !p.isSub && !isInactivePlayer(p));
      if (team.id !== userTeamId && starters.length < 4) problems.push(`team ${team.id} has only ${starters.length} valid active starter(s)`);
      for (const player of starters) {
        const key = normalizePlayerName(player.name);
        if (activeIds.has(player.id)) problems.push(`duplicate active CDL player id: ${player.id}`);
        if (key && activeNames.has(key)) problems.push(`duplicate active CDL player name: ${player.name}`);
        if (player.challengerTeamId) problems.push(`${player.name} is listed on CDL team ${team.id} and Challenger team ${player.challengerTeamId}`);
        if (player.teamId !== team.id) problems.push(`${player.name} has mismatched teamId ${player.teamId} for roster ${team.id}`);
        activeIds.add(player.id);
        if (key) activeNames.add(key);
      }
      const invalid = state.players.filter(p => p.teamId === team.id && !p.isSub && isInactivePlayer(p));
      for (const player of invalid) problems.push(`${player.name} is inactive/retired on active CDL roster ${team.id}`);
    }
  }

  return problems;
}
