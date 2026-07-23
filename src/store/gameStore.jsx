// src/store/gameStore.jsx
// Central game state manager using React Context + useReducer.
// Handles: new game, load/save (localStorage), all sim actions.

import { createContext, useContext, useReducer } from "react";
import { buildInitialRoster } from "../data/players.js";
import { generateProspects } from "../data/prospects.js";
import { applyChallengerRatingOverride } from "../data/challengerRatingOverrides.js";
import { buildCdlRosterNameSet, findDuplicateActivePlayers, isCdlTeamId, isInactivePlayer, normalizePlayerName } from "../utils/playerIdentity.js";
import { buildSeason, simNextMatch, simMatchday, simUserMatchday, simStage, simMajor, simNextMajorMatch, simMajorRound, advanceOffseason, beginChamps, beginEswc, enterContractPhase, commitUserMatchResult, ensureChallengerTeams, buildChallengerRostersForNewGame, simChallengerQualifier, simNextChallengerQualifierMatch, simChallengerQualifierRound, simUserChallengerQualifierMatch, continueFromChallengerQualifier } from "../engine/seasonEngine.js";
import { generateMajorFeed, generateChallengerQualFeed, generateRosterMoveFeed, generateOffseasonFeed } from "../engine/feedGenerator.js";
import { ensureCdlRosterIntegrity, getSigningCost, getTeamCap } from "../engine/rosterAI.js";
import { buildContractDemand, evaluateContractOffer, getContractMemory, CONTRACT_MEMORY, migrateContractState, makePendingContractOffer, buildOffseasonCalendar } from "../engine/contractNegotiation.js";
import { isChallengerMode, getChallengerRosterPlayers, getUserChallengerTeam } from "../utils/userTeam.js";
import { generateChallengerBuyoutOffers, applyChallengerBuyout, buildBuyoutTransaction, isChallengerMarketOpen, getChallengerWindowKey } from "../engine/challengerMarket.js";
import { canAffordStarterResign } from "../utils/contractBudget.js";
import { getRosterIncompleteMessage, getTeamRosterStatus, getRequiredStarters } from "../utils/rosterValidation.js";
import { autoPickStarterIds, getStarters, resolveSigningSlot } from "../utils/rosterSlots.js";
import { CDL_TEAMS, resetTeamBranding } from "../data/teams.js";
import { isValidGameState, isValidTeamId, findPhaseInvariantViolations } from "./gameValidation.js";
import { migrateStaff, hireStaff, fireStaff, ensureTeamStaff, roleLabel } from "../engine/staffEngine.js";
import { migrateBoardState, buildBoardObjectives, objectivesNeedRegen, BOARD_OBJ_VERSION, nudgeConfidenceAfterMajor, runBoardReview } from "../engine/boardEngine.js";
import {
  migratePlayerMorale, applyResultMorale, applyMajorMorale, evaluateAllPromises,
  applyBenchEvent, applyPromoteEvent, applyReleaseEvent, applyBlockedMoveEvent,
  applyTransferInterestEvent, applyNewContractEvent, applySignedEvent,
  applyConversationChoice, makePromise, getConversationFor, getManagerResponsesForTopic, getMorale, PROMISE_TYPES,
  ensureMoraleConversationState, delayMoraleConversationEvent, dismissMoraleConversationEvent,
} from "../engine/moraleEngine.js";
import { getMajorPlacementMap } from "../utils/historyProfiles.js";
import { ensureTeamMapProfiles } from "../engine/mapProfile.js";
import { migrateUserScouting, applyScout, toggleShortlist } from "../engine/scoutingEngine.js";
import {
  migrateTransferMarket, isTransferWindowOpen, getWindowKey, generateIncomingOffers,
  evaluateSellResponse, evaluateBuyerCounterResponse,
  buildTransferResult, boardNudgeForTransfer, getTransferBudget,
  isOutgoingTermsRequired, evaluatePlayerTerms,
  teamTag as trTeamTag, teamName as trTeamName0, fmtFee,
} from "../engine/transferEngine.js";
import {
  migrateEventCentre, pushEvents, addInboxEvent, markEventRead, markAllRead, dismissEvent,
  convertFeedToEvents,
  makeTransferOfferEvent, makeChallengerBuyoutEvent, makeTransferDoneEvent, makeTransferDevelopmentEvent,
  makeMoraleMeetingEvent, makePromiseAtRiskEvent, makePromiseBrokenEvent,
  makeBoardWarningEvent, makeBoardConfidenceUpEvent, makeBoardObjectiveEvent,
  makeScoutReportEvent, makeContractReviewEvent, makeFreeAgencyOpenEvent,
  makePlayerWantsOutEvent, makeBlockedMoveEvent, makeMajorDrawEvent,
  makeTournamentChampionEvent, makeUserEliminatedEvent, makeMajorSummaryEvent, makeAwardEvent,
  makeUserAwardEvent, makeStageSimSummaryEvent, makeUserMatchResultEvent,
  makeOffseasonStartEvent, makeStandoutPerformanceEvent, makeContractNegotiationEvent,
  makeAssistantGmRecommendation, makeRivalSigningEvent, makeEraTransitionEvents,
  generateMatchInboxEvents,
} from "../engine/eventCentreEngine.js";
import { createHistoricalStateFields, createHistoricalCareer, migrateHistoricalDynastyState, introduceHistoricalRookieClass } from "../engine/historicalDynasty.js";
import { ensureOpenCircuitSeason, advanceOpenCircuitEvent, simCircuitToNextMajor, stateUsesOpenCircuit } from "../engine/openCircuitCareer.js";
import { buildCircuitTournament, simCircuitAiUntilUser, applyUserCircuitResult, finalizeCircuitTournament } from "../engine/circuitTournament.js";
import { applyEraTeamBranding } from "../data/historicalTeams.js";
import { HISTORICAL_START_ERA_ID, MODERN_ERA_ID } from "../data/codEras.js";

const SAVE_KEY  = "cdl_manager_save";
const FEED_CAP  = 200;

// ── Feed helpers ──────────────────────────────────────────────────────────────
// Each feed item: { id, type, message, season, phase, read }
// id is derived from feed length at insertion — unique and stable per session.

function mkFeed(type, message, season, phase) {
  return { type, message, season: season ?? 1, phase: phase ?? "stage", read: false };
}

function pushFeed(state, items) {
  if (!items.length) return state;
  const base    = state.feed?.length ?? 0;
  const stamped = items.map((item, i) => ({ ...item, id: `f_${base + i}` }));
  const combined = [...(state.feed ?? []), ...stamped];
  const feed = combined.length > FEED_CAP ? combined.slice(combined.length - FEED_CAP) : combined;
  return { ...state, feed };
}

function applyContractTalkResult(state, player, evalResult, offer) {
  const old = getContractMemory(state, player.id);
  const flags = new Set(old.flags || []);
  let lowballs = old.lowballs || 0;
  let rejectedOffers = old.rejectedOffers || 0;
  let stalledTalks = old.stalledTalks || 0;
  if (evalResult.outcome === "accept") flags.add(CONTRACT_MEMORY.HAPPY);
  else {
    rejectedOffers += 1;
    stalledTalks += ["wait_market", "stronger_interest"].includes(evalResult.reason) ? 1 : 0;
    if (evalResult.reason === "lowball") { flags.add(CONTRACT_MEMORY.LOWBALL); lowballs += 1; }
    if (lowballs >= 2) flags.add(CONTRACT_MEMORY.OFFENDED);
    if (evalResult.reason === "wait_market") flags.add(CONTRACT_MEMORY.MARKET);
    if (evalResult.reason === "starter_promise") flags.add(CONTRACT_MEMORY.ROLE);
    if (evalResult.reason === "stronger_interest") flags.add(CONTRACT_MEMORY.CONTENDER);
    flags.add(CONTRACT_MEMORY.STALLED);
  }
  const morale = { ...(state.playerMorale || {}) };
  const entry = morale[player.id];
  if (entry) {
    const delta = evalResult.outcome === "accept" ? 4 : evalResult.reason === "lowball" ? -8 : -3;
    morale[player.id] = { ...entry, level: Math.max(0, Math.min(100, (entry.level ?? 65) + delta)), trust: Math.max(0, Math.min(100, (entry.trust ?? 65) + delta)) };
  }
  const acceptedPromises = [offer.starterStatus === "starter" && "starter_role", offer.developmentPromise && "development_focus", offer.transferReviewPromise && "consider_offers"].filter(Boolean);
  let next = { ...state, playerMorale: morale, contractNegotiations: { ...(state.contractNegotiations || {}), [player.id]: { ...old, attempts: (old.attempts || 0) + 1, lowballs, rejectedOffers, stalledTalks, flags: [...flags], lastOffer: offer, pendingOffer: null, responseDueDay: null, lastOutcome: evalResult.reason, talksStatus: evalResult.outcome === "accept" ? "Accepted" : evalResult.reason === "wait_market" ? "Will test market" : evalResult.reason === "lowball" ? "Talks ongoing" : "Rejected", acceptedPromises: evalResult.outcome === "accept" ? acceptedPromises : (old.acceptedPromises || []), wantsToTestMarket: evalResult.reason === "wait_market", waitingForRivalInterest: evalResult.reason === "stronger_interest" } } };
  next = pushInboxEvents(next, [makeContractNegotiationEvent(player, evalResult, next)]);
  return next;
}

function queueContractOffer(state, player, offer, opts = {}) {
  const pending = makePendingContractOffer(state, player, offer, opts);
  const old = getContractMemory(state, player.id);
  const memory = { ...old, lastOffer: offer, pendingOffer: pending, responseDueDay: pending.responseDueDay, talksStatus: old.attempts ? "Talks ongoing" : "Offer pending" };
  const next = { ...state, calendar: state.calendar || buildOffseasonCalendar(state), contractNegotiations: { ...(state.contractNegotiations || {}), [player.id]: memory } };
  return addNotif(next, `${player.name}'s camp will respond in ${pending.responseDueDay - (next.calendar?.day ?? 0)} day(s).`);
}

function applyAcceptedContract(state, player, offer) {
  let next = { ...state, players: state.players.map(p => p.id === player.id ? { ...p, contractYears: offer.years, ...(offer.salary != null ? { salary: offer.salary } : {}) } : p) };
  if (offer.starterStatus === "starter") next = makePromise(next, player.id, "starter_role");
  if (offer.developmentPromise) next = makePromise(next, player.id, "development_focus");
  if (offer.transferReviewPromise) next = makePromise(next, player.id, "consider_offers");
  return evaluateAllPromises(applyNewContractEvent(next, player));
}

function resolveDueContractOffers(state) {
  const day = Number(state.calendar?.day ?? 0);
  let next = state;
  for (const [playerId, mem] of Object.entries(state.contractNegotiations || {})) {
    if (!mem?.pendingOffer || Number(mem.responseDueDay) > day) continue;
    const player = next.players.find(p => p.id === playerId);
    if (!player) continue;
    if (mem.pendingOffer.outcome === "accept") next = applyAcceptedContract(next, player, mem.pendingOffer.demand ? mem.lastOffer : mem.lastOffer);
    next = applyContractTalkResult(next, player, mem.pendingOffer, mem.lastOffer);
  }
  return next;
}

// ── Team rank helper ──────────────────────────────────────────────────────────
function teamRank(standings, teamId) {
  const sorted = Object.entries(standings ?? {}).sort((a, b) => b[1].points - a[1].points);
  const idx = sorted.findIndex(([id]) => id === teamId);
  return idx >= 0 ? idx + 1 : 0;
}


// ── Streak detection ──────────────────────────────────────────────────────────
// Called after stage sims. `fullLog` is the final log; `prevLen` is how many
// entries existed before the sim ran (captured as a number, immune to mutation).
function detectStreakFeed(fullLog, prevLen, season) {
  const items = [];
  const newStageMatches = fullLog.slice(prevLen).filter(m => !m.stage?.includes("–"));
  if (!newStageMatches.length) return items;

  const teamsPlayed = new Set();
  newStageMatches.forEach(m => { teamsPlayed.add(m.winnerId); teamsPlayed.add(m.loserId); });

  for (const teamId of teamsPlayed) {
    const stageLog = fullLog.filter(
      m => (m.winnerId === teamId || m.loserId === teamId) && !m.stage?.includes("–")
    );
    if (stageLog.length < 3) continue;

    const last3 = stageLog.slice(-3);
    const prev4 = stageLog.length >= 4 ? stageLog[stageLog.length - 4] : null;

    const allWin  = last3.every(m => m.winnerId === teamId);
    const allLoss = last3.every(m => m.loserId  === teamId);
    if (!allWin && !allLoss) continue;

    // Only emit when streak JUST hit 3 (the 4th-back went the other way)
    const justStarted = !prev4
      || (allWin  && prev4.loserId  === teamId)
      || (allLoss && prev4.winnerId === teamId);
    if (!justStarted) continue;

    const tag = CDL_TEAMS.find(t => t.id === teamId)?.tag ?? teamId;
    if (allWin)  items.push(mkFeed("win_streak",  `${tag} win 3 straight`,    season, "stage"));
    if (allLoss) items.push(mkFeed("lose_streak", `${tag} drop 3 in a row`,   season, "stage"));
  }
  return items;
}

// ── Standings change detection (user team only) ───────────────────────────────
// prevRank captured as a number before mutation — immune to in-place updates.
function detectStandingsFeed(prevRank, newStandings, userTeamId, season, phase) {
  const items = [];
  if (!userTeamId || !prevRank) return items;
  const newRank = teamRank(newStandings, userTeamId);
  const tag     = CDL_TEAMS.find(t => t.id === userTeamId)?.tag ?? userTeamId;
  if (prevRank > 4 && newRank <= 4)
    items.push(mkFeed("top4_climb", `${tag} move into top 4`, season, phase ?? "stage"));
  if (prevRank <= 8 && newRank > 8)
    items.push(mkFeed("out_top8",   `${tag} fall out of top 8`, season, phase ?? "stage"));
  return items;
}



