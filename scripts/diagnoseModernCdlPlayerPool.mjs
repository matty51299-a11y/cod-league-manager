import assert from "node:assert/strict";
import { buildInitialRoster } from "../src/data/players.js";
import { generateProspects, syncModernCdlChallengers } from "../src/data/prospects.js";
import { normalizePlayerName } from "../src/utils/playerIdentity.js";
const check = (label, value) => { assert.ok(value, label); console.log(`✓ ${label}`); };
const players = buildInitialRoster();
const active = players.filter(p => p.teamId);
const pool = syncModernCdlChallengers(generateProspects(90210), players, normalizePlayerName);
const poolNames = new Set(pool.map(p => normalizePlayerName(p.name)));
check("Rostered players are removed from the seeded Challengers pool", active.every(p => !poolNames.has(normalizePlayerName(p.name))));
for (const name of ["Pred", "Neptune"]) check(`${name} is in Modern free agency`, players.some(p => p.name === name && p.teamId === null));
const all = [...players, ...pool];
const names = all.map(p => normalizePlayerName(p.name));
check("No duplicate player identities exist across active roster and pool", names.length === new Set(names).size);
for (const [name, teamId] of [["Pred", null], ["Neptune", null], ["Wevy", "cloud9"], ["Mercules", "optic"], ["O4", "faze"], ["Abuzah", "faze"]]) {
  check(`Player Search resolves ${name} to the correct location`, players.some(p => p.name === name && p.teamId === teamId));
}
console.log("Modern CDL player-pool diagnostics passed.");
