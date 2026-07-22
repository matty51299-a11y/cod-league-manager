// src/data/codEras.js
// Central Call of Duty era database for Historical Dynasty mode.
//
// Each entry is a data-driven "season definition". The progression engine reads
// these instead of hardcoding titles, roster sizes, modes or map pools, so real
// history and procedurally generated future seasons share one code path.
//
// dataStatus distinguishes verified real-world history ("historical") from
// procedurally generated future seasons ("fictional"). This is never presented
// to the player as verified fact when fictional.

export const MODERN_ERA_ID = "modern_2026";
export const HISTORICAL_START_ERA_ID = "ghosts";

// Ecosystem eras: the structural phase of competitive Call of Duty.
export const ECOSYSTEM = { MLG: "mlg", CWL: "cwl", CDL: "cdl", FUTURE: "future" };

// The historical timeline. Ordered; nextEraId chains them. After the final
// historical season the engine generates fictional future seasons on demand.
export const COD_ERAS = [
  {
    id: "ghosts", seasonLabel: "2013/14", gameTitle: "Call of Duty: Ghosts", shortTitle: "Ghosts",
    movementStyle: "boots", rosterSize: 4, ecosystem: ECOSYSTEM.MLG, dataStatus: "historical",
    nextEraId: "advanced_warfare", startDate: "2013-09-01",
    modes: ["Hardpoint", "Search & Destroy", "Blitz", "Domination"],
    mapPool: { Hardpoint: ["Freight", "Octane", "Sovereign", "Strikezone", "Warhawk"], "Search & Destroy": ["Freight", "Octane", "Sovereign", "Warhawk"], Blitz: ["Freight", "Octane", "Warhawk"], Domination: ["Freight", "Sovereign", "Strikezone"] },
    rookieClassId: "ghosts_rookies", metaTags: ["boots", "snd_heavy", "ar_friendly"],
    roleWeights: { "Main AR": 1.08, Flex: 1.0, SMG: 0.94, Slayer: 0.98, Objective: 1.02, "Search Specialist": 1.06 },
    championship: "Call of Duty Championship 2014", lanWeight: 0.8,
    rulesNote: "Boots era. Open MLG-style circuit; Pro Points decide Champs seeding.",
  },
  {
    id: "advanced_warfare", seasonLabel: "2014/15", gameTitle: "Call of Duty: Advanced Warfare", shortTitle: "Advanced Warfare",
    movementStyle: "jetpack", rosterSize: 4, ecosystem: ECOSYSTEM.MLG, dataStatus: "historical",
    nextEraId: "black_ops_3", startDate: "2014-11-03",
    modes: ["Hardpoint", "Search & Destroy", "Uplink", "Capture the Flag"],
    mapPool: { Hardpoint: ["Detroit", "Retreat", "Solar", "Bio Lab"], "Search & Destroy": ["Detroit", "Recovery", "Riot", "Solar"], Uplink: ["Bio Lab", "Comeback", "Detroit"], "Capture the Flag": ["Ascend", "Retreat", "Solar"] },
    rookieClassId: "advanced_warfare_rookies", metaTags: ["jetpack", "high_pace", "smg_friendly"],
    roleWeights: { "Main AR": 0.96, Flex: 1.02, SMG: 1.1, Slayer: 1.08, Objective: 0.98, "Search Specialist": 0.98 },
    championship: "Call of Duty Championship 2015", lanWeight: 0.82,
    rulesNote: "First jetpack title. Exo-movement rewards raw slaying and pace.",
  },
  {
    id: "black_ops_3", seasonLabel: "2015/16", gameTitle: "Call of Duty: Black Ops 3", shortTitle: "Black Ops 3",
    movementStyle: "jetpack", rosterSize: 4, ecosystem: ECOSYSTEM.CWL, dataStatus: "historical",
    nextEraId: "infinite_warfare", startDate: "2015-11-06",
    modes: ["Hardpoint", "Search & Destroy", "Uplink", "Capture the Flag"],
    mapPool: { Hardpoint: ["Breach", "Evac", "Fringe", "Stronghold"], "Search & Destroy": ["Breach", "Evac", "Fringe", "Redwood", "Stronghold"], Uplink: ["Breach", "Evac", "Fringe"], "Capture the Flag": ["Breach", "Evac", "Stronghold"] },
    rookieClassId: "black_ops_3_rookies", metaTags: ["jetpack", "specialist", "high_pace"],
    roleWeights: { "Main AR": 0.98, Flex: 1.04, SMG: 1.06, Slayer: 1.1, Objective: 0.98, "Search Specialist": 1.0 },
    championship: "Call of Duty Championship 2016", lanWeight: 0.84,
    rulesNote: "CWL era begins. Structured Pro League; jetpack specialists demand elite mechanics.",
  },
  {
    id: "infinite_warfare", seasonLabel: "2016/17", gameTitle: "Call of Duty: Infinite Warfare", shortTitle: "Infinite Warfare",
    movementStyle: "jetpack", rosterSize: 4, ecosystem: ECOSYSTEM.CWL, dataStatus: "historical",
    nextEraId: "wwii", startDate: "2016-11-04",
    modes: ["Hardpoint", "Search & Destroy", "Uplink"],
    mapPool: { Hardpoint: ["Breakout", "Retaliation", "Scorch", "Throwback"], "Search & Destroy": ["Crusher", "Retaliation", "Scorch", "Throwback"], Uplink: ["Frost", "Precinct", "Throwback"] },
    rookieClassId: "infinite_warfare_rookies", metaTags: ["jetpack", "high_pace", "smg_friendly"],
    roleWeights: { "Main AR": 0.98, Flex: 1.02, SMG: 1.08, Slayer: 1.08, Objective: 0.98, "Search Specialist": 1.0 },
    championship: "Call of Duty Championship 2017", lanWeight: 0.85,
    rulesNote: "Final jetpack season. CWL Global Pro League with international qualification.",
  },
  {
    id: "wwii", seasonLabel: "2017/18", gameTitle: "Call of Duty: WWII", shortTitle: "WWII",
    movementStyle: "boots", rosterSize: 4, ecosystem: ECOSYSTEM.CWL, dataStatus: "historical",
    nextEraId: "black_ops_4", startDate: "2017-11-03",
    modes: ["Hardpoint", "Search & Destroy", "Capture the Flag"],
    mapPool: { Hardpoint: ["Ardennes Forest", "Gibraltar", "London Docks", "Sainte Marie du Mont"], "Search & Destroy": ["Ardennes Forest", "London Docks", "Sainte Marie du Mont", "USS Texas"], "Capture the Flag": ["Ardennes Forest", "Flak Tower", "London Docks"] },
    rookieClassId: "wwii_rookies", metaTags: ["boots", "snd_heavy", "fundamentals"],
    roleWeights: { "Main AR": 1.1, Flex: 1.02, SMG: 0.92, Slayer: 0.96, Objective: 1.04, "Search Specialist": 1.08 },
    championship: "Call of Duty Championship 2018", lanWeight: 0.86,
    rulesNote: "Boots reset after jetpacks. Fundamentals and S&D regain importance.",
  },
  {
    id: "black_ops_4", seasonLabel: "2018/19", gameTitle: "Call of Duty: Black Ops 4", shortTitle: "Black Ops 4",
    movementStyle: "boots", rosterSize: 5, ecosystem: ECOSYSTEM.CWL, dataStatus: "historical",
    nextEraId: "modern_warfare_2019", startDate: "2018-10-12",
    modes: ["Hardpoint", "Search & Destroy", "Control"],
    mapPool: { Hardpoint: ["Arsenal", "Frequency", "Gridlock", "Hacienda", "Seaside"], "Search & Destroy": ["Arsenal", "Frequency", "Gridlock", "Hacienda", "Payload"], Control: ["Arsenal", "Frequency", "Gridlock", "Seaside"] },
    rookieClassId: "black_ops_4_rookies", metaTags: ["boots", "specialist", "high_pace"],
    roleWeights: { "Main AR": 1.02, Flex: 1.06, SMG: 1.0, Slayer: 1.02, Objective: 1.04, "Search Specialist": 1.0 },
    championship: "CWL Championship 2019", lanWeight: 0.85,
    rulesNote: "5v5 specialist title. Rosters expand to five starters; Control debuts.",
  },
  {
    id: "modern_warfare_2019", seasonLabel: "2019/20", gameTitle: "Call of Duty: Modern Warfare", shortTitle: "Modern Warfare",
    movementStyle: "boots", rosterSize: 5, ecosystem: ECOSYSTEM.CDL, dataStatus: "historical",
    nextEraId: "black_ops_cold_war", startDate: "2019-10-25", franchise: true,
    modes: ["Hardpoint", "Search & Destroy", "Domination"],
    mapPool: { Hardpoint: ["Azhir Cave", "Gun Runner", "Hackney Yard", "Rammaza", "St. Petrograd"], "Search & Destroy": ["Arklov Peak", "Gun Runner", "Hackney Yard", "Rammaza", "St. Petrograd"], Domination: ["Gun Runner", "Hackney Yard", "Rammaza"] },
    rookieClassId: "modern_warfare_2019_rookies", metaTags: ["boots", "snd_heavy", "ar_friendly"],
    roleWeights: { "Main AR": 1.1, Flex: 1.02, SMG: 0.92, Slayer: 0.94, Objective: 1.04, "Search Specialist": 1.08 },
    championship: "Call of Duty League Championship 2020", lanWeight: 0.55,
    rulesNote: "CDL franchise era begins. City-based slots, Home Series, 5v5 SND-heavy meta.",
  },
  {
    id: "black_ops_cold_war", seasonLabel: "2020/21", gameTitle: "Call of Duty: Black Ops Cold War", shortTitle: "Cold War",
    movementStyle: "boots", rosterSize: 4, ecosystem: ECOSYSTEM.CDL, dataStatus: "historical",
    nextEraId: "vanguard", startDate: "2020-11-13", franchise: true,
    modes: ["Hardpoint", "Search & Destroy", "Control"],
    mapPool: { Hardpoint: ["Cartel", "Checkmate", "Crossroads Strike", "Garrison", "Moscow", "Raid"], "Search & Destroy": ["Checkmate", "Crossroads Strike", "Garrison", "Miami", "Moscow", "Raid"], Control: ["Cartel", "Garrison", "Moscow", "Raid"] },
    rookieClassId: "black_ops_cold_war_rookies", metaTags: ["boots", "snd_heavy", "ar_friendly"],
    roleWeights: { "Main AR": 1.08, Flex: 1.04, SMG: 0.94, Slayer: 0.96, Objective: 1.04, "Search Specialist": 1.06 },
    championship: "Call of Duty League Championship 2021", lanWeight: 0.35,
    rulesNote: "Rosters return to 4v4. Online-heavy season; AR fundamentals dominate.",
  },
  {
    id: "vanguard", seasonLabel: "2021/22", gameTitle: "Call of Duty: Vanguard", shortTitle: "Vanguard",
    movementStyle: "boots", rosterSize: 4, ecosystem: ECOSYSTEM.CDL, dataStatus: "historical",
    nextEraId: "modern_warfare_2", startDate: "2021-11-05", franchise: true,
    modes: ["Hardpoint", "Search & Destroy", "Control"],
    mapPool: { Hardpoint: ["Bocage", "Desert Siege", "Gavutu", "Hotel Royal", "Berlin"], "Search & Destroy": ["Berlin", "Bocage", "Desert Siege", "Hotel Royal"], Control: ["Berlin", "Desert Siege", "Hotel Royal"] },
    rookieClassId: "vanguard_rookies", metaTags: ["boots", "snd_heavy", "ar_friendly"],
    roleWeights: { "Main AR": 1.08, Flex: 1.02, SMG: 0.95, Slayer: 0.97, Objective: 1.03, "Search Specialist": 1.05 },
    championship: "Call of Duty League Championship 2022", lanWeight: 0.6,
    rulesNote: "Return to LAN Majors. Structured 4v4 with a stable three-mode pool.",
  },
  {
    id: "modern_warfare_2", seasonLabel: "2022/23", gameTitle: "Call of Duty: Modern Warfare II", shortTitle: "Modern Warfare II",
    movementStyle: "boots", rosterSize: 4, ecosystem: ECOSYSTEM.CDL, dataStatus: "historical",
    nextEraId: "modern_warfare_3", startDate: "2022-10-28", franchise: true,
    modes: ["Hardpoint", "Search & Destroy", "Control"],
    mapPool: { Hardpoint: ["Breenbergh Hotel", "El Asilo", "Embassy", "Mercado Las Almas", "Zarqwa Hydroelectric"], "Search & Destroy": ["Breenbergh Hotel", "El Asilo", "Embassy", "Mercado Las Almas", "Zarqwa Hydroelectric"], Control: ["Breenbergh Hotel", "El Asilo", "Zarqwa Hydroelectric"] },
    rookieClassId: "modern_warfare_2_rookies", metaTags: ["boots", "tactical", "ar_friendly"],
    roleWeights: { "Main AR": 1.12, Flex: 1.02, SMG: 0.9, Slayer: 0.93, Objective: 1.05, "Search Specialist": 1.08 },
    championship: "Call of Duty League Championship 2023", lanWeight: 0.6,
    rulesNote: "Slower tactical title. AR-heavy, positioning and S&D discipline rewarded.",
  },
  {
    id: "modern_warfare_3", seasonLabel: "2023/24", gameTitle: "Call of Duty: Modern Warfare III", shortTitle: "Modern Warfare III",
    movementStyle: "boots", rosterSize: 4, ecosystem: ECOSYSTEM.CDL, dataStatus: "historical",
    nextEraId: "black_ops_6", startDate: "2023-11-10", franchise: true,
    modes: ["Hardpoint", "Search & Destroy", "Control"],
    mapPool: { Hardpoint: ["Invasion", "Karachi", "Rio", "Skidrow", "Terminal"], "Search & Destroy": ["Highrise", "Invasion", "Karachi", "Rio", "Skidrow", "Terminal"], Control: ["Invasion", "Karachi", "Skidrow"] },
    rookieClassId: "modern_warfare_3_rookies", metaTags: ["boots", "high_pace", "smg_friendly"],
    roleWeights: { "Main AR": 1.0, Flex: 1.04, SMG: 1.06, Slayer: 1.06, Objective: 1.0, "Search Specialist": 1.0 },
    championship: "Call of Duty League Championship 2024", lanWeight: 0.62,
    rulesNote: "Faster movement returns. SMG aggression and slaying spike in value.",
  },
  {
    id: "black_ops_6", seasonLabel: "2024/25", gameTitle: "Call of Duty: Black Ops 6", shortTitle: "Black Ops 6",
    movementStyle: "omnimovement", rosterSize: 4, ecosystem: ECOSYSTEM.CDL, dataStatus: "historical",
    nextEraId: null, startDate: "2024-11-01", franchise: true,
    modes: ["Hardpoint", "Search & Destroy", "Control"],
    mapPool: { Hardpoint: ["Protocol", "Red Card", "Rewind", "Skyline", "Vault"], "Search & Destroy": ["Protocol", "Red Card", "Rewind", "Skyline", "Vault"], Control: ["Hacienda", "Protocol", "Vault"] },
    rookieClassId: "black_ops_6_rookies", metaTags: ["omnimovement", "high_pace", "smg_friendly"],
    roleWeights: { "Main AR": 1.0, Flex: 1.05, SMG: 1.08, Slayer: 1.08, Objective: 1.0, "Search Specialist": 0.98 },
    championship: "Call of Duty League Championship 2025", lanWeight: 0.62,
    rulesNote: "Omnimovement era. Highest mechanical ceiling; flex slayers dominate.",
  },
  // Standalone "current" era used by the default (non-historical) Modern career.
  // Not part of the historical chain; historical dynasties reach the future via
  // procedural generation after Black Ops 6.
  {
    id: "modern_2026", seasonLabel: "2026", gameTitle: "Call of Duty League 2026", shortTitle: "Modern CDL 2026",
    movementStyle: "omnimovement", rosterSize: 4, ecosystem: ECOSYSTEM.CDL, dataStatus: "historical",
    nextEraId: null, startDate: "2026-01-01", franchise: true,
    modes: ["Hardpoint", "Search & Destroy", "Control"],
    mapPool: { Hardpoint: ["Current CDL HP Pool"], "Search & Destroy": ["Current CDL S&D Pool"], Control: ["Current CDL Control Pool"] },
    rookieClassId: null, metaTags: ["modern", "high_pace"],
    roleWeights: { "Main AR": 1.0, Flex: 1.03, SMG: 1.04, Slayer: 1.04, Objective: 1.0, "Search Specialist": 1.0 },
    championship: "Call of Duty League Championship 2026", lanWeight: 0.62,
    rulesNote: "Current default CDL mode; existing map simulation remains authoritative.",
  },
];

