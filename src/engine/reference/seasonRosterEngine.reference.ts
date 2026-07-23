/**
 * Historical season roster reconciliation for a COD dynasty/career game.
 *
 * Core rule:
 * Historical data is a target for the new season, never a replacement save.
 * The user's roster is protected. A historical signing only joins the user
 * team when there is room; otherwise the player enters free agency.
 */

export type PlayerId = string;
export type TeamId = string;

export interface CareerPlayer {
  id: PlayerId;
  gamertag: string;
  teamId: TeamId | null;
  isRetired?: boolean;
  overall?: number;
}

export interface CareerTeam {
  id: TeamId;
  name: string;
  historicalTeamId?: string;
  isUserControlled?: boolean;
  isActive: boolean;
  roster: PlayerId[];
}

export interface CareerState {
  seasonId: string;
  userTeamId: TeamId;
  players: Record<PlayerId, CareerPlayer>;
  teams: Record<TeamId, CareerTeam>;
  freeAgentIds: PlayerId[];
  rosterCompliance?: {
    isBlocked: boolean;
    reason?: string;
  };
}

export interface HistoricalPlayerRef {
  playerId: PlayerId;
  displayName: string;
}

export interface HistoricalTeamTemplate {
  historicalTeamId: string;
  teamName: string;
  players: HistoricalPlayerRef[];
}

export interface HistoricalSeasonTemplate {
  seasonId: string;
  gameTitle: string;
  startYear: number;
  endYear: number;
  rosterSize: number;
  teams: HistoricalTeamTemplate[];
}

export type ReconciliationConflictType =
  | "USER_OWNED_TARGET_BLOCKED"
  | "USER_TEAM_FULL_SIGNING_TO_FREE_AGENCY"
  | "DUPLICATE_PLAYER_IN_TEMPLATE"
  | "AI_TEAM_SHORTAGE_FILLED"
  | "USER_TEAM_OVER_LIMIT"
  | "USER_TEAM_NOT_IN_TEMPLATE";

export interface ReconciliationConflict {
  type: ReconciliationConflictType;
  playerId?: PlayerId;
  teamId?: TeamId;
  historicalTeamId?: string;
  message: string;
}

export interface ReconciliationResult {
  state: CareerState;
  conflicts: ReconciliationConflict[];
}

function cloneState(state: CareerState): CareerState {
  return structuredClone(state);
}

function removeFromAllTeams(state: CareerState, playerId: PlayerId): void {
  for (const team of Object.values(state.teams)) {
    team.roster = team.roster.filter((id) => id !== playerId);
  }
}

function removeFromFreeAgency(state: CareerState, playerId: PlayerId): void {
  state.freeAgentIds = state.freeAgentIds.filter((id) => id !== playerId);
}

function sendToFreeAgency(state: CareerState, playerId: PlayerId): void {
  removeFromAllTeams(state, playerId);

  const player = state.players[playerId];
  if (player) {
    player.teamId = null;
  }

  if (!state.freeAgentIds.includes(playerId)) {
    state.freeAgentIds.push(playerId);
  }
}

function assignPlayer(
  state: CareerState,
  playerId: PlayerId,
  teamId: TeamId,
): void {
  const team = state.teams[teamId];
  const player = state.players[playerId];

  if (!team || !player) {
    throw new Error(`Cannot assign missing player/team: ${playerId} -> ${teamId}`);
  }

  removeFromAllTeams(state, playerId);
  removeFromFreeAgency(state, playerId);

  if (!team.roster.includes(playerId)) {
    team.roster.push(playerId);
  }
  player.teamId = teamId;
}

function ensurePlayer(
  state: CareerState,
  ref: HistoricalPlayerRef,
): CareerPlayer {
  const existing = state.players[ref.playerId];
  if (existing) return existing;

  const created: CareerPlayer = {
    id: ref.playerId,
    gamertag: ref.displayName,
    teamId: null,
    overall: 70,
  };
  state.players[ref.playerId] = created;

  if (!state.freeAgentIds.includes(ref.playerId)) {
    state.freeAgentIds.push(ref.playerId);
  }

  return created;
}

