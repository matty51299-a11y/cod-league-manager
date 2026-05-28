import { CDL_TEAMS } from "../data/teams.js";

const VALID_PHASES = new Set(["stage", "challengerQualifier", "major", "preChamps", "offseason", "contracts"]);

export function isValidTeamId(teamId) {
  return CDL_TEAMS.some(t => t.id === teamId);
}

export function isValidGameState(state) {
  return Boolean(
    state &&
    isValidTeamId(state.userTeamId) &&
    state.schedule &&
    VALID_PHASES.has(state.schedule.phase) &&
    Array.isArray(state.schedule.stages) &&
    Array.isArray(state.schedule.majors) &&
    Number.isFinite(state.season)
  );
}