// The final real-world historical season. After this, seasons are fictional.
export const LAST_HISTORICAL_ERA_ID = "black_ops_6";

export const COD_ERA_BY_ID = Object.fromEntries(COD_ERAS.map(era => [era.id, era]));

// Runtime registry for procedurally generated future eras. These are stored in
// the save (state.generatedEras) and re-registered on load so getEra(id) keeps
// resolving them everywhere without threading state through every call site.
const GENERATED_ERA_REGISTRY = {};

export function registerGeneratedEras(eras) {
  for (const era of eras || []) {
    if (era?.id) GENERATED_ERA_REGISTRY[era.id] = era;
  }
}

export function getEra(id) {
  return COD_ERA_BY_ID[id] || GENERATED_ERA_REGISTRY[id] || COD_ERA_BY_ID[MODERN_ERA_ID];
}

export function getNextEra(id) {
  const era = getEra(id);
  if (!era?.nextEraId) return null;
  return getEra(era.nextEraId);
}

export function isFictionalEra(era) {
  return (typeof era === "string" ? getEra(era) : era)?.dataStatus === "fictional";
}

// ── Procedural future-season generation ────────────────────────────────────────
// After Black Ops 6 the timeline continues indefinitely with believable fictional
// titles. Generation is deterministic given (dynastySeed, seasonIndex) so a save
// reloaded before the transition always produces the same future season.

