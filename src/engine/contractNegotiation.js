import { CDL_TEAMS } from "../data/teams.js";
import { getMorale } from "./moraleEngine.js";
import { getResignDemand, getSigningCost, getTeamBudgetTier } from "./rosterAI.js";

export const CONTRACT_ROLES = ["Star Player", "Starter", "Rotation", "Sub", "Prospect"];
export const CONTRACT_MEMORY = {
  LOWBALL: "rejected_lowball", STALLED: "talks_stalled", MARKET: "waiting_for_market",
  ROLE: "wants_role_clarity", CONTENDER: "wants_contender", HAPPY: "happy_with_offer", OFFENDED: "offended_by_low_offers",
};

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = s => String(s || "").split("").reduce((a, c) => ((a * 31) + c.charCodeAt(0)) | 0, 7);
export const fmtSalary = n => `$${Math.round((n || 0) / 1000)}k`;

export function migrateContractState(state = {}) {
  return { ...state, contractNegotiations: state.contractNegotiations || {} };
}

function currentKd(player, state) {
  const season = state?.offseason?.outgoingSeason ?? state?.season;
  const rows = (state?.playerSeasonStats?.[player?.id] || []).filter(r => Number(r.season) === Number(season) && (r.matches || 0) > 0);
  const k = rows.reduce((s, r) => s + (r.kills || 0), 0), d = rows.reduce((s, r) => s + (r.deaths || 0), 0);
  return d > 0 ? k / d : 1;
}

export function getContractMemory(state, playerId) {
  return state?.contractNegotiations?.[playerId] || { attempts: 0, lowballs: 0, flags: [], lastOffer: null };
}

export function estimateCompetingInterest(player, state, teamId = state?.userTeamId) {
  const ovr = player?.overall ?? 70, pot = player?.potential ?? 75, age = player?.age ?? 23;
  let score = (ovr - 72) * 3 + (pot - 78) * 1.4 + (age <= 22 ? 10 : age >= 29 ? -10 : 0);
  if ((player?.contractYears ?? 0) <= 1 || !player?.teamId) score += 10;
  if (currentKd(player, state) >= 1.2) score += 8;
  const seed = Math.abs(hash(`${state?.season}:${player?.id}:interest`)) % 18;
  score += seed - 6;
  const level = score >= 55 ? "Heavy" : score >= 35 ? "Medium" : score >= 18 ? "Light" : "None";
  const teams = CDL_TEAMS.filter(t => t.id !== teamId).sort((a, b) => (b.budgetTier || 3) - (a.budgetTier || 3)).slice(0, level === "Heavy" ? 3 : level === "Medium" ? 2 : level === "Light" ? 1 : 0);
  return { level, teams, score: clamp(score, 0, 85), label: teams.length ? teams.map(t => t.tag).join(", ") : "None" };
}

