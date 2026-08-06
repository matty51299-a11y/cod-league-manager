// Persistent Modern CDL manager-career layer. This deliberately wraps the
// existing board objectives/confidence instead of creating a second mandate.
import { CDL_TEAMS } from "../data/teams.js";
import { calcTeamOvr } from "./teamOvr.js";
import { buildBoardObjectives, evalAllObjectives, getLeagueOvrRanks } from "./boardEngine.js";
import { getMajorPlacementMap } from "../utils/historyProfiles.js";

const clamp = n => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const teamName = id => CDL_TEAMS.find(t => t.id === id)?.name ?? id ?? "Unattached";

export function getReputationTier(value) {
  const n = clamp(value);
  return n >= 90 ? "Legendary" : n >= 75 ? "Elite" : n >= 60 ? "Respected" : n >= 40 ? "Established" : n >= 20 ? "Developing" : "Unknown";
}

export function getJobSecurityStatus(value) {
  const n = clamp(value);
  return n === 0 ? "Sacked" : n <= 20 ? "Final Warning" : n <= 35 ? "Under Pressure" : n <= 55 ? "Under Review" : n <= 75 ? "Stable" : "Secure";
}

export function getModernCdlTeamExpectation(state, teamId = state?.userTeamId) {
  const ranks = getLeagueOvrRanks(state);
  const powerRank = ranks.rankById[teamId] || CDL_TEAMS.length;
  const rosterOverall = calcTeamOvr(teamId, state?.players || []);
  const tier = powerRank <= 3 ? "elite" : powerRank <= 5 ? "playoff" : powerRank <= 8 ? "mid" : "rebuild";
  return {
    teamId, rosterOverall, powerRank, tier,
    expectedLeaguePosition: powerRank,
    minimumMajorPlacement: tier === "elite" ? 6 : tier === "playoff" ? 8 : tier === "mid" ? 10 : 12,
    targetMajorPlacement: tier === "elite" ? 4 : tier === "playoff" ? 6 : tier === "mid" ? 8 : 10,
    stretchMajorPlacement: tier === "elite" ? 1 : tier === "playoff" ? 3 : tier === "mid" ? 6 : 8,
    summary: tier === "elite" ? "Challenge for trophies and make a deep Champs run." : tier === "playoff" ? "Qualify for Champs and reach Major Sundays." : tier === "mid" ? "Stay in the Champs race and produce a top-eight Major." : "Avoid last place and show measurable progress.",
  };
}

function normalizeObjective(o, season) {
  return { ...o, objectiveId: o.objectiveId || o.id, category: o.weight === "primary" ? "season" : o.weight, title: o.title || o.label,
    description: o.description || o.label, targetType: o.targetType || o.type, targetValue: o.targetValue ?? o.target,
    currentValue: o.currentValue ?? null, mandatory: o.weight === "primary", reward: o.weight === "primary" ? 5 : o.weight === "secondary" ? 2 : 1,
    penalty: o.weight === "primary" ? 10 : o.weight === "secondary" ? 4 : 0, deadlineEventId: o.deadlineEventId || "season_end", createdAt: o.createdAt || `season_${season}`,
    status: o.status === "notStarted" || o.status === "onTrack" || o.status === "ahead" || o.status === "atRisk" ? "active" : o.status };
}

export function generateModernCdlSeasonObjectives(state, teamId = state?.userTeamId) {
  const scoped = { ...state, userTeamId: teamId };
  const existing = state?.boardState?.objectives?.length && teamId === state?.userTeamId
    ? state.boardState.objectives : buildBoardObjectives(scoped).objectives;
  const primary = existing.find(o => o.weight === "primary");
  const secondary = existing.find(o => o.weight === "secondary");
  const stretch = existing.find(o => o.weight === "stretch");
  return [primary, secondary, stretch].filter(Boolean).map(o => normalizeObjective(o, state?.season || 1));
}