const FUTURE_CODENAMES = ["Vanguard", "Frontier", "Requiem", "Sentinel", "Havoc", "Reckoning", "Dominion", "Vendetta", "Onslaught", "Apex", "Nemesis", "Warzone", "Insurgency", "Blackout", "Genesis", "Overload", "Retribution", "Ascension", "Zero Day", "Endgame"];
const FUTURE_MOVEMENT = ["boots", "boots", "boots", "omnimovement", "jetpack"];
const FUTURE_MAP_NAMES = ["Terminal", "Skyline", "Nexus", "Cartel", "Foundry", "Harbor", "Downlink", "Meridian", "Outpost", "Vector", "Citadel", "Basin", "Relay", "Junction", "Spire", "Delta", "Quarry", "Bastion", "Verdant", "Ridgeline"];

function futureRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
function pickN(rng, arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

// Generate one fictional era that follows `prevEra`. seasonIndex is the count of
// seasons since the dynasty began (used for the label year and RNG).
export function generateFutureEra(prevEra, seasonIndex, dynastySeed = 1) {
  const rng = futureRng(((dynastySeed >>> 0) ^ 0x9e3779b9) + seasonIndex * 2654435761);
  const codename = pick(rng, FUTURE_CODENAMES);
  const yearNum = 2025 + Math.max(0, seasonIndex - 11); // BO6 = 2024/25 at index 11
  const seasonLabel = `${yearNum}/${String((yearNum + 1) % 100).padStart(2, "0")}`;
  const movementStyle = pick(rng, FUTURE_MOVEMENT);
  const rosterSize = rng() < 0.85 ? 4 : 5; // occasional roster-size shake-up
  const modes = ["Hardpoint", "Search & Destroy", rng() < 0.5 ? "Control" : "Domination"];
  const mapPool = {};
  for (const mode of modes) mapPool[mode] = pickN(rng, FUTURE_MAP_NAMES, 4);
  const smgMeta = movementStyle !== "boots" || rng() < 0.4;
  const roleWeights = smgMeta
    ? { "Main AR": 0.98, Flex: 1.05, SMG: 1.08, Slayer: 1.08, Objective: 1.0, "Search Specialist": 0.98 }
    : { "Main AR": 1.1, Flex: 1.02, SMG: 0.93, Slayer: 0.95, Objective: 1.04, "Search Specialist": 1.07 };
  const id = `future_${yearNum}_${codename.toLowerCase().replace(/\s+/g, "_")}`;
  return {
    id,
    seasonLabel,
    gameTitle: `Call of Duty: ${codename}`,
    shortTitle: codename,
    movementStyle,
    rosterSize,
    ecosystem: ECOSYSTEM.FUTURE,
    dataStatus: "fictional",
    nextEraId: null, // the next fictional era is generated when this one ends
    startDate: `${yearNum}-11-01`,
    franchise: true,
    modes,
    mapPool,
    rookieClassId: `${id}_rookies`,
    metaTags: [movementStyle, smgMeta ? "smg_friendly" : "ar_friendly", "fictional"],
    roleWeights,
    championship: `Call of Duty League Championship ${yearNum + 1}`,
    lanWeight: 0.62,
    rulesNote: `${movementStyle === "boots" ? "Boots-on-the-ground" : movementStyle === "jetpack" ? "Advanced-movement" : "Omnimovement"} title. ${smgMeta ? "Fast, slayer-driven meta." : "Tactical, AR-anchored meta."} (Procedurally generated season.)`,
  };
}
