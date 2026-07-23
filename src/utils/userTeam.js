// src/utils/userTeam.js
// Central helpers for the dual-mode career: managing a CDL team or a Challenger
// team. `state.userTeamType` is the source of truth ("cdl" | "challenger").
// Old saves with no userTeamType are treated as CDL — never migrated.
//
// These helpers resolve a uniform team-display object and the user's active
// roster regardless of which mode is in play, so UI/components can stay simple.

import { CDL_TEAMS } from "../data/teams.js";
import { isInactivePlayer } from "./playerIdentity.js";

export function getUserTeamType(state) {
  return state?.userTeamType === "challenger" ? "challenger" : "cdl";
}

export function isChallengerMode(state) {
  return getUserTeamType(state) === "challenger";
}

// The challengerTeams[] entry the user manages (challenger mode only).
export function getUserChallengerTeam(state) {
  if (!state || !isChallengerMode(state)) return null;
  return (state.challengerTeams || []).find(t => t.id === state.userTeamId) || null;
}

// A uniform { id, name, tag, color, logo, region } for the user team in either
// mode. Returns null if the user team cannot be resolved.
export function resolveUserTeamMeta(state) {
  if (!state) return null;
  // Historical Dynasty: the user team is a historical organisation stored in
  // state.teams (id === `historical:<orgId>`), not a modern CDL franchise.
  if (state.userTeamType === "historical") {
    const t = (state.teams || []).find(x => x.id === state.userTeamId);
    if (t) {
      const tag = String(t.name || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "GHT";
      return { id: t.id, name: t.name, tag, color: "#fbbf24", logo: null, region: t.region || null };
    }
    return { id: state.userTeamId, name: String(state.userTeamId ?? "Historical Team"), tag: "GHT", color: "#fbbf24", logo: null, region: null };
  }
  if (isChallengerMode(state)) {
    const t = getUserChallengerTeam(state);
    if (t) return { id: t.id, name: t.name, tag: t.tag, color: t.color, logo: t.logo, region: t.region };
    return { id: state.userTeamId, name: String(state.userTeamId ?? "Challenger Team"), tag: "CHA", color: "#7c5cff", logo: null, region: null };
  }
  const t = CDL_TEAMS.find(x => x.id === state.userTeamId);
  return t ? { id: t.id, name: t.name, tag: t.tag, color: t.color, logo: t.logo, region: null } : null;
}

// Resolve the active roster for a Challenger team (players live in the
// prospects/players arrays, keyed by challengerTeamId / the team's playerIds).
export function getChallengerRosterPlayers(state, teamId = state?.userTeamId) {
  const team = (state?.challengerTeams || []).find(t => t.id === teamId);
  if (!team) return [];
  const byId = new Map([...(state.players || []), ...(state.prospects || [])].map(p => [p.id, p]));
  const seen = new Set();
  const out = [];
  for (const pid of team.playerIds || []) {
    const p = byId.get(pid);
    if (p && !isInactivePlayer(p) && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
  }
  return out;
}

// True when this player belongs to the user-managed Challenger team. Used to
// protect the user's Challenger roster from silent AI poaching / cannibalizing.
export function isUserChallengerPlayer(player, state) {
  return isChallengerMode(state) && !!state.userTeamId && player?.challengerTeamId === state.userTeamId;
}
