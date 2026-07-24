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
  const raw = state.contractNegotiations || {};
  const migrated = {};
  for (const [playerId, mem] of Object.entries(raw)) {
    migrated[playerId] = {
      attempts: mem?.attempts || 0,
      lowballs: mem?.lowballs || 0,
      rejectedOffers: mem?.rejectedOffers || 0,
      stalledTalks: mem?.stalledTalks || 0,
      flags: Array.isArray(mem?.flags) ? mem.flags : [],
      lastOffer: mem?.lastOffer || null,
      lastOutcome: mem?.lastOutcome || null,
      pendingOffer: mem?.pendingOffer || null,
      responseDueDay: mem?.responseDueDay ?? null,
      talksStatus: mem?.talksStatus || (mem?.pendingOffer ? "Offer pending" : "Not approached"),
      acceptedPromises: Array.isArray(mem?.acceptedPromises) ? mem.acceptedPromises : [],
      wantsToTestMarket: !!mem?.wantsToTestMarket,
      waitingForRivalInterest: !!mem?.waitingForRivalInterest,
    };
  }
  return { ...state, contractNegotiations: migrated, calendar: state.calendar || buildOffseasonCalendar(state) };
}

export function buildOffseasonCalendar(state = {}) {
  const base = Number(state?.season || state?.schedule?.season || 1);
  const day = Number(state?.calendar?.day ?? 0);
  return { day, label: `Offseason ${base} Day ${day + 1}`, freeAgencyOpenDay: 5, rosterDeadlineDay: 12, seasonStartDay: 15 };
}

function currentKd(player, state) {
  const season = state?.offseason?.outgoingSeason ?? state?.season;
  const rows = (state?.playerSeasonStats?.[player?.id] || []).filter(r => Number(r.season) === Number(season) && (r.matches || 0) > 0);
  const k = rows.reduce((s, r) => s + (r.kills || 0), 0), d = rows.reduce((s, r) => s + (r.deaths || 0), 0);
  return d > 0 ? k / d : 1;
}

export function getContractMemory(state, playerId) {
  return state?.contractNegotiations?.[playerId] || { attempts: 0, lowballs: 0, rejectedOffers: 0, stalledTalks: 0, flags: [], lastOffer: null, pendingOffer: null, responseDueDay: null, talksStatus: "Not approached", acceptedPromises: [], wantsToTestMarket: false, waitingForRivalInterest: false };
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
  return { salary: demand, years: desiredYears, wantedRole, signingBonus: Math.round(demand * (interest.level === "Heavy" ? 0.18 : 0.1) / 5000) * 5000, moraleStance: stance, interest, difficulty, message: qualitativeDemandMessage(player, { moraleStance: stance, interest, wantedRole, difficulty }), kd };
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
  return { outcome, reason, chance, demand, message: responseMessage(player, outcome, reason, demand), qualitative: qualitativeOfferFeedback(player, { offer, demand, chance, reason, morale }) };
}

