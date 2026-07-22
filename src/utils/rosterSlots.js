import { isInactivePlayer } from "./playerIdentity.js";

export const STARTER_LIMIT = 4;

export function getTeamPlayers(players = [], teamId) {
  return (players || []).filter(p => p.teamId === teamId && !isInactivePlayer(p));
}

export function getStarters(players = [], teamId) {
  return getTeamPlayers(players, teamId).filter(p => !p.isSub);
}

export function getBenchPlayers(players = [], teamId) {
  return getTeamPlayers(players, teamId).filter(p => p.isSub);
}

export function resolveSigningSlot(players = [], teamId, requestedSlot = "starter", limit = STARTER_LIMIT) {
  const starterCount = getStarters(players, teamId).length;
  if (requestedSlot === "sub" || requestedSlot === "bench") return "sub";
  return starterCount < limit ? "starter" : "sub";
}

export function sortByOverallDesc(players = []) {
  return [...players].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
}

export function autoPickStarterIds(players = [], teamId, limit = STARTER_LIMIT) {
  return new Set(sortByOverallDesc(getTeamPlayers(players, teamId)).slice(0, limit).map(p => p.id));
}

export function hasDuplicateRosterIds(players = [], teamId) {
  const seen = new Set();
  for (const p of getTeamPlayers(players, teamId)) {
    if (seen.has(p.id)) return true;
    seen.add(p.id);
  }
  return false;
}