export function buildContractDemand(player, state, opts = {}) {
  const signing = opts.type === "signing" || !player?.teamId;
  const desiredYears = (player?.age ?? 23) >= 29 ? 1 : (player?.potential ?? 75) >= 88 && (player?.age ?? 23) <= 23 ? 3 : 2;
  const base = signing ? getSigningCost(player) : getResignDemand(player, desiredYears, state?.playerSeasonStats, state?.offseason?.outgoingSeason ?? state?.season);
  const morale = getMorale(state, player?.id);
  const interest = estimateCompetingInterest(player, state, opts.teamId || state?.userTeamId);
  const memory = getContractMemory(state, player?.id);
  const tier = getTeamBudgetTier(opts.teamId || state?.userTeamId);
  const kd = currentKd(player, state);
  let mult = 1;
  if ((player?.overall ?? 70) >= 90) mult += 0.16;
  if ((player?.potential ?? 70) >= 90) mult += 0.08;
  if (kd >= 1.25) mult += 0.08; else if (kd < 0.85) mult -= 0.06;
  if ((morale?.level ?? 65) >= 78) mult -= 0.08; else if ((morale?.level ?? 65) < 45) mult += 0.12;
  if (interest.level === "Heavy") mult += 0.18; else if (interest.level === "Medium") mult += 0.10; else if (interest.level === "Light") mult += 0.05;
  if (memory.flags?.includes(CONTRACT_MEMORY.OFFENDED)) mult += 0.18; else if (memory.flags?.includes(CONTRACT_MEMORY.LOWBALL)) mult += 0.08;
  if ((player?.transferMemory?.blockedMoves || 0) > 0 || memory.flags?.includes(CONTRACT_MEMORY.CONTENDER)) mult += 0.10;
  if (tier >= 5) mult += 0.04; else if (tier <= 2) mult -= 0.03;
  const demand = Math.max(15000, Math.round((base * mult) / 5000) * 5000);
  const wantedRole = (player?.overall ?? 70) >= 88 ? "Star Player" : (player?.overall ?? 70) >= 80 ? "Starter" : (player?.potential ?? 70) >= 86 && (player?.age ?? 23) <= 22 ? "Prospect" : opts.asSub ? "Sub" : "Rotation";
  const difficulty = interest.level === "Heavy" || (morale?.level ?? 65) < 45 ? "Hard" : interest.level === "Medium" || (player?.overall ?? 70) >= 85 ? "Medium" : "Easy";
  const stance = (morale?.level ?? 65) >= 75 ? "Happy/loyal" : (morale?.level ?? 65) < 45 ? "Unhappy" : "Open";
  return { salary: demand, years: desiredYears, wantedRole, signingBonus: Math.round(demand * (interest.level === "Heavy" ? 0.18 : 0.1) / 5000) * 5000, moraleStance: stance, interest, difficulty, message: `${player?.name}'s camp wants ${fmtSalary(demand)}, ${desiredYears} year${desiredYears === 1 ? "" : "s"}, and a ${wantedRole} path.`, kd };
}

export function evaluateContractOffer(player, state, offer = {}, opts = {}) {
  const demand = buildContractDemand(player, state, opts);
  const salary = Number(offer.salary || 0), years = Number(offer.years || 2);
  let chance = 50 + ((salary - demand.salary) / Math.max(1, demand.salary)) * 90;
  if (offer.rolePromise === demand.wantedRole) chance += 12;
  if (offer.starterStatus === "starter" && ["Star Player", "Starter"].includes(demand.wantedRole)) chance += 12;
  if (offer.developmentPromise && demand.wantedRole === "Prospect") chance += 10;
  if (offer.transferReviewPromise) chance += 6;
  chance -= Math.abs(years - demand.years) * 8;
  if (demand.interest.level === "Heavy") chance -= 15; else if (demand.interest.level === "Medium") chance -= 8;
  const morale = getMorale(state, player?.id)?.level ?? 65;
  if (morale >= 78) chance += 10; else if (morale < 40) chance -= 22;
  const mem = getContractMemory(state, player?.id);
  if (mem.flags?.includes(CONTRACT_MEMORY.OFFENDED)) chance -= 18;
  chance = clamp(Math.round(chance), 3, 97);
  let outcome = chance >= 65 ? "accept" : "reject";
  let reason = "happy_with_offer";
  if (outcome !== "accept") {
    if (salary < demand.salary * 0.78) reason = "lowball";
    else if (morale < 40) reason = "low_morale";
    else if (demand.interest.level === "Heavy") reason = "stronger_interest";
    else if (years < demand.years) reason = "longer_term";
    else if (years > demand.years) reason = "shorter_term";
    else if (["Star Player", "Starter"].includes(demand.wantedRole) && offer.starterStatus !== "starter") reason = "starter_promise";
    else reason = chance < 35 ? "wait_market" : "more_salary";
  }
  return { outcome, reason, chance, demand, message: responseMessage(player, outcome, reason, demand) };
}

function responseMessage(player, outcome, reason, demand) {
  if (outcome === "accept") return `${player.name} accepts and is encouraged by the role clarity.`;
  return ({ lowball: `${player.name}'s agent calls the offer well below expectations.`, low_morale: `${player.name} is not ready to commit while morale is low.`, stronger_interest: `${player.name} wants to wait because stronger teams are interested.`, longer_term: `${player.name}'s camp asks for a longer commitment.`, shorter_term: `${player.name}'s camp prefers a shorter deal.`, starter_promise: `${player.name} wants a clear starter promise.`, wait_market: `${player.name} wants to test free agency.`, more_salary: `${player.name}'s agent asks for more salary.`, }[reason] || demand.message);
}