// This is deliberately the single public evaluation entry point for the modern
// free-agent / Challengers flow.  UI previews and the reducer both call it, so
// an agent response can never be a dead-end message that uses different rules
// from the offer which is eventually submitted.
export function evaluateModernCdlPlayerOffer(state, playerId, offer = {}) {
  const player = [...(state?.players || []), ...(state?.prospects || [])].find(p => p.id === playerId);
  if (!player) return { accepted: false, reason: "Player unavailable", requiredAction: "Choose a player who is still available.", details: {} };
  if (player.teamId) return { accepted: false, reason: "Player unavailable", requiredAction: "This player is already under contract or rostered.", details: {} };
  const asSub = offer.starterStatus === "sub";
  const result = evaluateContractOffer(player, state, offer, { type: "signing", teamId: state?.userTeamId, asSub });
  const demand = result.demand;
  const actions = {
    lowball: `Increase salary to at least ${fmtSalary(demand.salary)}.`,
    more_salary: `Increase salary to at least ${fmtSalary(demand.salary)}.`,
    starter_promise: "Offer a starting spot, or approach another player.",
    longer_term: `Offer a ${demand.years}-year contract or longer.`,
    shorter_term: `Offer a ${demand.years}-year contract or shorter.`,
    stronger_interest: `Offer at least ${fmtSalary(demand.salary)} with a starting role. Stronger team interest makes this a difficult deal.`,
    wait_market: `Match the expected ${fmtSalary(demand.salary)} salary and preferred ${demand.years}-year term.`,
    low_morale: "Make a stronger financial offer or revisit once the player is more receptive.",
  };
  return {
    accepted: result.outcome === "accept",
    reason: result.outcome === "accept" ? null : result.message,
    requiredAction: result.outcome === "accept" ? null : actions[result.reason] || `Meet the expected salary of ${fmtSalary(demand.salary)} and role request.`,
    details: {
      offeredSalary: Number(offer.salary || 0), expectedSalary: demand.salary,
      offeredYears: Number(offer.years || 0), expectedYears: demand.years,
      wantedRole: demand.wantedRole, interest: demand.interest.level,
      acceptanceChance: result.chance,
    },
    evaluation: result,
  };
}

function responseMessage(player, outcome, reason, demand) {
  if (outcome === "accept") return `${player.name} accepts and is encouraged by the role clarity.`;
  return ({ lowball: `${player.name}'s agent calls the offer well below expectations.`, low_morale: `${player.name} is not ready to commit while morale is low.`, stronger_interest: `${player.name} wants to wait because stronger teams are interested.`, longer_term: `${player.name}'s camp asks for a longer commitment.`, shorter_term: `${player.name}'s camp prefers a shorter deal.`, starter_promise: `${player.name} wants a clear starter promise.`, wait_market: `${player.name} wants to test free agency.`, more_salary: `${player.name}'s agent asks for more salary.`, }[reason] || demand.message);
}


export function qualitativeDemandMessage(player, demand) {
  if (demand.interest?.level === "Heavy") return "The player is tempted by stronger teams and may wait for the market.";
  if (demand.moraleStance === "Happy/loyal") return "The player is happy at the club but expects a fair raise.";
  if (demand.moraleStance === "Unhappy") return "The agent is cautious because morale around the player is low.";
  if (["Star Player", "Starter"].includes(demand.wantedRole)) return "The player wants assurances over starter status.";
  if (demand.wantedRole === "Prospect") return "The player wants a clear development pathway.";
  return `${player?.name || "The player"}'s agent is willing to listen, but expects a serious offer.`;
}

export function qualitativeOfferFeedback(player, ctx = {}) {
  const salary = Number(ctx.offer?.salary || 0);
  const demandSalary = Number(ctx.demand?.salary || 1);
  if (ctx.reason === "lowball" || salary < demandSalary * 0.85) return "The agent thinks this offer is below market value.";
  if (ctx.reason === "starter_promise") return "The player wants assurances over starter status and map time.";
  if (ctx.reason === "stronger_interest") return "The player is tempted by stronger teams.";
  if (ctx.reason === "low_morale") return "The player is reluctant to commit while morale is low.";
  if (salary >= demandSalary * 1.05) return "The agent views the financial package as serious.";
  if ((ctx.morale ?? 65) >= 78) return "The player is happy at the club but expects a raise.";
  return `${player?.name || "The player"}'s camp is considering the structure of the offer.`;
}

export function makePendingContractOffer(state, player, offer = {}, opts = {}) {
  const evalResult = evaluateContractOffer(player, state, offer, opts);
  const day = Number(state?.calendar?.day ?? 0);
  const delay = 1 + (Math.abs(hash(`${state?.season}:${player?.id}:${JSON.stringify(offer)}`)) % 3);
  return { ...evalResult, submittedDay: day, responseDueDay: day + delay };
}
