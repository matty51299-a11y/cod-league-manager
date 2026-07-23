// src/engine/seasonRosterEngine.js
// Historical season roster reconciliation for the COD dynasty career.
//
// Adapted from the supplied seasonRosterEngine.ts reference to the project's
// runtime types. Operates on a "circuit world" CareerState:
//
//   CareerState = {
//     seasonId, userTeamId,
//     players: { [playerId]: CareerPlayer },
//     teams:   { [teamId]:   CareerTeam },
//     freeAgentIds: [playerId],
//     rosterCompliance?: { isBlocked, reason },
//     processedSeasonIds?: [seasonId],   // idempotency markers
//   }
//
// Core rule: historical data is a TARGET for the incoming season, never a
// replacement save. The user's roster is protected in every case. A historical
// signing only joins the user team when a slot exists; otherwise it enters free
// agency (USER_TEAM_FULL_SIGNING_TO_FREE_AGENCY). Identity is the stable
// playerId — never the visible gamertag.

import { claimIdentity } from "../utils/stableIdentity.js";

export const CONFLICT = {
  USER_OWNED_TARGET_BLOCKED: "USER_OWNED_TARGET_BLOCKED",
  USER_TEAM_FULL_SIGNING_TO_FREE_AGENCY: "USER_TEAM_FULL_SIGNING_TO_FREE_AGENCY",
  DUPLICATE_PLAYER_IN_TEMPLATE: "DUPLICATE_PLAYER_IN_TEMPLATE",
  AI_TEAM_SHORTAGE_FILLED: "AI_TEAM_SHORTAGE_FILLED",
  USER_TEAM_OVER_LIMIT: "USER_TEAM_OVER_LIMIT",
  USER_TEAM_NOT_IN_TEMPLATE: "USER_TEAM_NOT_IN_TEMPLATE",
  UNRESOLVED_DATA_WARNING: "UNRESOLVED_DATA_WARNING",
};

function cloneState(state) {
  return typeof structuredClone === "function"
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state));
}

function removeFromAllTeams(state, playerId) {
  for (const team of Object.values(state.teams)) {
    team.roster = team.roster.filter((id) => id !== playerId);
  }
}

function removeFromFreeAgency(state, playerId) {
  state.freeAgentIds = state.freeAgentIds.filter((id) => id !== playerId);
}

function sendToFreeAgency(state, playerId) {
  removeFromAllTeams(state, playerId);
  const player = state.players[playerId];
  if (player) player.teamId = null;
  if (!state.freeAgentIds.includes(playerId)) state.freeAgentIds.push(playerId);
}

function assignPlayer(state, playerId, teamId) {
  const team = state.teams[teamId];
  const player = state.players[playerId];
  if (!team || !player) {
    throw new Error(`Cannot assign missing player/team: ${playerId} -> ${teamId}`);
  }
  removeFromAllTeams(state, playerId);
  removeFromFreeAgency(state, playerId);
  if (!team.roster.includes(playerId)) team.roster.push(playerId);
  player.teamId = teamId;
}

function ensurePlayer(state, ref) {
  const existing = state.players[ref.playerId];
  if (existing) {
    // Preserve career data. Only backfill a missing gamertag; never overwrite.
    if (!existing.gamertag && ref.displayName) existing.gamertag = ref.displayName;
    return existing;
  }
  const created = {
    id: ref.playerId,
    playerId: ref.playerId,
    gamertag: ref.displayName,
    name: ref.displayName,
    teamId: null,
    overall: ref.overall ?? 70,
    role: ref.role || null,
    region: ref.region || null,
  };
  state.players[ref.playerId] = created;
  if (!state.freeAgentIds.includes(ref.playerId)) {
    state.freeAgentIds.push(ref.playerId);
  }
  return created;
}

function resolveOrCreateTeam(state, template) {
  const existing = Object.values(state.teams).find(
    (team) => team.historicalTeamId === template.historicalTeamId,
  );
  if (existing) {
    existing.isActive = true;
    if (!existing.isUserControlled) existing.name = template.teamName;
    return existing.id;
  }
  const id = `historical:${template.historicalTeamId}`;
  state.teams[id] = {
    id,
    name: template.teamName,
    historicalTeamId: template.historicalTeamId,
    isActive: true,
    roster: [],
  };
  return id;
}