export function generateModernCdlEventExpectation(state, eventId, teamId = state?.userTeamId) {
  const idx = typeof eventId === "number" ? eventId : (state?.schedule?.majors || []).findIndex((m, i) => m?.id === eventId || m?.name === eventId || `major_${i}` === eventId);
  const major = state?.schedule?.majors?.[idx];
  if (!major || major.completed) return null;
  const base = getModernCdlTeamExpectation(state, teamId);
  const standings = Object.entries(state?.schedule?.standings || {}).sort((a, b) => (b[1]?.points || 0) - (a[1]?.points || 0));
  const seed = standings.findIndex(([id]) => id === teamId) + 1;
  const formAdjustment = seed && Math.abs(seed - base.powerRank) >= 3 ? (seed < base.powerRank ? -1 : 1) : 0;
  const target = Math.max(1, Math.min(12, base.targetMajorPlacement + formAdjustment));
  return { eventId: `season_${state.season}_event_${idx}`, eventIndex: idx, eventName: major.name || (idx === 4 ? "Champs" : `Major ${idx + 1}`),
    issuedAt: `season_${state.season}_stage_${state.schedule?.stageIdx ?? 0}`, frozen: true,
    minimumAcceptable: Math.max(target, base.minimumMajorPlacement), expectedPlacement: target,
    stretchPlacement: Math.min(target, base.stretchMajorPlacement), basis: `Roster rank ${base.powerRank}, current seed ${seed || "unseeded"}, ${base.tier} expectations.` };
}

export function calculateManagerReputationChange({ expectedPlacement, actualPlacement, isChamps = false }) {
  const gap = expectedPlacement - actualPlacement;
  return Math.max(-5, Math.min(isChamps ? 10 : 7, Math.round(gap * 0.8) + (actualPlacement === 1 ? (isChamps ? 6 : 3) : actualPlacement === 2 ? 2 : 0)));
}
export function calculateBoardConfidenceChange({ expectedPlacement, actualPlacement, minimumAcceptable, mandatoryFailed = false }) {
  const gap = expectedPlacement - actualPlacement;
  let change = gap >= 0 ? 2 + gap * 2 : gap * 2;
  if (actualPlacement > minimumAcceptable) change -= 2;
  if (mandatoryFailed) change -= 4;
  return Math.max(-16, Math.min(14, Math.round(change)));
}

function unlock(profile, id, title, detail) {
  if (profile.achievements.some(a => a.id === id)) return profile;
  return { ...profile, achievements: [...profile.achievements, { id, title, detail, unlockedSeason: profile.currentSeason }] };
}

export function migrateModernCdlCareer(state) {
  if (!state || state.userTeamType === "historical" || state.userTeamType === "challenger" || state.careerMode === "historical") return state;
  const old = state.managerCareer || {};
  const exp = getModernCdlTeamExpectation(state, state.userTeamId);
  const reputation = clamp(old.reputation ?? (exp.tier === "elite" ? 50 : exp.tier === "playoff" ? 42 : exp.tier === "mid" ? 36 : 30));
  const jobSecurity = clamp(old.jobSecurity ?? state.boardState?.confidence ?? (exp.tier === "elite" ? 65 : 70));
  const completedEventIds = Array.isArray(old.evaluatedEventIds) ? old.evaluatedEventIds : [];
  const currentEventExpectation = old.currentEventExpectation || generateModernCdlEventExpectation(state, state.schedule?.majorIdx ?? 0);
  const objectives = (old.currentObjectives?.length ? old.currentObjectives : generateModernCdlSeasonObjectives(state)).map(o => normalizeObjective(o, state.season));
  const profile = {
    managerId: old.managerId || `manager_${state.userTeamId}_${state.season || 1}`, managerName: old.managerName || "Manager", currentTeamId: old.currentTeamId ?? state.userTeamId,
    reputation, reputationTier: getReputationTier(reputation), jobSecurity, seasonsManaged: old.seasonsManaged ?? Math.max(1, state.season || 1),
    careerMatchWins: old.careerMatchWins ?? old.careerSeriesWins ?? 0, careerMatchLosses: old.careerMatchLosses ?? old.careerSeriesLosses ?? 0,
    careerSeriesWins: old.careerSeriesWins ?? 0, careerSeriesLosses: old.careerSeriesLosses ?? 0, majorWins: old.majorWins ?? 0, champsWins: old.champsWins ?? 0,
    eventFinals: old.eventFinals ?? 0, topFourFinishes: old.topFourFinishes ?? 0, teamsManaged: old.teamsManaged?.length ? old.teamsManaged : [state.userTeamId],
    careerHistory: old.careerHistory?.length ? old.careerHistory : [{ teamId: state.userTeamId, organisation: teamName(state.userTeamId), startSeason: state.season || 1, endSeason: null, reasonForLeaving: null, seriesWins: 0, seriesLosses: 0, majorPlacements: [], majorWins: 0, champsWins: 0, reputationStart: reputation }],
    achievements: old.achievements || [], currentObjectives: objectives, completedObjectives: old.completedObjectives || [], failedObjectives: old.failedObjectives || [],
    boardMessages: old.boardMessages || [], jobOffers: old.jobOffers || [], employmentStatus: old.employmentStatus || "employed", warningLevel: old.warningLevel || "none",
    warningCount: old.warningCount || 0, consecutiveUnderperformances: old.consecutiveUnderperformances || 0, activeUltimatum: old.activeUltimatum || null,
    evaluatedEventIds: completedEventIds, eventReviews: old.eventReviews || [], currentEventExpectation, vacancies: old.vacancies || [], currentSeason: state.season || 1,
  };
  return { ...state, managerCareer: profile, boardState: { ...state.boardState, confidence: jobSecurity } };
}