/**
 * Map a historical template team to a persistent career team.
 *
 * Best practice:
 * - Store historicalTeamId separately from the visible team name.
 * - Add a franchise-transition table for known rebrands.
 * - Never use visible team-name text as the only save-game identity.
 */
function resolveOrCreateTeam(
  state: CareerState,
  template: HistoricalTeamTemplate,
): TeamId {
  const existing = Object.values(state.teams).find(
    (team) => team.historicalTeamId === template.historicalTeamId,
  );

  if (existing) {
    existing.isActive = true;
    if (!existing.isUserControlled) {
      existing.name = template.teamName;
    }
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

function pickBestAvailableFreeAgent(
  state: CareerState,
  excluded: Set<PlayerId>,
): PlayerId | undefined {
  return state.freeAgentIds
    .filter((id) => !excluded.has(id) && !state.players[id]?.isRetired)
    .sort(
      (a, b) =>
        (state.players[b]?.overall ?? 0) - (state.players[a]?.overall ?? 0),
    )[0];
}

/**
 * Apply at the OFF-SEASON / NEW-SEASON boundary only.
 *
 * Precedence:
 * 1. User roster and contracts.
 * 2. Historical season target.
 * 3. AI roster completion from free agency.
 */
export function applyHistoricalSeasonTemplate(
  currentState: CareerState,
  template: HistoricalSeasonTemplate,
): ReconciliationResult {
  const state = cloneState(currentState);
  const conflicts: ReconciliationConflict[] = [];

  const userTeam = state.teams[state.userTeamId];
  if (!userTeam) {
    throw new Error(`User team ${state.userTeamId} does not exist.`);
  }

  userTeam.isUserControlled = true;
  userTeam.isActive = true;

  // These players can never be removed by historical reconciliation.
  const protectedUserPlayers = new Set<PlayerId>(userTeam.roster);

  // Resolve/create every team in the new season before moving players.
  const templateTeamToCareerTeam = new Map<string, TeamId>();
  for (const historicalTeam of template.teams) {
    const careerTeamId = resolveOrCreateTeam(state, historicalTeam);
    templateTeamToCareerTeam.set(
      historicalTeam.historicalTeamId,
      careerTeamId,
    );
  }

  const userHistoricalTeam = template.teams.find(
    (historicalTeam) =>
      templateTeamToCareerTeam.get(historicalTeam.historicalTeamId) ===
      userTeam.id,
  );

  if (!userHistoricalTeam) {
    conflicts.push({
      type: "USER_TEAM_NOT_IN_TEMPLATE",
      teamId: userTeam.id,
      message:
        "The user's team is not present in this historical season. It remains active as a user exception and is never deleted.",
    });
  }

  // Deactivate AI teams that are not part of the incoming season.
  // Never deactivate or rename the user's team.
  const activeIncomingTeamIds = new Set(templateTeamToCareerTeam.values());
  for (const team of Object.values(state.teams)) {
    if (team.id === userTeam.id) continue;

    if (!activeIncomingTeamIds.has(team.id)) {
      for (const playerId of [...team.roster]) {
        sendToFreeAgency(state, playerId);
      }
      team.isActive = false;
    }
  }

  // Clear AI rosters so they can be rebuilt toward the historical target.
  // The user roster is deliberately untouched.
  for (const teamId of activeIncomingTeamIds) {
    if (teamId === userTeam.id) continue;

    const team = state.teams[teamId];
    for (const playerId of [...team.roster]) {
      sendToFreeAgency(state, playerId);
    }
  }

  const claimedThisPass = new Map<PlayerId, TeamId>();
  const historicalPlayerIds = new Set<PlayerId>();

  for (const historicalTeam of template.teams) {
    const targetTeamId = templateTeamToCareerTeam.get(
      historicalTeam.historicalTeamId,
    );
    if (!targetTeamId) continue;

    const targetTeam = state.teams[targetTeamId];

    for (const playerRef of historicalTeam.players) {
      ensurePlayer(state, playerRef);
      historicalPlayerIds.add(playerRef.playerId);

      const alreadyClaimedBy = claimedThisPass.get(playerRef.playerId);
      if (alreadyClaimedBy && alreadyClaimedBy !== targetTeamId) {
        conflicts.push({
          type: "DUPLICATE_PLAYER_IN_TEMPLATE",
          playerId: playerRef.playerId,
          teamId: targetTeamId,
          historicalTeamId: historicalTeam.historicalTeamId,
          message:
            `${playerRef.displayName} appears on multiple teams in the same season template. ` +
            "The first assignment was retained and the duplicate was skipped.",
        });
        continue;
      }

      // User already owns this player. History is not allowed to take them.
      if (
        protectedUserPlayers.has(playerRef.playerId) &&
        targetTeamId !== userTeam.id
      ) {
        conflicts.push({
          type: "USER_OWNED_TARGET_BLOCKED",
          playerId: playerRef.playerId,
          teamId: targetTeamId,
          historicalTeamId: historicalTeam.historicalTeamId,
          message:
            `${playerRef.displayName} was historically due to join ${targetTeam.name}, ` +
            "but remains with the user's team.",
        });
        continue;
      }

      // Historical signing for the user's team.
      // Keep all current user players, then add only if a slot exists.
      if (targetTeamId === userTeam.id) {
        if (userTeam.roster.includes(playerRef.playerId)) {
          claimedThisPass.set(playerRef.playerId, userTeam.id);
          continue;
        }

        if (userTeam.roster.length < template.rosterSize) {
          assignPlayer(state, playerRef.playerId, userTeam.id);
          claimedThisPass.set(playerRef.playerId, userTeam.id);
        } else {
          sendToFreeAgency(state, playerRef.playerId);
          conflicts.push({
            type: "USER_TEAM_FULL_SIGNING_TO_FREE_AGENCY",
            playerId: playerRef.playerId,
            teamId: userTeam.id,
            historicalTeamId: historicalTeam.historicalTeamId,
            message:
              `${playerRef.displayName} was historically due to sign for the user's team, ` +
              `but the ${template.rosterSize}-player roster is full. The player entered free agency.`,
          });
        }
        continue;
      }

      // Strict historical assignment for AI-controlled teams.
      if (targetTeam.roster.length < template.rosterSize) {
        assignPlayer(state, playerRef.playerId, targetTeamId);
        claimedThisPass.set(playerRef.playerId, targetTeamId);
      } else {
        // Bad template data or an oversized target roster must not delete a player.
        sendToFreeAgency(state, playerRef.playerId);
      }
    }
  }

  // Any AI team missing a historical target because the user owns that player
  // receives the best remaining free agent so fixtures are still playable.
  const unavailable = new Set<PlayerId>([
    ...protectedUserPlayers,
    ...claimedThisPass.keys(),
  ]);

  for (const teamId of activeIncomingTeamIds) {
    if (teamId === userTeam.id) continue;

    const team = state.teams[teamId];
    while (team.roster.length < template.rosterSize) {
      const replacement = pickBestAvailableFreeAgent(state, unavailable);
      if (!replacement) break;

      assignPlayer(state, replacement, teamId);
      unavailable.add(replacement);

      conflicts.push({
        type: "AI_TEAM_SHORTAGE_FILLED",
        playerId: replacement,
        teamId,
        message:
          `${team.name} was short of the season roster limit and signed an available free agent.`,
      });
    }
  }

  // Never auto-cut the user when a later COD changes roster size.
  // Example future transition: MW 5v5 -> Cold War 4v4.
  if (userTeam.roster.length > template.rosterSize) {
    state.rosterCompliance = {
      isBlocked: true,
      reason:
        `User roster has ${userTeam.roster.length} players but ${template.gameTitle} ` +
        `allows ${template.rosterSize}. The user must bench or release a player manually.`,
    };
    conflicts.push({
      type: "USER_TEAM_OVER_LIMIT",
      teamId: userTeam.id,
      message: state.rosterCompliance.reason,
    });
  } else {
    state.rosterCompliance = { isBlocked: false };
  }

  state.seasonId = template.seasonId;
  return { state, conflicts };
}
