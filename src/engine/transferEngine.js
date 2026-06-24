// src/engine/transferEngine.js
// In-contract Transfer / Buyout / Trade negotiation system.
//
// Pure, deterministic helpers + state transitions. NEVER changes match sim,
// ratings, brackets, points, awards, map/veto logic. Builds on the existing
// contract (player.contractYears / player.salary), budget (getTeamCap /
// getSigningCost), roster-integrity (ensureCdlRosterIntegrity), staff (Assistant
// GM negotiation/reputation) and board (boardState.confidence) systems.
//
// Storage lives in `state.transferMarket` (see migrateTransferMarket). User-set
// transfer statuses / asking prices are stored there keyed by playerId rather
// than mutated onto player objects, so old saves hydrate safely and player data
// stays clean. Buyout values are derived on demand from a valuation model.

import { CDL_TEAMS } from "../data/teams.js";
import { getTeamCap, getSigningCost, getTeamBudgetTier } from "./rosterAI.js";
import { calcTeamOvr } from "./teamOvr.js";
import { isCdlTeamId, isInactivePlayer } from "../utils/playerIdentity.js";
import { getActiveStarters } from "../utils/rosterValidation.js";
import { moraleWillingnessDelta } from "./moraleEngine.js";

export const TRANSFER_VERSION = 1;

export const TRANSFER_STATUSES = [
  "Open to Offers", "Transfer Listed", "Not For Sale",
  "Unsettled", "Wants Move", "Recently Signed", "Protected",
];
export const OFFER_STATUSES = ["Pending", "Accepted", "Completed", "Rejected", "Countered", "Withdrawn", "Expired", "Cancelled"];