export function evaluateManagerJobStatus(profile, { endOfSeason = false } = {}) {
  let warningLevel = profile.warningLevel || "none";
  let warningCount = profile.warningCount || 0;
  let activeUltimatum = profile.activeUltimatum;
  let employmentStatus = profile.employmentStatus;
  if (profile.jobSecurity <= 20 && warningLevel === "final" && profile.consecutiveUnderperformances >= 3) employmentStatus = "unemployed";
  else if (profile.jobSecurity <= 20 && warningLevel !== "final") { warningLevel = "final"; warningCount++; activeUltimatum = { id: `ultimatum_${profile.currentSeason}_${warningCount}`, title: "Deliver at the next event", targetType: "eventPlacement", targetValue: 8, deadlineEventId: "next_event", status: "active" }; }
  else if (profile.jobSecurity <= 35 && !["formal", "final"].includes(warningLevel)) { warningLevel = "formal"; warningCount++; }
  else if (profile.jobSecurity <= 55 && warningLevel === "none") { warningLevel = "concern"; warningCount++; }
  if (endOfSeason && profile.jobSecurity <= 10 && profile.warningCount >= 2) employmentStatus = "unemployed";
  return { ...profile, warningLevel, warningCount, activeUltimatum, employmentStatus };
}

export function evaluateModernCdlEventPerformance(state, eventIndex = state?.schedule?.majorIdx) {
  let migrated = migrateModernCdlCareer(state);
  if (migrated === state && !state.managerCareer) return state;
  const profile = migrated.managerCareer;
  const event = migrated.schedule?.majors?.[eventIndex];
  if (!event?.completed) return migrated;
  const eventId = `season_${migrated.season}_event_${eventIndex}`;
  if (profile.evaluatedEventIds.includes(eventId)) return migrated;
  const placement = getMajorPlacementMap(event)[migrated.userTeamId];
  if (!placement) return migrated;
  const expectation = profile.currentEventExpectation?.eventIndex === eventIndex ? profile.currentEventExpectation : {
    ...getModernCdlTeamExpectation(migrated), eventId, eventIndex, eventName: event.name, expectedPlacement: getModernCdlTeamExpectation(migrated).targetMajorPlacement, minimumAcceptable: getModernCdlTeamExpectation(migrated).minimumMajorPlacement,
  };
  const evaluatedBoard = evalAllObjectives(migrated.boardState?.objectives || [], migrated, false);
  const newlyCompleted = evaluatedBoard.filter(o => (o.status === "completed" || o.status === "met") && !profile.completedObjectives.some(x => (x.id || x.objectiveId) === o.id));
  const repDelta = calculateManagerReputationChange({ expectedPlacement: expectation.expectedPlacement, actualPlacement: placement, isChamps: eventIndex === 4 });
  const confidenceDelta = calculateBoardConfidenceChange({ expectedPlacement: expectation.expectedPlacement, actualPlacement: placement, minimumAcceptable: expectation.minimumAcceptable });
  const gap = expectation.expectedPlacement - placement;
  const grade = gap >= 5 || placement === 1 && expectation.expectedPlacement >= 6 ? "S" : gap >= 2 ? "A" : gap >= 0 ? "B" : gap >= -2 ? "C" : gap >= -4 ? "D" : "F";
  const beforeSecurity = profile.jobSecurity, beforeRep = profile.reputation;
  const reasons = [`${gap >= 0 ? "+" : ""}${confidenceDelta} job security: finished ${placement}${placement === 1 ? "st" : placement === 2 ? "nd" : placement === 3 ? "rd" : "th"} against a top-${expectation.expectedPlacement} target`, ...newlyCompleted.map(o => `+ Objective completed: ${o.label}`)];
  let next = { ...profile, reputation: clamp(beforeRep + repDelta), jobSecurity: clamp(beforeSecurity + confidenceDelta), reputationTier: getReputationTier(beforeRep + repDelta),
    majorWins: profile.majorWins + (eventIndex < 4 && placement === 1 ? 1 : 0), champsWins: profile.champsWins + (eventIndex === 4 && placement === 1 ? 1 : 0), eventFinals: profile.eventFinals + (placement <= 2 ? 1 : 0), topFourFinishes: profile.topFourFinishes + (placement <= 4 ? 1 : 0),
    consecutiveUnderperformances: grade === "D" || grade === "F" ? profile.consecutiveUnderperformances + 1 : 0, evaluatedEventIds: [...profile.evaluatedEventIds, eventId],
    completedObjectives: [...profile.completedObjectives, ...newlyCompleted.map(o => normalizeObjective(o, migrated.season))], currentObjectives: evaluatedBoard.map(o => normalizeObjective(o, migrated.season)),
  };
  if (placement === 1) next = unlock(next, eventIndex === 4 ? "world_champion" : "major_champion", eventIndex === 4 ? "World Champion" : "Major Champion", `Won ${event.name}.`);
  if (placement <= 4) next = unlock(next, "first_major_sunday", "First Major Sunday", `Finished top four at ${event.name}.`);
  next = evaluateManagerJobStatus(next);
  const review = { eventId, eventName: event.name || expectation.eventName, expectedPlacement: expectation.expectedPlacement, actualPlacement: placement, performanceGrade: grade,
    confidenceBefore: beforeSecurity, confidenceAfter: next.jobSecurity, confidenceChange: next.jobSecurity - beforeSecurity, reputationBefore: beforeRep, reputationAfter: next.reputation, reputationChange: next.reputation - beforeRep,
    objectivesCompleted: newlyCompleted.map(o => o.label), objectivesFailed: [], reasons, explanation: grade === "S" || grade === "A" ? "The board is delighted with clear overperformance." : grade === "B" ? "The board is satisfied that the target was met." : grade === "C" ? "The board wants a response at the next event." : "The board considers this a serious underperformance and expects immediate improvement.", status: getJobSecurityStatus(next.jobSecurity), warningLevel: next.warningLevel };
  next = { ...next, eventReviews: [...next.eventReviews, review], boardMessages: [...next.boardMessages, { id: `board_${eventId}`, type: "event_review", season: migrated.season, ...review }],
    currentEventExpectation: generateModernCdlEventExpectation(migrated, eventIndex + 1) };
  if (next.employmentStatus === "unemployed") next = dismissModernCdlManager({ ...migrated, managerCareer: next }, "Repeated event underperformance after formal board warnings.").managerCareer;
  return { ...migrated, managerCareer: next, boardState: { ...migrated.boardState, confidence: next.jobSecurity }, pendingCareerBoardReview: review };
}