function blockIfUserRosterInvalid(state) {
  const message = getRosterIncompleteMessage(state);
  return message ? addNotif(state, message) : null;
}

function runIfUserRosterValid(state, runner) {
  const blocked = blockIfUserRosterInvalid(state);
  return blocked ?? runner();
}

function blockIfUserOffseasonAdvanceInvalid(state) {
  // Contract review may intentionally create openings; the user gets the next
  // offseason hub/free-agency screen to repair them before the new season starts.
  if (state?.schedule?.phase === "contracts") return null;
  return blockIfUserRosterInvalid(state);
}

function shouldRetireOnRelease(player) {
  return (player.age ?? 25) >= 33 || ((player.age ?? 25) >= 30 && (player.overall ?? 70) < 70);
}

function shouldMoveToChallengersOnRelease(player) {
  return ((player.overall ?? 70) >= 75 || (player.age ?? 25) < 29) && !shouldRetireOnRelease(player);
}

function txKey(tx) {
  return [
    tx.season ?? "",
    tx.stageIdx ?? "",
    tx.majorIdx ?? "",
    tx.type ?? "",
    tx.playerId ?? normalizePlayerName(tx.playerName),
    normalizePlayerName(tx.playerName),
    tx.fromTeamId ?? "",
    tx.toTeamId ?? "",
  ].join("|");
}

function pushChallengerTransaction(transactions, state, entry) {
  const playerName = entry.playerName || entry.name;
  if (!entry?.type || !playerName) return transactions || [];
  const tx = {
    season: state.season,
    stageIdx: state.schedule?.stageIdx ?? null,
    majorIdx: state.schedule?.majorIdx ?? null,
    ...entry,
    playerName,
  };
  const key = txKey(tx);
  return (transactions || []).some((existing) => txKey(existing) === key)
    ? (transactions || [])
    : [...(transactions || []), tx];
}

function cdlRosterHasName(players, name, exceptId = null) {
  const key = normalizePlayerName(name);
  if (!key) return false;
  return (players || []).some((player) => (exceptId == null || player.id !== exceptId)
    && player.teamId && isCdlTeamId(player.teamId) && !isInactivePlayer(player)
    && normalizePlayerName(player.name) === key);
}

function cleanupDuplicateActiveAssignments(state) {
  const cdlNames = buildCdlRosterNameSet(state.players || []);
  const duplicateIds = new Set();
  for (const group of findDuplicateActivePlayers(state)) {
    for (const dup of group.duplicates) {
      if (dup.location !== "cdl") duplicateIds.add(dup.player.id);
    }
  }

  const prospects = (state.prospects || []).filter((prospect) => {
    const key = normalizePlayerName(prospect.name);
    return key && !cdlNames.has(key) && !duplicateIds.has(prospect.id) && !isInactivePlayer(prospect);
  });

  const players = (state.players || []).map((player) => {
    const key = normalizePlayerName(player.name);
    if (!player.teamId && key && (cdlNames.has(key) || duplicateIds.has(player.id))) {
      return { ...player, challengerTeamId: null, status: "duplicate_hidden" };
    }
    return player;
  });

  const validIds = new Set([...players, ...prospects].filter((player) => !isInactivePlayer(player)).map((player) => player.id));
  const nameById = new Map([...players, ...prospects].map((player) => [player.id, normalizePlayerName(player.name)]));
  const assignedNames = new Set();
  const challengerTeams = (state.challengerTeams || []).map((team) => {
    const playerIds = [];
    for (const pid of team.playerIds || []) {
      const key = nameById.get(pid);
      if (!pid || !validIds.has(pid) || !key || cdlNames.has(key) || assignedNames.has(key)) continue;
      playerIds.push(pid);
      assignedNames.add(key);
    }
    return { ...team, playerIds: playerIds.slice(0, 4) };
  });

  const cleaned = { ...state, players, prospects, challengerTeams };
  ensureChallengerTeams(cleaned);
  return cleaned;
}

