import assert from "node:assert/strict";
import { buildInitialRoster } from "../src/data/players.js";
import { CDL_TEAMS, resetTeamBranding } from "../src/data/teams.js";
import { generateProspects, syncModernCdlChallengers } from "../src/data/prospects.js";
import { buildSeason } from "../src/engine/seasonEngine.js";
import { createHistoricalCareer } from "../src/engine/historicalDynasty.js";
import { normalizePlayerName } from "../src/utils/playerIdentity.js";

const expected = {
  faze: ["Simp", "Drazah", "O4", "Abuzah"], optic: ["Shotzzy", "Dashy", "Huke", "Mercules"],
  riyadh: ["Exnid", "Cellium", "KiSMET", "Alluka"], paris: ["Ghosty", "Sib", "Estreal", "JoeDeceives"],
  miami: ["MettalZ", "RenKoR", "SupeR", "ReeaL"], g2: ["Kremp", "Skyz", "Envoy", "Nastie"],
  toronto: ["CleanX", "Insight", "Kips", "Abe"], lat: ["Scrap", "HyDra", "aBeZy", "Nium"],
  boston: ["Purj", "Spart", "Afro", "TJHaLy"], carolina: ["Lurqxx", "Exceed", "Fire", "Standy"],
  cloud9: ["Encourage", "Hide", "Nejra", "Wevy"], vancouver: ["Lunarz", "Nero", "Craze", "Mamba"],
};
const check = (label, value) => { assert.ok(value, label); console.log(`✓ ${label}`); };
resetTeamBranding();
const players = buildInitialRoster();
check("Modern CDL mode starts", !!buildSeason(1));
check("All 12 Modern CDL teams exist", CDL_TEAMS.length === 12 && Object.keys(expected).every(id => CDL_TEAMS.some(t => t.id === id)));
const active = players.filter(p => p.teamId);
for (const [teamId, names] of Object.entries(expected)) {
  const roster = active.filter(p => p.teamId === teamId && !p.isSub);
  check(`${teamId} has exactly four active starters`, roster.length === 4);
  check(`${teamId} roster matches`, [...roster.map(p => p.name)].sort().join("|") === [...names].sort().join("|"));
}
const wevy = players.find(p => normalizePlayerName(p.name) === "wevy");
check("Wevy is an active Cloud9 player with 76 OVR and 90 POT", wevy?.teamId === "cloud9" && wevy.overall === 76 && wevy.potential === 90);
const alluka = players.find(p => normalizePlayerName(p.name) === "alluka");
check("Alluka is an active RYD Falcons player with 84 OVR, 91 POT, and age 19", alluka?.teamId === "riyadh" && alluka.overall === 84 && alluka.potential === 91 && alluka.age === 19);
for (const name of ["Pred", "Neptune"]) check(`${name} is a free agent, not an active CDL player`, players.some(p => p.name === name && p.teamId === null));
const prospectNames = new Set(syncModernCdlChallengers(generateProspects(90210), players, normalizePlayerName).map(p => normalizePlayerName(p.name)));
check("No active CDL player is in the Challengers pool", active.every(p => !prospectNames.has(normalizePlayerName(p.name))));
check("No active player appears on two CDL teams", new Set(active.map(p => p.id)).size === active.length);
check("No coaches are in active rosters", active.length === 48);
const historical = createHistoricalCareer("ghosts", { userTeamId: "optic-gaming" });
check("Historical Dynasty mode still starts", historical?.players?.length > 0);
console.log("Modern CDL roster diagnostics passed.");