export function generateModernCdlJobInterest(state, { force = false } = {}) {
  const migrated = migrateModernCdlCareer(state); const p = migrated.managerCareer;
  const key = `market_s${migrated.season}_e${p.evaluatedEventIds.length}`;
  if (!force && p.lastJobMarketKey === key) return migrated;
  const candidates = CDL_TEAMS.filter(t => t.id !== migrated.userTeamId).map(t => ({ team: t, expectation: getModernCdlTeamExpectation(migrated, t.id) }))
    .filter(x => p.employmentStatus === "unemployed" || p.reputation >= 45 + Math.max(0, 5 - x.expectation.powerRank) * 4)
    .sort((a, b) => b.expectation.powerRank - a.expectation.powerRank);
  const pick = candidates[0];
  if (!pick) return { ...migrated, managerCareer: { ...p, lastJobMarketKey: key } };
  const id = `offer_${key}_${pick.team.id}`;
  if (p.jobOffers.some(o => o.id === id)) return migrated;
  const roster = (migrated.players || []).filter(pl => pl.teamId === pick.team.id && !pl.isSub).map(pl => ({ id: pl.id, name: pl.name, overall: pl.overall }));
  const offer = { id, teamId: pick.team.id, organisation: pick.team.name, roster, currentStanding: Object.keys(migrated.schedule?.standings || {}).sort((a,b)=>(migrated.schedule.standings[b]?.points||0)-(migrated.schedule.standings[a]?.points||0)).indexOf(pick.team.id)+1,
    teamStrength: pick.expectation.rosterOverall, boardExpectation: pick.expectation.summary, startingJobSecurity: 68, contractLength: 2, reason: p.employmentStatus === "unemployed" ? "The organisation believes your reputation can lead its recovery." : "Your results relative to roster expectations have attracted interest.", responseDeadline: `Season ${migrated.season}, next event`, status: "pending" };
  return { ...migrated, managerCareer: { ...p, jobOffers: [...p.jobOffers, offer], lastJobMarketKey: key } };
}

