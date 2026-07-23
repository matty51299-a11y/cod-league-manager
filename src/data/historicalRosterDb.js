// src/data/historicalRosterDb.js
// Loader + typed accessors for the corrected historical roster database
// (cod_dynasty_rosters.corrected.json).
//
// Identity rule (from the source workbook): players are identified by a stable
// `playerId`. They are NEVER merged by lowercased gamertag alone. The database
// deliberately contains two different players displayed as "Vortex"
// (vortex-uk / vortex-fr) and two displayed as MethodZ/Methodz
// (methodz-es / methodz-na). Those must be able to coexist.

import DB from "./cod_dynasty_rosters.corrected.json";

// Season ids in the DB use hyphens (advanced-warfare); the era ids in codEras.js
// use underscores (advanced_warfare). This maps between the two conventions.
export function dbSeasonIdToEraId(seasonId) {
  return String(seasonId || "").replace(/-/g, "_");
}
export function eraIdToDbSeasonId(eraId) {
  return String(eraId || "").replace(/_/g, "-");
}

export const HISTORICAL_ROSTER_SCHEMA_VERSION = DB.schemaVersion ?? 1;

// Index of every canonical player identity, keyed by stable playerId.
const PLAYER_INDEX = new Map();
for (const p of DB.players || []) {
  PLAYER_INDEX.set(p.playerId, p);
}

export function getHistoricalPlayer(playerId) {
  return PLAYER_INDEX.get(playerId) || null;
}

export function getAllHistoricalPlayers() {
  return DB.players || [];
}

// Explicit alias map (visible spelling → canonical spelling). Used only for
// display/lookup convenience; it is NOT an identity-merge instruction.
export const PLAYER_ALIASES_APPLIED = DB.playerAliasesApplied || {};

// Structured identity corrections (e.g. the two Vortex players). Preserved so the
// UI / tooling can surface them and so we never collapse the identities.
export const IDENTITY_CORRECTIONS = DB.identityCorrections || [];

// Validation warnings that must be preserved rather than silently "resolved"
// (e.g. the unresolved Ghosts Blackk-on-two-teams warning).
export const VALIDATION_WARNINGS = DB.validationWarnings || [];

export function getValidationWarningsForSeason(seasonOrEraId) {
  const dbId = eraIdToDbSeasonId(seasonOrEraId);
  return VALIDATION_WARNINGS.filter(
    (w) => w.seasonId === dbId || w.seasonId === seasonOrEraId,
  );
}

// Return the raw season template from the DB for a given era id (or DB season id).
export function getHistoricalSeason(seasonOrEraId) {
  const dbId = eraIdToDbSeasonId(seasonOrEraId);
  return (
    (DB.seasons || []).find(
      (s) => s.seasonId === dbId || s.seasonId === seasonOrEraId,
    ) || null
  );
}

export function hasHistoricalSeason(seasonOrEraId) {
  return !!getHistoricalSeason(seasonOrEraId);
}

export function listHistoricalSeasonIds() {
  return (DB.seasons || []).map((s) => s.seasonId);
}

// Build a normalised HistoricalSeasonTemplate (the shape the reconciliation
// engine consumes) for an era id. Returns null when the DB has no data for it.
export function buildHistoricalSeasonTemplate(eraId) {
  const season = getHistoricalSeason(eraId);
  if (!season) return null;
  return {
    seasonId: dbSeasonIdToEraId(season.seasonId),
    dbSeasonId: season.seasonId,
    gameTitle: season.gameTitle,
    startYear: season.startYear,
    endYear: season.endYear,
    rosterSize: season.rosterSize,
    teams: (season.teams || []).map((t) => ({
      historicalTeamId: t.historicalTeamId,
      teamName: t.teamName,
      players: (t.players || []).map((pl) => ({
        playerId: pl.playerId,
        displayName: pl.displayName,
      })),
    })),
    warnings: getValidationWarningsForSeason(season.seasonId),
  };
}

export default DB;
