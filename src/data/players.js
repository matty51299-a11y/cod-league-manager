// src/data/players.js
// March 2026 CDL starting rosters.
// Each player has a full stat block used by the match sim and chemistry engine.
// Ratings are 1–99. Hidden traits use a 1–5 scale (stored here as seeds; scouting reveals them).

// Helper to build a player object
function mkPlayer(name, teamId, age, primary, secondary, ratings, hidden) {
  return {
    id: `${teamId}_${name.toLowerCase().replace(/\s/g, "_")}`,
    name,
    teamId,        // current team id (null = free agent)
    age,
    primary,       // primary role
    secondary,     // secondary role
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
  };
}

// Roles used in the sim
// "Entry SMG" | "Slayer SMG" | "Flex" | "Main AR" | "Objective" | "Search Specialist"

export function buildInitialRoster() {
  return [
    // ── BOSTON BREACH ──────────────────────────────────────────────────────────
    mkPlayer("Cammy",   "boston", 23, "Main AR",      "Entry SMG",
      { overall:80, potential:87, gunny:88, awareness:80, objective:72, searchIQ:78, clutch:85, teamwork:82, composure:83, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:2 }),
    mkPlayer("Purj",    "boston", 21, "Entry SMG",       "Flex",
      { overall:74, potential:88, gunny:82, awareness:76, objective:78, searchIQ:74, clutch:77, teamwork:79, composure:75, adaptability:82 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:2 }),
    mkPlayer("Snoopy",  "boston", 22, "Slayer SMG",         "Flex",
      { overall:75, potential:85, gunny:79, awareness:84, objective:80, searchIQ:82, clutch:80, teamwork:85, composure:82, adaptability:79 },
      { ego:1, workEthic:5, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Nastie",  "boston", 20, "Flex",       "Slayer SMG",
      { overall:83, potential:90, gunny:76, awareness:78, objective:85, searchIQ:72, clutch:74, teamwork:80, composure:72, adaptability:84 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),

    // ── CAROLINA ROYAL RAVENS ──────────────────────────────────────────────────
    mkPlayer("Exceed",  "carolina", 23, "Slayer SMG",    "Entry SMG",
      { overall:79, potential:86, gunny:87, awareness:79, objective:70, searchIQ:80, clutch:84, teamwork:78, composure:82, adaptability:78 },
      { ego:3, workEthic:3, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Nero",    "carolina", 24, "Search Specialist","Main AR",
      { overall:78, potential:86, gunny:82, awareness:88, objective:75, searchIQ:91, clutch:86, teamwork:83, composure:87, adaptability:81 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Lurqxx",  "carolina", 22, "Entry SMG",     "Slayer SMG",
      { overall:80, potential:87, gunny:83, awareness:75, objective:74, searchIQ:76, clutch:78, teamwork:77, composure:74, adaptability:83 },
      { ego:3, workEthic:3, tiltResistance:2, leadership:2, metaDependence:3 }),
    mkPlayer("Craze",   "carolina", 21, "Flex",          "Objective",
      { overall:79, potential:89, gunny:77, awareness:80, objective:82, searchIQ:78, clutch:76, teamwork:82, composure:75, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:3 }),

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
    mkPlayer("Okis",    "cloud9", 22, "Objective",       "Search Specialist",
      { overall:74, potential:85, gunny:74, awareness:82, objective:87, searchIQ:83, clutch:78, teamwork:84, composure:80, adaptability:79 },
      { ego:1, workEthic:5, tiltResistance:4, leadership:3, metaDependence:2 }),

    // ── FAZE VEGAS ────────────────────────────────────────────────────────────
    mkPlayer("Simp",    "faze", 24, "Slayer SMG",        "Entry SMG",
      { overall:93, potential:94, gunny:95, awareness:89, objective:78, searchIQ:88, clutch:94, teamwork:84, composure:91, adaptability:85 },
      { ego:3, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),
    mkPlayer("Drazah",  "faze", 23, "Main AR",         "Slayer SMG",
      { overall:88, potential:91, gunny:90, awareness:83, objective:78, searchIQ:84, clutch:87, teamwork:82, composure:84, adaptability:84 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),
    mkPlayer("04",      "faze", 22, "Entry SMG",              "Main AR",
      { overall:85, potential:90, gunny:83, awareness:86, objective:83, searchIQ:85, clutch:83, teamwork:84, composure:83, adaptability:87 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:2 }),
    mkPlayer("Abuzah",  "faze", 23, "Flex",           "Flex",
      { overall:84, potential:87, gunny:80, awareness:87, objective:81, searchIQ:84, clutch:82, teamwork:86, composure:85, adaptability:82 },
      { ego:1, workEthic:5, tiltResistance:4, leadership:4, metaDependence:2 }),

    // ── G2 MINNESOTA ─────────────────────────────────────────────────────────
    mkPlayer("Estreal", "g2", 23, "Slayer SMG",          "Entry SMG",
      { overall:86, potential:89, gunny:89, awareness:82, objective:74, searchIQ:82, clutch:87, teamwork:82, composure:84, adaptability:82 },
      { ego:3, workEthic:3, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Skyz",    "g2", 22, "Entry SMG",           "Flex",
      { overall:84, potential:89, gunny:86, awareness:80, objective:76, searchIQ:78, clutch:83, teamwork:80, composure:79, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Kremp",   "g2", 24, "Search Specialist",   "Main AR",
      { overall:85, potential:86, gunny:80, awareness:87, objective:78, searchIQ:90, clutch:84, teamwork:84, composure:86, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Mamba",   "g2", 21, "Flex",                "Objective",
      { overall:84, potential:91, gunny:80, awareness:82, objective:84, searchIQ:80, clutch:80, teamwork:83, composure:78, adaptability:87 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:3 }),

    // ── LOS ANGELES THIEVES ───────────────────────────────────────────────────
    mkPlayer("HyDra",   "lat", 26, "Slayer SMG",            "Flex",
      { overall:90, potential:87, gunny:83, awareness:90, objective:83, searchIQ:87, clutch:86, teamwork:89, composure:90, adaptability:83 },
      { ego:1, workEthic:5, tiltResistance:5, leadership:5, metaDependence:1 }),
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
      { ego:2, workEthic:5, tiltResistance:5, leadership:4, metaDependence:1 }),
    mkPlayer("RenKoR",  "miami", 23, "Slayer SMG",       "Entry SMG",
      { overall:85, potential:88, gunny:88, awareness:81, objective:73, searchIQ:81, clutch:86, teamwork:80, composure:82, adaptability:82 },
      { ego:3, workEthic:3, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Traix",   "miami", 22, "Entry SMG",        "Flex",
      { overall:83, potential:89, gunny:85, awareness:79, objective:77, searchIQ:77, clutch:81, teamwork:80, composure:77, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("MettalZ", "miami", 23, "Flex",             "Objective",
      { overall:85, potential:88, gunny:82, awareness:84, objective:85, searchIQ:83, clutch:83, teamwork:85, composure:83, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),

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
    mkPlayer("Ghosty",  "paris", 23, "Main AR",          "Flex",
      { overall:89, potential:88, gunny:81, awareness:88, objective:82, searchIQ:85, clutch:84, teamwork:85, composure:85, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Envoy",   "paris", 24, "Search Specialist","Flex",
      { overall:86, potential:87, gunny:81, awareness:88, objective:78, searchIQ:91, clutch:85, teamwork:84, composure:87, adaptability:81 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),
    mkPlayer("Sib",     "paris", 22, "Flex",       "Entry SMG",
      { overall:88, potential:89, gunny:87, awareness:79, objective:73, searchIQ:79, clutch:83, teamwork:79, composure:80, adaptability:84 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Neptune", "paris", 21, "Slayer SMG",        "Flex",
      { overall:92, potential:91, gunny:83, awareness:77, objective:76, searchIQ:76, clutch:80, teamwork:79, composure:74, adaptability:86 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),

    // ── RIYADH FALCONS ────────────────────────────────────────────────────────
    mkPlayer("Exnid",   "riyadh", 23, "Entry SMG",       "Slayer SMG",
      { overall:84, potential:88, gunny:87, awareness:81, objective:76, searchIQ:80, clutch:85, teamwork:81, composure:82, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Pred",    "riyadh", 24, "Slayer SMG",       "Search Specialist",
      { overall:88, potential:88, gunny:89, awareness:84, objective:75, searchIQ:86, clutch:88, teamwork:82, composure:85, adaptability:82 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),
    mkPlayer("Cellium", "riyadh", 24, "Main AR",         "Flex",
      { overall:93, potential:96, gunny:93, awareness:95, objective:86, searchIQ:93, clutch:95, teamwork:87, composure:94, adaptability:88 },
      { ego:2, workEthic:5, tiltResistance:5, leadership:5, metaDependence:1 }),
    mkPlayer("KiSMET",  "riyadh", 23, "Flex",            "Objective",
      { overall:87, potential:89, gunny:83, awareness:86, objective:86, searchIQ:84, clutch:84, teamwork:86, composure:84, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:3, metaDependence:2 }),

    // ── TORONTO KOI ───────────────────────────────────────────────────────────
    mkPlayer("CleanX",      "toronto", 23, "Slayer SMG",  "Entry SMG",
      { overall:85, potential:88, gunny:88, awareness:81, objective:73, searchIQ:81, clutch:85, teamwork:81, composure:82, adaptability:82 },
      { ego:3, workEthic:3, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("JoeDeceives", "toronto", 22, "Entry SMG",   "Flex",
      { overall:89, potential:89, gunny:85, awareness:79, objective:77, searchIQ:77, clutch:82, teamwork:80, composure:77, adaptability:85 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("ReeaL",       "toronto", 24, "Main AR",     "Search Specialist",
      { overall:82, potential:86, gunny:80, awareness:87, objective:81, searchIQ:88, clutch:83, teamwork:85, composure:86, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Insight",     "toronto", 21, "Flex",        "Objective",
      { overall:81, potential:90, gunny:78, awareness:82, objective:83, searchIQ:80, clutch:79, teamwork:83, composure:78, adaptability:86 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:3, metaDependence:3 }),

    // ── VANCOUVER SURGE ───────────────────────────────────────────────────────
    mkPlayer("Gwinn",   "vancouver", 23, "Main AR",       "Flex",
      { overall:78, potential:87, gunny:80, awareness:87, objective:81, searchIQ:85, clutch:82, teamwork:86, composure:85, adaptability:82 },
      { ego:1, workEthic:5, tiltResistance:4, leadership:4, metaDependence:2 }),
    mkPlayer("Abe",     "vancouver", 22, "Slayer SMG",    "Entry SMG",
      { overall:76, potential:89, gunny:87, awareness:80, objective:74, searchIQ:80, clutch:84, teamwork:80, composure:80, adaptability:83 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("Lunarz",  "vancouver", 21, "Entry SMG",     "Flex",
      { overall:82, potential:90, gunny:84, awareness:77, objective:77, searchIQ:76, clutch:80, teamwork:79, composure:75, adaptability:86 },
      { ego:2, workEthic:4, tiltResistance:3, leadership:2, metaDependence:3 }),
    mkPlayer("TJHaLy",  "vancouver", 24, "Search Specialist","Main AR",
      { overall:80, potential:86, gunny:79, awareness:87, objective:79, searchIQ:90, clutch:83, teamwork:85, composure:86, adaptability:80 },
      { ego:2, workEthic:4, tiltResistance:4, leadership:4, metaDependence:2 }),
  ];
}