export function acceptModernCdlJobOffer(state, offerId) {
  const migrated = migrateModernCdlCareer(state); const p = migrated.managerCareer; const offer = p.jobOffers.find(o => o.id === offerId && o.status === "pending");
  if (!offer) return migrated;
  const oldTeamId = p.currentTeamId;
  const history = p.careerHistory.map((h, i) => i === p.careerHistory.length - 1 && !h.endSeason ? { ...h, endSeason: migrated.season, reasonForLeaving: "Accepted another organisation's offer", reputationEnd: p.reputation } : h);
  const moved = { ...p, currentTeamId: offer.teamId, employmentStatus: "employed", jobSecurity: offer.startingJobSecurity, warningLevel: "none", activeUltimatum: null,
    teamsManaged: [...new Set([...p.teamsManaged, offer.teamId])], jobOffers: p.jobOffers.map(o => ({ ...o, status: o.id === offerId ? "accepted" : o.status === "pending" ? "withdrawn" : o.status })),
    careerHistory: [...history, { teamId: offer.teamId, organisation: offer.organisation, startSeason: migrated.season, endSeason: null, reasonForLeaving: null, seriesWins: 0, seriesLosses: 0, majorPlacements: [], majorWins: 0, champsWins: 0, reputationStart: p.reputation }],
    boardMessages: [...p.boardMessages, { id: `move_${offer.id}`, type: "job_accepted", text: `Moved from ${teamName(oldTeamId)} to ${offer.organisation}.` }] };
  const switched = { ...migrated, userTeamId: offer.teamId, managerCareer: moved };
  const board = buildBoardObjectives(switched);
  return migrateModernCdlCareer({ ...switched, boardState: { ...switched.boardState, confidence: offer.startingJobSecurity, objectives: board.objectives, meta: board.meta }, managerCareer: { ...moved, currentObjectives: board.objectives.map(o => normalizeObjective(o, migrated.season)), currentEventExpectation: generateModernCdlEventExpectation(switched, switched.schedule?.majorIdx ?? 0) } });
}

export function dismissModernCdlManager(state, reason = "The board has terminated your contract.") {
  const migrated = migrateModernCdlCareer(state); const p = migrated.managerCareer;
  if (p.employmentStatus === "unemployed") return migrated;
  const history = p.careerHistory.map((h, i) => i === p.careerHistory.length - 1 && !h.endSeason ? { ...h, endSeason: migrated.season, reasonForLeaving: "Dismissed", reputationEnd: p.reputation } : h);
  return { ...migrated, managerCareer: { ...p, currentTeamId: null, employmentStatus: "unemployed", jobSecurity: 0, reputationTier: getReputationTier(p.reputation), careerHistory: history,
    boardMessages: [...p.boardMessages, { id: `dismissal_s${migrated.season}_${p.warningCount}`, type: "dismissal", text: reason }] }, pendingDismissal: { organisation: teamName(migrated.userTeamId), reason, finalJobSecurity: p.jobSecurity, reputation: p.reputation } };
}