// Prefer a replacement close to the player being replaced: rating first, then a
// role match, then a region match, where that information exists.
function pickBestReplacement(state, excluded, want = {}) {
  const candidates = state.freeAgentIds
    .filter((id) => !excluded.has(id) && !state.players[id]?.isRetired)
    .map((id) => {
      const p = state.players[id];
      let score = p?.overall ?? 0;
      if (want.role && p?.role && p.role === want.role) score += 6;
      if (want.region && p?.region && p.region === want.region) score += 4;
      return { id, score };
    })
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.id;
}

// Apply at the OFF-SEASON / NEW-SEASON boundary only.
//
// options.unresolvedWarnings: DB validation warnings for this season. Players
// named in an unresolved DUPLICATE warning are prevented from being assigned to
// more than one team without inventing a resolution (the warning is preserved
// and surfaced as an UNRESOLVED_DATA_WARNING conflict).
export function applyHistoricalSeasonTemplate(currentState, template, options = {}) {
  const state = cloneState(currentState);
  state.freeAgentIds = state.freeAgentIds || [];
  const conflicts = [];

  const userTeam = state.teams[state.userTeamId];
  if (!userTeam) throw new Error(`User team ${state.userTeamId} does not exist.`);
  userTeam.isUserControlled = true;
  userTeam.isActive = true;

  // Players the user currently owns can never be removed by reconciliation.
  const protectedUserPlayers = new Set(userTeam.roster);

  // Resolve/create every team in the incoming season first.
  const templateTeamToCareerTeam = new Map();
  for (const historicalTeam of template.teams) {
    templateTeamToCareerTeam.set(
      historicalTeam.historicalTeamId,
      resolveOrCreateTeam(state, historicalTeam),
    );
  }

  const userHistoricalTeam = template.teams.find(
    (t) => templateTeamToCareerTeam.get(t.historicalTeamId) === userTeam.id,
  );
  if (!userHistoricalTeam) {
    conflicts.push({
      type: CONFLICT.USER_TEAM_NOT_IN_TEMPLATE,
      teamId: userTeam.id,
      message:
        "The user's team is not in this historical season. It stays active as a user exception and is never deleted.",
    });
  }

  // Deactivate AI teams not part of the incoming season (players → free agency).
  const activeIncomingTeamIds = new Set(templateTeamToCareerTeam.values());
  for (const team of Object.values(state.teams)) {
    if (team.id === userTeam.id) continue;
    if (!activeIncomingTeamIds.has(team.id)) {
      for (const playerId of [...team.roster]) sendToFreeAgency(state, playerId);
      team.isActive = false;
    }
  }

  // Clear AI rosters so they rebuild toward the historical target. User untouched.
  for (const teamId of activeIncomingTeamIds) {
    if (teamId === userTeam.id) continue;
    for (const playerId of [...state.teams[teamId].roster]) {
      sendToFreeAgency(state, playerId);
    }
  }

  // Player ids flagged as unresolved duplicates in the source data.
  const unresolvedDuplicateIds = new Set();
  for (const w of options.unresolvedWarnings || []) {
    if (w?.type === "DUPLICATE_PLAYER_IN_SEASON_TEMPLATE" && w.playerId) {
      unresolvedDuplicateIds.add(w.playerId);
    }
  }

  const claims = new Map(); // playerId -> teamId (stable-id claim guard)

  for (const historicalTeam of template.teams) {
    const targetTeamId = templateTeamToCareerTeam.get(historicalTeam.historicalTeamId);
    if (!targetTeamId) continue;
    const targetTeam = state.teams[targetTeamId];

    for (const playerRef of historicalTeam.players) {
      ensurePlayer(state, playerRef);

      // Identity is the stable playerId. A player already claimed by another
      // team this pass is skipped (prevents duplicate assignment, including the
      // unresolved Blackk case) without merging by gamertag.
      if (!claimIdentity(claims, playerRef.playerId, targetTeamId)) {
        conflicts.push({
          type: unresolvedDuplicateIds.has(playerRef.playerId)
            ? CONFLICT.UNRESOLVED_DATA_WARNING
            : CONFLICT.DUPLICATE_PLAYER_IN_TEMPLATE,
          playerId: playerRef.playerId,
          teamId: targetTeamId,
          historicalTeamId: historicalTeam.historicalTeamId,
          message: unresolvedDuplicateIds.has(playerRef.playerId)
            ? `${playerRef.displayName} (${playerRef.playerId}) has an unresolved duplicate-team warning in the source data. Kept on the first team only; the data still needs manual correction.`
            : `${playerRef.displayName} appears on multiple teams in the season template; the first assignment was kept.`,
        });
        continue;
      }

      // User already owns this player — history cannot take them.
      if (protectedUserPlayers.has(playerRef.playerId) && targetTeamId !== userTeam.id) {
        conflicts.push({
          type: CONFLICT.USER_OWNED_TARGET_BLOCKED,
          playerId: playerRef.playerId,
          teamId: targetTeamId,
          historicalTeamId: historicalTeam.historicalTeamId,
          message: `${playerRef.displayName} was historically due to join ${targetTeam.name}, but remains with the user's team.`,
        });
        continue;
      }

      // Historical signing for the user's team: keep all current players, add
      // only if a slot exists; otherwise the incoming player enters free agency.
      if (targetTeamId === userTeam.id) {
        if (userTeam.roster.includes(playerRef.playerId)) continue;
        if (userTeam.roster.length < template.rosterSize) {
          assignPlayer(state, playerRef.playerId, userTeam.id);
        } else {
          sendToFreeAgency(state, playerRef.playerId);
          conflicts.push({
            type: CONFLICT.USER_TEAM_FULL_SIGNING_TO_FREE_AGENCY,
            playerId: playerRef.playerId,
            teamId: userTeam.id,
            historicalTeamId: historicalTeam.historicalTeamId,
            message: `${playerRef.displayName} was historically due to sign for the user's team, but the ${template.rosterSize}-player roster is full. The player entered free agency.`,
          });
        }
        continue;
      }

      // Strict historical assignment for AI teams.
      if (targetTeam.roster.length < template.rosterSize) {
        assignPlayer(state, playerRef.playerId, targetTeamId);
      } else {
        sendToFreeAgency(state, playerRef.playerId);
      }
    }
  }

  // AI teams that lost a historical target to user protection sign the best
  // available replacement (rating → role → region) so fixtures stay playable.
  const unavailable = new Set([...protectedUserPlayers, ...claims.keys()]);
  for (const teamId of activeIncomingTeamIds) {
    if (teamId === userTeam.id) continue;
    const team = state.teams[teamId];
    // What did this team fail to sign? Prefer replacing like-for-like.
    const missing = (template.teams.find(
      (t) => templateTeamToCareerTeam.get(t.historicalTeamId) === teamId,
    )?.players || []).find((pl) => protectedUserPlayers.has(pl.playerId));
    while (team.roster.length < template.rosterSize) {
      const replacement = pickBestReplacement(state, unavailable, {
        role: missing?.role,
        region: missing?.region,
      });
      if (!replacement) break;
      assignPlayer(state, replacement, teamId);
      unavailable.add(replacement);
      conflicts.push({
        type: CONFLICT.AI_TEAM_SHORTAGE_FILLED,
        playerId: replacement,
        teamId,
        message: `${team.name} was short of the season roster limit and signed an available free agent.`,
      });
    }
  }

  // Roster-size reduction (e.g. 5v5 → 4v4) never auto-cuts the user. Flag as
  // non-compliant so the user must bench / transfer / release before their next
  // official match.
  if (userTeam.roster.length > template.rosterSize) {
    state.rosterCompliance = {
      isBlocked: true,
      reason: `User roster has ${userTeam.roster.length} players but ${template.gameTitle || template.seasonId} allows ${template.rosterSize}. Bench or release a player before your next official match.`,
    };
    conflicts.push({
      type: CONFLICT.USER_TEAM_OVER_LIMIT,
      teamId: userTeam.id,
      message: state.rosterCompliance.reason,
    });
  } else {
    state.rosterCompliance = { isBlocked: false };
  }

  state.seasonId = template.seasonId;
  state.processedSeasonIds = Array.from(
    new Set([...(state.processedSeasonIds || []), template.seasonId]),
  );
  return { state, conflicts };
}

// Idempotency guard for the season transition. Returns true if the given season
// template has already been reconciled onto this state.
export function isSeasonProcessed(state, seasonId) {
  return (state?.processedSeasonIds || []).includes(seasonId);
}
