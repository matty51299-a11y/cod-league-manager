// src/utils/stableIdentity.js
// Stable, permanent player identity helpers for the historical open-circuit.
//
// Core rule: identity is the permanent `playerId`, NOT the visible gamertag.
// Two different players can share a displayed gamertag in the same season
// (the corrected DB ships English "Vortex" = vortex-uk and French "Vortex"
// = vortex-fr, plus MethodZ = methodz-es and Methodz = methodz-na). These must
// never be merged, overwritten, or moved together when only one is referenced.

// Return a player's stable id. Prefers an explicit historicalId/playerId; falls
// back to the engine's own id. NEVER derives identity from the gamertag.
export function stableId(player) {
  return player?.historicalId ?? player?.playerId ?? player?.id ?? null;
}

// Two players are the same identity iff their stable ids match. Identical visible
// gamertags do NOT prove identical identity.
export function sameIdentity(a, b) {
  const ia = stableId(a);
  const ib = stableId(b);
  return ia != null && ib != null && ia === ib;
}

// Build an index of players by stable id. Distinct ids are kept distinct even
// when they share a display name — this is what lets both Vortex players coexist.
export function indexByStableId(players = []) {
  const index = new Map();
  for (const p of players) {
    const id = stableId(p);
    if (id == null) continue;
    index.set(id, p);
  }
  return index;
}

// Group players by their (lowercased) display name. Used ONLY for reporting /
// UI ("these two share a gamertag") — never as an identity-merge signal.
export function groupByDisplayName(players = []) {
  const groups = new Map();
  for (const p of players) {
    const key = String(p?.gamertag ?? p?.name ?? "").toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return groups;
}

// Distinct identities that legitimately share a visible gamertag. Returns
// [{ displayName, playerIds: [...] }]. For the corrected DB this includes
// Vortex (vortex-uk, vortex-fr) and MethodZ/Methodz (methodz-es, methodz-na).
export function findSharedGamertagIdentities(players = []) {
  const out = [];
  for (const [name, group] of groupByDisplayName(players)) {
    const ids = [...new Set(group.map(stableId).filter((x) => x != null))];
    if (ids.length > 1) out.push({ displayName: name, playerIds: ids });
  }
  return out;
}

// Guard against assigning the SAME stable id to two teams in one reconciliation
// pass. Returns true if the id was newly claimed, false if already claimed by a
// different team (caller should skip and record a conflict — this is how the
// unresolved Ghosts "Blackk on two teams" warning is prevented from producing a
// duplicate assignment without inventing a resolution).
export function claimIdentity(claims, playerId, teamId) {
  const existing = claims.get(playerId);
  if (existing != null && existing !== teamId) return false;
  claims.set(playerId, teamId);
  return true;
}
