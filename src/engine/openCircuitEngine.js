// src/engine/openCircuitEngine.js
// The open-circuit season runner. Ties together the competition profile, the
// historical roster reconciliation, the deterministic calendar, Pro Points and
// the bracket / pool / championship engines into one data-driven season that the
// career flow actually uses for Ghosts-era historical seasons.
//
// Everything here is deterministic given a seed and idempotent: results and
// Pro Point awards are guarded by per-tournament markers, so reloading a save
// never regenerates fixtures or awards points twice.

import { buildHistoricalSeasonTemplate, getValidationWarningsForSeason } from "../data/historicalRosterDb.js";
import { buildCompetitionProfile } from "../data/competitionProfiles.js";
import { historicalPlayerOverall } from "../data/historicalRatings.js";
import { applyHistoricalSeasonTemplate } from "./seasonRosterEngine.js";
import {
  migrateProPointsStore, ensureSeason,
  awardTournamentPoints, rankTeamsByProPoints, eligibleLockedRoster,
} from "./proPoints.js";
import { buildSeasonCalendar } from "./openCircuit/calendar.js";
import { runDoubleElimination, runSingleElimination } from "./openCircuit/brackets.js";
import { runPools, roundRobinStandings } from "./openCircuit/pools.js";
import { runChampionship } from "./openCircuit/championship.js";

