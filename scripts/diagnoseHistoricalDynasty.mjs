import { buildInitialRoster } from "../src/data/players.js";
import { generateProspects } from "../src/data/prospects.js";
import { buildSeason } from "../src/engine/seasonEngine.js";
import { getEra } from "../src/data/codEras.js";
import { createHistoricalStateFields, advanceHistoricalEraIfNeeded, migrateHistoricalDynastyState, introduceHistoricalRookieClass } from "../src/engine/historicalDynasty.js";

let failures = 0;
function check(label, ok, detail = "") { console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; }
function newState(careerMode = "modern") { return { userTeamId: "lat", userTeamType: "cdl", season: 1, players: buildInitialRoster(), prospects: generateProspects(1234).slice(0, 30), schedule: buildSeason(1), ...createHistoricalStateFields(careerMode) }; }

const modern = newState("modern");
check("Modern mode starts normally", modern?.careerMode === "modern" && modern?.currentEraId === "modern_2026", `${modern?.careerMode}/${modern?.currentEraId}`);

let hist = introduceHistoricalRookieClass(newState("historical"), "ghosts");
check("Historical mode starts in Ghosts", hist?.careerMode === "historical" && hist?.currentEraId === "ghosts", hist?.currentEraId);
check("Current game title is Call of Duty: Ghosts", hist?.currentGameTitle === "Call of Duty: Ghosts", hist?.currentGameTitle);
const ghosts = getEra("ghosts");
check("Ghosts map/mode data is available", ghosts?.modes?.includes("Blitz") && ghosts?.mapPool?.Hardpoint?.includes("Freight"));

// advanceHistoricalEraIfNeeded is called when the NEW season has been built, so
// it takes the incremented season number (index 0 = season 1 = Ghosts).
const aw = advanceHistoricalEraIfNeeded({ ...hist, season: 2, schedule: { ...(hist.schedule || {}), season: 2 } });
check("End of season advances to Advanced Warfare", aw.currentEraId === "advanced_warfare", aw.currentEraId);
check("Era transition is recorded", aw.eraHistory?.length === 1 && aw.pendingEraTransition?.newEraId === "advanced_warfare");
const awCount = (aw.prospects || []).filter(p => p.debutEraId === "advanced_warfare").length;
// Rookies whose names already exist in the base roster are de-duplicated, so the
// count is data-dependent; the invariant is that the class is introduced at all.
check("Advanced Warfare rookie class is introduced", awCount >= 1, `${awCount} AW prospects`);
const reloaded = introduceHistoricalRookieClass(migrateHistoricalDynastyState(JSON.parse(JSON.stringify(aw))), "advanced_warfare");
const awCountReload = (reloaded.prospects || []).filter(p => p.debutEraId === "advanced_warfare").length;
check("Reloading/hydrating does not duplicate rookie class", awCountReload === awCount, `${awCountReload} after reload`);
// Idempotency: re-running the advance for the SAME season must not advance again.
const awAgain = advanceHistoricalEraIfNeeded({ ...reloaded, pendingEraTransition: null });
check("Re-advancing the same season is a no-op (no double transition)", awAgain.currentEraId === "advanced_warfare", awAgain.currentEraId);
const bo3 = advanceHistoricalEraIfNeeded({ ...reloaded, season: 3, schedule: { season: 3 }, pendingEraTransition: null });
check("Advancing to the next season moves to Black Ops 3", bo3.currentEraId === "black_ops_3", bo3.currentEraId);
const old = migrateHistoricalDynastyState({ season: 4, players: [], prospects: [], schedule: { season: 4 } });
check("Existing modern saves hydrate as modern_2026", old.careerMode === "modern" && old.currentEraId === "modern_2026", `${old.careerMode}/${old.currentEraId}`);
check("Current full-season flow compatibility smoke", !!modern.schedule?.stages?.length && !!modern.players?.length && Array.isArray(modern.prospects));

// ── Full historical timeline reaches Black Ops 6, then generates the future ──
let walk = introduceHistoricalRookieClass(newState("historical"), "ghosts");
const expectedChain = ["advanced_warfare", "black_ops_3", "infinite_warfare", "wwii", "black_ops_4", "modern_warfare_2019", "black_ops_cold_war", "vanguard", "modern_warfare_2", "modern_warfare_3", "black_ops_6"];
let chainOk = true;
for (let i = 0; i < expectedChain.length; i++) {
  walk = advanceHistoricalEraIfNeeded({ ...walk, season: i + 2, schedule: { season: i + 2 } });
  if (walk.currentEraId !== expectedChain[i]) { chainOk = false; break; }
}
check("Historical chain runs Ghosts → Black Ops 6", chainOk && walk.currentEraId === "black_ops_6", walk.currentEraId);
check("Reached the last verified historical season", getEra(walk.currentEraId)?.dataStatus === "historical");

// One more advance past BO6 generates a fictional future season.
const future = advanceHistoricalEraIfNeeded({ ...walk, season: expectedChain.length + 2, schedule: { season: expectedChain.length + 2 } });
const futureEra = getEra(future.currentEraId);
check("Past BO6 a fictional future season is generated", futureEra?.dataStatus === "fictional", future.currentEraId);
check("Generated era is stored in the save", (future.generatedEras || []).length === 1);
check("Future season introduces a procedurally generated rookie class", (future.prospects || []).some(p => p.dataStatus === "fictional"));

// Determinism: same seed + season index → same generated era.
const futureB = advanceHistoricalEraIfNeeded({ ...walk, season: expectedChain.length + 2, schedule: { season: expectedChain.length + 2 } });
check("Future generation is deterministic for a fixed seed", futureB.currentEraId === future.currentEraId, `${future.currentEraId} vs ${futureB.currentEraId}`);

// Roster-size transitions are flagged on the transition payload.
const bo4Transition = walkTo(newState("historical"), 5).pendingEraTransition; // season 6 = Black Ops 4
check("Black Ops 4 transition reports a 4 → 5 roster expansion", bo4Transition?.newRosterSize === 5 && bo4Transition?.rosterSizeChange === 1, `${bo4Transition?.previousRosterSize}→${bo4Transition?.newRosterSize}`);
const cwTransition = walkTo(newState("historical"), 7).pendingEraTransition; // season 8 = Cold War
check("Cold War transition reports a 5 → 4 roster reduction", cwTransition?.newRosterSize === 4 && cwTransition?.rosterSizeChange === -1, `${cwTransition?.previousRosterSize}→${cwTransition?.newRosterSize}`);

function walkTo(state, advances) {
  let s = introduceHistoricalRookieClass(state, "ghosts");
  for (let i = 0; i < advances; i++) s = advanceHistoricalEraIfNeeded({ ...s, season: i + 2, schedule: { season: i + 2 } });
  return s;
}

if (failures) { console.error(`\nHistorical Dynasty diagnostic failed: ${failures}`); process.exit(1); }
console.log("\nHistorical Dynasty diagnostic passed.");
