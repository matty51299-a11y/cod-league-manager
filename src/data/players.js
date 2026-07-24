// src/data/players.js
// March 2026 CDL starting rosters.
// Each player has a full stat block used by the match sim and chemistry engine.
// Ratings are 1–99. Hidden traits use a 1–5 scale (stored here as seeds; scouting reveals them).

// Deterministic hash for assigning initial contract lengths without RNG
function nameHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  return h;
}

// IDs are stable across roster moves and display-name casing updates.  The values
// below preserve the IDs used by the previous Modern CDL bootstrap.
const STABLE_PLAYER_IDS = {
  cammy: "boston_cammy", snoopy: "boston_snoopy", nastie: "boston_nastie",
  nero: "carolina_nero", craze: "carolina_craze", okis: "cloud9_okis",
  o4: "faze_04", estreal: "g2_estreal", mamba: "g2_mamba",
  reeal: "toronto_reeal", envoy: "paris_envoy", neptune: "paris_neptune",
  pred: "riyadh_pred", joedecieves: "toronto_joedeceives", abe: "vancouver_abe",
  gwinn: "vancouver_gwinn", lunarz: "vancouver_lunarz", alluka: "riyadh_aliuka", tjhaly: "vancouver_tjhaly",
};

function playerKey(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Helper to build a player object
// region: "NA" | "EU" | "MENA" | "APAC" — player nationality, NOT org/team location.
// Must be set per-player; do not infer from teamId. Travels with the player on transfers.
function mkPlayer(name, teamId, age, primary, secondary, ratings, hidden, region = "NA") {
  return {
    id: STABLE_PLAYER_IDS[playerKey(name)] ?? `${teamId}_${name.toLowerCase().replace(/\s/g, "_")}`,
    name,
    teamId,        // current team id (null = free agent)
    age,
    primary,       // primary role
    secondary,     // secondary role
    region,        // player's home region
    salary: (() => { const t = Math.max(0, (ratings.overall - 70) / 29); return Math.round((Math.pow(t, 2.5) * 575 + 25)) * 1000; })(),
    ...ratings,
    // hidden traits – not shown to player unless scouted
    ego: hidden.ego,
    workEthic: hidden.workEthic,
    tiltResistance: hidden.tiltResistance,
    leadership: hidden.leadership,
    metaDependence: hidden.metaDependence,
    // form: rolling average, starts neutral
    form: 70,
    // seasons of shared experience (per team, increments each season together)
    experience: 1,
    isProspect: false,
    // contract years remaining (decrements each offseason; 0 = expires → free agent)
    contractYears: (nameHash(name) % 3) + 1,  // 1–3 years, deterministic per player
  };
}

// Roles used in the sim
// "Entry SMG" | "Slayer SMG" | "Flex" | "Main AR" | "Objective" | "Search Specialist"

export function buildInitialRoster() {
  return [
    // ── BOSTON BREACH ──────────────────────────────────────────────────────────
    mkPlayer("Cammy",   null, 23, "Main AR",      "Entry SMG",
      { overall:80, potential:87, gunny:88, awareness:80, objective:72, searchIQ:78, clutch:85, teamwork:82, composure:83, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:2 }, "EU"),
    mkPlayer("Purj",    "boston", 21, "Entry SMG",       "Flex",
      { overall:74, potential:88, gunny:82, awareness:76, objective:78, searchIQ:74, clutch:77, teamwork:79, composure:75, adaptability:82 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:2 }),        // NA
    mkPlayer("Snoopy",  null, 22, "Slayer SMG",         "Flex",
      { overall:75, potential:85, gunny:79, awareness:84, objective:80, searchIQ:82, clutch:80, teamwork:85, composure:82, adaptability:79 },
      { ego:1, workEthic:5, tiltResistance:4, leadership:4, metaDependence:2 }),        // NA
    mkPlayer("Nastie",  "g2", 20, "Flex",       "Slayer SMG",
      { overall:83, potential:90, gunny:76, awareness:78, objective:85, searchIQ:72, clutch:74, teamwork:80, composure:72, adaptability:84 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }, "EU"),

    mkPlayer("Afro",    "boston", 23, "Slayer SMG", "Entry SMG",
      { overall:76, potential:84, gunny:80, awareness:75, objective:73, searchIQ:76, clutch:76, teamwork:77, composure:76, adaptability:78 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Spart",   "boston", 22, "Flex", "Main AR",
      { overall:75, potential:86, gunny:76, awareness:77, objective:76, searchIQ:77, clutch:75, teamwork:78, composure:76, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),

    // ── CAROLINA ROYAL RAVENS ──────────────────────────────────────────────────
    mkPlayer("Exceed",  "carolina", 23, "Slayer SMG",    "Entry SMG",
      { overall:79, potential:86, gunny:87, awareness:79, objective:70, searchIQ:80, clutch:84, teamwork:78, composure:82, adaptability:78 },
      { ego:3, workEthic:3, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Nero",    "vancouver", 24, "Search Specialist","Main AR",
      { overall:78, potential:86, gunny:82, awareness:88, objective:75, searchIQ:91, clutch:86, teamwork:83, composure:87, adaptability:81 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Lurqxx",  "carolina", 22, "Entry SMG",     "Slayer SMG",
      { overall:80, potential:87, gunny:83, awareness:75, objective:74, searchIQ:76, clutch:78, teamwork:77, composure:74, adaptability:83 },
      { ego:3, workEthic:3, tiltResistance:2, leadership:2, metaDependence:3 }),
    mkPlayer("Craze",   "vancouver", 21, "Flex",          "Objective",
      { overall:79, potential:89, gunny:77, awareness:80, objective:82, searchIQ:78, clutch:76, teamwork:82, composure:75, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:3 }),

    mkPlayer("Fire",    "carolina", 21, "Entry SMG", "Slayer SMG",
      { overall:74, potential:86, gunny:78, awareness:74, objective:75, searchIQ:74, clutch:74, teamwork:76, composure:74, adaptability:81 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Standy",  "carolina", 24, "Slayer SMG", "Flex",
      { overall:77, potential:85, gunny:80, awareness:78, objective:75, searchIQ:77, clutch:78, teamwork:78, composure:77, adaptability:79 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),

    // ── CLOUD9 NEW YORK ───────────────────────────────────────────────────────
    mkPlayer("Encourage","cloud9", 25, "Main AR",        "Flex",
      { overall:74, potential:87, gunny:83, awareness:88, objective:82, searchIQ:84, clutch:85, teamwork:88, composure:88, adaptability:83 },
      { ego:1, workEthic:5, tiltResistance:5, leadership:5, metaDependence:1 }),
    mkPlayer("Hide",    "cloud9", 23, "Slayer SMG",      "Entry SMG",
      { overall:77, potential:87, gunny:88, awareness:80, objective:72, searchIQ:79, clutch:86, teamwork:80, composure:82, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),
    mkPlayer("Nejra",   "cloud9", 21, "Entry SMG",       "Flex",
      { overall:78, potential:91, gunny:84, awareness:77, objective:76, searchIQ:75, clutch:79, teamwork:78, composure:73, adaptability:86 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:2 }),
    mkPlayer("Okis",    null, 22, "Objective",       "Search Specialist",
      { overall:74, potential:85, gunny:74, awareness:82, objective:87, searchIQ:83, clutch:78, teamwork:84, composure:80, adaptability:79 },
      { ego:1, workEthic:5, tiltResistance:4, leadership:3, metaDependence:2 }),

    mkPlayer("Wevy",    "cloud9", 18, "Flex", "Slayer SMG",
      { overall:76, potential:90, gunny:76, awareness:76, objective:76, searchIQ:76, clutch:76, teamwork:76, composure:76, adaptability:76 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),

    // ── FAZE VEGAS ────────────────────────────────────────────────────────────
    mkPlayer("Simp",    "faze", 24, "Slayer SMG",        "Entry SMG",
      { overall:93, potential:94, gunny:95, awareness:89, objective:78, searchIQ:88, clutch:94, teamwork:84, composure:91, adaptability:85 },
      { ego:3, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),
    mkPlayer("Drazah",  "faze", 23, "Main AR",         "Slayer SMG",
      { overall:88, potential:91, gunny:90, awareness:83, objective:78, searchIQ:84, clutch:87, teamwork:82, composure:84, adaptability:84 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),
    mkPlayer("O4",      "faze", 22, "Entry SMG",              "Main AR",
      { overall:85, potential:90, gunny:83, awareness:86, objective:83, searchIQ:85, clutch:83, teamwork:84, composure:83, adaptability:87 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:2 }),
    mkPlayer("Abuzah",  "faze", 23, "Flex",           "Flex",
      { overall:84, potential:87, gunny:80, awareness:87, objective:81, searchIQ:84, clutch:82, teamwork:86, composure:85, adaptability:82 },
      { ego:1, workEthic:5, tiltResistance:4, leadership:4, metaDependence:2 }, "EU"),

    // ── G2 MINNESOTA ─────────────────────────────────────────────────────────
    mkPlayer("Estreal", "paris", 23, "Slayer SMG",          "Entry SMG",
      { overall:86, potential:89, gunny:89, awareness:82, objective:74, searchIQ:82, clutch:87, teamwork:82, composure:84, adaptability:82 },
      { ego:3, workEthic:3, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Skyz",    "g2", 22, "Entry SMG",           "Flex",
      { overall:84, potential:89, gunny:86, awareness:80, objective:76, searchIQ:78, clutch:83, teamwork:80, composure:79, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Kremp",   "g2", 24, "Search Specialist",   "Main AR",
      { overall:85, potential:86, gunny:80, awareness:87, objective:78, searchIQ:90, clutch:84, teamwork:84, composure:86, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Mamba",   "vancouver", 21, "Flex",                "Objective",
      { overall:84, potential:91, gunny:80, awareness:82, objective:84, searchIQ:80, clutch:80, teamwork:83, composure:78, adaptability:87 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:3 }),

    // ── LOS ANGELES THIEVES ───────────────────────────────────────────────────
    mkPlayer("HyDra",   "lat", 26, "Slayer SMG",            "Flex",
      { overall:90, potential:87, gunny:83, awareness:90, objective:83, searchIQ:87, clutch:86, teamwork:89, composure:90, adaptability:83 },
      { ego:1, workEthic:5, tiltResistance:5, leadership:5, metaDependence:1 }, "EU"),
    mkPlayer("Scrap",   "lat", 24, "Main AR",         "Entry SMG",
      { overall:92, potential:88, gunny:89, awareness:82, objective:74, searchIQ:83, clutch:87, teamwork:83, composure:83, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),
    mkPlayer("aBeZy",   "lat", 25, "Entry SMG",          "Slayer SMG",
      { overall:90, potential:91, gunny:92, awareness:86, objective:78, searchIQ:86, clutch:91, teamwork:83, composure:87, adaptability:85 },
      { ego:3, workEthic:4, tiltResistance:3, leadership:2, metaDependence:2 }),
    mkPlayer("Nium",    "lat", 22, "Flex",               "Objective",
      { overall:82, potential:88, gunny:79, awareness:83, objective:83, searchIQ:81, clutch:80, teamwork:83, composure:80, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:3 }),

    // ── MIAMI HERETICS ────────────────────────────────────────────────────────
    mkPlayer("SupeR",   "miami", 26, "Search Specialist","Main AR",
      { overall:87, potential:87, gunny:82, awareness:90, objective:79, searchIQ:93, clutch:86, teamwork:86, composure:89, adaptability:82 },
      { ego:2, workEthic:5, tiltResistance:5, leadership:4, metaDependence:1 }, "EU"),
    mkPlayer("RenKoR",  "miami", 23, "Slayer SMG",       "Entry SMG",
      { overall:85, potential:88, gunny:88, awareness:81, objective:73, searchIQ:81, clutch:86, teamwork:80, composure:82, adaptability:82 },
      { ego:3, workEthic:3, tiltResistance:3, leadership:2, metaDependence:3 }, "EU"),
    mkPlayer("Traix",   null, 22, "Entry SMG",        "Flex",
      { overall:83, potential:89, gunny:85, awareness:79, objective:77, searchIQ:77, clutch:81, teamwork:80, composure:77, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }, "EU"),
    mkPlayer("MettalZ", "miami", 23, "Flex",             "Objective",
      { overall:85, potential:88, gunny:82, awareness:84, objective:85, searchIQ:83, clutch:83, teamwork:85, composure:83, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }, "EU"),

    mkPlayer("ReeaL",   "miami", 24, "Main AR", "Search Specialist",
      { overall:82, potential:86, gunny:80, awareness:87, objective:81, searchIQ:88, clutch:83, teamwork:85, composure:86, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }, "EU"),

    // ── OPTIC TEXAS ───────────────────────────────────────────────────────────
    mkPlayer("Dashy",   "optic", 25, "Main AR",       "Entry SMG",
      { overall:92, potential:92, gunny:93, awareness:87, objective:76, searchIQ:87, clutch:92, teamwork:82, composure:88, adaptability:84 },
      { ego:3, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Shotzzy", "optic", 24, "Entry SMG",        "Slayer SMG",
      { overall:92, potential:93, gunny:91, awareness:88, objective:82, searchIQ:89, clutch:92, teamwork:83, composure:88, adaptability:87 },
      { ego:3, workEthic:4, tiltResistance:3, leadership:3, metaDependence:2 }),
    mkPlayer("Huke",    "optic", 25, "Slayer SMG",          "Flex",
      { overall:89, potential:90, gunny:86, awareness:90, objective:83, searchIQ:88, clutch:88, teamwork:86, composure:88, adaptability:85 },
      { ego:2, workEthic:5, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Mercules","optic", 23, "Flex",             "Objective",
      { overall:91, potential:89, gunny:82, awareness:85, objective:85, searchIQ:83, clutch:83, teamwork:85, composure:82, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),

    // ── PARIS GENTLE MATES ────────────────────────────────────────────────────
    // All NA players — the org is based in Paris but the roster is NA
    mkPlayer("Ghosty",  "paris", 23, "Main AR",          "Flex",
      { overall:89, potential:88, gunny:81, awareness:88, objective:82, searchIQ:85, clutch:84, teamwork:85, composure:85, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),        // NA
    mkPlayer("Envoy",   "g2", 24, "Search Specialist","Flex",
      { overall:86, potential:87, gunny:81, awareness:88, objective:78, searchIQ:91, clutch:85, teamwork:84, composure:87, adaptability:81 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),        // NA
    mkPlayer("Sib",     "paris", 22, "Flex",       "Entry SMG",
      { overall:88, potential:89, gunny:87, awareness:79, objective:73, searchIQ:79, clutch:83, teamwork:79, composure:80, adaptability:84 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),        // NA
    mkPlayer("Neptune", null, 21, "Slayer SMG",        "Flex",
      { overall:92, potential:91, gunny:83, awareness:77, objective:76, searchIQ:76, clutch:80, teamwork:79, composure:74, adaptability:86 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),        // NA

    // ── RIYADH FALCONS ────────────────────────────────────────────────────────
    mkPlayer("Exnid",   "riyadh", 23, "Entry SMG",       "Slayer SMG",
      { overall:84, potential:88, gunny:87, awareness:81, objective:76, searchIQ:80, clutch:85, teamwork:81, composure:82, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }, "MENA"),
    mkPlayer("Pred",    null, 24, "Slayer SMG",       "Search Specialist",
      { overall:88, potential:88, gunny:89, awareness:84, objective:75, searchIQ:86, clutch:88, teamwork:82, composure:85, adaptability:82 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),        // NA
    mkPlayer("Cellium", "riyadh", 24, "Main AR",         "Flex",
      { overall:93, potential:96, gunny:93, awareness:95, objective:86, searchIQ:93, clutch:95, teamwork:87, composure:94, adaptability:88 },
      { ego:2, workEthic:5, tiltResistance:5, leadership:5, metaDependence:1 }),        // NA
    mkPlayer("KiSMET",  "riyadh", 23, "Flex",            "Objective",
      { overall:87, potential:89, gunny:83, awareness:86, objective:86, searchIQ:84, clutch:84, teamwork:86, composure:84, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),        // NA

    mkPlayer("Alluka",  "riyadh", 19, "Flex",            "Entry SMG",
      { overall:84, potential:91, gunny:86, awareness:83, objective:84, searchIQ:83, clutch:84, teamwork:85, composure:83, adaptability:89 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }, "EU"),

    // ── TORONTO KOI ───────────────────────────────────────────────────────────
    mkPlayer("CleanX",      "toronto", 23, "Slayer SMG",  "Entry SMG",
      { overall:85, potential:88, gunny:88, awareness:81, objective:73, searchIQ:81, clutch:85, teamwork:81, composure:82, adaptability:82 },
      { ego:3, workEthic:3, tiltResistance:3, leadership:2, metaDependence:3 }, "EU"),
    mkPlayer("JoeDeceives", "paris", 22, "Entry SMG",   "Flex",
      { overall:89, potential:89, gunny:85, awareness:79, objective:77, searchIQ:77, clutch:82, teamwork:80, composure:77, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),        // NA
    mkPlayer("Insight",     "toronto", 21, "Flex",        "Objective",
      { overall:81, potential:90, gunny:78, awareness:82, objective:83, searchIQ:80, clutch:79, teamwork:83, composure:78, adaptability:86 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:3 }, "EU"),

    mkPlayer("Kips",    "toronto", 19, "Flex", "Main AR",
      { overall:76, potential:89, gunny:75, awareness:78, objective:77, searchIQ:78, clutch:75, teamwork:78, composure:76, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }, "EU"),

    // ── VANCOUVER SURGE ───────────────────────────────────────────────────────
    mkPlayer("Gwinn",   null, 23, "Main AR",       "Flex",
      { overall:78, potential:87, gunny:80, awareness:87, objective:81, searchIQ:85, clutch:82, teamwork:86, composure:85, adaptability:82 },
      { ego:1, workEthic:5, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Abe",     "toronto", 22, "Slayer SMG",    "Entry SMG",
      { overall:76, potential:89, gunny:87, awareness:80, objective:74, searchIQ:80, clutch:84, teamwork:80, composure:80, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Lunarz", "vancouver", 21, "Entry SMG",     "Flex",
      { overall:82, potential:90, gunny:84, awareness:77, objective:77, searchIQ:76, clutch:80, teamwork:79, composure:75, adaptability:86 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("TJHaLy",  "boston", 24, "Search Specialist","Main AR",
      { overall:80, potential:86, gunny:79, awareness:87, objective:79, searchIQ:90, clutch:83, teamwork:85, composure:86, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),
  ];
}
