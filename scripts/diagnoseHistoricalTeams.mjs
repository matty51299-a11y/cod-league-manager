// Historical Dynasty — era teams & starting rosters diagnostic.
// Verifies that a historical dynasty re-skins the 12 stable team slots to the
// real organisations of the era and seeds an era-appropriate starting roster,
// while modern careers keep the 2026 CDL franchises.
//
// Run: node --import ./scripts/register-assets.mjs scripts/diagnoseHistoricalTeams.mjs

import { CDL_TEAMS, resetTeamBranding } from "../src/data/teams.js";
import { applyEraTeamBranding, buildHistoricalStartingRoster } from "../src/data/historicalTeams.js";
import { migrateHistoricalDynastyState } from "../src/engine/historicalDynasty.js";

let fail = 0;
const ok = (l, c, d = "") => { console.log((c ? "✅" : "❌") + " " + l + (d ? " — " + d : "")); if (!c) fail++; };
const teamName = (id) => CDL_TEAMS.find(t => t.id === id).name;

resetTeamBranding();
ok("Default branding is the modern CDL franchise", teamName("optic") === "OpTic Texas", teamName("optic"));

applyEraTeamBranding("ghosts", "historical");
const optic = CDL_TEAMS.find(t => t.id === "optic");
ok("Ghosts era re-skins optic slot to OpTic Gaming", optic.name === "OpTic Gaming" && optic.tag === "OG", optic.name + "/" + optic.tag);
ok("Ghosts era re-skins faze slot to Rise Nation", teamName("faze") === "Rise Nation");
ok("Historical brands drop the modern logo (fallback tag)", optic.logo === null);

applyEraTeamBranding("black_ops_3", "historical");
ok("CWL era shows eUnited on cloud9 slot", teamName("cloud9") === "eUnited", teamName("cloud9"));
ok("optic keeps its OpTic lineage in the CWL era", teamName("optic") === "OpTic Gaming");

applyEraTeamBranding("modern_warfare_2019", "historical");
ok("CDL era returns to franchise brands", teamName("optic") === "OpTic Texas", teamName("optic"));

applyEraTeamBranding("ghosts", "modern");
ok("Modern career ignores era branding", teamName("optic") === "OpTic Texas");

const roster = buildHistoricalStartingRoster("ghosts");
ok("Ghosts roster has 48 players across 12 teams", roster.length === 48 && new Set(roster.map(p => p.teamId)).size === 12, roster.length + "");
ok("Ghosts roster is recognisable era players (Scump on OpTic slot)", roster.some(p => p.name === "Scump" && p.teamId === "optic"));
ok("Roster display names are unique", new Set(roster.map(p => p.name)).size === roster.length);
ok("Roster ids are unique", new Set(roster.map(p => p.id)).size === roster.length);
ok("Players have full stat blocks tagged historical", roster.every(p => Number.isFinite(p.overall) && Number.isFinite(p.gunny) && Number.isFinite(p.searchIQ) && p.dataStatus === "historical"));
ok("No modern-roster stars leak into Ghosts (no Cellium/Simp/Shotzzy)", !roster.some(p => ["Cellium", "Simp", "Shotzzy"].includes(p.name)));
ok("Modern era has no curated roster (falls back to default)", buildHistoricalStartingRoster("modern_2026") === null);

resetTeamBranding();
migrateHistoricalDynastyState({ careerMode: "historical", currentEraId: "ghosts", season: 1 });
ok("migrate() applies era branding from state", teamName("optic") === "OpTic Gaming");
migrateHistoricalDynastyState({ careerMode: "modern", season: 1 });
ok("migrate() resets branding for modern saves", teamName("optic") === "OpTic Texas");

if (fail) { console.error(`\nHistorical teams diagnostic FAILED: ${fail}`); process.exit(1); }
console.log("\nHistorical teams diagnostic passed.");
