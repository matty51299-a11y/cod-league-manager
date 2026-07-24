// Targeted Modern CDL roster correction.  This module deliberately changes only
// the requested overall and primary-role fields; all other player data remains
// owned by the existing roster record/save.

export const MODERN_CDL_RATING_UPDATE_VERSION = 1;

// `previousOverall` is the value in the currently shipped Modern CDL bootstrap
// (after its existing Challenger-rating reconciliation).  It lets save migration
// apply the same rating delta without discarding offseason progression.
export const MODERN_CDL_RATING_UPDATES = [
  { id: "vancouver_tjhaly", name: "TJHaLy", previousOverall: 80, overall: 77, primary: "Flex" },
  { id: "boston_spart", name: "Spart", primary: "Main AR" },
  { id: "carolina_lurqxx", name: "Lurqxx", previousOverall: 80, overall: 85, primary: "Slayer SMG" },
  { id: "carolina_exceed", name: "Exceed", primary: "Main AR" },
  { id: "carolina_fire", name: "Fire", primary: "Flex" },
  { id: "paris_envoy", name: "Envoy", previousOverall: 86, overall: 84, primary: "Entry SMG" },
  { id: "g2_kremp", name: "Kremp", previousOverall: 85, overall: 87, primary: "Slayer SMG" },
  { id: "g2_skyz", name: "Skyz", previousOverall: 84, overall: 81, primary: "Flex" },
  { id: "boston_nastie", name: "Nastie", previousOverall: 83, overall: 83, primary: "Main AR" },
  { id: "toronto_reeal", name: "ReeaL", primary: "Slayer SMG" },
  { id: "miami_mettalz", name: "MettalZ", primary: "Entry SMG" },
  { id: "miami_super", name: "SupeR", previousOverall: 87, overall: 85, primary: "Main AR" },
  { id: "miami_renkor", name: "RenKoR", previousOverall: 85, overall: 84, primary: "Flex" },
  { id: "riyadh_kismet", name: "KiSMET", previousOverall: 87, overall: 85, primary: "Slayer SMG" },
  { id: "riyadh_aliuka", name: "Alluka", previousOverall: 79, overall: 86 },
  { id: "toronto_insight", name: "Insight", previousOverall: 81, overall: 78, primary: "Main AR" },
  { id: "vancouver_abe", name: "Abe", previousOverall: 79, overall: 77, primary: "Entry SMG" },
  { id: "g2_mamba", name: "Mamba", previousOverall: 84, overall: 80, primary: "Main AR" },
  { id: "carolina_nero", name: "Nero", previousOverall: 78, overall: 76, primary: "Flex" },
  { id: "vancouver_lunarz", name: "Lunarz", previousOverall: 82, overall: 77 },
];

const updateById = new Map(MODERN_CDL_RATING_UPDATES.map((update) => [update.id, update]));

export function applyModernCdlRatingUpdates(players = [], { preserveProgress = false } = {}) {
  return players.map((player) => {
    const update = updateById.get(player.id);
    if (!update) return player;
    const overall = update.overall == null
      ? player.overall
      : preserveProgress
        ? player.overall + (update.overall - update.previousOverall)
        : update.overall;
    return {
      ...player,
      ...(update.name ? { name: update.name } : {}),
      ...(update.primary ? { primary: update.primary } : {}),
      ...(update.overall != null ? { overall } : {}),
    };
  });
}