// ── Initial state factory ─────────────────────────────────────────────────────
// userTeamType: "cdl" (manage a CDL franchise) | "challenger" (manage a
// Challenger team — a "Road to CDL" career). For challenger mode userTeamId is
// a Challenger team id and is validated against the freshly-built rosters.
function createInitialGameState(userTeamId, userTeamType = "cdl", seedOverride = null, careerMode = "modern", dynastyOptions = {}) {
  // Historical careers do not pass through the CDL/Challengers bootstrap.  The
  // roster DB is the world source of truth on day one; reconciliation is only
  // used by the later-era transition pipeline.
  if (careerMode === "historical") {
    const historical = createHistoricalCareer(HISTORICAL_START_ERA_ID, { userTeamId });
    let state = {
      userTeamId: `historical:${userTeamId}`, userTeamType: "historical", season: 1,
      notifications: [], feed: [], saveExists: true, enteredMajorIdx: null,
      playerSeasonStats: {}, playerOvrHistory: {}, challengersLog: [], challengerTransactions: [],
      seasonHistory: [], playerCareerHistory: [], teamCareerHistory: [], awards: [], pendingSeasonAwards: null, seenAwardsSeasons: [],
      staff: [], boardState: migrateBoardState(null), pendingBoardReview: null,
      userScouting: migrateUserScouting(null), transferMarket: migrateTransferMarket(null), challengerOffers: [], challengerFunds: 0,
      eventCentre: migrateEventCentre(null), contractNegotiations: {},
      ...createHistoricalStateFields(careerMode, dynastyOptions), ...historical,
    };
    // Build + simulate the data-driven open circuit (calendar, brackets, Pro
    // Points, 28-team ranking, results) via the real engine — this is what the
    // Circuit and Standings screens read.
    state = ensureOpenCircuitSeason(state);
    state.playerMorale = migratePlayerMorale(state);
    return ensureMoraleConversationState(state);
  }
  const challengerMode = userTeamType === "challenger";
  if (!challengerMode && !isValidTeamId(userTeamId)) return null;
  // Historical Dynasty starts with the era's real teams + players; the modern
  // career keeps the 2026 CDL rosters. Team branding is applied to the stable
  // slots below (via migrateHistoricalDynastyState / createHistoricalStateFields).
  const startEraId = careerMode === "historical" ? HISTORICAL_START_ERA_ID : MODERN_ERA_ID;
  applyEraTeamBranding(startEraId, careerMode);
  const players  = buildInitialRoster().map(applyChallengerRatingOverride);
  // When a seed is supplied (Challenger team-select preview), use it for the
  // prospect pool too so the previewed roster OVRs match the started save.
  const prospectSeed = seedOverride != null
    ? ((seedOverride % 999983) + 999983) % 999983
    : Date.now() % 999983;
  const rawProspects = generateProspects(prospectSeed).map(applyChallengerRatingOverride);
  const seen = new Set();
  const prospects = rawProspects.filter((p) => {
    const key = normalizePlayerName(p.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Generate a unique seed for this save's initial Challenger roster draft.
  // Two bits of entropy: milliseconds and a secondary counter derived from the
  // prospect generation seed, so rapid successive new-games still differ.
  const t = Date.now();
  const challengerDraftSeed = seedOverride != null
    ? (seedOverride | 0) || 1
    : ((t % 999983) * 1009 + (t % 97) * 37 + 1) | 0;
  const state = {
    userTeamId,
    userTeamType: challengerMode ? "challenger" : "cdl",
    season: 1,
    players,      // all pro players + any signed prospects (Roster reads from here)
    prospects,    // unsigned challengers pool only
    schedule: buildSeason(1),
    notifications: [],
    feed: [],
    saveExists: true,
    enteredMajorIdx:   null,  // tracks which major the user has "entered" past the intro gate
    playerSeasonStats: {},    // { [playerId]: [{ season, kills, deaths, matches }, ...] }
    playerOvrHistory:  {},    // { [playerId]: [{ season, overall }, ...] }
    challengersLog:    [],    // per-season challengers pool snapshots (for Pool Health panel)
    challengerTransactions: [],
    seasonHistory: [],
    playerCareerHistory: [],
    teamCareerHistory: [],
    awards: [],
    pendingSeasonAwards: null,
    seenAwardsSeasons: [],
    challengerDraftSeed,      // stored for reference; roster is already built — do not re-use
    staff: ensureTeamStaff(migrateStaff([])),
    boardState: migrateBoardState(null),
    pendingBoardReview: null,
    userScouting: migrateUserScouting(null),
    transferMarket: migrateTransferMarket(null),
    challengerOffers: [],   // CDL buyout offers for the user's Challenger players
    challengerFunds: 0,     // transfer income earned selling Challenger players
    eventCentre: migrateEventCentre(null),
    contractNegotiations: {},
    ...createHistoricalStateFields(careerMode, dynastyOptions),
  };
  // Build randomized starting Challenger rosters for this new save.
  buildChallengerRostersForNewGame(state, challengerDraftSeed);
  // For Challenger mode, the chosen team id must resolve against the built teams.
  if (challengerMode && !(state.challengerTeams || []).some(team => team.id === userTeamId)) return null;
  let finalState = ensureCdlRosterIntegrity(cleanupDuplicateActiveAssignments(state), { windowType: "new_game" });
  finalState = introduceHistoricalRookieClass(finalState, finalState.currentEraId);
  // Board objectives: CDL franchises use the Owner Expectations engine; Challenger
  // teams keep a neutral CDL boardState (unused) and read Challenger objectives live.
  finalState.boardState = challengerMode
    ? migrateBoardState(null)
    : regenBoardObjectives(finalState, finalState.boardState);
  // CDL 2026 map pool: generate every team's map/mode profile once at new game.
  finalState.teamMapProfiles = ensureTeamMapProfiles(finalState, { force: true });
  // Squad dynamics: seed neutral-positive morale for every rostered player.
  finalState.playerMorale = migratePlayerMorale(finalState);
  finalState = ensureMoraleConversationState(finalState);
  // Historical open-circuit (Ghosts-era) seasons build their data-driven circuit
  // — calendar, Pro Points, brackets — instead of the modern four-Major system.
  finalState = ensureOpenCircuitSeason(finalState);
  return finalState;
}

// ── Board objective (re)generation — sets objectives + explanatory meta ───────
// Generated at season start and stored in the save. Never call this on render.
function regenBoardObjectives(state, boardState) {
  const base = migrateBoardState(boardState);
  const { objectives, meta } = buildBoardObjectives({ ...state, boardState: base });
  return { ...base, objectives, meta, version: BOARD_OBJ_VERSION };
}

// ── Board nudge helper — applies after a Major completes ──────────────────────
function withMajorBoardNudge(beforeState, afterState, majorIdx) {
  if (afterState?.userTeamType === "challenger") return afterState;
  if (majorIdx == null || majorIdx > 3 || majorIdx < 0) return afterState;
  if (!afterState.boardState) return afterState;
  const wasCompleted = beforeState.schedule?.majors?.[majorIdx]?.completed ?? true;
  const nowCompleted = afterState.schedule?.majors?.[majorIdx]?.completed ?? false;
  if (!wasCompleted && nowCompleted) {
    const confBefore = afterState.boardState.confidence ?? 60;
    const nudged = nudgeConfidenceAfterMajor(afterState.boardState, afterState, majorIdx);
    let result = { ...afterState, boardState: nudged };
    const confAfter = nudged.confidence ?? 60;
    const band = confAfter >= 80 ? "Secure" : confAfter >= 60 ? "Stable" : confAfter >= 40 ? "Shaky" : confAfter >= 20 ? "At Risk" : "Critical";
    if (confAfter < confBefore && confAfter < 40) {
      result = pushInboxEvents(result, [makeBoardWarningEvent(confAfter, band, result)]);
    } else if (confAfter > confBefore && confAfter >= 60 && confBefore < 60) {
      result = pushInboxEvents(result, [makeBoardConfidenceUpEvent(confAfter, band, result)]);
    }
    return result;
  }
  return afterState;
}

// ── Morale nudge helper — applies after a Major / Champs completes ────────────
// Mirrors withMajorBoardNudge: when a major just completed, derive the user
// team's finishing placement and nudge squad morale + resolve any due promises.
// Works for both CDL and Challenger mode (Challenger user team has no CDL major
// placement, so it only resolves promises by deadline). Modest, bounded effects.
function withMajorMoraleNudge(beforeState, afterState, majorIdx) {
  if (majorIdx == null || !afterState) return afterState;
  const wasCompleted = beforeState.schedule?.majors?.[majorIdx]?.completed ?? true;
  const nowCompleted = afterState.schedule?.majors?.[majorIdx]?.completed ?? false;
  if (wasCompleted || !nowCompleted) return afterState;
  let next = afterState;
  if (afterState.userTeamType !== "challenger") {
    const major = afterState.schedule?.majors?.[majorIdx];
    const placement = getMajorPlacementMap(major)[afterState.userTeamId];
    if (placement != null) next = applyMajorMorale(next, placement);
  }
  return evaluateAllPromises(next);
}

// ── Inbox events helper — generates tournament events when a Major completes ──
function withMajorInboxEvents(beforeState, afterState, majorIdx, wasCompletedBefore = null) {
  if (majorIdx == null || !afterState) return afterState;
  const wasCompleted = wasCompletedBefore ?? (beforeState.schedule?.majors?.[majorIdx]?.completed ?? true);
  const nowCompleted = afterState.schedule?.majors?.[majorIdx]?.completed ?? false;
  if (wasCompleted || !nowCompleted) return afterState;
  const major = afterState.schedule?.majors?.[majorIdx];
  if (!major?.bracket) return afterState;
  const eventName = major.name ?? `Major ${majorIdx + 1}`;
  const events = [];
  const champion = major.bracket?.champion;
  if (champion) {
    const isUser = champion === afterState.userTeamId;
    const champName = CDL_TEAMS.find(t => t.id === champion)?.name ?? champion;
    events.push(makeTournamentChampionEvent(eventName, champName, isUser, afterState));
  }
  const placement = getMajorPlacementMap(major);
  const userPlace = placement[afterState.userTeamId];
  if (userPlace != null && userPlace > 2 && champion !== afterState.userTeamId) {
    events.push(makeUserEliminatedEvent(eventName, afterState));
  }
  events.push(makeMajorSummaryEvent(buildMajorSummaryPayload(afterState, major, majorIdx, placement), afterState));
  const withEvents = pushInboxEvents(afterState, events);
  return events.some(e => e.type === "major_summary") ? addNotif(withEvents, "Major recap added to Inbox") : withEvents;
}

function buildMajorSummaryPayload(state, major, majorIdx, placement) {
  const eventName = major.name ?? `Major ${majorIdx + 1}`;
  const userTeamId = state.userTeamId;
  const userMatches = (state.schedule?.matchLog || []).filter(m =>
    (m.stage || "").startsWith(`${eventName} `) || (m.stage || "").startsWith(`${eventName} –`)
  ).filter(m => m.teamAId === userTeamId || m.teamBId === userTeamId || m.teamA === userTeamId || m.teamB === userTeamId);
  const wins = userMatches.filter(m => m.winnerId === userTeamId).length;
  const losses = userMatches.filter(m => m.loserId === userTeamId).length;
  const stats = [];
  for (const match of userMatches) {
    for (const [playerId, ps] of Object.entries(match.playerStats || {})) {
      if (ps.teamId === userTeamId) stats.push({ playerId, name: ps.name, kd: ps.kd });
    }
  }
  const bestUserPlayer = stats.length ? stats.reduce((a, b) => (Number(b.kd || 0) > Number(a.kd || 0) ? b : a), stats[0]) : null;
  const mvpPlayer = userMatches.map(m => ({ playerId: m.standoutId, name: m.standoutName, kd: m.standoutKD })).filter(p => p.name)
    .sort((a, b) => Number(b.kd || 0) - Number(a.kd || 0))[0] || null;
  const majorNumber = majorIdx + 1;
  return {
    majorName: eventName,
    majorNumber,
    championId: major.bracket?.champion ?? null,
    userPlacement: placement?.[userTeamId],
    userRecord: userMatches.length ? `${wins}-${losses}` : null,
    userPoints: null,
    bestUserPlayer,
    mvpPlayer,
    nextPhaseMessage: majorIdx < 3 ? `Next up: Stage ${majorIdx + 2}.` : "Next up: the road to Champs continues.",
  };
}

// ── Reducer ──────────────────────────────────────────────────────────────────
export function __diagnoseReducer(state, action) {
  switch (action.type) {

    case "RESET_TO_TEAM_SELECT":
      // Clear any historical era branding so the team-select / next save starts
      // from the default modern franchises.
      resetTeamBranding();
      return null;

    case "NEW_GAME":
      return createInitialGameState(action.teamId, action.teamType, action.seed, action.careerMode, {
        historicalStrictness: action.historicalStrictness,
        dynastySeed: action.dynastySeed,
      });

    case "LOAD_GAME": {
      if (!action.state || !isValidGameState(action.state)) return null;

      // Backfill `feed` for saves that predate this feature
      const loaded = {
        ...action.state,
        // Existing saves are CDL manager saves — default to "cdl", never migrate
        // a CDL save into Challenger mode.
        userTeamType: action.state?.userTeamType === "challenger" ? "challenger" : "cdl",
        feed: action.state?.feed ?? [],
        seasonHistory: action.state?.seasonHistory ?? [],
        playerCareerHistory: action.state?.playerCareerHistory ?? [],
        teamCareerHistory: action.state?.teamCareerHistory ?? [],
        awards: action.state?.awards ?? [],
        pendingSeasonAwards: action.state?.pendingSeasonAwards ?? null,
        seenAwardsSeasons: action.state?.seenAwardsSeasons ?? [],
      };
      const migratedMajors = [...(loaded.schedule?.majors ?? [])];
      if (!migratedMajors[5]) migratedMajors[5] = { name: "ESWC", bracket: null, completed: false, eventType: "eswc", pointsAwarded: true };
      loaded.schedule = {
        ...loaded.schedule,
        majors: migratedMajors,
        challengerQualifierResults: loaded.schedule?.challengerQualifierResults ?? [],
        currentChallengerQualifier: loaded.schedule?.currentChallengerQualifier ?? null,
        currentMajorEventTeams: loaded.schedule?.currentMajorEventTeams ?? null,
      };
      ensureChallengerTeams(loaded);
      const loadedWithEra = migrateHistoricalDynastyState(loaded);
      const cleaned = ensureCdlRosterIntegrity(cleanupDuplicateActiveAssignments(loadedWithEra), { windowType: "load_migration" });
      cleaned.challengerTransactions = cleaned.challengerTransactions ?? [];
      // Migrate staff: old saves without staff get the full starting pool
      cleaned.staff = ensureTeamStaff(migrateStaff(cleaned.staff));
      // Migrate board state: old saves without boardState get a fresh one.
      // Also safely regenerate objectives if they are missing OR predate the
      // current (realism-fixed) objective logic — a one-time mid-season migration
      // that replaces clearly-invalid legacy objectives. Placement/Major/Champs
      // objectives evaluate from current standings, so regenerating mid-season is safe.
      cleaned.boardState = migrateBoardState(cleaned.boardState);
      // CDL franchises only — Challenger teams read their own objectives live.
      if (cleaned.userTeamType !== "challenger" && objectivesNeedRegen(cleaned.boardState)) {
        cleaned.boardState = regenBoardObjectives(cleaned, cleaned.boardState);
      }
      // Map pool: hydrate profiles for old saves; rebuild if stale (new season).
      cleaned.teamMapProfiles = ensureTeamMapProfiles(cleaned);
      // Prospect Scouting 2.0: hydrate the scouting visibility layer. Missing on
      // old saves → empty structure; estimates are derived lazily on view.
      cleaned.userScouting = migrateUserScouting(cleaned.userScouting);
      // Transfer / buyout negotiation layer: hydrate safely on old saves.
      cleaned.transferMarket = migrateTransferMarket(cleaned.transferMarket);
      // Challenger manager mode: buyout offers + transfer income (empty on CDL saves).
      cleaned.challengerOffers = Array.isArray(cleaned.challengerOffers) ? cleaned.challengerOffers : [];
      cleaned.challengerFunds = Number.isFinite(cleaned.challengerFunds) ? cleaned.challengerFunds : 0;
      // Player Morale / Squad Dynamics: hydrate safely on old saves. Missing →
      // neutral-positive morale for every rostered player; never mass unrest.
      cleaned.playerMorale = migratePlayerMorale(cleaned);
      // Event Centre: hydrate safely on old saves. Missing → empty structure;
      // old feed items are converted to events on first load.
      Object.assign(cleaned, migrateContractState(cleaned));
      cleaned.eventCentre = migrateEventCentre(cleaned.eventCentre);
      if (!cleaned.eventCentre.events.length && (cleaned.feed ?? []).length) {
        cleaned.eventCentre = pushEvents(cleaned.eventCentre, convertFeedToEvents(cleaned.feed));
      }
      let moraleCleaned = ensureMoraleConversationState(cleaned);
      // Save migration: rebuild the open-circuit season from persisted markers.
      // Idempotent — the build key prevents re-running / re-awarding on reload.
      moraleCleaned = ensureOpenCircuitSeason(moraleCleaned);
      return isValidGameState(moraleCleaned) ? moraleCleaned : null;
    }

    // ── Stage sims — detect streaks + standings changes ────────────────────
    case "SIM_NEXT_MATCH": {
      return runIfUserRosterValid(state, () => {
      const prevLogLen = state.schedule?.matchLog?.length ?? 0;
      const prevRank   = teamRank(state.schedule?.standings ?? {}, state.userTeamId);
      const season     = state.season;
      const newState   = applyResultMorale(simNextMatch({ ...state }), state);
      const withFeed = pushFeed(newState, [
        ...detectStreakFeed(newState.schedule?.matchLog ?? [], prevLogLen, season),
        ...detectStandingsFeed(prevRank, newState.schedule?.standings ?? {}, state.userTeamId, season, newState.schedule?.phase),
      ]);
      return withMoraleInboxEvents(state, withMatchInboxEvents(state, withFeed, prevLogLen));
      });
    }

    case "SIM_MATCHDAY": {
      return runIfUserRosterValid(state, () => {
      const prevLogLen = state.schedule?.matchLog?.length ?? 0;
      const prevRank   = teamRank(state.schedule?.standings ?? {}, state.userTeamId);
      const season     = state.season;
      const newState   = applyResultMorale(simMatchday({ ...state }), state);
      const withFeed = pushFeed(newState, [
        ...detectStreakFeed(newState.schedule?.matchLog ?? [], prevLogLen, season),
        ...detectStandingsFeed(prevRank, newState.schedule?.standings ?? {}, state.userTeamId, season, newState.schedule?.phase),
      ]);
      return withMoraleInboxEvents(state, withMatchInboxEvents(state, withFeed, prevLogLen));
      });
    }

    case "SIM_USER_MATCHDAY": {
      return runIfUserRosterValid(state, () => {
      const prevLogLen = state.schedule?.matchLog?.length ?? 0;
      const prevRank   = teamRank(state.schedule?.standings ?? {}, state.userTeamId);
      const season     = state.season;
      const newState   = applyResultMorale(simUserMatchday({ ...state }), state);
      const withFeed = pushFeed(newState, [
        ...detectStreakFeed(newState.schedule?.matchLog ?? [], prevLogLen, season),
        ...detectStandingsFeed(prevRank, newState.schedule?.standings ?? {}, state.userTeamId, season, newState.schedule?.phase),
      ]);
      return withMoraleInboxEvents(state, withMatchInboxEvents(state, withFeed, prevLogLen));
      });
    }

    // ── Open circuit: play the next tournament on the calendar ────────────
    case "SIM_NEXT_CIRCUIT_EVENT": {
      return runIfUserRosterValid(state, () => advanceOpenCircuitEvent(state));
    }

    case "SIM_CIRCUIT_TO_MAJOR": {
      return runIfUserRosterValid(state, () => simCircuitToNextMajor(state));
    }

    // ── Live open-circuit LAN/championship (interactive DE16 tournament) ───
    case "START_CIRCUIT_EVENT": {
      return runIfUserRosterValid(state, () => {
        const eventId = action.eventId || state.openCircuit?.nextEventId;
        const t = buildCircuitTournament(state, eventId);
        // Cups / non-bracket events fall back to the quick event sim.
        if (!t) return advanceOpenCircuitEvent(state);
        const step = simCircuitAiUntilUser(t, state);
        if (step.done) return { ...finalizeCircuitTournament(state, t), circuitTournament: { ...t, status: "complete" } };
        return { ...state, circuitTournament: t };
      });
    }

    case "CLOSE_CIRCUIT_TOURNAMENT":
      return { ...state, circuitTournament: null };

    case "SIM_STAGE": {
      return runIfUserRosterValid(state, () => {
      const prevLogLen = state.schedule?.matchLog?.length ?? 0;
      const prevRank   = teamRank(state.schedule?.standings ?? {}, state.userTeamId);
      const season     = state.season;
      const newState   = applyResultMorale(simStage({ ...state }), state);
      const withFeed = pushFeed(newState, [
        ...detectStreakFeed(newState.schedule?.matchLog ?? [], prevLogLen, season),
        ...detectStandingsFeed(prevRank, newState.schedule?.standings ?? {}, state.userTeamId, season, newState.schedule?.phase),
      ]);
      return withMoraleInboxEvents(state, withMatchInboxEvents(state, withFeed, prevLogLen));
      });
    }

    // ── Major sims — detect champion + eliminations + K/D leader ──────────
    case "SIM_MAJOR": {
      return runIfUserRosterValid(state, () => {
      const majorIdx     = state.schedule?.majorIdx;
      const wasCompleted = state.schedule?.majors?.[majorIdx]?.completed ?? true;
      const prevLogLen = state.schedule?.matchLog?.length ?? 0;
      const newState     = simMajor({ ...state });
      const withFeed = pushFeed(newState, generateMajorFeed(wasCompleted, newState, majorIdx));
      const withBoard = withMajorBoardNudge(state, withFeed, majorIdx);
      const withMorale = withMajorMoraleNudge(state, withBoard, majorIdx);
      return withMatchInboxEvents(state, withMajorInboxEvents(state, withMorale, majorIdx, wasCompleted), prevLogLen);
      });
    }

    case "SIM_NEXT_MAJOR_MATCH": {
      return runIfUserRosterValid(state, () => {
      const majorIdx     = state.schedule?.majorIdx;
      const wasCompleted = state.schedule?.majors?.[majorIdx]?.completed ?? true;
      const prevLogLen = state.schedule?.matchLog?.length ?? 0;
      const newState     = simNextMajorMatch({ ...state });
      const withFeed = pushFeed(newState, generateMajorFeed(wasCompleted, newState, majorIdx));
      const withBoard = withMajorBoardNudge(state, withFeed, majorIdx);
      const withMorale = withMajorMoraleNudge(state, withBoard, majorIdx);
      return withMatchInboxEvents(state, withMajorInboxEvents(state, withMorale, majorIdx, wasCompleted), prevLogLen);
      });
    }

    case "SIM_MAJOR_ROUND": {
      return runIfUserRosterValid(state, () => {
      const majorIdx     = state.schedule?.majorIdx;
      const wasCompleted = state.schedule?.majors?.[majorIdx]?.completed ?? true;
      const prevLogLen = state.schedule?.matchLog?.length ?? 0;
      const newState     = simMajorRound({ ...state });
      const withFeed = pushFeed(newState, generateMajorFeed(wasCompleted, newState, majorIdx));
      const withBoard = withMajorBoardNudge(state, withFeed, majorIdx);
      const withMorale = withMajorMoraleNudge(state, withBoard, majorIdx);
      return withMatchInboxEvents(state, withMajorInboxEvents(state, withMorale, majorIdx, wasCompleted), prevLogLen);
      });
    }

    // ── Interactive match result from MatchCenterOverlay ──────────────
    case "COMMIT_USER_MATCH_RESULT": {
      // Live open-circuit tournament: apply the user's real Match Center result
      // to their bracket match, resume AI, and finalise when the bracket ends.
      if (state.circuitTournament?.status === "active") {
        const t = JSON.parse(JSON.stringify(state.circuitTournament));
        const step = applyUserCircuitResult(t, state, action.result);
        if (step.done) return { ...finalizeCircuitTournament(state, t), circuitTournament: { ...t, status: "complete" } };
        return { ...state, circuitTournament: t };
      }
      return runIfUserRosterValid(state, () => {
      const majorIdx     = state.schedule?.majorIdx;
      const wasCompleted = majorIdx != null
        ? (state.schedule?.majors?.[majorIdx]?.completed ?? true)
        : true;
      const prevLogLen = state.schedule?.matchLog?.length ?? 0;
      const prevRank   = teamRank(state.schedule?.standings ?? {}, state.userTeamId);
      const season     = state.season;

      const newState = commitUserMatchResult({ ...state }, action.result);

      const feedItems = [
        ...detectStreakFeed(newState.schedule?.matchLog ?? [], prevLogLen, season),
        ...detectStandingsFeed(prevRank, newState.schedule?.standings ?? {}, state.userTeamId, season, newState.schedule?.phase),
        ...(majorIdx != null ? generateMajorFeed(wasCompleted, newState, majorIdx) : []),
      ];
      const result = pushFeed(newState, feedItems);
      const withBoard = withMajorBoardNudge(state, result, majorIdx);
      const withMorale = majorIdx != null ? withMajorMoraleNudge(state, withBoard, majorIdx) : withBoard;
      const withInbox = majorIdx != null ? withMajorInboxEvents(state, withMorale, majorIdx, wasCompleted) : withMorale;
      return withMoraleInboxEvents(state, withMatchInboxEvents(state, withInbox, prevLogLen));
      });
    }

    case "ENTER_MAJOR":
      return runIfUserRosterValid(state, () => {
        const majorIdx = action.majorIdx;
        const majorName = state.schedule?.majors?.[majorIdx]?.name ?? `Major ${(majorIdx ?? 0) + 1}`;
        let next = { ...state, enteredMajorIdx: majorIdx };
        next = pushInboxEvents(next, [makeMajorDrawEvent(majorName, majorIdx, next)]);
        return next;
      });

    case "DISMISS_MAJOR":
      return { ...state, enteredMajorIdx: null };

    case "SIM_CHALLENGER_QUALIFIER":
      return runIfUserRosterValid(state, () => simChallengerQualifier({ ...state }));

    case "SIM_NEXT_CHALLENGER_QUALIFIER_MATCH":
      return runIfUserRosterValid(state, () => simNextChallengerQualifierMatch({ ...state }));

    case "SIM_CHALLENGER_QUALIFIER_ROUND":
      return runIfUserRosterValid(state, () => simChallengerQualifierRound({ ...state }));

    case "SIM_USER_CHALLENGER_QUALIFIER_MATCH":
      return runIfUserRosterValid(state, () => simUserChallengerQualifierMatch({ ...state }));

    case "CONTINUE_FROM_CHALLENGER_QUALIFIER": {
      return runIfUserRosterValid(state, () => {
        const event = state.schedule?.currentChallengerQualifier;
        const majorIdx = state.schedule?.majorIdx ?? state.schedule?.stageIdx ?? 0;
        const newState = continueFromChallengerQualifier({ ...state });
        if (event?.eventType === "challengersFinals") {
          const winner = event.results?.find(r => r.placement === 1);
          const eswcTeams = (event.results || []).filter(r => r.qualified).sort((a, b) => a.placement - b.placement).map(r => r.teamName).join(", ");
          return pushFeed(newState, [
            ...(winner ? [mkFeed("challengers_finals", `${winner.teamName} win Challengers Finals`, newState.season, "challengerQualifier")] : []),
            ...(eswcTeams ? [mkFeed("eswc_field", `Challenger ESWC qualifiers: ${eswcTeams}`, newState.season, "challengerQualifier")] : []),
          ]);
        }
        return pushFeed(newState, generateChallengerQualFeed(newState, majorIdx));
      });
    }

    case "BEGIN_CHAMPS":
      return runIfUserRosterValid(state, () => beginChamps({ ...state }));

    case "ENTER_CONTRACT_PHASE": {
      if (state.pendingSeasonAwards) return state;
      let contractState = enterContractPhase({ ...state });
      const expiring = (contractState.players ?? []).filter(p => p.teamId === contractState.userTeamId && p.contractYears === 1 && !p.isSub).length;
      if (expiring > 0) {
        contractState = pushInboxEvents(contractState, [makeContractReviewEvent(expiring, contractState)]);
      }
      return contractState;
    }

    case "CONTINUE_FROM_SEASON_AWARDS": {
      const season = Number(action.season ?? state.pendingSeasonAwards?.season);
      const seenAwardsSeasons = Number.isFinite(season)
        ? [...new Set([...(state.seenAwardsSeasons || []).map(Number), season])]
        : (state.seenAwardsSeasons || []);
      const baseState = { ...state, pendingSeasonAwards: null, seenAwardsSeasons, enteredMajorIdx: null };
      // CDL franchises get a board review; Challenger teams have no CDL board.
      const reviewedState = state.userTeamType === "challenger"
        ? baseState
        : (() => {
            const currentBoard = migrateBoardState(baseState.boardState);
            const { newBoardState, pendingBoardReview } = runBoardReview(currentBoard, baseState);
            return { ...baseState, boardState: newBoardState, pendingBoardReview };
          })();
      return reviewedState.schedule?.pendingPostChampsEswc ? beginEswc(reviewedState) : reviewedState;
    }

    // ── Offseason — retirements, prospect class, notable AI signings, roster moves ──
    case "ACK_ERA_TRANSITION":
      return { ...state, pendingEraTransition: null };

    case "ADVANCE_OFFSEASON": {
      const blocked = blockIfUserOffseasonAdvanceInvalid(state);
      if (blocked) return blocked;
      const runAdvance = () => {
      const prevRetiredLen = state.retiredPlayers?.length ?? 0;
      const prevFreeIds    = new Set(
        (state.players ?? []).filter(p => !p.teamId).map(p => p.id)
      );
      const prevMovesLen = state.rosterMovesLog?.length ?? 0;
      const season       = state.season; // outgoing season

      const advanced = advanceOffseason({ ...state });
      const newState = { ...migrateHistoricalDynastyState(advanced), enteredMajorIdx: null, pendingBoardReview: null };
      // New season → regenerate every team's map profile from the updated rosters.
      newState.teamMapProfiles = ensureTeamMapProfiles(newState, { force: true });

      const challengerMode = newState.userTeamType === "challenger";
      // CDL franchises: build new owner objectives + a mandate feed item.
      // Challenger teams: no CDL board; objectives are derived live each render.
      const stateWithBoard = challengerMode
        ? newState
        : { ...newState, boardState: { ...regenBoardObjectives(newState, newState.boardState), verdict: null } };
      const boardFeedItems = [];
      if (!challengerMode) {
        const tag = CDL_TEAMS.find(t => t.id === newState.userTeamId)?.tag ?? "Owner";
        const bs = stateWithBoard.boardState;
        const primObj = bs.objectives.find(o => o.weight === "primary");
        const secObjs = bs.objectives.filter(o => o.weight === "secondary");
        boardFeedItems.push(mkFeed(
          "board_mandate",
          `${tag} owner sets Season ${newState.season} mandate — ${primObj?.label ?? ""}${secObjs.length ? "; " + secObjs.map(o => o.label).join(", ") : ""}`,
          newState.season,
          "stage"
        ));
      }

      // Squad dynamics: hydrate morale for new-season rosters (new signings get
      // entries; departed players keep theirs) and resolve any promises whose
      // deadline has now passed (e.g. contract talks promised "in the offseason").
      const moraledOffseason = evaluateAllPromises({
        ...stateWithBoard,
        playerMorale: migratePlayerMorale(stateWithBoard),
      });
      let finalOffseasonState = pushFeed(moraledOffseason, [
        ...boardFeedItems,
        ...generateOffseasonFeed(prevRetiredLen, prevFreeIds, moraledOffseason, season),
        ...generateRosterMoveFeed(moraledOffseason, prevMovesLen),
      ]);
      // Inbox events: board objectives set + offseason start
      const offseasonEvents = [];
      if (!challengerMode) offseasonEvents.push(makeBoardObjectiveEvent(finalOffseasonState));
      offseasonEvents.push(makeOffseasonStartEvent(season, finalOffseasonState));
      // Historical Dynasty: announce the new title / ruleset / roster-size change.
      offseasonEvents.push(...makeEraTransitionEvents(finalOffseasonState));
      finalOffseasonState = pushInboxEvents(finalOffseasonState, offseasonEvents);
      // New COD title / season → rebuild the open-circuit season for open-circuit
      // eras (Ghosts…). Idempotent via the era+season build key; also archives
      // the previous title's Pro Points and generates roster-change inbox news.
      finalOffseasonState = ensureOpenCircuitSeason(finalOffseasonState);
      return finalOffseasonState;
      };
      return state.schedule?.phase === "contracts" ? runAdvance() : runIfUserRosterValid(state, runAdvance);
    }

    // ── RE-SIGN PLAYER ────────────────────────────────────────────────────────
    case "RESIGN_PLAYER": {
      const { playerId, years, salary } = action;
      const player = state.players.find(p => p.id === playerId);
      if (!player || player.teamId !== state.userTeamId) return state;
      const offer = { years, salary, rolePromise: action.rolePromise, starterStatus: action.starterStatus, signingBonus: action.signingBonus, yearlyRise: action.yearlyRise, transferReviewPromise: action.transferReviewPromise, developmentPromise: action.developmentPromise };
      if (salary != null && !player.isSub) {
        const budget = canAffordStarterResign(state.players, state.userTeamId, playerId, salary);
        if (!budget.affordable) return addNotif(state, `Over budget — re-signing ${player.name} would exceed your cap.`);
      }
      return queueContractOffer(state, player, offer, { type: "resign", teamId: state.userTeamId });
    }

    case "ADVANCE_OFFSEASON_DAY": {
      let next = migrateContractState(state);
      next = { ...next, calendar: { ...(next.calendar || buildOffseasonCalendar(next)), day: Number(next.calendar?.day ?? 0) + 1 } };
      next.calendar = { ...next.calendar, label: `Offseason ${next.season} Day ${next.calendar.day + 1}` };
      next = resolveDueContractOffers(next);
      if ((next.schedule?.phase === "contracts" || next.schedule?.phase === "offseason") && !next.offseason?.freeAgencyOpen && next.calendar.day >= (next.calendar.freeAgencyOpenDay ?? 5)) {
        next = advanceOffseason({ ...next, schedule: { ...next.schedule, phase: "contracts" } });
        next = pushInboxEvents(next, [makeFreeAgencyOpenEvent(next)]);
      }
      if (next.offseason?.freeAgencyOpen && next.calendar.day >= (next.calendar.seasonStartDay ?? 15)) {
        return __diagnoseReducer(next, { type: "ADVANCE_OFFSEASON" });
      }
      return addNotif(next, `Advanced to ${next.calendar.label}.`);
    }

    // ── SIGN PLAYER ───────────────────────────────────────────────────────────
    case "SIGN_PLAYER": {
      const { playerId, slotType } = action;
      const userTeam  = state.userTeamId;
      const rosterNow = state.players.filter(p => p.teamId === userTeam);
      const requestedSlot = slotType || "starter";
      const actualSlot = resolveSigningSlot(state.players, userTeam, requestedSlot, getRequiredStarters(state));

      const tag = CDL_TEAMS.find(t => t.id === userTeam)?.tag ?? userTeam;
      const phase = state.schedule?.phase ?? "stage";
      const targetForDuplicateCheck = state.prospects.find(p => p.id === playerId)
        || state.players.find(p => p.id === playerId);

      // Hard budget check (starters only). If the lineup already has four
      // starters, a requested starter signing is intentionally placed on the
      // bench instead of being blocked/stuck in limbo.
      if (actualSlot === "starter" && targetForDuplicateCheck) {
        const cap       = getTeamCap(userTeam);
        const committed = rosterNow
          .filter(p => !p.isSub)
          .reduce((s, p) => s + (p.salary ?? getSigningCost(p)), 0);
        const cost = action.salary ?? buildContractDemand(targetForDuplicateCheck, state, { type: "signing", teamId: userTeam, asSub: actualSlot === "sub" }).salary;
        const over = committed + cost - cap;
        if (over > 0) {
          return addNotif(state,
            `Over budget — signing ${targetForDuplicateCheck.name} would exceed your cap by $${(over / 1000).toFixed(0)}k.`
          );
        }
      }
      if (!targetForDuplicateCheck || isInactivePlayer(targetForDuplicateCheck)) {
        return addNotif(state, "Player is not available to sign.");
      }
      if (targetForDuplicateCheck.teamId === userTeam) {
        return addNotif(state, `${targetForDuplicateCheck.name} is already on your roster.`);
      }
      if (targetForDuplicateCheck.teamId && targetForDuplicateCheck.teamId !== userTeam) {
        return addNotif(state, `${targetForDuplicateCheck.name} is not available to sign.`);
      }
      if (cdlRosterHasName(state.players, targetForDuplicateCheck.name, targetForDuplicateCheck.id)) {
        return addNotif(state, `${targetForDuplicateCheck.name} is already active on a CDL roster.`);
      }

      const prospect = state.prospects.find(p => p.id === playerId);

      if (prospect) {
        const fromChallengerTeamId = prospect.challengerTeamId ?? null;
        const existingHistory = prospect.teamHistory || [];
        const historyUpdated  = existingHistory.some(e => e.season === state.season)
          ? existingHistory
          : [...existingHistory, { season: state.season, teamId: userTeam }];
        const offer = { years: action.years ?? 2, salary: action.salary ?? buildContractDemand(prospect, state, { type: "signing", teamId: userTeam, asSub: actualSlot === "sub" }).salary, rolePromise: action.rolePromise, starterStatus: action.starterStatus ?? actualSlot, transferReviewPromise: action.transferReviewPromise, developmentPromise: action.developmentPromise };
        const evalResult = evaluateContractOffer(prospect, state, offer, { type: "signing", teamId: userTeam, asSub: actualSlot === "sub" });
        if (evalResult.outcome !== "accept") return addNotif(applyContractTalkResult(state, prospect, evalResult, offer), evalResult.message);
        const demand = offer.salary;
        const signed = {
          ...prospect, teamId: userTeam, challengerTeamId: null, status: "cdl", circuit: "cdl", isSub: actualSlot === "sub",
          scouted: true, contractYears: offer.years, salary: demand, teamHistory: historyUpdated,
        };
        let baseSignedState = applySignedEvent({
          ...state,
          players:  [...state.players, signed],
          prospects: state.prospects.filter(p => p.id !== playerId),
          challengerTeams: (state.challengerTeams || []).map(t => t.id === fromChallengerTeamId ? { ...t, playerIds: (t.playerIds || []).filter(id => id !== signed.id) } : t),
          challengerTransactions: pushChallengerTransaction(state.challengerTransactions, state, {
            type: "CDL_SIGNING", playerId: signed.id, playerName: signed.name, fromTeamId: fromChallengerTeamId, toTeamId: userTeam,
            note: `${tag} signed ${signed.name} from Challengers`,
          }),
        }, signed);
        if (offer.starterStatus === "starter") baseSignedState = makePromise(baseSignedState, signed.id, "starter_role");
        if (offer.developmentPromise) baseSignedState = makePromise(baseSignedState, signed.id, "development_focus");
        if (offer.transferReviewPromise) baseSignedState = makePromise(baseSignedState, signed.id, "consider_offers");
        const signedState = applyContractTalkResult(baseSignedState, signed, evalResult, offer);
        return pushFeed(
          addNotif(signedState, `${signed.name} signed! ${actualSlot === "starter" ? "Player added to starting roster." : "Roster full: player added as substitute."}`),
          [mkFeed("signing", `${tag} sign ${signed.name} (${actualSlot === "starter" ? "starter" : "bench"})`, state.season, phase)]
        );
      }

      // Pro free agent
      const target = state.players.find(p => p.id === playerId);
      if (!target) return addNotif(state, "Player not found.");

      const offer = { years: action.years ?? 2, salary: action.salary ?? buildContractDemand(target, state, { type: "signing", teamId: userTeam, asSub: actualSlot === "sub" }).salary, rolePromise: action.rolePromise, starterStatus: action.starterStatus ?? actualSlot, transferReviewPromise: action.transferReviewPromise, developmentPromise: action.developmentPromise };
      const evalResult = evaluateContractOffer(target, state, offer, { type: "signing", teamId: userTeam, asSub: actualSlot === "sub" });
      if (evalResult.outcome !== "accept") return addNotif(applyContractTalkResult(state, target, evalResult, offer), evalResult.message);
      const demand = offer.salary;

      let baseSignedFaState = applySignedEvent({
        ...state,
        players: state.players.map(p => {
          if (p.id !== playerId) return p;
          const existingHistory = p.teamHistory || [];
          const historyUpdated  = existingHistory.some(e => e.season === state.season)
            ? existingHistory
            : [...existingHistory, { season: state.season, teamId: userTeam }];
          return {
            ...p, teamId: userTeam, challengerTeamId: null, status: "cdl", circuit: "cdl", isSub: actualSlot === "sub",
            scouted: true, contractYears: offer.years, salary: demand, teamHistory: historyUpdated,
          };
        }),
        challengerTeams: (state.challengerTeams || []).map(t => t.id === target.challengerTeamId ? { ...t, playerIds: (t.playerIds || []).filter(id => id !== target.id) } : t),
        challengerTransactions: pushChallengerTransaction(state.challengerTransactions, state, {
          type: target.status === "freeAgent" ? "FREE_AGENT_SIGNING" : "CDL_SIGNING", playerId: target.id, playerName: target.name, fromTeamId: target.previousTeamId ?? target.challengerTeamId ?? null, toTeamId: userTeam,
          note: target.status === "freeAgent" ? `${tag} signed ${target.name} in free agency` : `${tag} signed ${target.name}`,
        }),
      }, target);
      if (offer.starterStatus === "starter") baseSignedFaState = makePromise(baseSignedFaState, target.id, "starter_role");
      if (offer.developmentPromise) baseSignedFaState = makePromise(baseSignedFaState, target.id, "development_focus");
      if (offer.transferReviewPromise) baseSignedFaState = makePromise(baseSignedFaState, target.id, "consider_offers");
      const signedFaState = applyContractTalkResult(baseSignedFaState, target, evalResult, offer);
      return pushFeed(
        addNotif(signedFaState, `${target.name} signed! ${actualSlot === "starter" ? "Player added to starting roster." : "Roster full: player added as substitute."}`),
        [mkFeed("signing", `${tag} sign ${target.name} (${actualSlot === "starter" ? "starter" : "bench"})`, state.season, phase)]
      );
    }

    // ── USER ROSTER SLOT MANAGEMENT ───────────────────────────────────────────
    case "PROMOTE_PLAYER_TO_STARTER": {
      const { playerId, swapWithPlayerId } = action;
      const player = state.players.find(p => p.id === playerId);
      if (!player || player.teamId !== state.userTeamId || !player.isSub) return addNotif(state, "Choose a bench player to promote.");
      const starters = getStarters(state.players, state.userTeamId);
      const starterLimit = getRequiredStarters(state);
      if (starters.length >= starterLimit && !swapWithPlayerId) {
        return addNotif(state, `Starting roster is full (${starterLimit}/${starterLimit}). Choose a starter to swap with this substitute.`);
      }
      if (swapWithPlayerId) {
        const starter = starters.find(p => p.id === swapWithPlayerId);
        if (!starter) return addNotif(state, "Choose a valid starter to move to the bench.");
        let swapped = {
          ...state,
          players: state.players.map(p => {
            if (p.id === playerId) return { ...p, isSub: false };
            if (p.id === swapWithPlayerId) return { ...p, isSub: true };
            return p;
          }),
        };
        swapped = applyPromoteEvent(swapped, player);
        swapped = applyBenchEvent(swapped, starter);
        swapped = evaluateAllPromises(swapped);
        return addNotif(swapped, `${player.name} promoted. ${starter.name} moved to the bench.`);
      }
      let promoted = {
        ...state,
        players: state.players.map(p => p.id === playerId ? { ...p, isSub: false } : p),
      };
      promoted = evaluateAllPromises(applyPromoteEvent(promoted, player));
      return addNotif(promoted, `${player.name} promoted to the starting roster.`);
    }

    case "MOVE_PLAYER_TO_BENCH": {
      const { playerId } = action;
      const player = state.players.find(p => p.id === playerId);
      if (!player || player.teamId !== state.userTeamId || player.isSub) return addNotif(state, "Choose a starter to move to the bench.");
      const nextPlayers = state.players.map(p => p.id === playerId ? { ...p, isSub: true } : p);
      const warning = getRosterIncompleteMessage({ ...state, players: nextPlayers });
      let benched = applyBenchEvent({ ...state, players: nextPlayers }, player);
      benched = evaluateAllPromises(benched);
      return addNotif(benched, warning ? `${player.name} moved to the bench. ${warning}` : `${player.name} moved to the bench.`);
    }

    case "SWAP_STARTER_SUB": {
      const { starterId, subId } = action;
      const starter = state.players.find(p => p.id === starterId);
      const sub = state.players.find(p => p.id === subId);
      if (!starter || starter.teamId !== state.userTeamId || starter.isSub) return addNotif(state, "Choose a valid starter to swap out.");
      if (!sub || sub.teamId !== state.userTeamId || !sub.isSub) return addNotif(state, "Choose a valid bench player to swap in.");
      let swap = {
        ...state,
        players: state.players.map(p => {
          if (p.id === starterId) return { ...p, isSub: true };
          if (p.id === subId) return { ...p, isSub: false };
          return p;
        }),
      };
      swap = applyPromoteEvent(swap, sub);
      swap = applyBenchEvent(swap, starter);
      swap = evaluateAllPromises(swap);
      return addNotif(swap, `${sub.name} swapped into the starting roster. ${starter.name} moved to the bench.`);
    }

    case "AUTO_PICK_BEST_STARTERS": {
      const teamId = action.teamId ?? state.userTeamId;
      if (teamId !== state.userTeamId) return state;
      const limit = getRequiredStarters(state);
      const roster = state.players.filter(p => p.teamId === teamId && !isInactivePlayer(p));
      if (roster.length < limit) return addNotif(state, `Need ${limit} active players before auto-picking starters.`);
      const starterIds = autoPickStarterIds(state.players, teamId, limit);
      return addNotif({
        ...state,
        players: state.players.map(p => p.teamId === teamId && !isInactivePlayer(p) ? { ...p, isSub: !starterIds.has(p.id) } : p),
      }, `Auto Pick Best ${limit} complete. Highest-OVR players are now starters.`);
    }

    // ── RELEASE PLAYER ────────────────────────────────────────────────────────
    case "RELEASE_PLAYER": {
      const player = state.players.find(p => p.id === action.playerId);
      if (!player) return state;
      const wasOnCdlRoster = !!player.teamId && isCdlTeamId(player.teamId) && !isInactivePlayer(player);
      if (!wasOnCdlRoster) return addNotif(state, `${player.name || "Player"} is not on an active CDL roster.`);

      const requiredStarters = getRequiredStarters(state);
      const activeStarters = getTeamRosterStatus(state.players, player.teamId, requiredStarters).count;
      if (player.teamId !== state.userTeamId && !player.isSub && activeStarters <= requiredStarters) {
        return addNotif(state, `Cannot release ${player.name}; CDL rosters must keep at least ${requiredStarters} active players.`);
      }

      const tag   = CDL_TEAMS.find(t => t.id === player.teamId)?.tag ?? player.teamId ?? "FA";
      const phase = state.schedule?.phase ?? "stage";
      const feedItem = mkFeed("release", `${tag} release ${player.name}`, state.season, phase);
      // Squad dynamics: being released stings (only meaningful for the user's own team).
      const stateM = player.teamId === state.userTeamId ? applyReleaseEvent(state, player) : state;

      if (player.isProspect) {
        const releaseToRetire = shouldRetireOnRelease(player);
        const released = { ...player, teamId: null, isSub: false, challengerTeamId: null };
        return pushFeed(
          addNotif({
            ...stateM,
            players:  state.players.filter(p => p.id !== action.playerId),
            prospects: releaseToRetire ? state.prospects : [...state.prospects, released],
            challengerTransactions: pushChallengerTransaction(state.challengerTransactions, state, {
              type: releaseToRetire ? "RETIREMENT" : "CDL_RELEASE_TO_CHALLENGERS", playerId: released.id, playerName: released.name, fromTeamId: player.teamId, toTeamId: null,
              note: releaseToRetire ? `${released.name} retired after release` : `${released.name} moved to Challengers pool`,
            }),
          }, !player.isSub && player.teamId === state.userTeamId
            ? `${player.name} released. ${getRosterIncompleteMessage({ ...state, players: state.players.filter(p => p.id !== action.playerId) }) ?? ""}`.trim()
            : `${player.name} released.`),
          [feedItem]
        );
      }

      const releaseToChallengers = shouldMoveToChallengersOnRelease(player);
      const txType = releaseToChallengers ? "CDL_RELEASE_TO_CHALLENGERS" : "RETIREMENT";
      return pushFeed(
        addNotif({
          ...stateM,
          players: state.players.filter(p => p.id !== action.playerId),
          prospects: releaseToChallengers
            ? [...state.prospects, { ...player, teamId: null, isSub: false, challengerTeamId: null, contractYears: 0 }]
            : state.prospects,
          challengerTransactions: pushChallengerTransaction(state.challengerTransactions, state, {
            type: txType,
            playerId: player.id, playerName: player.name, fromTeamId: player.teamId, toTeamId: null,
            note: releaseToChallengers ? `${player.name} moved to Challengers pool` : `${player.name} retired after release`,
          }),
        }, !player.isSub && player.teamId === state.userTeamId
          ? `${player.name} released. ${getRosterIncompleteMessage({ ...state, players: state.players.filter(p => p.id !== action.playerId) }) ?? ""}`.trim()
          : `${player.name} released.`),
        [feedItem]
      );
    }

    // ── SIGN A PLAYER TO THE USER'S CHALLENGER TEAM ───────────────────────────
    case "SIGN_CHALLENGER_PLAYER": {
      if (!isChallengerMode(state)) return addNotif(state, "Only available in Challenger manager mode.");
      const team = getUserChallengerTeam(state);
      if (!team) return addNotif(state, "Your Challenger team could not be resolved.");
      if (getChallengerRosterPlayers(state).length >= 4) {
        return addNotif(state, "Challenger roster is full (4/4). Release a player first.");
      }
      const target = (state.prospects || []).find(p => p.id === action.playerId)
        || (state.players || []).find(p => p.id === action.playerId);
      if (!target || isInactivePlayer(target)) return addNotif(state, "Player is not available to sign.");
      if (target.teamId && isCdlTeamId(target.teamId)) return addNotif(state, `${target.name} is signed to a CDL team.`);
      if (target.challengerTeamId === state.userTeamId) return addNotif(state, `${target.name} is already on your roster.`);

      const tag = team.tag ?? "CHA";
      const phase = state.schedule?.phase ?? "stage";
      const setTeamId = (p) => p.id === target.id
        ? { ...p, challengerTeamId: state.userTeamId, status: "challengers", teamId: null, isSub: false, region: p.region ?? team.region }
        : p;
      return pushFeed(
        addNotif({
          ...state,
          players: (state.players || []).map(setTeamId),
          prospects: (state.prospects || []).map(setTeamId),
          challengerTeams: (state.challengerTeams || []).map(t => {
            if (t.id === state.userTeamId) {
              return { ...t, playerIds: [...new Set([...(t.playerIds || []), target.id])].slice(0, 4) };
            }
            // Remove from any other Challenger team that listed them.
            return (t.playerIds || []).includes(target.id)
              ? { ...t, playerIds: (t.playerIds || []).filter(id => id !== target.id) }
              : t;
          }),
          challengerTransactions: pushChallengerTransaction(state.challengerTransactions, state, {
            type: "CHALLENGER_SIGNING", playerId: target.id, playerName: target.name, fromTeamId: target.challengerTeamId ?? null, toTeamId: state.userTeamId,
            note: `${team.name} signed ${target.name}`,
          }),
        }, `${target.name} signed to ${team.name}.`),
        [mkFeed("signing", `${tag} sign ${target.name}`, state.season, phase)]
      );
    }

    // ── RELEASE A PLAYER FROM THE USER'S CHALLENGER TEAM ──────────────────────
    case "RELEASE_CHALLENGER_PLAYER": {
      if (!isChallengerMode(state)) return addNotif(state, "Only available in Challenger manager mode.");
      const team = getUserChallengerTeam(state);
      const player = (state.prospects || []).find(p => p.id === action.playerId)
        || (state.players || []).find(p => p.id === action.playerId);
      if (!team || !player) return state;
      if (player.challengerTeamId !== state.userTeamId) return addNotif(state, `${player.name} is not on your roster.`);
      const clear = (p) => p.id === player.id ? { ...p, challengerTeamId: null, isSub: false } : p;
      const after = {
        ...state,
        players: (state.players || []).map(clear),
        prospects: (state.prospects || []).map(clear),
        challengerTeams: (state.challengerTeams || []).map(t =>
          t.id === state.userTeamId ? { ...t, playerIds: (t.playerIds || []).filter(id => id !== player.id) } : t
        ),
        challengerTransactions: pushChallengerTransaction(state.challengerTransactions, state, {
          type: "CHALLENGER_RELEASE", playerId: player.id, playerName: player.name, fromTeamId: state.userTeamId, toTeamId: null,
          note: `${team.name} released ${player.name}`,
        }),
      };
      const warn = getRosterIncompleteMessage(after) ?? "";
      return addNotif(after, `${player.name} released.${warn ? " " + warn : ""}`.trim());
    }

    // ── GENERATE CDL BUYOUT OFFERS for the user's Challenger players ───────────
    // Guarded by a window key so it runs once per open window (never every render).
    case "GENERATE_CHALLENGER_OFFERS": {
      if (!isChallengerMode(state) || !isChallengerMarketOpen(state)) return state;
      const windowKey = getChallengerWindowKey(state);
      if (!action.force && state.lastChallengerOfferKey === windowKey) return state;
      const fresh = generateChallengerBuyoutOffers(state, state.challengerOffers || []);
      const next = {
        ...state,
        challengerOffers: [...(state.challengerOffers || []), ...fresh],
        lastChallengerOfferKey: windowKey,
      };
      if (!fresh.length) return next;
      const phase = state.schedule?.phase ?? "stage";
      const feedItems = fresh.map(o => {
        const buyer = CDL_TEAMS.find(t => t.id === o.fromCdlTeamId);
        return mkFeed("transfer_offer", `${buyer?.tag ?? o.fromCdlTeamId} table a $${Math.round(o.fee / 1000)}k buyout for ${o.playerName}`, state.season, phase);
      });
      const first = fresh[0];
      const firstBuyer = CDL_TEAMS.find(t => t.id === first.fromCdlTeamId);
      const inboxBuyouts = fresh.map(o => makeChallengerBuyoutEvent(o, next));
      return addNotif(pushInboxEvents(pushFeed(next, feedItems), inboxBuyouts), `${firstBuyer?.name ?? "A CDL team"} have offered $${Math.round(first.fee / 1000)}k for ${first.playerName}.`);
    }

    // ── RESPOND TO A CDL BUYOUT OFFER (accept = sell for income / reject) ──────
    case "RESPOND_CHALLENGER_OFFER": {
      if (!isChallengerMode(state)) return state;
      const offer = (state.challengerOffers || []).find(o => o.id === action.offerId);
      if (!offer || offer.status !== "pending") return addNotif(state, "This offer is no longer active.");
      const markOffer = (st, status) => ({
        ...st,
        challengerOffers: (st.challengerOffers || []).map(o => o.id === offer.id ? { ...o, status } : o),
      });

      if (action.decision === "reject") {
        const blockedPlayer = (state.players || []).concat(state.prospects || []).find(p => p.id === offer.playerId);
        let rejected = markOffer(state, "rejected");
        if (blockedPlayer) {
          rejected = evaluateAllPromises(applyBlockedMoveEvent(rejected, blockedPlayer));
          rejected = pushInboxEvents(rejected, [makeBlockedMoveEvent(blockedPlayer, rejected)]);
        }
        return addNotif(rejected, `Rejected ${CDL_TEAMS.find(t => t.id === offer.fromCdlTeamId)?.name ?? "the"} offer for ${offer.playerName}.`);
      }
      // accept
      const result = applyChallengerBuyout(state, offer);
      if (result.blocked) return addNotif(state, result.blocked);
      let next = markOffer({
        ...state,
        players: result.players,
        prospects: result.prospects,
        challengerTeams: result.challengerTeams,
        challengerFunds: (state.challengerFunds || 0) + result.fee,
        challengerTransactions: pushChallengerTransaction(state.challengerTransactions, state, buildBuyoutTransaction(state, offer)),
      }, "accepted");
      // Repair the buyer roster (and any duplicates) without touching the user team.
      next = ensureCdlRosterIntegrity(cleanupDuplicateActiveAssignments(next), { windowType: "challenger_buyout" });
      next.teamMapProfiles = ensureTeamMapProfiles(next, { force: true });
      const buyer = CDL_TEAMS.find(t => t.id === offer.fromCdlTeamId);
      const phase = state.schedule?.phase ?? "stage";
      next = pushFeed(next, [mkFeed("transfer_done", `${buyer?.tag ?? offer.fromCdlTeamId} sign ${offer.playerName} from Challengers ($${Math.round(offer.fee / 1000)}k)`, state.season, phase)]);
      const warn = getRosterIncompleteMessage(next) ?? "";
      return addNotif(next, `${offer.playerName} sold to ${buyer?.name ?? "a CDL team"} for $${Math.round(offer.fee / 1000)}k.${warn ? " " + warn : ""}`.trim());
    }

    // ── SCOUT PLAYER (Prospect Scouting 2.0) ──────────────────────────────────
    case "SCOUT_PLAYER": {
      const result = applyScout(state, action.playerId, { deep: !!action.deep });
      if (!result.ok) return addNotif(state, result.reason);
      const verb = action.deep ? "Deep scouted" : "Scouted";
      let scoutState = { ...state, userScouting: result.scouting };
      if (action.deep && result.confidence >= 50) {
        scoutState = pushInboxEvents(scoutState, [makeScoutReportEvent(result.player, scoutState)]);
      }
      return addNotif(scoutState, `${verb} ${result.player.name} (+${result.gain}) — confidence ${result.confidence}%`);
    }

    // ── SHORTLIST TOGGLE ──────────────────────────────────────────────────────
    case "TOGGLE_SHORTLIST": {
      const { scouting, added } = toggleShortlist(state, action.playerId);
      const p = (state.prospects || []).find(x => x.id === action.playerId)
        || (state.players || []).find(x => x.id === action.playerId);
      const name = p?.name || "Player";
      return addNotif(
        { ...state, userScouting: scouting },
        added ? `${name} added to shortlist.` : `${name} removed from shortlist.`
      );
    }

    // ── TRANSFER WAVE (AI generates incoming offers for user players) ─────────
    // Guarded by a window key so it runs once per transfer window (never every
    // render). `force` bumps a nonce for an explicit user "Scan Market".
    case "RUN_TRANSFER_WAVE": {
      if (!isTransferWindowOpen(state)) return state;
      const tm = migrateTransferMarket(state.transferMarket);
      const windowKey = getWindowKey(state);
      if (!action.force && tm.lastWaveKey === windowKey) return state;
      const seededTm = action.force ? { ...tm, waveNonce: (tm.waveNonce || 0) + 1 } : tm;
      const offers = generateIncomingOffers({ ...state, transferMarket: seededTm });
      const nextTm = {
        ...seededTm,
        negotiations: [...seededTm.negotiations, ...offers],
        nextId: seededTm.nextId + offers.length,
        lastWaveKey: windowKey,
      };
      let next = { ...state, transferMarket: nextTm };
      if (offers.length) {
        const phase = state.schedule?.phase ?? "stage";
        const feedItems = offers.map(o => {
          const p = state.players.find(pl => pl.id === o.playerId);
          return mkFeed("transfer_offer", `${trTeamTag(o.fromTeamId)} table a ${fmtFee(o.fee)} buyout offer for ${p?.name ?? "your player"}`, state.season, phase);
        });
        next = pushFeed(next, feedItems);
        // Squad dynamics: concrete interest can give an ambitious player itchy feet.
        const seenOffered = new Set();
        for (const o of offers) {
          if (seenOffered.has(o.playerId)) continue;
          seenOffered.add(o.playerId);
          const op = state.players.find(pl => pl.id === o.playerId);
          if (op) next = applyTransferInterestEvent(next, op);
        }
        const first = offers[0];
        const fp = state.players.find(pl => pl.id === first.playerId);
        next = addNotif(next, `${trTeamName0(first.fromTeamId)} have offered ${fmtFee(first.fee)} for ${fp?.name ?? "your player"}.`);
        // Inbox events for each incoming offer
        const inboxOffers = offers.map(o => {
          const op2 = state.players.find(pl => pl.id === o.playerId);
          return makeTransferOfferEvent(o, op2, next);
        });
        next = pushInboxEvents(next, inboxOffers);
      }
      return next;
    }

    // ── SET TRANSFER STATUS / ASKING PRICE for a user player ──────────────────
    case "SET_TRANSFER_STATUS": {
      const { playerId, status, askingPrice } = action;
      const player = state.players.find(p => p.id === playerId);
      if (!player || player.teamId !== state.userTeamId) return addNotif(state, "You can only set status for your own players.");
      const tm = migrateTransferMarket(state.transferMarket);
      const prev = tm.status[playerId] || {};
      const nextEntry = { ...prev };
      if (status != null) nextEntry.transferStatus = status;
      if (askingPrice != null) nextEntry.askingPrice = Math.max(0, Math.round(askingPrice));
      return addNotif(
        { ...state, transferMarket: { ...tm, status: { ...tm.status, [playerId]: nextEntry } } },
        `${player.name}: ${status ?? "asking price updated"}${askingPrice != null ? ` · ${fmtFee(askingPrice)}` : ""}`
      );
    }

    // ── USER MAKES AN OFFER for another team's contracted player ──────────────
    case "MAKE_TRANSFER_OFFER": {
      if (!isTransferWindowOpen(state)) return addNotif(state, "Transfer window is closed during live events.");
      const { playerId, fee } = action;
      const player = state.players.find(p => p.id === playerId);
      if (!player || !player.teamId || !isCdlTeamId(player.teamId)) return addNotif(state, "Player is not available to approach.");
      if (player.teamId === state.userTeamId) return addNotif(state, "That player is already on your roster.");
      if (!(fee > 0)) return addNotif(state, "Enter a valid offer fee.");
      const tm = migrateTransferMarket(state.transferMarket);
      const budget = getTransferBudget(state, state.userTeamId).balance;
      if (fee > budget) return addNotif(state, `Offer exceeds your transfer budget (${fmtFee(budget)}).`);
      if (tm.negotiations.some(n => n.status === "Pending" && n.playerId === playerId && n.fromTeamId === state.userTeamId)) {
        return addNotif(state, "You already have a live offer for this player.");
      }
      const sellerTeamId = player.teamId;
      const windowKey = getWindowKey(state);
      const id = `tr_${tm.nextId}`;
      const resp = evaluateSellResponse(state, player, state.userTeamId, fee);
      const neg = {
        id, fromTeamId: state.userTeamId, toTeamId: sellerTeamId, playerId,
        offerType: "buyout", fee, includedPlayerIds: [],
        status: "Pending", counterFee: null, counterBy: null, round: 0,
        initiator: "user", reason: "User enquiry",
        season: state.season, stageIdx: state.schedule?.stageIdx ?? 0, phase: state.schedule?.phase,
        createdKey: windowKey, expiresKey: windowKey,
        history: [{ by: state.userTeamId, action: "offer", fee }],
      };
      // AI seller responds immediately.
      if (resp.decision === "accept") {
        neg.status = "Accepted"; neg.nextAction = "player_terms"; neg.agreedFee = fee; neg.responseReason = resp.reason;
        neg.history.push({ by: sellerTeamId, action: "accept", fee, reason: resp.reason });
        const withNeg = { ...state, transferMarket: { ...tm, negotiations: [...tm.negotiations, neg], nextId: tm.nextId + 1, pendingAcceptedOfferId: id } };
        return addNotif(withNeg, `${trTeamName0(sellerTeamId)} accepted your ${fmtFee(fee)} offer for ${player.name}. Agree player terms to complete it.`);
      }
      if (resp.decision === "counter") {
        neg.status = "Countered"; neg.counterFee = resp.counterFee; neg.counterBy = "seller"; neg.round = 1; neg.counterReason = resp.reason;
        neg.history.push({ by: sellerTeamId, action: "counter", fee: resp.counterFee, reason: resp.reason });
        const withNeg = { ...state, transferMarket: { ...tm, negotiations: [...tm.negotiations, neg], nextId: tm.nextId + 1 } };
        return addNotif(withNeg, `${trTeamName0(sellerTeamId)} countered at ${fmtFee(resp.counterFee)} for ${player.name}. ${resp.reason}`);
      }
      neg.status = "Rejected"; neg.responseReason = resp.reason;
      neg.history.push({ by: sellerTeamId, action: "reject", reason: resp.reason });
      const withNeg = { ...state, transferMarket: { ...tm, negotiations: [...tm.negotiations, neg], nextId: tm.nextId + 1 } };
      return addNotif(withNeg, `${trTeamName0(sellerTeamId)} rejected your offer for ${player.name}. ${resp.reason}`);
    }

    // ── RESPOND TO A NEGOTIATION (accept / reject / counter / withdraw / nfs) ──
    case "RESPOND_TRANSFER_OFFER": {
      const { negotiationId, action: act, fee } = action;
      const tm = migrateTransferMarket(state.transferMarket);
      const neg = tm.negotiations.find(n => n.id === negotiationId);
      if (!neg) return state;
      if (!["Pending", "Countered", "Accepted"].includes(neg.status)) return addNotif(state, "This offer is no longer active.");
      const player = state.players.find(p => p.id === neg.playerId);
      if (!player) return addNotif(state, "Player no longer available.");
      const userIsSeller = neg.toTeamId === state.userTeamId;
      const phase = state.schedule?.phase ?? "stage";
      const setNeg = (patch) => ({ ...state, transferMarket: { ...tm, negotiations: tm.negotiations.map(n => n.id === negotiationId ? { ...n, ...patch, history: [...(n.history || []), patch.__h].filter(Boolean) } : n) } });

      // ---- WITHDRAW (user's own outgoing offer) ----
      if (act === "withdraw") {
        return addNotif(setNeg({ status: "Withdrawn", __h: { by: state.userTeamId, action: "withdraw" } }), `Offer for ${player.name} withdrawn.`);
      }
      // ---- CANCEL DEAL (accepted outgoing fee, before terms are signed) ----
      if (act === "cancel") {
        const cancelled = setNeg({ status: "Cancelled", nextAction: "cancelled", __h: { by: state.userTeamId, action: "cancel-deal" } });
        const tm2 = migrateTransferMarket(cancelled.transferMarket);
        return addNotif({ ...cancelled, transferMarket: { ...tm2, pendingAcceptedOfferId: null, activeTermsOfferId: null } }, `Deal for ${player.name} cancelled. The player remains with ${trTeamName0(neg.toTeamId)}.`);
      }
      // ---- DELAY / PROMISE REVIEW / ASK MORE (incoming) ----
      if (act === "delay") {
        const delayed = setNeg({ status: "Pending", delayed: true, __h: { by: state.userTeamId, action: "delay" } });
        const ev = makeTransferDevelopmentEvent({ type: "transfer_delay", title: `Decision delayed on ${player.name}`, summary: `You asked for more time to review ${trTeamName0(neg.fromTeamId)}'s offer for ${player.name}.`, player, teamId: neg.fromTeamId, state: delayed, severity: "low", reportData: { "Current Bid": fmtFee(neg.counterFee ?? neg.fee), "Next Step": "Return to the Transfer Centre before the window closes." } });
        return addNotif(pushInboxEvents(delayed, [ev]), `Decision delayed for ${player.name}.`);
      }
      if (act === "promise_review") {
        const promised = setNeg({ status: "Rejected", __h: { by: state.userTeamId, action: "promise-review" } });
        const tm2 = migrateTransferMarket(promised.transferMarket);
        const memory = { ...(tm2.playerTransferMemory || {}), [player.id]: { ...(tm2.playerTransferMemory?.[player.id] || {}), promisedReviewUntil: (state.season ?? 1) * 10 + (state.schedule?.stageIdx ?? 0) + 1 } };
        let out = { ...promised, transferMarket: { ...tm2, playerTransferMemory: memory } };
        if (userIsSeller) out = evaluateAllPromises(applyBlockedMoveEvent(out, player));
        const ev = makeTransferDevelopmentEvent({ type: "player_meeting_requested", title: `${player.name} wants future offers reviewed`, summary: `${player.name} accepted that this bid was blocked after being promised future serious offers will be reviewed.`, player, teamId: neg.fromTeamId, state: out, severity: "high", reportData: { Promise: "Review future offers", "Morale Risk": "Reduced now, higher if future serious bids are blocked." } });
        return addNotif(pushInboxEvents(out, [ev]), `${player.name} promised future offers will be reviewed.`);
      }
      if (act === "ask_more") {
        const ask = Math.round((neg.counterFee ?? neg.fee) * 1.18 / 5000) * 5000;
        action.fee = ask;
      }

      // ---- MARK NOT FOR SALE (incoming) ----
      if (act === "nfs") {
        const withStatus = setNeg({ status: "Rejected", __h: { by: state.userTeamId, action: "reject-nfs" } });
        const tm2 = migrateTransferMarket(withStatus.transferMarket);
        let out = { ...withStatus, transferMarket: { ...tm2, status: { ...tm2.status, [player.id]: { ...(tm2.status[player.id] || {}), transferStatus: "Not For Sale" } }, playerTransferMemory: { ...(tm2.playerTransferMemory || {}), [player.id]: { ...(tm2.playerTransferMemory?.[player.id] || {}), blockedMoves: ((tm2.playerTransferMemory?.[player.id]?.blockedMoves) || 0) + 1 } } } };
        // Squad dynamics: blocking an offer for your own player can unsettle him.
        if (userIsSeller) {
          out = evaluateAllPromises(applyBlockedMoveEvent(out, player));
          out = pushInboxEvents(out, [makeBlockedMoveEvent(player, out)]);
        }
        return addNotif(out, `${player.name} marked Not For Sale; offer rejected.`);
      }
      // ---- REJECT ----
      if (act === "reject") {
        const cdKey = `${neg.fromTeamId}:${neg.playerId}`;
        const rejected = setNeg({ status: "Rejected", __h: { by: state.userTeamId, action: "reject" } });
        const tm2 = migrateTransferMarket(rejected.transferMarket);
        let out = { ...rejected, transferMarket: { ...tm2, cooldowns: { ...tm2.cooldowns, [cdKey]: getWindowKey(state) }, playerTransferMemory: { ...(tm2.playerTransferMemory || {}), [player.id]: { ...(tm2.playerTransferMemory?.[player.id] || {}), blockedMoves: ((tm2.playerTransferMemory?.[player.id]?.blockedMoves) || 0) + 1 } } } };
        if (userIsSeller) {
          out = evaluateAllPromises(applyBlockedMoveEvent(out, player));
          out = pushInboxEvents(out, [makeBlockedMoveEvent(player, out)]);
        }
        return addNotif(out, `Offer for ${player.name} rejected.`);
      }
      // ---- COUNTER ----
      if (act === "counter" || act === "ask_more") {
        if (act === "counter" && !(fee > 0)) return addNotif(state, "Enter a valid counter fee.");
        if (userIsSeller) {
          // User (seller) counters the AI buyer; AI decides.
          const resp = evaluateBuyerCounterResponse(state, player, neg.fromTeamId, act === "ask_more" ? action.fee : fee);
          const counterFee = act === "ask_more" ? action.fee : fee;
          if (resp.decision === "accept") {
            return addNotif(setNeg({ status: "Accepted", counterFee, counterBy: "seller", agreedFee: counterFee, round: (neg.round || 0) + 1, __h: { by: neg.fromTeamId, action: "accept", fee: counterFee } }),
              `${trTeamName0(neg.fromTeamId)} accepted your ${fmtFee(counterFee)} valuation for ${player.name}. Accept to complete the sale.`);
          }
          if (resp.decision === "counter") {
            const upd = setNeg({ status: "Countered", counterFee: resp.counterFee, counterBy: "buyer", round: (neg.round || 0) + 1, counterReason: resp.reason, __h: { by: neg.fromTeamId, action: "counter", fee: resp.counterFee, reason: resp.reason } });
            return addNotif(pushInboxEvents(upd, [makeTransferDevelopmentEvent({ type: "counter_improved", title: `${trTeamName0(neg.fromTeamId)} improve bid for ${player.name}`, summary: `${trTeamName0(neg.fromTeamId)} came back with ${fmtFee(resp.counterFee)}. ${resp.reason}.`, player, teamId: neg.fromTeamId, state: upd, reportData: { "Improved Bid": fmtFee(resp.counterFee), Response: resp.reason } })]), `${trTeamName0(neg.fromTeamId)} came back with ${fmtFee(resp.counterFee)} for ${player.name}.`);
          }
          const cdKey = `${neg.fromTeamId}:${neg.playerId}`;
          const rj = setNeg({ status: "Rejected", __h: { by: neg.fromTeamId, action: "reject", reason: resp.reason } });
          const tm2 = migrateTransferMarket(rj.transferMarket);
          const done = { ...rj, transferMarket: { ...tm2, cooldowns: { ...tm2.cooldowns, [cdKey]: getWindowKey(state) } } };
          return addNotif(pushInboxEvents(done, [makeTransferDevelopmentEvent({ type: resp.decision === "walk_away" ? "deal_collapsed" : "counter_rejected", title: `${trTeamName0(neg.fromTeamId)} ${resp.decision === "walk_away" ? "walk away" : "reject counter"} for ${player.name}`, summary: `${trTeamName0(neg.fromTeamId)}: ${resp.reason}.`, player, teamId: neg.fromTeamId, state: done, reportData: { Response: resp.reason, Outcome: resp.decision === "walk_away" ? "Deal collapsed" : "Counter rejected" } })]), `${trTeamName0(neg.fromTeamId)} walked away (${resp.reason}).`);
        } else {
          // User (buyer) counters the AI seller; AI decides.
          const resp = evaluateSellResponse(state, player, state.userTeamId, fee);
          const budget = getTransferBudget(state, state.userTeamId).balance;
          if (fee > budget) return addNotif(state, `Counter exceeds your transfer budget (${fmtFee(budget)}).`);
          if (resp.decision === "accept") {
            const accepted = setNeg({ status: "Accepted", nextAction: "player_terms", fee, counterFee: null, agreedFee: fee, responseReason: resp.reason, round: (neg.round || 0) + 1, __h: { by: neg.toTeamId, action: "accept", fee, reason: resp.reason } });
            const tm2 = migrateTransferMarket(accepted.transferMarket);
            return addNotif({ ...accepted, transferMarket: { ...tm2, pendingAcceptedOfferId: negotiationId } },
              `${trTeamName0(neg.toTeamId)} accepted ${fmtFee(fee)} for ${player.name}. Agree player terms to complete the signing.`);
          }
          if (resp.decision === "counter") {
            return addNotif(setNeg({ status: "Countered", fee, counterFee: resp.counterFee, counterBy: "seller", counterReason: resp.reason, round: (neg.round || 0) + 1, __h: { by: neg.toTeamId, action: "counter", fee: resp.counterFee, reason: resp.reason } }),
              `${trTeamName0(neg.toTeamId)} countered at ${fmtFee(resp.counterFee)} for ${player.name}. ${resp.reason}`);
          }
          return addNotif(setNeg({ status: "Rejected", responseReason: resp.reason, __h: { by: neg.toTeamId, action: "reject", reason: resp.reason } }), `${trTeamName0(neg.toTeamId)} rejected your counter. ${resp.reason}`);
        }
      }
      // ---- ACCEPT (completes a transfer) ----
      if (act === "accept") {
        // Agreed fee: the most recent figure on the table.
        const agreedFee = neg.counterFee ?? neg.agreedFee ?? neg.fee;
        const userIsBuyer = neg.fromTeamId === state.userTeamId;
        if (userIsBuyer && neg.status === "Countered" && neg.counterBy === "seller") {
          const accepted = setNeg({ status: "Accepted", nextAction: "player_terms", agreedFee, counterFee: null, responseReason: neg.counterReason || "Counter accepted by user.", __h: { by: state.userTeamId, action: "accept-counter", fee: agreedFee } });
          const tm2 = migrateTransferMarket(accepted.transferMarket);
          return addNotif({ ...accepted, transferMarket: { ...tm2, pendingAcceptedOfferId: negotiationId } },
            `Fee accepted: ${fmtFee(agreedFee)} for ${player.name}. Agree player terms to complete the signing.`);
        }
        if (userIsBuyer && neg.status === "Accepted" && neg.nextAction && neg.nextAction !== "player_terms") {
          return addNotif(state, "This accepted offer is missing player terms context. Reopen it from the Transfer Centre.");
        }
        const terms = { promisedRole: action.promisedRole, salary: action.salary, contractYears: action.contractYears };
        // If the user is the buyer, the player must agree personal terms.
        if (userIsBuyer) {
          const termsResp = evaluatePlayerTerms(player, neg.fromTeamId, neg.toTeamId, state, terms);
          if (!termsResp.accepted) {
            return addNotif(setNeg({ status: "Rejected", playerRejectionReason: termsResp.reason, nextAction: "terms_rejected", __h: { by: neg.playerId, action: "reject-terms", reason: termsResp.reason } }),
              `${player.name} rejected personal terms. ${termsResp.reason}`);
          }
        }
        const result = buildTransferResult(state, neg, agreedFee, terms);
        if (result.blockedReason) return addNotif(state, `Cannot complete transfer: ${result.blockedReason}`);
        // Mark this negotiation completed.
        const negotiations = result.transferMarket.negotiations.map(n =>
          n.id === negotiationId ? { ...n, status: "Completed", nextAction: "done", agreedFee, history: [...(n.history || []), { by: state.userTeamId, action: "complete", fee: agreedFee }] } : n
        );
        let next = { ...state, players: result.players, transferMarket: { ...result.transferMarket, negotiations, pendingAcceptedOfferId: null, activeTermsOfferId: null } };
        // Board reaction (user team only).
        next = { ...next, boardState: boardNudgeForTransfer(next.boardState, { userIsSeller, player, fee: agreedFee, state }) };
        // Roster integrity: repair AI teams that dropped below 4; rebuild map profiles.
        next = ensureCdlRosterIntegrity(cleanupDuplicateActiveAssignments(next), { windowType: "transfer" });
        next.transferMarket = migrateTransferMarket(next.transferMarket);
        next.teamMapProfiles = ensureTeamMapProfiles(next, { force: true });
        const buyTag = trTeamTag(result.buyerTeamId);
        next = pushFeed(next, [mkFeed("transfer_done", `${buyTag} complete ${fmtFee(agreedFee)} buyout for ${player.name}`, state.season, phase)]);
        next = pushInboxEvents(next, [makeTransferDoneEvent(player, result.buyerTeamId, agreedFee, next)]);
        const msg = userIsSeller
          ? `${player.name} sold to ${trTeamName0(result.buyerTeamId)} for ${fmtFee(agreedFee)}.`
          : `Transfer completed: ${player.name} has joined ${trTeamName0(result.buyerTeamId)}. ${result.asSub ? "Player added to bench." : "Player added to starting roster."}`;
        return addNotif(next, msg);
      }
      return state;
    }

    case "OPEN_TRANSFER_TERMS": {
      const tm = migrateTransferMarket(state.transferMarket);
      const neg = tm.negotiations.find(n => n.id === action.negotiationId);
      if (!isOutgoingTermsRequired(neg, state)) return addNotif(state, "No player terms are required for that offer.");
      return { ...state, transferMarket: { ...tm, activeTermsOfferId: neg.id, pendingAcceptedOfferId: null } };
    }

    case "DISMISS_TRANSFER_ACCEPTED_MODAL": {
      const tm = migrateTransferMarket(state.transferMarket);
      return { ...state, transferMarket: { ...tm, pendingAcceptedOfferId: null } };
    }

    case "CLOSE_TRANSFER_TERMS": {
      const tm = migrateTransferMarket(state.transferMarket);
      return { ...state, transferMarket: { ...tm, activeTermsOfferId: null } };
    }

    // ── HIRE STAFF ────────────────────────────────────────────────────────────
    case "HIRE_STAFF": {
      const { staffId, teamId } = action;
      if (!staffId || !teamId) return state;
      const target = (state.staff || []).find(s => s.id === staffId);
      if (!target) return addNotif(state, "Staff member not found.");
      const newStaff = hireStaff(state.staff, staffId, teamId);
      const teamTag  = CDL_TEAMS.find(t => t.id === teamId)?.tag ?? teamId;
      const role     = roleLabel(target.role);
      return pushFeed(
        addNotif({ ...state, staff: newStaff }, `${target.name} hired as ${role}!`),
        [mkFeed("staff_hire", `${teamTag} hire ${target.name} as ${role}`, state.season, state.schedule?.phase ?? "stage")]
      );
    }

    // ── FIRE STAFF ────────────────────────────────────────────────────────────
    case "FIRE_STAFF": {
      const { staffId } = action;
      if (!staffId) return state;
      const target = (state.staff || []).find(s => s.id === staffId);
      if (!target || target.currentTeamId !== state.userTeamId) return state;
      const newStaff = fireStaff(state.staff, staffId);
      const teamTag  = CDL_TEAMS.find(t => t.id === state.userTeamId)?.tag ?? state.userTeamId;
      const role     = roleLabel(target.role);
      return pushFeed(
        addNotif({ ...state, staff: newStaff }, `${target.name} released.`),
        [mkFeed("staff_fire", `${teamTag} part ways with ${target.name} (${role})`, state.season, state.schedule?.phase ?? "stage")]
      );
    }

    case "BOARD_REVIEW_CONTINUE":
      return { ...state, pendingBoardReview: null };

    case "BOARD_ACCEPT_NEW_MANDATE":
      return {
        ...state,
        pendingBoardReview: null,
        boardState: {
          ...migrateBoardState(state.boardState),
          confidence: 60,
        },
      };

    // ── SQUAD DYNAMICS: talk to a player (apply a conversation choice) ─────────
    case "TALK_TO_PLAYER": {
      const player = (state.players || []).concat(state.prospects || []).find(p => p.id === action.playerId);
      if (!player) return addNotif(state, "Player not found.");
      const event = (state.moraleConversationEvents || []).find(e => e.id === action.eventId);
      const convo = action.topic ? null : getConversationFor(state, player, event);
      const optionPool = action.topic ? getManagerResponsesForTopic(state, player, action.topic) : (convo?.options || []);
      const option = optionPool.find(o => o.id === action.optionId);
      if (!option) return addNotif(state, "That conversation option is no longer available.");
      let next = applyConversationChoice(state, player, { ...option, topic: action.topic || option.topic, meetingId: action.meetingId }, event);
      next = evaluateAllPromises(next);
      const msg = option.promise
        ? `You spoke with ${player.name}. Promise logged: ${option.label}.`
        : `You spoke with ${player.name}.`;
      return addNotif(next, msg);
    }


    case "DELAY_MORALE_CONVERSATION":
      return delayMoraleConversationEvent(state, action.eventId, action.stages || 1);

    case "DISMISS_MORALE_CONVERSATION":
      return dismissMoraleConversationEvent(state, action.eventId);

    // ── SQUAD DYNAMICS: make a promise to a player directly ───────────────────
    case "MAKE_PROMISE": {
      const player = (state.players || []).concat(state.prospects || []).find(p => p.id === action.playerId);
      if (!player) return addNotif(state, "Player not found.");
      const before = (getMorale(state, action.playerId).promises || []).length;
      const next = makePromise(state, action.playerId, action.promiseType);
      const after = (getMorale(next, action.playerId).promises || []).length;
      if (after <= before) return addNotif(state, `${player.name} already has that promise.`);
      const def = PROMISE_TYPES[action.promiseType];
      return addNotif(next, `Promise made to ${player.name}: ${def?.label ?? action.promiseType}.`);
    }

    case "SHOW_ROSTER_INCOMPLETE":
      return blockIfUserRosterInvalid(state) ?? state;

    case "CLEAR_NOTIF":
      return { ...state, notifications: state.notifications.slice(1) };

    case "MARK_FEED_READ":
      return { ...state, feed: (state.feed ?? []).map(f => ({ ...f, read: true })) };

    // ── EVENT CENTRE ACTIONS ──────────────────────────────────────────────────
    case "MARK_EVENT_READ":
      return { ...state, eventCentre: markEventRead(state.eventCentre, action.eventId) };

    case "MARK_ALL_EVENTS_READ":
      return { ...state, eventCentre: markAllRead(state.eventCentre) };

    case "DISMISS_EVENT":
      return { ...state, eventCentre: dismissEvent(state.eventCentre, action.eventId) };

    default:
      return state;
  }
}

function addNotif(state, msg) {
  return { ...state, notifications: [...state.notifications, msg] };
}

function pushInboxEvents(state, events) {
  if (!events?.length) return state;
  return events.reduce((acc, event) => addInboxEvent(acc, event), state);
}

function withMoraleInboxEvents(prevState, newState) {
  const prevIds = new Set((prevState.moraleConversationEvents || []).map(e => e.id));
  const events = (newState.moraleConversationEvents || [])
    .filter(e => e.status === "open" && !prevIds.has(e.id))
    .map(e => {
      const player = (newState.players || []).concat(newState.prospects || []).find(p => p.id === e.playerId);
      return player ? makeMoraleMeetingEvent(player, e.topic || e.trigger, e.severity, newState) : null;
    })
    .filter(Boolean);
  return pushInboxEvents(newState, events);
}

function withMatchInboxEvents(prevState, newState, prevLogLen = null) {
  const events = generateMatchInboxEvents(prevState, newState, prevLogLen == null ? {} : { prevLogLen });
  const withEvents = pushInboxEvents(newState, events);
  return events.some(e => e.type === "match_summary") ? addNotif(withEvents, "Match report added to Inbox") : withEvents;
}

// ── Reducer wrapper: track lastAction + validate post-state invariants ────────
// Stores diagnostics on `window.__lastAction` and `window.__phaseProblems` so
// the ErrorBoundary can show them when a render crash happens, and so console
// users can inspect what just happened. Never throws.
// Actions that change rosters or staff → safe trigger to refresh map profiles
// mid-season (deterministic rebuild, so it stays stable until the next change).
const MAP_PROFILE_REFRESH_ACTIONS = new Set([
  "SIGN_PLAYER", "RELEASE_PLAYER", "RESIGN_PLAYER", "PROMOTE_PLAYER_TO_STARTER",
  "MOVE_PLAYER_TO_BENCH", "SWAP_STARTER_SUB", "AUTO_PICK_BEST_STARTERS",
  "HIRE_STAFF", "FIRE_STAFF",
]);

function instrumentedReducer(prevState, action) {
  const phaseBefore = prevState?.schedule?.phase ?? null;
  const txBefore = prevState?.challengerTransactions?.length ?? 0;
  let nextState = __diagnoseReducer(prevState, action);
  if (nextState && MAP_PROFILE_REFRESH_ACTIONS.has(action?.type) && nextState !== prevState) {
    nextState = { ...nextState, teamMapProfiles: ensureTeamMapProfiles(nextState, { force: true }) };
  }
  const phaseAfter = nextState?.schedule?.phase ?? null;
  const txAfter = nextState?.challengerTransactions?.length ?? 0;
  if (typeof window !== "undefined") {
    const payloadKeys = action && typeof action === "object"
      ? Object.keys(action).filter(k => k !== "type" && k !== "state").slice(0, 8)
      : [];
    window.__lastAction = {
      type: action?.type ?? "(unknown)",
      payloadKeys,
      phaseBefore,
      phaseAfter,
      challengerTransactionsBefore: txBefore,
      challengerTransactionsAfter: txAfter,
      timestamp: new Date().toISOString(),
    };
    if (window.__CLM_DEBUG_CHALLENGER_TX__) {
      console.debug("[challenger-tx] reducer final state", {
        action: action?.type ?? "(unknown)",
        phaseBefore,
        phaseAfter,
        before: txBefore,
        after: txAfter,
      });
    }
    if (nextState) {
      const problems = findPhaseInvariantViolations(nextState);
      window.__phaseProblems = problems;
      if (problems.length) {
        console.warn(
          `[gameStore] phase invariants violated after ${action?.type}:`,
          problems,
          { phaseBefore, phaseAfter }
        );
      }
    } else {
      window.__phaseProblems = [];
    }
  }
  return nextState;
}

// ── Context ───────────────────────────────────────────────────────────────────
const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(instrumentedReducer, null);

  // Expose state on window so the poolReport() console utility can access it.
  if (typeof window !== "undefined") window.__gameState = state;

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}

// ── Challenger team-select preview ────────────────────────────────────────────
// Builds the 24 Challenger teams for a given seed and returns lightweight
// identity + roster OVR estimates for the new-game team picker. Passing the
// same seed to NEW_GAME yields a save whose rosters match this preview.
export function buildChallengerPreview(seed) {
  const players = buildInitialRoster().map(applyChallengerRatingOverride);
  const prospectSeed = (((seed % 999983) + 999983) % 999983) | 0;
  const rawProspects = generateProspects(prospectSeed).map(applyChallengerRatingOverride);
  const seen = new Set();
  const prospects = rawProspects.filter((p) => {
    const key = normalizePlayerName(p.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const temp = { players, prospects, challengerTeams: [] };
  buildChallengerRostersForNewGame(temp, (seed | 0) || 1);
  const byId = new Map([...players, ...prospects].map(p => [p.id, p]));
  return (temp.challengerTeams || []).map(t => {
    const roster = (t.playerIds || []).map(id => byId.get(id)).filter(Boolean);
    const ovr = roster.length ? Math.round(roster.reduce((s, p) => s + (p.overall ?? 60), 0) / roster.length) : 0;
    return { id: t.id, name: t.name, tag: t.tag, color: t.color, logo: t.logo, region: t.region, ovr, players: roster.length };
  }).sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
}

// ── localStorage helpers ──────────────────────────────────────────────────────
export function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Save failed:", e);
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidGameState(parsed)) {
      localStorage.removeItem(SAVE_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(SAVE_KEY);
    return null;
  }
}

export function deleteSave() {
  localStorage.removeItem(SAVE_KEY);
}
