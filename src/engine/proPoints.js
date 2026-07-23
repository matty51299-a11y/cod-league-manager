// src/engine/proPoints.js
// Player-level seasonal Pro Points.
//
// Points belong to PLAYERS, not organisations, and are stored per season:
//
//   store.playerSeasonProPoints[seasonId][playerId] = number
//
// A team's Pro Points ranking is the sum of its eligible active roster's
// individual current-season points (4 for a 4v4 title, 5 for 5v5). Because
// points are keyed by player, a transferred player's points move with them
// automatically. Points are awarded exactly once per tournament (guarded by a
// per-tournament marker), and archived (not deleted) when the title changes.

import { pointsForPlacement, prizeForPlacement } from "../data/competitionProfiles.js";

export function createProPointsStore() {
  return {
    playerSeasonProPoints: {}, // { [seasonId]: { [playerId]: points } }
    pointsAwardedTournaments: {}, // { [seasonId]: { [tournamentId]: true } }
    archivedSeasons: [], // seasonIds whose points have been archived
  };
}

export function migrateProPointsStore(store) {
  const base = createProPointsStore();
  if (!store || typeof store !== "object") return base;
  return {
    playerSeasonProPoints: store.playerSeasonProPoints || {},
    pointsAwardedTournaments: store.pointsAwardedTournaments || {},
    archivedSeasons: Array.isArray(store.archivedSeasons) ? store.archivedSeasons : [],
  };
}

export function ensureSeason(store, seasonId) {
  if (!store.playerSeasonProPoints[seasonId]) store.playerSeasonProPoints[seasonId] = {};
  if (!store.pointsAwardedTournaments[seasonId]) store.pointsAwardedTournaments[seasonId] = {};
  return store;
}

export function getPlayerSeasonPoints(store, seasonId, playerId) {
  return store?.playerSeasonProPoints?.[seasonId]?.[playerId] ?? 0;
}

export function isTournamentAwarded(store, seasonId, tournamentId) {
  return !!store?.pointsAwardedTournaments?.[seasonId]?.[tournamentId];
}

// Award a tournament's Pro Points + prize money exactly once.
//   placements: [{ teamId, placement, roster: [playerId], lockedRoster?: [playerId] }]
// Each player on a team's LOCKED winning roster receives the per-player points
// for the team's final placement. Returns { store, awards, alreadyAwarded }.
export function awardTournamentPoints(store, opts) {
  const {
    seasonId,
    tournamentId,
    placements = [],
    proPointTableId,
    prizePool = 0,
    fieldSize = placements.length,
  } = opts;
  ensureSeason(store, seasonId);
  if (isTournamentAwarded(store, seasonId, tournamentId)) {
    return { store, awards: [], alreadyAwarded: true };
  }
  const seasonPoints = store.playerSeasonProPoints[seasonId];
  const awards = [];
  for (const p of placements) {
    const roster = p.lockedRoster || p.roster || [];
    const perPlayerPoints = proPointTableId ? pointsForPlacement(proPointTableId, p.placement) : 0;
    const teamPrize = prizeForPlacement(prizePool, p.placement, fieldSize);
    const perPlayerPrize = roster.length ? Math.round(teamPrize / roster.length) : 0;
    const playerAwards = [];
    for (const playerId of roster) {
      seasonPoints[playerId] = (seasonPoints[playerId] || 0) + perPlayerPoints;
      playerAwards.push({ playerId, points: perPlayerPoints, prize: perPlayerPrize });
    }
    awards.push({
      teamId: p.teamId,
      placement: p.placement,
      pointsPerPlayer: perPlayerPoints,
      teamPrize,
      players: playerAwards,
    });
  }
  store.pointsAwardedTournaments[seasonId][tournamentId] = true;
  return { store, awards, alreadyAwarded: false };
}

// Combined eligible-roster points for a team, using a roster-lock snapshot.
//   lockedRoster: array of eligible playerIds (already trimmed to roster size).
export function teamProPoints(store, seasonId, lockedRoster = []) {
  return lockedRoster.reduce((sum, pid) => sum + getPlayerSeasonPoints(store, seasonId, pid), 0);
}

// Rank teams by combined locked-roster Pro Points (desc). teams: [{ id, roster }].
// rosterSize trims each team to its top-N eligible players by individual points
// (so bench players don't inflate the total).
export function rankTeamsByProPoints(store, seasonId, teams = [], rosterSize = 4) {
  return teams
    .map((t) => {
      const eligible = eligibleLockedRoster(store, seasonId, t.roster || [], rosterSize);
      return {
        teamId: t.id,
        name: t.name,
        roster: eligible,
        points: teamProPoints(store, seasonId, eligible),
      };
    })
    .sort((a, b) => b.points - a.points || String(a.teamId).localeCompare(String(b.teamId)))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

// Pick the top `rosterSize` players from a roster by individual season points as
// the locked competition lineup (deterministic tiebreak by id).
export function eligibleLockedRoster(store, seasonId, roster = [], rosterSize = 4) {
  return [...roster]
    .sort(
      (a, b) =>
        getPlayerSeasonPoints(store, seasonId, b) - getPlayerSeasonPoints(store, seasonId, a) ||
        String(a).localeCompare(String(b)),
    )
    .slice(0, rosterSize);
}

// Archive (never delete) a season's points when moving to the next COD title.
export function archiveSeasonPoints(store, seasonId) {
  if (!store.archivedSeasons.includes(seasonId)) store.archivedSeasons.push(seasonId);
  return store;
}