// ── Tiny deterministic helpers ───────────────────────────────────────────────
function hashStr(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function unit(key) { return (hashStr(key) % 100000) / 100000; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clamp01(v) { return clamp(v, 0, 1); }
function round5k(v) { return Math.round(v / 5000) * 5000; }
export function fmtFee(n) { return `$${Math.round((n || 0) / 1000)}k`; }
export function teamTag(id) { return CDL_TEAMS.find(t => t.id === id)?.tag ?? id; }
export function teamName(id) { return CDL_TEAMS.find(t => t.id === id)?.name ?? id; }

// ── Migration / hydration ────────────────────────────────────────────────────
export function migrateTransferMarket(existing) {
  const e = existing && typeof existing === "object" ? existing : {};
  return {
    version: TRANSFER_VERSION,
    negotiations: Array.isArray(e.negotiations) ? e.negotiations : [],
    status: e.status && typeof e.status === "object" ? e.status : {},        // { [playerId]: {transferStatus, askingPrice} }
    budgets: e.budgets && typeof e.budgets === "object" ? e.budgets : {},    // { [teamId]: {balance, spend, income} }
    recentlyTransferred: e.recentlyTransferred && typeof e.recentlyTransferred === "object" ? e.recentlyTransferred : {},
    cooldowns: e.cooldowns && typeof e.cooldowns === "object" ? e.cooldowns : {},
    playerTransferMemory: e.playerTransferMemory && typeof e.playerTransferMemory === "object" ? e.playerTransferMemory : {},
    pendingAcceptedOfferId: e.pendingAcceptedOfferId ?? null,
    activeTermsOfferId: e.activeTermsOfferId ?? null,
    lastWaveKey: e.lastWaveKey ?? null,
    waveNonce: e.waveNonce ?? 0,
    nextId: e.nextId ?? 1,
  };
}

// ── Transfer windows / timing ────────────────────────────────────────────────
// Open during offseason, contract review, pre-champs and the regular stage
// (between matchdays). Closed during live events (Major / Champs / ESWC / the
// Challenger qualifier) once event rosters are baked.
export function isTransferWindowOpen(state) {
  const phase = state?.schedule?.phase;
  return phase === "stage" || phase === "preChamps" || phase === "offseason" || phase === "contracts";
}
export function getWindowKey(state) {
  const season = state?.season ?? 1;
  const phase = state?.schedule?.phase ?? "stage";
  const stageIdx = state?.schedule?.stageIdx ?? 0;
  return phase === "stage" ? `${season}:st${stageIdx}` : `${season}:${phase}`;
}
export function transferWindowLabel(state) {
  if (!isTransferWindowOpen(state)) return "Closed (live event)";
  const phase = state?.schedule?.phase;
  if (phase === "offseason" || phase === "contracts") return "Offseason window — open";
  if (phase === "preChamps") return "Pre-Champs window — open";
  return `Stage ${(state?.schedule?.stageIdx ?? 0) + 1} window — open`;
}

// ── Staff (GM) negotiation influence — modest ────────────────────────────────
function teamGm(state, teamId) {
  return (state?.staff || []).find(s => s.currentTeamId === teamId && s.role === "assistant_gm");
}
// 0..1 negotiation skill of a team's Assistant GM (drives fee leverage).
export function getGmNegotiation(state, teamId) {
  const gm = teamGm(state, teamId);
  return clamp01(((gm?.negotiation ?? 55) - 40) / 50);
}
// 0..1 reputation (helps attract players / big moves).
export function getGmReputation(state, teamId) {
  const gm = teamGm(state, teamId);
  return clamp01(((gm?.reputation ?? 55) - 40) / 50);
}

// ── User-set status / asking price (stored in transferMarket.status) ─────────
export function getTransferStatus(player, state) {
  if (!player) return "Open to Offers";
  const tm = state?.transferMarket;
  const recent = tm?.recentlyTransferred?.[player.id];
  if (recent) return "Recently Signed";
  const set = tm?.status?.[player.id]?.transferStatus;
  return set || "Open to Offers";
}
export function getAskingPriceOverride(player, state) {
  return state?.transferMarket?.status?.[player.id]?.askingPrice ?? null;
}
export function isNotForSale(player, state) { return getTransferStatus(player, state) === "Not For Sale"; }
export function isTransferListed(player, state) { return getTransferStatus(player, state) === "Transfer Listed"; }

// ── Valuation / buyout ───────────────────────────────────────────────────────
// Builds on getSigningCost (the salary/market curve) and inflates it for an
// in-contract buyout based on contract length, age, potential, recent form,
// transfer status and the selling owner's ambition. Deterministic.
export function getPlayerValuation(player, state) {
  if (!player) return 0;
  const base = getSigningCost(player);
  const ovr = player.overall ?? 70;
  const pot = player.potential ?? ovr;
  const age = player.age ?? 23;
  const years = clamp(player.contractYears ?? 1, 0, 4);

  let mult = 1.05;
  mult += 0.16 * years;                                    // long contract = expensive to prise away
  if (age <= 20) mult += 0.18; else if (age <= 22) mult += 0.10;
  else if (age >= 30) mult -= 0.32; else if (age >= 28) mult -= 0.18; else if (age >= 26) mult -= 0.08;
  const gap = pot - ovr;
  if (age <= 24 && pot >= 90) mult += 0.22; else if (age <= 25 && gap >= 8) mult += 0.10;
  if (ovr >= 90) mult += 0.15; else if (ovr >= 86) mult += 0.08;

  // Recent form (rolling) nudges value ±8%.
  const form = player.form ?? 65;
  mult += clamp((form - 65) / 35, -1, 1) * 0.08;

  // Selling owner ambition: ambitious orgs price their players higher.
  const owner = CDL_TEAMS.find(t => t.id === player.teamId)?.owner;
  if (owner) mult += clamp((owner.ambition - 60) / 100, -0.15, 0.2);

  // Transfer status.
  const status = getTransferStatus(player, state);
  if (status === "Not For Sale") mult *= 2.3;
  else if (status === "Transfer Listed") mult *= 0.7;
  else if (status === "Wants Move" || status === "Unsettled") mult *= 0.85;

  return Math.max(15000, round5k(base * Math.max(0.4, mult)));
}

// The seller's anchor: user asking price (if set) wins, else valuation.
export function getAskingPrice(player, state) {
  const override = getAskingPriceOverride(player, state);
  if (override != null) return round5k(override);
  return getPlayerValuation(player, state);
}

// ── Transfer budget (separate from salary cap) ───────────────────────────────
export function getTransferBudget(state, teamId) {
  const stored = state?.transferMarket?.budgets?.[teamId];
  if (stored && typeof stored.balance === "number") return stored;
  // Lazy default: proportional to the org's salary cap.
  const balance = round5k(getTeamCap(teamId) * 0.6);
  return { balance, spend: 0, income: 0 };
}

// Salary-cap room for a buyer to add `salary` as a starter (subs are cap-free).
export function capRoomForStarter(state, teamId, addSalary, excludePlayerId = null) {
  const starters = getActiveStarters(state.players, teamId).filter(p => p.id !== excludePlayerId);
  const committed = starters.reduce((s, p) => s + (p.salary ?? getSigningCost(p)), 0);
  return getTeamCap(teamId) - committed - addSalary;
}

function currentTeamRank(state, teamId) {
  const table = state?.schedule?.standings || state?.schedule?.stageStandings || {};
  const rows = Object.entries(table).sort((a, b) => (b[1]?.points ?? 0) - (a[1]?.points ?? 0) || (b[1]?.wins ?? 0) - (a[1]?.wins ?? 0));
  const idx = rows.findIndex(([id]) => id === teamId);
  return idx >= 0 ? idx + 1 : Math.ceil(CDL_TEAMS.length / 2);
}

function teamRecentWinScore(state, teamId) {
  const logs = (state?.schedule?.matchLog || state?.matchLog || []).slice(-24);
  const mine = logs.filter(m => m.winnerId === teamId || m.loserId === teamId).slice(-8);
  if (!mine.length) return 0.5;
  return mine.filter(m => m.winnerId === teamId).length / mine.length;
}

function recentKd(player, state) {
  const rows = state?.playerSeasonStats?.[player?.id] || [];
  const cur = rows.find(r => r.season === state?.season) || rows[rows.length - 1];
  if (!cur || !cur.deaths) return null;
  return cur.kills / cur.deaths;
}

function roleRankOnTeam(player, state) {
  const mates = getActiveStarters(state.players || [], player.teamId).sort((a, b) => (b.overall ?? 70) - (a.overall ?? 70));
  const idx = mates.findIndex(p => p.id === player.id);
  return idx >= 0 ? idx + 1 : 99;
}

function replacementRisk(state, sellerTeamId, player) {
  const starters = getActiveStarters(state.players || [], sellerTeamId);
  if (starters.length <= 4 && starters.some(p => p.id === player.id)) return 1;
  const bench = (state.players || []).filter(p => p.teamId === sellerTeamId && p.isSub && !isInactivePlayer(p));
  const sameRole = bench.filter(p => p.primary === player.primary).sort((a, b) => (b.overall ?? 70) - (a.overall ?? 70))[0];
  const bestBench = bench.sort((a, b) => (b.overall ?? 70) - (a.overall ?? 70))[0];
  const rep = sameRole || bestBench;
  if (!rep) return 0.9;
  const drop = (player.overall ?? 70) - (rep.overall ?? 65);
  return clamp(drop / 14, 0, 1);
}

export function getTeamAttractiveness(state, teamId, opts = {}) {
  const team = CDL_TEAMS.find(t => t.id === teamId);
  const teamOvr = calcTeamOvr(teamId, state?.players || []) || 72;
  const ovrs = CDL_TEAMS.map(t => ({ id: t.id, ovr: calcTeamOvr(t.id, state?.players || []) || 72 })).sort((a, b) => b.ovr - a.ovr);
  const ovrRank = ovrs.findIndex(t => t.id === teamId) + 1 || 8;
  const standingRank = currentTeamRank(state, teamId);
  const ownerAmbition = team?.owner?.ambition ?? 60;
  const budgetTier = getTeamBudgetTier(teamId);
  const gmRep = getGmReputation(state, teamId);
  const form = teamRecentWinScore(state, teamId);
  let score = 45;
  score += clamp((teamOvr - 76) * 2.2, -16, 24);
  score += clamp((7 - ovrRank) * 2.2, -12, 14);
  score += clamp((7 - standingRank) * 1.6, -10, 10);
  score += (budgetTier - 3) * 3.5;
  score += clamp((ownerAmbition - 60) / 3.5, -8, 12);
  score += gmRep * 8;
  score += (form - 0.5) * 12;
  if (opts.salaryBoost) score += clamp(opts.salaryBoost * 10, -5, 10);
  if (opts.promisedRole === "Starter") score += 5;
  if (opts.promisedRole === "Substitute") score -= 8;
  if (opts.promisedRole === "Prospect") score -= 12;
  return { score: clamp(score, 0, 100), teamOvr, ovrRank, standingRank, form, ownerAmbition, budgetTier };
}

export function getProtectedPlayerInfo(player, state, buyerTeamId = null) {
  if (!player || !player.teamId) return { protected: false, level: 0, reasons: [], requiredMultiplier: 1.1 };
  const status = getTransferStatus(player, state);
  const rank = roleRankOnTeam(player, state);
  const ovr = player.overall ?? 70;
  const pot = player.potential ?? ovr;
  const age = player.age ?? 23;
  const sellerTeamId = player.teamId;
  const sellerAttr = getTeamAttractiveness(state, sellerTeamId);
  const sellerOvr = calcTeamOvr(sellerTeamId, state.players || []) || 75;
  const buyerOvr = buyerTeamId ? (calcTeamOvr(buyerTeamId, state.players || []) || 75) : 75;
  const kd = recentKd(player, state);
  const risk = replacementRisk(state, sellerTeamId, player);
  const reasons = [];
  let level = 0;
  if (status === "Recently Signed") { level += 5; reasons.push("recently signed"); }
  if (status === "Not For Sale") { level += 4; reasons.push("marked not for sale"); }
  if (rank === 1) { level += 3; reasons.push("highest OVR player"); }
  else if (rank === 2) { level += 2; reasons.push("top-two player"); }
  if (ovr >= 88) { level += 3; reasons.push("elite franchise talent"); }
  else if (ovr >= 85) { level += 2; reasons.push("star starter"); }
  if (age <= 22 && pot >= 90) { level += 3; reasons.push("young high-potential core piece"); }
  else if (age <= 24 && pot >= 88) { level += 2; reasons.push("high-potential core piece"); }
  if (sellerAttr.score >= 66 && rank <= 2) { level += 2; reasons.push("contending team core"); }
  if ((CDL_TEAMS.find(t => t.id === sellerTeamId)?.owner?.ambition ?? 60) >= 75 && rank <= 2) { level += 1.5; reasons.push("high-ambition ownership"); }
  if (kd != null && kd >= 1.12) { level += 1.5; reasons.push("elite recent form"); }
  if (risk >= 0.75) { level += 2; reasons.push("no credible replacement"); }
  if (buyerTeamId && buyerOvr >= sellerOvr - 1 && sellerAttr.score >= 58 && rank <= 2) { level += 1; reasons.push("direct competitor interest"); }
  if (status === "Transfer Listed") level -= 4;
  if (status === "Wants Move" || status === "Unsettled") level -= 2.5;
  if ((player.contractYears ?? 1) <= 1) level -= 1;
  level = Math.max(0, level);
  const requiredMultiplier = level >= 10 ? 3.4 : level >= 7 ? 2.7 : level >= 4 ? 1.9 : level >= 2 ? 1.35 : 1.05;
  return { protected: level >= 4, level, reasons, requiredMultiplier, rank, sellerAttractiveness: sellerAttr, replacementRisk: risk };
}

export function getTransferIntel(player, state, buyerTeamId = state?.userTeamId, opts = {}) {
  if (!player || !state) return null;
  const status = getTransferStatus(player, state);
  const protectedInfo = getProtectedPlayerInfo(player, state, buyerTeamId);
  const baseAsk = getAskingPrice(player, state);
  const sellerAttr = getTeamAttractiveness(state, player.teamId);
  const buyerAttr = getTeamAttractiveness(state, buyerTeamId, opts);
  const terms = buildDefaultTransferTerms(state, { fromTeamId: buyerTeamId, toTeamId: player.teamId, playerId: player.id }, opts);
  const willingness = evaluatePlayerTerms(player, buyerTeamId, player.teamId, state, terms);
  let clubStance = "Will sell for right price";
  if (status === "Transfer Listed") clubStance = "Transfer listed";
  else if (status === "Not For Sale") clubStance = "Not for sale";
  else if (protectedInfo.level >= 7) clubStance = "Protected franchise player";
  else if (protectedInfo.protected) clubStance = "Protected";
  else if (status === "Unsettled" || status === "Wants Move") clubStance = "Open to offers";
  const diffScore = protectedInfo.level * 8 + (sellerAttr.score - buyerAttr.score) * 0.55 + (willingness.willingness < 0.35 ? 18 : willingness.willingness < 0.5 ? 10 : 0);
  const dealDifficulty = diffScore >= 86 ? "Nearly impossible" : diffScore >= 62 ? "Very difficult" : diffScore >= 38 ? "Difficult" : diffScore >= 18 ? "Possible" : "Easy";
  return {
    clubStance,
    playerInterest: willingness.interestLabel,
    dealDifficulty,
    playerWillingness: willingness.willingness,
    askingPrice: baseAsk,
    expectedSalary: terms.salary,
    expectedRole: terms.promisedRole,
    reason: willingness.reason,
    protectedInfo,
    sellerAttractiveness: sellerAttr.score,
    buyerAttractiveness: buyerAttr.score,
  };
}

export function isOutgoingTermsRequired(neg, state) {
  if (!neg || !state) return false;
  if (neg.initiator !== "user" || neg.fromTeamId !== state.userTeamId) return false;
  if (neg.status !== "Accepted") return false;
  if (neg.nextAction && neg.nextAction !== "player_terms") return false;
  const player = (state.players || []).find(p => p.id === neg.playerId);
  return !!player && player.teamId === neg.toTeamId;
}

export function getAcceptedOutgoingTermsOffers(state) {
  const tm = migrateTransferMarket(state?.transferMarket);
  return tm.negotiations.filter(n => isOutgoingTermsRequired(n, state));
}

export function getTransferTermsPreview(state, neg, termsOverride = {}) {
  const player = (state?.players || []).find(p => p.id === neg?.playerId);
  if (!state || !neg || !player) return null;
  const terms = buildDefaultTransferTerms(state, neg, termsOverride);
  const salary = terms.salary;
  const contractYears = terms.contractYears;
  const promisedRole = terms.promisedRole;
  const buyerTeamId = neg.fromTeamId;
  const sellerTeamId = neg.toTeamId;
  const buyerStarters = getActiveStarters(state.players, buyerTeamId);
  const userIsBuyer = buyerTeamId === state.userTeamId;
  let asSub = false;
  let releaseId = null;
  let rosterNote = "Starter slot available";
  if (promisedRole === "Substitute" || promisedRole === "Prospect") {
    asSub = true;
    rosterNote = promisedRole === "Prospect" ? "Prospect/depth role promised" : "Substitute role promised";
  } else if (buyerStarters.length >= 4) {
    if (userIsBuyer) {
      const subs = state.players.filter(p => p.teamId === buyerTeamId && p.isSub && !isInactivePlayer(p));
      asSub = true;
      rosterNote = subs.length >= 1 ? "Roster full — release a starter or your sub first" : "Will join as your sub";
    } else {
      const weakest = [...buyerStarters].sort((a, b) => (a.overall ?? 70) - (b.overall ?? 70))[0];
      releaseId = weakest?.id ?? null;
      rosterNote = releaseId ? "AI buyer will release weakest starter" : "AI buyer roster check pending";
    }
  }
  const capAfter = asSub ? getTeamCap(buyerTeamId) - getActiveStarters(state.players, buyerTeamId).reduce((s, p) => s + (p.salary ?? getSigningCost(p)), 0)
    : capRoomForStarter(state, buyerTeamId, salary, releaseId);
  return {
    player, buyerTeamId, sellerTeamId,
    transferFee: neg.counterFee ?? neg.agreedFee ?? neg.fee,
    salary, contractYears, promisedRole, asSub, releaseId, capAfter, rosterNote,
  };
}

export function buildDefaultTransferTerms(state, neg, overrides = {}) {
  const player = (state?.players || []).find(p => p.id === neg?.playerId);
  const buyerTeamId = neg?.fromTeamId;
  const buyerStarters = getActiveStarters(state?.players || [], buyerTeamId);
  const currentSalary = player?.salary ?? getSigningCost(player || {});
  const starterQuality = (player?.overall ?? 70) >= (calcTeamOvr(buyerTeamId, state?.players || []) || 75) - 2;
  let promisedRole = overrides.promisedRole || overrides.role;
  if (!promisedRole) promisedRole = buyerStarters.length < 4 || starterQuality ? "Starter" : "Substitute";
  const roleBoost = promisedRole === "Starter" ? 1.18 : promisedRole === "Substitute" ? 1.02 : 0.92;
  const salary = round5k(overrides.salary ?? Math.max(currentSalary, getSigningCost(player || {}) * roleBoost));
  const contractYears = clamp(Number(overrides.contractYears ?? player?.contractYears ?? 2), 1, 3);
  return { promisedRole, salary, contractYears };
}

function interestLabel(w) {
  if (w < 0.22) return "No interest";
  if (w < 0.4) return "Low";
  if (w < 0.55) return "Unclear";
  if (w < 0.75) return "Interested";
  return "Very interested";
}

export function evaluatePlayerTerms(player, buyerTeamId, sellerTeamId, state, opts = {}) {
  if (!player) return { accepted: false, willingness: 0, interestLabel: "No interest", reason: "Player no longer available." };
  const curSalary = player.salary ?? getSigningCost(player);
  const defaults = buildDefaultTransferTerms(state, { fromTeamId: buyerTeamId, toTeamId: sellerTeamId, playerId: player.id }, opts);
  const cleanOpts = Object.fromEntries(Object.entries(opts || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const terms = { ...defaults, ...cleanOpts };
  const salaryBoost = (terms.salary - curSalary) / Math.max(curSalary, 1);
  const buyerAttr = getTeamAttractiveness(state, buyerTeamId, { promisedRole: terms.promisedRole, salaryBoost });
  const sellerAttr = getTeamAttractiveness(state, sellerTeamId);
  const buyerOvr = buyerAttr.teamOvr;
  const sellerOvr = sellerAttr.teamOvr;
  const deltaAttr = buyerAttr.score - sellerAttr.score;
  const deltaOvr = buyerOvr - sellerOvr;
  const currentStarter = getActiveStarters(state.players || [], sellerTeamId).some(p => p.id === player.id);
  const age = player.age ?? 23;
  const ovr = player.overall ?? 70;
  const pot = player.potential ?? ovr;
  const loyalty = ((player.leadership ?? 50) + (player.workEthic ?? 50)) / 2;
  const status = getTransferStatus(player, state);

  let w = 0.44;
  w += clamp(deltaAttr / 70, -0.36, 0.36);
  w += clamp(deltaOvr / 28, -0.2, 0.2);
  w += clamp(salaryBoost, -0.4, 1.2) * 0.24;
  if (terms.promisedRole === "Starter") w += currentStarter ? 0.04 : 0.22;
  if (terms.promisedRole === "Substitute") w -= currentStarter || ovr >= 80 ? 0.28 : 0.12;
  if (terms.promisedRole === "Prospect") w -= ovr >= 76 ? 0.32 : 0.1;
  if (age >= 28) w += clamp(deltaAttr / 100, -0.12, 0.16);
  if (age <= 22 && terms.promisedRole === "Starter") w += 0.08;
  if (age <= 23 && pot >= 88 && terms.promisedRole !== "Starter") w -= 0.12;
  if (loyalty >= 78 && currentStarter && deltaAttr < 12) w -= 0.13;
  if (status === "Wants Move" || status === "Unsettled") w += 0.22;
  const memory = migrateTransferMarket(state?.transferMarket).playerTransferMemory?.[player.id] || {};
  if (memory.blockedMoves) w += clamp(memory.blockedMoves * 0.08, 0, 0.24);
  if (memory.promisedReviewUntil && memory.promisedReviewUntil >= (state?.season ?? 1) * 10 + (state?.schedule?.stageIdx ?? 0)) w += 0.08;
  if (status === "Transfer Listed") w += 0.1;
  if (status === "Recently Signed") w -= 0.35;
  if ((player.contractYears ?? 1) <= 1) w += 0.06;
  if (ovr >= 86 && deltaAttr < -8 && salaryBoost < 0.75) w -= 0.22;
  // Squad dynamics: morale nudges willingness modestly (unhappy → keener to move,
  // very happy/settled → slightly more reluctant). Bounded, 0 when no morale data.
  w += moraleWillingnessDelta(state, player);

  w = clamp01(w);
  let reason = "Player is open to the project if the club agreement is in place.";
  if (status === "Recently Signed") reason = "Player has only just signed and is not ready to move again.";
  else if (terms.promisedRole !== "Starter" && (currentStarter || ovr >= 80)) reason = "Player wants a guaranteed starting role to consider the move.";
  else if (deltaAttr < -18 && salaryBoost < 0.65) reason = "Player has no interest in joining a weaker competitive project without a major salary premium.";
  else if (deltaAttr < -8 && ovr >= 84) reason = "Player does not view this as a step up and wants either a stronger project or a much higher salary.";
  else if (salaryBoost < -0.05) reason = "Player wants a higher salary to consider the move.";
  else if (loyalty >= 78 && currentStarter && deltaAttr < 12) reason = "Player is happy at his current club and would need a clearly better project.";
  else if (w >= 0.75) reason = "Player is very interested in the role, salary and competitive project.";
  else if (w >= 0.55) reason = "Player is interested, provided the promised role and salary are honoured.";
  else if (w >= 0.4) reason = "Player interest is uncertain; stronger terms may be required.";
  else if (sellerAttr.score > buyerAttr.score) reason = "Player is waiting for offers from stronger teams.";

  return { accepted: w >= 0.48, willingness: w, interestLabel: interestLabel(w), reason, buyerAttractiveness: buyerAttr.score, sellerAttractiveness: sellerAttr.score, terms };
}

// ── Player willingness to move (buyer = destination) ─────────────────────────
// Back-compatible numeric wrapper around the richer personal-terms evaluation.
export function playerWillingness(player, buyerTeamId, sellerTeamId, state, opts = {}) {
  return evaluatePlayerTerms(player, buyerTeamId, sellerTeamId, state, opts).willingness;
}

// ── Seller AI response to a buy offer (buyer offers `fee`) ────────────────────
// Returns { decision: "accept"|"reject"|"counter", counterFee, reason }.
export function evaluateSellResponse(state, player, buyerTeamId, fee) {
  if (!isTransferWindowOpen(state)) return { decision: "reject", reason: "Transfer window is closed and event rosters are locked." };
  const ask = getAskingPrice(player, state);
  const status = getTransferStatus(player, state);
  const sellerTeamId = player.teamId;
  const sellerName = teamName(sellerTeamId);
  const protectedInfo = getProtectedPlayerInfo(player, state, buyerTeamId);
  const sellerAttr = getTeamAttractiveness(state, sellerTeamId);
  const buyerAttr = getTeamAttractiveness(state, buyerTeamId);
  const sellerNeg = getGmNegotiation(state, sellerTeamId);
  const buyerOvr = calcTeamOvr(buyerTeamId, state.players || []) || 75;
  const sellerOvr = calcTeamOvr(sellerTeamId, state.players || []) || 75;
  const ratio = fee / Math.max(ask, 1);
  const starters = getActiveStarters(state.players || [], sellerTeamId);

  if (starters.length <= 4 && starters.some(p => p.id === player.id) && protectedInfo.replacementRisk >= 0.9 && status !== "Transfer Listed" && status !== "Wants Move" && status !== "Unsettled" && ratio < 2.2) {
    return { decision: "reject", reason: `${sellerName} cannot replace ${player.name} without weakening their starting roster.` };
  }
  if (status === "Recently Signed") {
    return { decision: "reject", reason: `${player.name} has only just signed; ${sellerName} will not move him again this window.` };
  }
  if (status === "Not For Sale" && ratio < 2.4) {
    return { decision: "reject", reason: `${sellerName} have marked ${player.name} Not For Sale and will not negotiate below an extreme premium.` };
  }
  if (protectedInfo.protected && ratio < protectedInfo.requiredMultiplier * 0.88) {
    return { decision: "reject", reason: `${sellerName} consider ${player.name} vital (${protectedInfo.reasons.slice(0, 2).join(", ") || "protected player"}). Offer is far below protected-player valuation.` };
  }
  if (protectedInfo.rank === 1 && sellerAttr.score >= 62 && ratio < 2.6) {
    return { decision: "reject", reason: `${sellerName} are contending and will not sell their highest OVR player unless the offer is extraordinary.` };
  }
  if (buyerOvr >= sellerOvr - 1 && sellerAttr.score >= 58 && protectedInfo.rank <= 2 && ratio < 2.3) {
    return { decision: "reject", reason: `${sellerName} will not strengthen a direct competitor without a massive premium.` };
  }

  let required = 1.0 + sellerNeg * 0.08;
  if (status === "Transfer Listed") required = 0.78 + sellerNeg * 0.04;
  else if (status === "Wants Move" || status === "Unsettled") required = 0.92 + sellerNeg * 0.06;
  else required += clamp(protectedInfo.level * 0.13, 0, 1.75);
  required += clamp((sellerAttr.score - buyerAttr.score) / 150, -0.08, 0.18);
  if ((player.contractYears ?? 1) >= 3) required += 0.12;
  if (protectedInfo.replacementRisk > 0.55) required += protectedInfo.replacementRisk * 0.22;
  if (status === "Not For Sale") required = Math.max(required, 2.7);

  if (ratio >= required) {
    return { decision: "accept", reason: status === "Transfer Listed" ? `${sellerName} accept because ${player.name} is transfer listed and the fee meets their valuation.` : `${sellerName} accept an above-market fee that offsets ${player.name}'s importance.` };
  }
  if (ratio < Math.min(0.58, required * 0.45)) {
    return { decision: "reject", reason: `${sellerName} rejected the offer. ${player.name} is valued much higher due to role importance and contract status.` };
  }
  if (protectedInfo.protected && ratio < required * 0.65) {
    return { decision: "reject", reason: `${sellerName} rejected the offer. ${player.name} is a protected player and requires an extreme fee.` };
  }
  const counterFee = round5k(Math.max(ask * required, fee * (1.18 + sellerNeg * 0.12)));
  const reason = protectedInfo.protected
    ? `${sellerName} are reluctant to sell a protected player and value him at ${fmtFee(counterFee)} due to ${protectedInfo.reasons.slice(0, 2).join(" and ") || "his importance"}.`
    : `${sellerName} are open to selling but value the player at ${fmtFee(counterFee)} due to contract length, role importance and replacement cost.`;
  return { decision: "counter", counterFee, reason };
}

// ── Buyer (AI) response when the user counters an incoming offer ─────────────
// The AI buyer decides whether to pay the user's counter. Bounded by what the
// AI is willing/able to pay (valuation tolerance + transfer budget + cap room).
export function evaluateBuyerCounterResponse(state, player, buyerTeamId, counterFee) {
  const ask = getPlayerValuation(player, state);
  const buyerNeg = getGmNegotiation(state, buyerTeamId);
  const maxPay = Math.min(
    ask * (1.18 + buyerNeg * 0.12),                          // up to ~1.3× valuation
    getTransferBudget(state, buyerTeamId).balance
  );
  const salary = player.salary ?? getSigningCost(player);
  const capOk = capRoomForStarter(state, buyerTeamId, salary, /*they will free a slot*/ null) > -salary; // lenient: AI frees weakest
  const roll = unit(`${getWindowKey(state)}:${buyerTeamId}:${player.id}:${counterFee}:buyerCounter`);
  if (!capOk) return { decision: "walk_away", reason: "Cannot fit wages" };
  if (counterFee <= maxPay) return { decision: "accept", reason: "Met the counter" };
  if (counterFee <= maxPay * 1.15 && roll < 0.7) {
    return { decision: "counter", counterFee: round5k((counterFee + maxPay) / 2), reason: "Come back with improved bid" };
  }
  if (counterFee <= maxPay * 1.35 && roll < 0.45) return { decision: "reject", reason: "Price is too high" };
  if (roll > 0.72) return { decision: "walk_away", reason: "Player is not a priority anymore" };
  return { decision: "reject", reason: "Counter too rich" };
}

// ── AI interest in buying a specific user player ─────────────────────────────
// Returns an interest score 0..1 and a human reason, or null if no interest.
export function aiInterestInPlayer(state, buyerTeamId, player) {
  if (!player || player.teamId === buyerTeamId) return null;
  if (isInactivePlayer(player)) return null;
  if (getTransferStatus(player, state) === "Recently Signed") return null;
  const protection = getProtectedPlayerInfo(player, state, buyerTeamId);
  if (protection.protected && protection.level >= 7) return null;

  const buyerOvr = calcTeamOvr(buyerTeamId, state.players) || 75;
  const sellerOvr = calcTeamOvr(player.teamId, state.players) || 75;
  const ovr = player.overall ?? 70;
  const age = player.age ?? 23;
  const pot = player.potential ?? ovr;

  // Role need: does the buyer have a weak starter in the player's primary role?
  const buyerStarters = getActiveStarters(state.players, buyerTeamId);
  const roleStarters = buyerStarters.filter(p => p.primary === player.primary);
  const weakestInRole = roleStarters.length ? Math.min(...roleStarters.map(p => p.overall ?? 70)) : 0;
  const upgradesRole = ovr > weakestInRole + 2;
  const upgradesTeam = ovr >= buyerOvr - 1;

  let score = 0;
  if (upgradesRole) score += 0.35;
  if (upgradesTeam) score += 0.25;
  if (buyerOvr > sellerOvr) score += 0.15;                   // bigger team eyeing weaker team's player
  if (age <= 23 && pot >= 86) score += 0.2;                  // young upside
  if (getTransferStatus(player, state) === "Transfer Listed") score += 0.25;
  if (getTransferStatus(player, state) === "Wants Move") score += 0.2;
  if (protection.protected) score -= 0.25;
  // Ambition of the buying owner.
  const owner = CDL_TEAMS.find(t => t.id === buyerTeamId)?.owner;
  if (owner) score += clamp((owner.ambition - 60) / 200, -0.1, 0.15);
  // GM scouting/negotiation sharpens recruitment.
  score += getGmNegotiation(state, buyerTeamId) * 0.1;

  const termsInterest = evaluatePlayerTerms(player, buyerTeamId, player.teamId, state, { promisedRole: "Starter" });
  if (!termsInterest.accepted && termsInterest.willingness < 0.42) return null;
  if (score < 0.45) return null;

  // Affordability: transfer budget for the fee + cap room for wages (AI frees a slot).
  const val = getPlayerValuation(player, state);
  const budget = getTransferBudget(state, buyerTeamId).balance;
  if (budget < val * 0.8) return null;

  const reasons = [];
  if (upgradesRole) reasons.push(`upgrade at ${player.primary}`);
  else if (upgradesTeam) reasons.push("immediate starter");
  if (age <= 23 && pot >= 86) reasons.push("high-potential youngster");
  if (buyerOvr > sellerOvr) reasons.push("targeting a weaker rival");
  return { score: clamp01(score), reason: reasons.join(", ") || "squad depth", valuation: val };
}

// ── Generate incoming AI offers for the user's players (one wave) ────────────
// Deterministic per window key; controlled frequency + anti-spam cooldowns.
export function generateIncomingOffers(state) {
  const tm = migrateTransferMarket(state.transferMarket);
  const userTeamId = state.userTeamId;
  const windowKey = getWindowKey(state);
  const phase = state?.schedule?.phase;
  const offseasonish = phase === "offseason" || phase === "contracts" || phase === "preChamps";

  // Window budget for how many offers can arrive (kept calm).
  const seedBase = `${windowKey}:${userTeamId}:${tm.waveNonce}`;
  const maxOffers = offseasonish ? 2 : (unit(seedBase + ":freq") < 0.5 ? 1 : 0);
  if (maxOffers === 0) return [];

  const userPlayers = state.players.filter(p => p.teamId === userTeamId && !isInactivePlayer(p));
  const aiTeams = CDL_TEAMS.map(t => t.id).filter(id => id !== userTeamId);

  // Score all (team, player) pairs, take the strongest, de-duped per player.
  const candidates = [];
  for (const buyerTeamId of aiTeams) {
    for (const player of userPlayers) {
      const cdKey = `${buyerTeamId}:${player.id}`;
      if (tm.cooldowns[cdKey] === windowKey) continue;                       // already approached this window
      if (tm.recentlyTransferred[player.id]) continue;                       // protected after a move
      // Don't re-offer if a live negotiation already exists for this pair.
      if (tm.negotiations.some(n => n.status === "Pending" && n.playerId === player.id && n.fromTeamId === buyerTeamId)) continue;
      const interest = aiInterestInPlayer(state, buyerTeamId, player);
      if (!interest) continue;
      // Deterministic gate so not every interested team bids.
      const roll = unit(`${seedBase}:${buyerTeamId}:${player.id}`);
      if (roll > 0.45 + interest.score * 0.4) continue;
      candidates.push({ buyerTeamId, player, interest, roll });
    }
  }
  candidates.sort((a, b) => (b.interest.score - a.interest.score) || (a.roll - b.roll));

  const offers = [];
  const usedPlayers = new Set();
  let id = tm.nextId;
  for (const c of candidates) {
    if (offers.length >= maxOffers) break;
    if (usedPlayers.has(c.player.id)) continue;
    usedPlayers.add(c.player.id);
    // Opening fee: a bit below valuation (room to negotiate), listed players lower.
    const val = c.interest.valuation;
    const listed = isTransferListed(c.player, state);
    const fee = round5k(val * (listed ? 0.8 : 0.85 + unit(`${seedBase}:${c.player.id}:fee`) * 0.08));
    offers.push({
      id: `tr_${id++}`,
      fromTeamId: c.buyerTeamId, toTeamId: userTeamId, playerId: c.player.id,
      offerType: "buyout", fee, includedPlayerIds: [],
      status: "Pending", counterFee: null, counterBy: null, round: 0,
      initiator: "ai", reason: c.interest.reason,
      season: state.season, stageIdx: state.schedule?.stageIdx ?? 0, phase: state.schedule?.phase,
      createdKey: windowKey, expiresKey: windowKey,
      history: [{ by: c.buyerTeamId, action: "offer", fee }],
    });
  }
  return offers;
}

// ── Apply a completed transfer (player moves buyer←seller) ───────────────────
// Returns { players, transferMarket, feed, notif, blockedReason }. Does not run
// integrity itself (the reducer runs ensureCdlRosterIntegrity afterwards).
export function buildTransferResult(state, neg, agreedFee, terms = {}) {
  const buyerTeamId = neg.fromTeamId;
  const sellerTeamId = neg.toTeamId;
  const player = state.players.find(p => p.id === neg.playerId);
  if (!player || player.teamId !== sellerTeamId) {
    return { blockedReason: "Player is no longer available." };
  }
  const agreedTerms = buildDefaultTransferTerms(state, neg, terms);
  const salary = agreedTerms.salary;
  const contractYears = agreedTerms.contractYears;
  const promisedRole = agreedTerms.promisedRole;
  const userIsBuyer = buyerTeamId === state.userTeamId;

  // Determine destination slot.
  const buyerStarters = getActiveStarters(state.players, buyerTeamId);
  let asSub = false;
  let releaseId = null;
  if (userIsBuyer && buyerStarters.length < 4) {
    asSub = false; // user signings fill open starter slots by default
  } else if (promisedRole === "Substitute" || promisedRole === "Prospect") {
    asSub = true;
  } else if (buyerStarters.length >= 4) {
    if (userIsBuyer) {
      asSub = true; // full user lineups place new arrivals on the bench
    } else {
      // AI frees its weakest starter (not the target's slot) to FA.
      const weakest = [...buyerStarters].sort((a, b) => (a.overall ?? 70) - (b.overall ?? 70))[0];
      releaseId = weakest?.id ?? null;
    }
  }

  // Salary-cap check for the buyer (subs are cap-free; AI release frees room).
  if (!asSub) {
    const room = capRoomForStarter(state, buyerTeamId, salary, releaseId);
    if (room < 0) {
      if (userIsBuyer) return { blockedReason: `Over salary cap — wages exceed cap by ${fmtFee(-room)}.` };
      // AI shouldn't reach here (affordability pre-checked); bail safely.
      return { blockedReason: "Buyer cannot fit wages." };
    }
  }

  const tm = migrateTransferMarket(state.transferMarket);
  const windowKey = getWindowKey(state);

  // Move the player.
  const players = state.players.map(p => {
    if (p.id === player.id) {
      const hist = p.teamHistory || [];
      const teamHistory = hist.some(e => e.season === state.season)
        ? hist : [...hist, { season: state.season, teamId: buyerTeamId }];
      return {
        ...p, teamId: buyerTeamId, challengerTeamId: null, status: "cdl", circuit: "cdl",
        isSub: asSub, salary, contractYears: Math.max(1, contractYears), teamHistory,
        previousTeamId: sellerTeamId, promisedRole,
      };
    }
    if (p.id === releaseId) {
      return { ...p, teamId: null, challengerTeamId: null, isSub: false, status: "freeAgent", previousTeamId: buyerTeamId, contractYears: 0 };
    }
    return p;
  });

  // Budgets (display-only accounting separate from the salary cap).
  const buyerBudget = getTransferBudget(state, buyerTeamId);
  const sellerBudget = getTransferBudget(state, sellerTeamId);
  const budgets = {
    ...tm.budgets,
    [buyerTeamId]: { balance: round5k(buyerBudget.balance - agreedFee), spend: (buyerBudget.spend || 0) + agreedFee, income: buyerBudget.income || 0 },
    [sellerTeamId]: { balance: round5k(sellerBudget.balance + agreedFee), spend: sellerBudget.spend || 0, income: (sellerBudget.income || 0) + agreedFee },
  };

  // Withdraw any other live offers for the same player; mark this protected.
  const negotiations = tm.negotiations.map(n =>
    n.playerId === player.id && n.id !== neg.id && n.status === "Pending"
      ? { ...n, status: "Withdrawn", history: [...(n.history || []), { by: "system", action: "withdrawn-sold" }] }
      : n
  );
  const recentlyTransferred = { ...tm.recentlyTransferred, [player.id]: windowKey };
  // Clear any user-set status for the moved player.
  const status = { ...tm.status };
  delete status[player.id];

  const transferMarket = { ...tm, negotiations, budgets, recentlyTransferred, status };

  return { players, transferMarket, player, buyerTeamId, sellerTeamId, agreedFee, asSub, releaseId };
}

// ── Board nudge for the user after a sale/buy (small, clamped) ────────────────
export function boardNudgeForTransfer(boardState, { userIsSeller, player, fee, state }) {
  if (!boardState || typeof boardState.confidence !== "number") return boardState;
  const ovr = player.overall ?? 70;
  const val = getPlayerValuation(player, state);
  let delta = 0;
  if (userIsSeller) {
    if (ovr >= 85 && fee < val * 0.8) delta -= 4;            // sold a star cheaply
    else if (ovr >= 85) delta += 2;                          // cashed in on a star at value
    else if (fee > val) delta += 2;                          // good business
  } else {
    if (ovr >= 85) delta += 4;                               // statement signing
    else if (ovr >= 80) delta += 2;
  }
  if (delta === 0) return boardState;
  return { ...boardState, confidence: clamp(boardState.confidence + delta, 0, 100) };
}

// ── Convenience selectors for UI ─────────────────────────────────────────────
export function getIncomingOffers(state) {
  return (state?.transferMarket?.negotiations || []).filter(n => n.toTeamId === state.userTeamId && n.initiator === "ai");
}
export function getOutgoingOffers(state) {
  return (state?.transferMarket?.negotiations || []).filter(n => n.fromTeamId === state.userTeamId && n.initiator === "user");
}
export function getLeagueTransferListed(state) {
  const tm = state?.transferMarket;
  if (!tm?.status) return [];
  return Object.entries(tm.status)
    .filter(([, v]) => v.transferStatus === "Transfer Listed")
    .map(([pid]) => (state.players || []).find(p => p.id === pid))
    .filter(p => p && !isInactivePlayer(p) && p.teamId && isCdlTeamId(p.teamId));
}


export function estimateTransferAcceptanceChance(player, state, buyerTeamId = state?.userTeamId, fee = null) {
  if (!player || !state) return 0;
  const ask = getAskingPrice(player, state);
  const amount = fee ?? ask;
  const resp = evaluateSellResponse(state, player, buyerTeamId, amount);
  if (resp.decision === "accept") return 78;
  if (resp.decision === "counter") return 46;
  const prot = getProtectedPlayerInfo(player, state, buyerTeamId);
  return prot.level >= 7 ? 6 : prot.protected ? 16 : 28;
}

export function getInterestedTeamsForPlayer(player, state) {
  if (!player || !state) return [];
  return CDL_TEAMS.map(t => t.id).filter(id => id !== player.teamId).map(id => ({ id, interest: aiInterestInPlayer(state, id, player) })).filter(x => x.interest).sort((a,b)=>b.interest.score-a.interest.score).slice(0,3);
}
