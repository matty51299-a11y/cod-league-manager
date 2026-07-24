import assert from "node:assert/strict";
import { buildInitialRoster } from "../src/data/players.js";
import { generateProspects } from "../src/data/prospects.js";
import { applyChallengerRatingOverride } from "../src/data/challengerRatingOverrides.js";
import { buildSeason, ensureChallengerTeams } from "../src/engine/seasonEngine.js";
import { createHistoricalCareer } from "../src/engine/historicalDynasty.js";
import { buildContractDemand, evaluateModernCdlPlayerOffer } from "../src/engine/contractNegotiation.js";

const check = (name, condition, detail = "") => {
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`✓ ${name}`);
};

const makeModernState = () => {
  const state = {
    userTeamId: "atl", userTeamType: "cdl", season: 1,
    players: buildInitialRoster().map(applyChallengerRatingOverride),
    prospects: generateProspects(90210).map(applyChallengerRatingOverride),
    schedule: buildSeason(1), notifications: [], playerSeasonStats: {}, contractNegotiations: {},
  };
  ensureChallengerTeams(state);
  return state;
};
let modern = makeModernState();
check("Modern CDL mode starts", modern.userTeamType === "cdl");
const player = modern.prospects.find(p => !p.teamId);
check("Modern CDL Challengers pool has an approachable player", !!player);

const demand = buildContractDemand(player, modern, { type: "signing", teamId: modern.userTeamId, asSub: true });
check("Salary demand is published", demand.salary >= 15000, `demand=${demand.salary}`);
check("Offer helper exposes role and term", !!demand.wantedRole && demand.years >= 1);

const lowOffer = { salary: 15000, years: 1, rolePromise: "Sub", starterStatus: "sub" };
const rejected = evaluateModernCdlPlayerOffer(modern, player.id, lowOffer);
check("Low offer is rejected", !rejected.accepted);
check("Low offer rejection is actionable", /Increase salary|Offer a starting|Offer a [1-4]-year|Match the expected|Make a stronger/.test(rejected.requiredAction || ""), rejected.requiredAction);
check("Rejection includes salary details", rejected.details.expectedSalary >= rejected.details.offeredSalary);

const highOffer = { salary: Math.max(demand.salary * 2, 500000), years: demand.years, rolePromise: demand.wantedRole, starterStatus: demand.wantedRole === "Star Player" || demand.wantedRole === "Starter" ? "starter" : "sub", developmentPromise: demand.wantedRole === "Prospect" };
const accepted = evaluateModernCdlPlayerOffer(modern, player.id, highOffer);
check("Higher offer can be accepted", accepted.accepted, JSON.stringify(accepted));

// Use a bench role to avoid an intentionally full starter cap being mistaken for
// an interest rejection.  This also validates the roster/pool mutation path.
const beforeRoster = modern.players.filter(p => p.teamId === modern.userTeamId).length;
modern = {
  ...modern,
  players: [...modern.players, { ...player, teamId: modern.userTeamId, isSub: highOffer.starterStatus === "sub", salary: highOffer.salary, contractYears: highOffer.years }],
  prospects: modern.prospects.filter(p => p.id !== player.id),
};
check("Accepted player joins the correct Modern CDL roster", modern.players.some(p => p.id === player.id && p.teamId === modern.userTeamId));
check("Accepted Challenger leaves available pool", !modern.prospects.some(p => p.id === player.id));
check("Roster count updates once", modern.players.filter(p => p.teamId === modern.userTeamId).length === beforeRoster + 1);
check("No duplicate player is created", modern.players.filter(p => p.id === player.id).length === 1);
check("Offer salary is persisted", modern.players.find(p => p.id === player.id)?.salary === highOffer.salary);

const historical = createHistoricalCareer("ghosts", { userTeamId: "optic-gaming" });
check("Cod Dynasty still starts separately", !!historical?.players?.length);
check("Cod Dynasty has no Modern CDL Challenger pool", !(historical.prospects || []).length);
console.log("Modern CDL signing diagnostics passed.");
