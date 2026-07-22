import { CDL_TEAMS } from "../data/teams.js";
import { isInactivePlayer } from "./playerIdentity.js";
import { isChallengerMode, getChallengerRosterPlayers, resolveUserTeamMeta } from "./userTeam.js";
import { getEra } from "../data/codEras.js";

export const REQUIRED_CDL_STARTERS = 4;
export const REQUIRED_CHALLENGER_STARTERS = 4;

// Era-aware required starter count. Historical Dynasty seasons can change the
// starting roster size (e.g. 4 → 5 in Black Ops 4 / MW2019, back to 4 in Cold
// War onward). Default modern careers always require 4.
export function getRequiredStarters(state) {
  const size = getEra(state?.currentEraId)?.rosterSize;
  return Number.isFinite(size) ? size : REQUIRED_CDL_STARTERS;
}

export function getActiveStarters(players, teamId) {
  return (players || []).filter(p => p.teamId === teamId && !p.isSub && !isInactivePlayer(p));
}

export function getTeamRosterStatus(players, teamId, required = REQUIRED_CDL_STARTERS) {
  const activeStarters = getActiveStarters(players, teamId);
  const count = activeStarters.length;
  return {
    activeStarters,
    count,
    required,
    missing: Math.max(0, required - count),
    excess: Math.max(0, count - required),
    valid: count === required,
  };
}

// Roster status for the user-managed Challenger team. The Challenger pipeline is
// 4-based end to end (rosters, repair, buyouts), so Challenger teams always
// require 4 starters regardless of the CDL-level era roster size.
export function getChallengerRosterStatus(state, teamId = state?.userTeamId) {
  const activeStarters = getChallengerRosterPlayers(state, teamId);
  const required = REQUIRED_CHALLENGER_STARTERS;
  const count = activeStarters.length;
  return {
    activeStarters,
    count,
    required,
    missing: Math.max(0, required - count),
    excess: Math.max(0, count - required),
    // Challenger teams only need a full 4; extra depth never blocks progression.
    valid: count >= required,
  };
}

// Mode-aware status for the user's own team (CDL or Challenger).
export function getUserRosterStatus(state) {
  if (isChallengerMode(state)) return getChallengerRosterStatus(state);
  return getTeamRosterStatus(state?.players, state?.userTeamId, getRequiredStarters(state));
}

export function getRosterIncompleteMessage(state, teamId = state?.userTeamId) {
  // The user team uses mode-aware status; other teams use the CDL check.
  if (teamId === state?.userTeamId) {
    const status = getUserRosterStatus(state);
    if (status.valid) return null;
    const teamName = resolveUserTeamMeta(state)?.name ?? teamId ?? "Your team";
    return rosterComplianceMessage(status, teamName);
  }
  const status = getTeamRosterStatus(state?.players, teamId, getRequiredStarters(state));
  if (status.valid) return null;
  const teamName = CDL_TEAMS.find(t => t.id === teamId)?.name ?? teamId ?? "Your team";
  return rosterComplianceMessage(status, teamName);
}

// Explains both under- and over-size rosters (roster-size transitions produce
// both: 4 → 5 requires signing, 5 → 4 requires releasing/benching).
function rosterComplianceMessage(status, teamName) {
  if (status.missing > 0) {
    const playerWord = status.missing === 1 ? "player" : "players";
    return `Roster incomplete — ${teamName} have ${status.count}/${status.required} starters. Promote or sign ${status.missing} more ${playerWord} before continuing.`;
  }
  if (status.excess > 0) {
    const playerWord = status.excess === 1 ? "starter" : "starters";
    return `Roster over the limit — ${teamName} have ${status.count}/${status.required} starters. Release, bench or transfer ${status.excess} ${playerWord} before continuing.`;
  }
  return null;
}

export function isUserRosterPlayable(state) {
  return getUserRosterStatus(state).valid;
}