// ── deterministic RNG ─────────────────────────────────────────────────────────
function hashString(str) {
  let h = 2166136261;
  for (const ch of String(str || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

// ── region heuristics ─────────────────────────────────────────────────────────
// Region data is sparse in the corrected DB, so team region is inferred from a
// curated set of known Ghosts-era organisations. Unknown teams fall back to NA
// and record a validation warning (never crash).
const EU_ORGS = /epsilon|vitality|tcm|sk\s?gaming|orbit|wizards|sublime|reign|killerfish|aztek|real\s?allstars|wild|rize\s?za|supremacy|fab|infused|reason|millenium|giants|penta|hyper|red\s?reserve|natus|na.?vi|western|demise|exertus|carnage|the\s?rewind|most\s?wanted|erase/i;
const ANZ_ORGS = /mindfreak|trident|immunity|plantronics|tainted|exile5|orderz|chiefs|legacy|integral|dark\s?sided|anz/i;

function inferRegion(teamName, warnings) {
  const n = String(teamName || "");
  if (ANZ_ORGS.test(n)) return "ANZ";
  if (EU_ORGS.test(n)) return "EU";
  // Default NA. Only warn for clearly unknown/blank names.
  if (!n) warnings.push({ type: "MISSING_REGION", teamName, message: "Team has no region data; defaulted to NA." });
  return "NA";
}

function teamRegionEligible(teamRegion, eligibility) {
  if (!eligibility || eligibility.includes("GLOBAL")) return true;
  return eligibility.includes(teamRegion);
}

// ── build the circuit world from the corrected DB + the user's real roster ─────
// dbTemplate: normalised HistoricalSeasonTemplate. userTeamId maps to a historical
// team id (or a standalone user team). userPlayers: the user's protected roster
// (array of { id, overall, role, region, name }).
export function buildCircuitWorld(dbTemplate, { userTeamId, userPlayers = [] }) {
  const players = {};
  const teams = {};
  const freeAgentIds = [];
  const regionWarnings = [];

  // Seed every historical team + player with deterministic overalls so teams
  // differ in strength (the DB carries identity, not ratings).
  for (const t of dbTemplate.teams) {
    const careerTeamId = `historical:${t.historicalTeamId}`;
    teams[careerTeamId] = {
      id: careerTeamId,
      name: t.teamName,
      historicalTeamId: t.historicalTeamId,
      isActive: true,
      roster: [],
      region: inferRegion(t.teamName, regionWarnings),
    };
    for (const pl of t.players) {
      if (!players[pl.playerId]) {
        players[pl.playerId] = {
          id: pl.playerId, playerId: pl.playerId,
          gamertag: pl.displayName, name: pl.displayName,
          teamId: null, overall: historicalPlayerOverall(pl.playerId, pl.displayName), region: teams[careerTeamId].region,
        };
        freeAgentIds.push(pl.playerId);
      }
    }
  }

  // Overlay the user's protected roster onto their team.
  const resolvedUserTeamId = teams[userTeamId] ? userTeamId : `historical:${userTeamId}`;
  if (!teams[resolvedUserTeamId]) {
    teams[resolvedUserTeamId] = {
      id: resolvedUserTeamId, name: "Your Team", historicalTeamId: userTeamId,
      isActive: true, roster: [], region: "NA", isUserControlled: true,
    };
  }
  teams[resolvedUserTeamId].isUserControlled = true;
  for (const up of userPlayers) {
    const pid = up.id || up.playerId;
    if (!pid) continue;
    players[pid] = {
      id: pid, playerId: pid, gamertag: up.name || up.gamertag || pid, name: up.name || pid,
      teamId: resolvedUserTeamId, overall: up.overall ?? 75, role: up.role || up.primary, region: up.region || "NA",
      protected: true,
    };
    if (!teams[resolvedUserTeamId].roster.includes(pid)) teams[resolvedUserTeamId].roster.push(pid);
    const fa = freeAgentIds.indexOf(pid);
    if (fa >= 0) freeAgentIds.splice(fa, 1);
  }

  return {
    seasonId: dbTemplate.seasonId,
    userTeamId: resolvedUserTeamId,
    players, teams, freeAgentIds,
    regionWarnings,
    processedSeasonIds: [],
  };
}

// Team OVR from its top-`rosterSize` players (deterministic).
function teamOvr(world, teamId, rosterSize) {
  const team = world.teams[teamId];
  if (!team) return 70;
  const ovrs = (team.roster || [])
    .map((pid) => world.players[pid]?.overall ?? 70)
    .sort((a, b) => b - a)
    .slice(0, rosterSize);
  if (!ovrs.length) return 70;
  return ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
}

// Deterministic best-of series result with a seeded upset chance.
function makeSeriesPlayer(world, rosterSize, seedBase) {
  return (a, b, meta) => {
    const oa = teamOvr(world, a, rosterSize);
    const ob = teamOvr(world, b, rosterSize);
    const rng = rngFrom(seedBase ^ hashString(`${a}|${b}|${meta?.phase || ""}|${meta?.round ?? ""}|${meta?.matchIndex ?? ""}|${meta?.groupIdx ?? ""}|${meta?.poolIdx ?? ""}`));
    // Best of 5: play maps until one reaches 3.
    let am = 0, bm = 0;
    const pA = 0.5 + Math.max(-0.35, Math.min(0.35, (oa - ob) / 40));
    while (am < 3 && bm < 3) {
      if (rng() < pA) am++; else bm++;
    }
    return { winner: am > bm ? a : b, aMaps: am, bMaps: bm };
  };
}

// Seed a set of teams by their current locked-roster Pro Points (desc), then OVR.
function seedTeams(world, proStore, seasonId, teamIds, rosterSize) {
  return [...teamIds].sort((a, b) => {
    const pa = rankPoints(world, proStore, seasonId, a, rosterSize);
    const pb = rankPoints(world, proStore, seasonId, b, rosterSize);
    if (pb !== pa) return pb - pa;
    const oa = teamOvr(world, a, rosterSize);
    const ob = teamOvr(world, b, rosterSize);
    if (ob !== oa) return ob - oa;
    return String(a).localeCompare(String(b));
  });
}
function rankPoints(world, proStore, seasonId, teamId, rosterSize) {
  const locked = eligibleLockedRoster(proStore, seasonId, world.teams[teamId]?.roster || [], rosterSize);
  return locked.reduce((s, pid) => s + (proStore.playerSeasonProPoints[seasonId]?.[pid] || 0), 0);
}

// Locked-roster snapshot for an event (top-N eligible by points).
function lockRoster(world, proStore, seasonId, teamId, rosterSize) {
  return eligibleLockedRoster(proStore, seasonId, world.teams[teamId]?.roster || [], rosterSize);
}

// ── event simulation ───────────────────────────────────────────────────────────
// Returns { placements: [{teamId, placement}], phases: [...] }.
function simulateEvent(world, proStore, seasonId, template, eligibleSeeds, rosterSize, seedBase) {
  const playSeries = makeSeriesPlayer(world, rosterSize, seedBase);
  const playMatch = (a, b, meta) => playSeries(a, b, meta).winner;
  const phases = [];

  if (template.eventType === "WORLD_CHAMPIONSHIP") {
    const champ = runChampionship({ seededTeams: eligibleSeeds, playSeries, groupSize: template.poolSize || 4, maxPlayoff: template.playoffSize || 16 });
    phases.push({ phase: "GROUP_STAGE", groups: champ.plan.groups.length, playInCut: champ.plan.playInTeams.length });
    phases.push({ phase: "CHAMPIONSHIP_BRACKET", playoffSize: champ.playoffSeeds.length });
    return { placements: appendNonPlayoff(champ.placements, eligibleSeeds), phases, detail: { groupStandings: champ.groupStandings, playoffSeeds: champ.playoffSeeds } };
  }

  if (template.eventType === "LEAGUE_SEASON") {
    // Multi-week league: full round robin standings, then a top-N playoff.
    const { standings } = roundRobinStandings(eligibleSeeds, playSeries, { phase: "league" });
    phases.push({ phase: "LEAGUE_STANDINGS", teams: eligibleSeeds.length, weeks: template.weeks || 8 });
    const playoffSize = Math.min(template.playoffSize || 4, standings.length);
    const playoffSeeds = standings.slice(0, playoffSize).map((r) => r.teamId);
    const playoff = runDoubleElimination({ seeds: playoffSeeds, playMatch });
    phases.push({ phase: "PLAYOFFS", playoffSize });
    const placements = mergePlacements(playoff.placements, standings.map((r) => r.teamId));
    return { placements, phases, detail: { standings } };
  }

  // Open LAN / invitational / regional: registration → open bracket → pools →
  // championship bracket. Small fields use a direct bracket.
  const poolSize = template.poolSize || 4;
  const poolCount = template.poolCount || (template.playoffSize ? Math.max(1, Math.round((template.playoffSize) / poolSize)) : 4);
  const poolField = poolCount * poolSize;
  const playoffSize = Math.min(template.playoffSize || poolField, poolField);

  phases.push({ phase: "REGISTRATION", entrants: eligibleSeeds.length });

  // Small event or no pool structure → direct bracket.
  if (eligibleSeeds.length <= poolSize || !template.playoffSize || template.playoffSize <= 4) {
    const bracket = (template.bracketType === "DOUBLE_ELIMINATION")
      ? runDoubleElimination({ seeds: eligibleSeeds.slice(0, Math.max(2, template.playoffSize || eligibleSeeds.length)), playMatch })
      : runSingleElimination({ seeds: eligibleSeeds.slice(0, Math.max(2, template.playoffSize || eligibleSeeds.length)), playMatch });
    phases.push({ phase: "CHAMPIONSHIP_BRACKET", bracketType: template.bracketType || "SINGLE_ELIMINATION" });
    return { placements: appendNonPlayoff(bracket.placements, eligibleSeeds), phases, detail: {} };
  }

  // Direct-pool invites + open bracket qualifiers.
  const directCount = eligibleSeeds.length <= poolField
    ? eligibleSeeds.length
    : (template.directPoolInviteCount ?? poolField);
  const directTeams = eligibleSeeds.slice(0, directCount);
  const openBracketTeams = eligibleSeeds.slice(directCount);
  let poolTeams = [...directTeams];
  let openBracketResult = null;

  if (openBracketTeams.length && poolTeams.length < poolField) {
    const need = poolField - poolTeams.length;
    openBracketResult = runDoubleElimination({ seeds: openBracketTeams, playMatch });
    const advancing = openBracketResult.placements.slice(0, need).map((p) => p.teamId);
    poolTeams = [...poolTeams, ...advancing];
    phases.push({ phase: "OPEN_BRACKET", entrants: openBracketTeams.length, advancing: advancing.length });
  }

  // Distribute pool teams into pools (snake by seed).
  const pools = Array.from({ length: Math.max(1, Math.min(poolCount, Math.ceil(poolTeams.length / poolSize))) }, () => []);
  poolTeams.forEach((t, i) => pools[i % pools.length].push(t));
  const poolResult = runPools({ pools, playSeries });
  phases.push({ phase: "POOL_PLAY", pools: pools.length, poolSize });

  // Championship bracket from pool seeds.
  const finalPlayoffSize = Math.min(playoffSize, poolResult.seeds.length);
  const playoff = runDoubleElimination({ seeds: poolResult.seeds.slice(0, finalPlayoffSize), playMatch });
  phases.push({ phase: "CHAMPIONSHIP_BRACKET", playoffSize: finalPlayoffSize, bracketType: "DOUBLE_ELIMINATION" });

  // Merge placements: playoff order first, then pool non-advancers, then open
  // bracket eliminated, then anyone not in the field.
  const order = [
    ...playoff.placements.map((p) => p.teamId),
    ...poolResult.seeds.filter((t) => !playoff.placements.some((p) => p.teamId === t)),
    ...(openBracketResult ? openBracketResult.placements.map((p) => p.teamId).filter((t) => !poolTeams.includes(t)) : []),
  ];
  const placements = mergePlacements(order.map((teamId, i) => ({ teamId, placement: i + 1 })), eligibleSeeds);
  return { placements, phases, detail: { poolStandings: poolResult.poolStandings } };
}

// Append teams not in the playoff to the end of a placement list (dedup).
function appendNonPlayoff(placements, allTeams) {
  const seen = new Set(placements.map((p) => p.teamId));
  let next = placements.length + 1;
  const out = [...placements];
  for (const t of allTeams) if (!seen.has(t)) { out.push({ teamId: t, placement: next++ }); seen.add(t); }
  return out;
}
function mergePlacements(orderedPlacements, allTeams) {
  const seen = new Set();
  const out = [];
  let place = 1;
  for (const p of orderedPlacements) {
    if (seen.has(p.teamId)) continue;
    seen.add(p.teamId); out.push({ teamId: p.teamId, placement: place++ });
  }
  for (const t of allTeams) if (!seen.has(t)) { seen.add(t); out.push({ teamId: t, placement: place++ }); }
  return out;
}

// ── full season simulation ──────────────────────────────────────────────────────
// Runs the whole calendar in chronological order, awarding Pro Points + prize
// exactly once per event. Idempotent: pass an existing proStore/results to
// resume; already-awarded events are skipped.
export function simulateOpenCircuitSeason(world, profile, options = {}) {
  const seasonId = profile.seasonId;
  const rosterSize = profile.rosterSize || 4;
  const dynastySeed = options.dynastySeed ?? 0;
  const proStore = ensureSeason(migrateProPointsStore(options.proStore), seasonId);
  const calendar = options.calendar || buildSeasonCalendar(profile);
  const results = options.results ? { ...options.results } : {};
  const commitments = new Map(); // teamId -> [{start,end}] committed date ranges

  const parse = (s) => new Date(`${s}T00:00:00Z`).getTime();
  const committed = (teamId, ev) => (commitments.get(teamId) || []).some((c) => parse(ev.startDate) <= c.end && c.start <= parse(ev.endDate || ev.startDate));
  const commit = (teamId, ev) => {
    if (!commitments.has(teamId)) commitments.set(teamId, []);
    commitments.get(teamId).push({ start: parse(ev.startDate), end: parse(ev.endDate || ev.startDate) });
  };

  const allTeamIds = Object.keys(world.teams).filter((id) => world.teams[id].isActive);

  // Process in date order, higher tier first within the same window so a team
  // commits to the more prestigious of two overlapping events.
  const tierRank = { S: 0, A: 1, B: 2, C: 3 };
  const schedule = [...calendar.all].sort((a, b) =>
    parse(a.startDate) - parse(b.startDate) ||
    (tierRank[a.tier] ?? 3) - (tierRank[b.tier] ?? 3) ||
    String(a.id).localeCompare(String(b.id)));

  for (const template of schedule) {
    // League seasons run in parallel across months and never lock a team out of
    // the single-weekend LAN/cup exclusivity system.
    const isBlocking = template.eventType !== "LEAGUE_SEASON";
    if (results[template.id]?.completed) {
      // Re-apply commitments so later overlap checks stay correct on resume.
      if (isBlocking) for (const p of results[template.id].placements || []) commit(p.teamId, template);
      continue;
    }
    // Eligible = active, region-eligible, not busy in an overlapping event.
    const eligible = allTeamIds.filter((id) => {
      const team = world.teams[id];
      if (!teamRegionEligible(team.region, template.regionEligibility)) return false;
      if (isBlocking && committed(id, template)) return false;
      return true;
    });
    if (eligible.length < 2) {
      results[template.id] = { completed: true, skipped: true, reason: "insufficient_eligible_field", placements: [] };
      continue;
    }

    // Seed by Pro Points (locked roster), dynamically reduce to the field size.
    const seeded = seedTeams(world, proStore, seasonId, eligible, rosterSize);
    const maxField = template.eventType === "WORLD_CHAMPIONSHIP"
      ? Math.min(template.targetFieldSize || 32, seeded.length)
      : Math.min(template.targetFieldSize || seeded.length, seeded.length);
    const field = seeded.slice(0, maxField);
    if (isBlocking) field.forEach((id) => commit(id, template));

    const seedBase = (dynastySeed >>> 0) ^ hashString(`${seasonId}|${template.id}`);
    const lockedRosters = {};
    for (const id of field) lockedRosters[id] = lockRoster(world, proStore, seasonId, id, rosterSize);

    const sim = simulateEvent(world, proStore, seasonId, template, field, rosterSize, seedBase);

    // Award Pro Points + prize exactly once.
    const placements = sim.placements.map((p) => ({
      teamId: p.teamId, placement: p.placement, lockedRoster: lockedRosters[p.teamId] || [],
    }));
    const award = awardTournamentPoints(proStore, {
      seasonId, tournamentId: template.id, placements,
      proPointTableId: template.proPointTableId, prizePool: template.prizePool || 0, fieldSize: field.length,
    });

    results[template.id] = {
      completed: true,
      name: template.name,
      eventType: template.eventType,
      tier: template.tier,
      startDate: template.startDate,
      fieldSize: field.length,
      phases: sim.phases,
      placements: sim.placements,
      awards: award.awards,
      lockedRosters,
      detail: sim.detail,
    };
  }

  // Final team Pro Points ranking from locked active rosters.
  const ranking = rankTeamsByProPoints(
    proStore, seasonId,
    allTeamIds.map((id) => ({ id, name: world.teams[id].name, roster: world.teams[id].roster })),
    rosterSize,
  );

  return { proStore, results, calendar, ranking, seasonId };
}

// One-call builder: from an era id + the user's team + protected roster, build
// the world, reconcile the historical target, and simulate the whole season.
export function buildAndRunOpenCircuitSeason({ eraId, userTeamId, userPlayers = [], dynastySeed = 0, existing = null }) {
  const dbTemplate = buildHistoricalSeasonTemplate(eraId);
  const profile = buildCompetitionProfile(eraId);
  if (!dbTemplate) {
    return { profile, world: null, season: null, error: `No historical roster data for era ${eraId}` };
  }
  const world = buildCircuitWorld(dbTemplate, { userTeamId, userPlayers });
  const warnings = getValidationWarningsForSeason(eraId);
  const recon = applyHistoricalSeasonTemplate(
    { seasonId: world.seasonId, userTeamId: world.userTeamId, players: world.players, teams: world.teams, freeAgentIds: world.freeAgentIds, processedSeasonIds: world.processedSeasonIds },
    dbTemplate,
    { unresolvedWarnings: warnings },
  );
  const reconciledWorld = { ...world, ...recon.state };
  const season = simulateOpenCircuitSeason(reconciledWorld, profile, {
    dynastySeed,
    proStore: existing?.proStore,
    results: existing?.results,
  });
  return { profile, world: reconciledWorld, reconciliationConflicts: recon.conflicts, season, warnings };
}
