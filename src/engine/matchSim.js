// src/engine/matchSim.js
// Simulates a CDL best-of-5 series in standard map rotation order.
//
// STAT MODEL DESIGN
// -----------------
// 1. Compute a TARGET K/D per player from a tight formula.
// 2. Generate KILLS from activity (role + mode + small noise).
// 3. Compute DEATHS using sqrt-scaled weights so actual K/D tracks target K/D
//    without the old 1/k formula's compounding amplification.
//
// Expected K/D distribution (series level):
//   Typical player, close series:   0.90 – 1.10
//   Good player, winning series:    1.10 – 1.30
//   Elite player, hot series:       1.30 – 1.50  (rare outliers to ~1.70)
//   Average player, losing series:  0.75 – 0.95
//   Poor player, disaster series:   0.55 – 0.75
//   2.0+ K/D series: extremely rare (elite + takeover + 3-0 sweep required)
//
// TRAIT SYSTEM (per-map, interactive play only)
// ─────────────────────────────────────────────
// applyTraitModifiers() modifies player attribute copies before each map:
//   Tilt Resistance  — losers with low tiltResistance get −5% on all key attrs
//   Clutch           — map 5 / S&D: players with clutch ≥ 4 get +10% all attrs
//   Leadership       — if team leader's last-map K/D > 1.0, rest get +3% teamwork
// Tactical boosts (user choices at intermission) are also applied here.

import { calcChemistry } from "./chemistry.js";
import { autoVeto, mapStrengthMod } from "./mapProfile.js";

// Defensive: every code path in simMap assumes a 4-player starter slate (it
// does indexed reads like teamA4[i] for i=0..3). Roster windows + the Challenger
// roster repair pipeline are supposed to keep all teams at 4, but if a thin team
// ever reaches the sim we pad to four so the match runs (badly, for the thin
// team) instead of throwing. This is the absolute last resort — and even here we
// use a believable generated gamertag, never a literal "Sub N" label.
const PLACEHOLDER_BASE = {
  overall: 60, potential: 65, primary: "Flex", secondary: "AR",
  gunny: 50, awareness: 50, objective: 50, searchIQ: 50,
  clutch: 50, teamwork: 50, composure: 50, adaptability: 50,
  ego: 50, workEthic: 50, tiltResistance: 3, leadership: 50, metaDependence: 50,
  form: 50, age: 22, experience: 0, region: "NA",
};
// Small believable gamertag pool so a last-resort padded starter never shows as
// "Sub 4" in match stats / player profiles.
const PAD_NAMES = ["Vex", "Rook", "Nyx", "Dax", "Kairo", "Zane", "Cole", "Riv"];
function hashStr(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function padTeamToFour(team) {
  const existing = Array.isArray(team?.players) ? team.players : [];
  const real = existing.filter(Boolean);
  if (real.length >= 4 && real === existing) return team;
  const padded = real.slice(0, 4);
  while (padded.length < 4) {
    const slot = padded.length;
    const h = hashStr(`${team?.id ?? "team"}_${slot}`);
    padded.push({
      ...PLACEHOLDER_BASE,
      id: `__placeholder_${team?.id ?? "team"}_${slot}`,
      name: PAD_NAMES[h % PAD_NAMES.length],
      teamId: team?.id ?? null,
      isEmergencyGenerated: true,
    });
  }
  return { ...team, players: padded };
}

// Standard CDL BO5 rotation
const MAP_ROTATION = [
  { mode: "Hardpoint",        short: "HP"  },
  { mode: "Search & Destroy", short: "S&D" },
  { mode: "Overload",         short: "OVR" },
  { mode: "Hardpoint",        short: "HP"  },
  { mode: "Search & Destroy", short: "S&D" },
];

// ── PRNG ──────────────────────────────────────────────────────────────────────
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * makeMatchRng — create a standalone seeded RNG for interactive match play.
 * The overlay owns this function reference and advances it across map calls.
 */
export function makeMatchRng(seed) {
  return seededRng(seed);
}

function ri(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// Map a player's primary role string to an era role-weight key. Matching is
// keyword-based so data variants ("Slayer SMG", "Entry SMG", "Main AR") all
// resolve. Returns 1 (neutral) when no era weights are supplied.
function roleWeightFor(primary, roleWeights) {
  if (!roleWeights) return 1;
  const r = String(primary || "").toLowerCase();
  if (r.includes("search")) return roleWeights["Search Specialist"] ?? 1;
  if (r.includes("smg")) return roleWeights.SMG ?? roleWeights.Slayer ?? 1;
  if (r.includes("slay")) return roleWeights.Slayer ?? 1;
  if (r.includes("object")) return roleWeights.Objective ?? 1;
  if (r.includes("ar")) return roleWeights["Main AR"] ?? 1;
  if (r.includes("flex")) return roleWeights.Flex ?? 1;
  return 1;
}

// ── TEAM STRENGTH ─────────────────────────────────────────────────────────────
// Weights updated per spec: 3 primary attributes per mode, not 6.
// roleWeights (optional): the active season/era's per-role multipliers. When
// supplied, a player's contribution is scaled by how much the current Call of
// Duty title values their role — so an SMG-stacked roster is stronger in a fast,
// slayer-friendly title and weaker in an AR-anchored one. Null → unchanged.
function teamStrength(players, chemistry, mode, roleWeights = null) {
  if (!players || players.length === 0) return 40;
  const starters = players.slice(0, 4);

  const modeWeights = {
    "Hardpoint":        { gunny: 0.40, awareness: 0.30, objective: 0.30 },
    "Search & Destroy": { searchIQ: 0.40, clutch: 0.30, composure: 0.30 },
    "Overload":         { gunny: 0.30, objective: 0.40, teamwork: 0.30 },
  };
  const w = modeWeights[mode] ?? modeWeights["Hardpoint"];

  const ratingAvg = starters.reduce((s, p) => {
    let score = 0;
    for (const [attr, weight] of Object.entries(w)) {
      score += (p[attr] ?? 60) * weight;
    }
    // Era role fit: a gentle multiplier (weights ≈ 0.9–1.12) around the player's
    // score, keeping the calibrated rating scale intact.
    return s + score * roleWeightFor(p.primary, roleWeights);
  }, 0) / starters.length;

  const formAvg    = starters.reduce((s, p) => s + (p.form || 70), 0) / starters.length;
  const formMod    = (formAvg - 70) * 0.2;
  const chemBonus  = (chemistry / 100) * 8;
  const avgMetaDep = starters.reduce((s, p) => s + (p.metaDependence || 2), 0) / starters.length;
  const metaRisk   = (avgMetaDep - 3) * 1.5;

  return ratingAvg + formMod + chemBonus - metaRisk;
}

// ── MAP WIN PROBABILITY ───────────────────────────────────────────────────────
function mapWinProb(strA, strB) {
  return 1 / (1 + Math.exp(-(strA - strB) / 8));
}

// ── MAP SCORE GENERATION ──────────────────────────────────────────────────────
function genMapScore(mode, rng) {
  if (mode === "Hardpoint")        return [250, ri(90, 249, rng)];
  if (mode === "Search & Destroy") return [6,   ri(0,   5, rng)];
  if (mode === "Overload")         return [3,   ri(0,   2, rng)];
  return [1, 0];
}

// ── STAT MODEL ────────────────────────────────────────────────────────────────

const ROLE_KD_MOD = {
  "Slayer SMG":        0.07,
  "Entry SMG":         0.02,
  "Flex":              0.00,
  "Main AR":          -0.01,
  "Objective":        -0.06,
  "Search Specialist": -0.03,
};

const ROLE_KILL_MOD = {
  "Slayer SMG":        3,
  "Entry SMG":         2,
  "Flex":              1,
  "Main AR":           0,
  "Objective":        -2,
  "Search Specialist": -1,
};

const MODE_KILL_BASE = {
  "Hardpoint":         20,
  "Search & Destroy":   5,
  "Overload":          14,
};

// ── PER-SERIES PERFORMANCE TIERS ─────────────────────────────────────────────
// Rolled once per player per series; applied as a flat K/D offset on every map.
// Ranges intentionally compressed so outliers feel like events, not normal rows.
// Tier  | Offset range  | Base prob
// -------|---------------|----------
// Takeover | +0.14..+0.26 | 6%
// Hot      | +0.06..+0.12 | 17%
// Normal   | −0.03..+0.03 | ~57%
// Quiet    | −0.12..−0.06 | 14%
// Disaster | −0.26..−0.14 | 6%

function rollSeriesMod(player, rng) {
  const ovr      = player.overall          ?? 75;
  const gunny    = player.gunny            ?? 60;
  const clutch   = player.clutch           ?? 60;
  const composure= player.composure        ?? 60;
  const tiltRes  = player.tiltResistance   ?? 3;
  const ego      = player.ego              ?? 3;
  const workEthic= player.workEthic        ?? 3;
  const metaDep  = player.metaDependence   ?? 3;

  let pTakeover = 0.06;
  let pHot      = 0.17;
  let pQuiet    = 0.14;
  let pDisaster = 0.06;

  if (ovr       >= 85) pTakeover += 0.020;
  if (gunny     >= 75) pTakeover += 0.010;
  if (clutch    >= 75) pTakeover += 0.015;
  if (composure >= 75) pHot      += 0.015;
  if (workEthic >= 4)  pHot      += 0.030;
  if (ego       >= 4)  pDisaster += 0.020;
  if (tiltRes   <= 2)  pDisaster += 0.020;
  if (composure <  50) pDisaster += 0.010;
  if (metaDep   >= 4)  pQuiet    += 0.020;

  const pNormal = Math.max(0.30, 1 - (pTakeover + pHot + pQuiet + pDisaster));
  const total   = pTakeover + pHot + pNormal + pQuiet + pDisaster;
  const n       = 1 / total;

  const cumTakeover = pTakeover * n;
  const cumHot      = cumTakeover + pHot * n;
  const cumNormal   = cumHot      + pNormal * n;
  const cumQuiet    = cumNormal   + pQuiet * n;

  const roll = rng();
  const mag  = rng();

  let lo, hi;
  if      (roll < cumTakeover) { lo =  0.14; hi =  0.26; }
  else if (roll < cumHot)      { lo =  0.06; hi =  0.12; }
  else if (roll < cumNormal)   { lo = -0.03; hi =  0.03; }
  else if (roll < cumQuiet)    { lo = -0.12; hi = -0.06; }
  else                         { lo = -0.26; hi = -0.14; }

  return lo + mag * (hi - lo);
}

/**
 * generateSeriesMods — roll a per-series performance modifier for each player.
 * Must be called once before the first map; the result is passed into every
 * simMap call via matchCtx.seriesMods.
 */
export function generateSeriesMods(players, rng) {
  const mods = {};
  for (const p of players) mods[p.id] = rollSeriesMod(p, rng);
  return mods;
}

function targetKDForMap(player, won, mode, rng, seriesMod) {
  const qualityMod = (player.overall - 82) / 90;
  // Reduced from ±0.06 to ±0.055 — keeps meaningful directional team signal while
  // the now-tighter HP/OVR pool gaps and softer death exponent do more of the work.
  // S&D noise is separately controlled below.
  const winMod     = won ? 0.055 : -0.055;
  const roleMod    = ROLE_KD_MOD[player.primary] ?? 0;
  const formMod    = ((player.form || 70) - 70) / 900;

  // S&D variance reduced from 0.13 to 0.09 to prevent small-round-count luck from
  // dominating series totals (a 6-5 S&D still generated extreme individual K/Ds).
  // The series mod already provides structured player-level variation across all maps.
  const noiseWidth = mode === "Search & Destroy" ? 0.09
                   : mode === "Overload"          ? 0.09
                   :                                0.07;
  const noise = (rng() - 0.5) * 2 * noiseWidth;

  const sm = seriesMod ?? 0;
  const kd = 1.0 + qualityMod + winMod + roleMod + formMod + noise + sm;
  // Tightened ceiling (1.80→1.70) to reduce elite-in-blowout compounding outliers.
  return Math.max(0.45, Math.min(1.70, kd));
}

function killsForMap(player, won, mode, rng) {
  const base    = MODE_KILL_BASE[mode] ?? 15;
  const roleMod = ROLE_KILL_MOD[player.primary] ?? 0;
  const qualMod = (player.overall - 80) / 25;
  const wonMod  = won ? 1 : -1;
  const noise   = (rng() - 0.5) * 7;
  return Math.max(0, Math.round(base + roleMod + qualMod + wonMod + noise));
}

function _weightedAllocate(total, weights, mins = null) {
  const n = weights.length;
  const out = Array(n).fill(0);
  let remaining = total;
  if (mins) {
    for (let i = 0; i < n; i++) {
      const m = Math.max(0, mins[i] ?? 0);
      out[i] += m;
      remaining -= m;
    }
  }
  if (remaining <= 0) return out;
  const safeW = weights.map(w => Math.max(0.001, w));
  const sum = safeW.reduce((s, w) => s + w, 0);
  for (let i = 0; i < n; i++) out[i] += Math.floor((safeW[i] / sum) * remaining);
  let used = out.reduce((s, v) => s + v, 0);
  while (used < total) {
    let bi = 0, bw = -1;
    for (let i = 0; i < n; i++) if (safeW[i] > bw) { bw = safeW[i]; bi = i; }
    out[bi]++; used++;
  }
  return out;
}

function _simSnDStats(teamAObj, teamBObj, scoreA, scoreB, aWon, modA, modB, rng, seriesMods) {
  const rounds = scoreA + scoreB;
  const winsA = scoreA, winsB = scoreB;
  const a = teamAObj.players.slice(0, 4);
  const b = teamBObj.players.slice(0, 4);
  const deathsA = Object.fromEntries(a.map(p => [p.id, 0]));
  const deathsB = Object.fromEntries(b.map(p => [p.id, 0]));

  const aDeathW = modA.map((p, i) => Math.max(0.5, 1.25 - ((seriesMods[a[i].id] ?? 0) * 0.8) - ((p.composure ?? 60) - 60) / 80));
  const bDeathW = modB.map((p, i) => Math.max(0.5, 1.25 - ((seriesMods[b[i].id] ?? 0) * 0.8) - ((p.composure ?? 60) - 60) / 80));

  function pickVictims(teamPlayers, deathMap, need, deathWeights) {
    const alive = teamPlayers.filter(p => deathMap[p.id] < rounds);
    const picked = [];
    for (let c = 0; c < need && alive.length; c++) {
      const ws = alive.map(p => deathWeights[teamPlayers.findIndex(tp => tp.id === p.id)] * (1 + (rounds - deathMap[p.id]) * 0.05));
      const sum = ws.reduce((s, v) => s + v, 0);
      let roll = rng() * sum, idx = 0;
      for (; idx < alive.length; idx++) { roll -= ws[idx]; if (roll <= 0) break; }
      const v = alive.splice(Math.min(idx, alive.length - 1), 1)[0];
      if (!v) break;
      deathMap[v.id]++; picked.push(v.id);
    }
    return picked.length;
  }

  for (let r = 0; r < rounds; r++) {
    const aWinsRound = r < winsA ? true : r >= winsA + winsB ? false : (r - winsA < winsB ? false : true);
    const loserDeaths = rng() < 0.8 ? 4 : (rng() < 0.5 ? 3 : 2);
    const winnerDeaths = rng() < 0.45 ? 0 : (rng() < 0.7 ? 1 : (rng() < 0.9 ? 2 : 3));
    if (aWinsRound) {
      pickVictims(b, deathsB, loserDeaths, bDeathW);
      pickVictims(a, deathsA, winnerDeaths, aDeathW);
    } else {
      pickVictims(a, deathsA, loserDeaths, aDeathW);
      pickVictims(b, deathsB, winnerDeaths, bDeathW);
    }
  }

  const totalDeathsA = a.reduce((s, p) => s + deathsA[p.id], 0);
  const totalDeathsB = b.reduce((s, p) => s + deathsB[p.id], 0);
  const killWtsA = modA.map((p, i) => Math.max(0.5, (targetKDForMap(p, aWon, "Search & Destroy", rng, seriesMods[a[i].id] ?? 0) + 0.1)));
  const killWtsB = modB.map((p, i) => Math.max(0.5, (targetKDForMap(p, !aWon, "Search & Destroy", rng, seriesMods[b[i].id] ?? 0) + 0.1)));
  const killsA = _weightedAllocate(totalDeathsB, killWtsA);
  const killsB = _weightedAllocate(totalDeathsA, killWtsB);

  return { deathsA, deathsB, killsA, killsB };
}

// ── FORM UPDATE ───────────────────────────────────────────────────────────────
function updateForm(player, won, rng) {
  const delta      = won ? ri(2, 8, rng) : ri(-8, -2, rng);
  const resistance = (player.tiltResistance || 2) - 1;
  const adjusted   = won ? delta : Math.max(delta + resistance * 2, -12);
  player.form      = Math.max(30, Math.min(100, (player.form || 70) + adjusted));
}

// ── TRAIT MODIFIERS ──────────────────────────────────────────────────────────
/**
 * applyTraitModifiers — returns new player attribute copies with traits applied.
 * Does NOT mutate the original player objects.
 *
 * ctx = {
 *   mapIdx:            number        — 0-based map index in series
 *   mode:              string        — "Hardpoint" | "Search & Destroy" | "Overload"
 *   tiltedIds:         Set<string>   — player IDs with active tilt penalty
 *   lastMapKDByPlayer: object        — { [playerId]: kd } from previous map
 *   extraBoosts:       object        — { gunny, awareness, teamwork } flat boosts
 * }
 *
 * Returns { modifiedPlayers, procs }
 * procs = [{ playerId, playerName, label }]
 */
function applyTraitModifiers(players, ctx) {
  const { mapIdx, mode, tiltedIds, lastMapKDByPlayer, extraBoosts } = ctx;

  const KEY_ATTRS = ["gunny", "awareness", "searchIQ", "clutch", "composure", "objective", "teamwork", "adaptability"];

  // Find the player with the highest leadership on this team (the "leader")
  let leaderId = null;
  let maxLeadership = -Infinity;
  for (const p of players) {
    if ((p.leadership ?? 2) > maxLeadership) {
      maxLeadership = p.leadership ?? 2;
      leaderId = p.id;
    }
  }
  const leaderKD = leaderId ? (lastMapKDByPlayer[leaderId] ?? 0) : 0;
  const leaderIsHot = leaderKD > 1.0;

  const procs = [];

  const modifiedPlayers = players.map(p => {
    const attrs = { ...p };

    // 1. Tilt penalty — player lost last map and has low tilt resistance
    if (tiltedIds.has(p.id) && (p.tiltResistance ?? 3) < 3) {
      for (const a of KEY_ATTRS) {
        if (attrs[a] != null) attrs[a] = attrs[a] * 0.95;
      }
    }

    // 2. Clutch proc — map 5 or S&D, player has high clutch
    const isClutchMap = mapIdx === 4 || mode === "Search & Destroy";
    if (isClutchMap && (p.clutch ?? 2) >= 4) {
      for (const a of KEY_ATTRS) {
        if (attrs[a] != null) attrs[a] = attrs[a] * 1.10;
      }
      procs.push({ playerId: p.id, playerName: p.name, label: "Clutch Play!" });
    }

    // 3. Leadership boost — leader is performing well, non-leaders get teamwork boost
    if (leaderIsHot && p.id !== leaderId) {
      attrs.teamwork = (attrs.teamwork ?? 50) * 1.03;
      if (procs.every(pr => pr.label !== "Leader Up!" || pr.playerId !== p.id)) {
        procs.push({ playerId: p.id, playerName: p.name, label: "Leader Up!" });
      }
    }

    // 4. Tactical adjustment boosts from the user's intermission choice
    if (extraBoosts) {
      for (const [attr, boost] of Object.entries(extraBoosts)) {
        if (!boost) continue;
        attrs[attr] = (attrs[attr] ?? 50) + boost;
      }
    }

    return attrs;
  });

  return { modifiedPlayers, procs };
}

// ── SINGLE MAP SIM ────────────────────────────────────────────────────────────
/**
 * simMap — simulate one map in a BO5 series.
 * Called by both MatchCenterOverlay (interactive) and simMatch (AI/burst).
 *
 * @param {{ id, name, players }} teamAObj
 * @param {{ id, name, players }} teamBObj
 * @param {number}  mapIdx   — 0-based index into MAP_ROTATION
 * @param {object}  matchCtx — trait and boost context
 * @param {function} rng     — seeded RNG (advanced in place across calls)
 *
 * matchCtx = {
 *   tiltedIdsA:        Set   — tilted player IDs on team A
 *   tiltedIdsB:        Set   — tilted player IDs on team B
 *   lastMapKDByPlayer: {}    — { [playerId]: kd }
 *   extraBoostsA:      {}    — { gunny, awareness, teamwork }
 *   extraBoostsB:      {}    — same for team B
 * }
 *
 * Returns {
 *   mapResult:      object         — standard mapResult entry
 *   playerMapStats: {}             — { [playerId]: { name, teamId, kills, deaths, kd } }
 *   procs:          []             — trait proc events for UI
 *   newTiltedIdsA:  Set            — tilted players heading into next map (team A)
 *   newTiltedIdsB:  Set            — tilted players heading into next map (team B)
 *   momentum:       number 0–1    — strA / (strA + strB)
 * }
 */
export function simMap(teamAObj, teamBObj, mapIdx, matchCtx, rng) {
  teamAObj = padTeamToFour(teamAObj);
  teamBObj = padTeamToFour(teamBObj);
  const mapDef = MAP_ROTATION[mapIdx];
  const chemA  = calcChemistry(teamAObj.players);
  const chemB  = calcChemistry(teamBObj.players);

  const ctx = matchCtx ?? {};
  const tiltedIdsA        = ctx.tiltedIdsA        ?? new Set();
  const tiltedIdsB        = ctx.tiltedIdsB        ?? new Set();
  const lastMapKDByPlayer = ctx.lastMapKDByPlayer  ?? {};
  const extraBoostsA      = ctx.extraBoostsA       ?? {};
  const extraBoostsB      = ctx.extraBoostsB       ?? {};
  const seriesMods        = ctx.seriesMods         ?? {};

  const { modifiedPlayers: modA, procs: procsA } = applyTraitModifiers(
    teamAObj.players.slice(0, 4),
    { mapIdx, mode: mapDef.mode, tiltedIds: tiltedIdsA, lastMapKDByPlayer, extraBoosts: extraBoostsA }
  );
  const { modifiedPlayers: modB, procs: procsB } = applyTraitModifiers(
    teamBObj.players.slice(0, 4),
    { mapIdx, mode: mapDef.mode, tiltedIds: tiltedIdsB, lastMapKDByPlayer, extraBoosts: extraBoostsB }
  );

  const strA = teamStrength(modA, chemA, mapDef.mode, teamAObj.eraRoleWeights ?? null);
  const strB = teamStrength(modB, chemB, mapDef.mode, teamBObj.eraRoleWeights ?? null);
  // Map-pool influence (opt-in via matchCtx): a modest, capped strength delta
  // derived from the two teams' rating on the selected map. Zero by default, so
  // callers that don't supply a map set get unchanged behaviour.
  const mapStrModA = ctx.mapStrModA ?? 0;
  const strAadj = strA + mapStrModA;
  const strBadj = strB - mapStrModA;
  const aWon = rng() < mapWinProb(strAadj, strBadj);

  const [winScore, loseScore] = genMapScore(mapDef.mode, rng);
  const scoreA = aWon ? winScore : loseScore;
  const scoreB = aWon ? loseScore : winScore;

  const playerMapStats = {};
  const teamA4 = teamAObj.players.slice(0, 4);
  const teamB4 = teamBObj.players.slice(0, 4);
  const kTargetsA = teamA4.map((p, i) => targetKDForMap(modA[i], aWon, mapDef.mode, rng, seriesMods[p.id] ?? 0));
  const kTargetsB = teamB4.map((p, i) => targetKDForMap(modB[i], !aWon, mapDef.mode, rng, seriesMods[p.id] ?? 0));

  let killsA, killsB, deathsA, deathsB;
  if (mapDef.mode === "Search & Destroy") {
    const snd = _simSnDStats(teamAObj, teamBObj, scoreA, scoreB, aWon, modA, modB, rng, seriesMods);
    killsA = snd.killsA;
    killsB = snd.killsB;
    deathsA = teamA4.map(p => snd.deathsA[p.id]);
    deathsB = teamB4.map(p => snd.deathsB[p.id]);
  } else {
    const lose = Math.min(scoreA, scoreB);
    if (mapDef.mode === "Hardpoint") {
      const close = lose >= 220 ? 2 : lose >= 170 ? 1 : 0;
      // Kill pool gap tightened: the old blowout split (90–115 win / 70–95 lose)
      // created a ~1.24 team pool K/D independent of individual performance.
      // New ranges keep winner advantage but let individual targets drive the spread.
      const winTot = close === 2 ? ri(106, 130, rng) : close === 1 ? ri(92, 116, rng) : ri(82, 104, rng);
      const loseTot = close === 2 ? ri(102, 126, rng) : close === 1 ? ri(86, 110, rng) : ri(77, 97, rng);
      const tAWin = scoreA > scoreB;
      const kA = tAWin ? winTot : loseTot;
      const kB = tAWin ? loseTot : winTot;
      killsA = _weightedAllocate(kA, kTargetsA);
      killsB = _weightedAllocate(kB, kTargetsB);
    } else { // Overload
      // OVR winner gets a modest kill advantage (smaller gap than HP since Control
      // is a symmetrical mode). Old code gave BOTH teams the same random range,
      // meaning the loser randomly "won" the kill count ~50% of the time, making
      // the OVR map a noise source that kept 3-0 losers near K/D 1.0.
      const close = lose >= 2 ? 2 : lose >= 1 ? 1 : 0;
      const winRange  = close === 2 ? [97, 122] : close === 1 ? [83, 107] : [76, 97];
      const loseRange = close === 2 ? [93, 118] : close === 1 ? [78, 102] : [70, 90];
      const tAWin = scoreA > scoreB;
      killsA = _weightedAllocate(ri(tAWin ? winRange[0] : loseRange[0], tAWin ? winRange[1] : loseRange[1], rng), kTargetsA);
      killsB = _weightedAllocate(ri(!tAWin ? winRange[0] : loseRange[0], !tAWin ? winRange[1] : loseRange[1], rng), kTargetsB);
    }
    // Death weights use 1/k^0.38 (softer than the old 1/k^0.5 / sqrt).
    // With sqrt: K/D ∝ k_i^1.5 — a target of 1.5 amplified to ~1.84× the median.
    // With k^0.38: K/D ∝ k_i^1.38 — same direction, less compounding, so elite
    // players still stand out but the gap between best and worst shrinks.
    deathsA = _weightedAllocate(killsB.reduce((s, v) => s + v, 0), kTargetsA.map(k => 1 / Math.pow(Math.max(0.2, k), 0.38)));
    deathsB = _weightedAllocate(killsA.reduce((s, v) => s + v, 0), kTargetsB.map(k => 1 / Math.pow(Math.max(0.2, k), 0.38)));
  }

  for (let i = 0; i < 4; i++) {
    const aP = teamA4[i], bP = teamB4[i];
    const aK = killsA[i] ?? 0, aD = deathsA[i] ?? 0;
    const bK = killsB[i] ?? 0, bD = deathsB[i] ?? 0;
    playerMapStats[aP.id] = { name: aP.name, teamId: teamAObj.id, kills: aK, deaths: aD, kd: aD > 0 ? +(aK / aD).toFixed(2) : aK };
    playerMapStats[bP.id] = { name: bP.name, teamId: teamBObj.id, kills: bK, deaths: bD, kd: bD > 0 ? +(bK / bD).toFixed(2) : bK };
  }

  // Tilt propagation: losing team's players with low tilt resistance become tilted next map
  const loserTeamPlayers = aWon ? teamBObj.players.slice(0, 4) : teamAObj.players.slice(0, 4);
  const winnerTeamPlayers = aWon ? teamAObj.players.slice(0, 4) : teamBObj.players.slice(0, 4);

  const newTiltedIdsLoser  = new Set(loserTeamPlayers .filter(p => (p.tiltResistance ?? 3) < 3).map(p => p.id));
  const newTiltedIdsWinner = new Set(winnerTeamPlayers.filter(p => tiltedIdsA.has(p.id) || tiltedIdsB.has(p.id) ? false : false)); // winners clear tilt
  void newTiltedIdsWinner; // intentionally empty — winners always clear tilt

  const newTiltedIdsA = aWon ? new Set() : new Set(teamAObj.players.slice(0, 4).filter(p => (p.tiltResistance ?? 3) < 3).map(p => p.id));
  const newTiltedIdsB = aWon ? new Set(teamBObj.players.slice(0, 4).filter(p => (p.tiltResistance ?? 3) < 3).map(p => p.id)) : new Set();

  const totalStr = strAadj + strBadj;
  const momentum = totalStr > 0 ? strAadj / totalStr : 0.5;

  const selectedMap = ctx.selectedMap ?? null;

  return {
    mapResult: {
      mapNum:      mapIdx + 1,
      mode:        mapDef.mode,
      short:       mapDef.short,
      // Map-pool layer (optional): real CDL 2026 map identity + map edge.
      mapId:       selectedMap?.id   ?? null,
      mapName:     selectedMap?.name ?? null,
      mapEdgeA:    ctx.mapEdgeA ?? null,   // signed, team-A perspective
      winnerId:    aWon ? teamAObj.id : teamBObj.id,
      winnerName:  aWon ? teamAObj.name : teamBObj.name,
      loserId:     aWon ? teamBObj.id : teamAObj.id,
      loserName:   aWon ? teamBObj.name : teamAObj.name,
      scoreA,
      scoreB,
      scoreWinner: aWon ? scoreA : scoreB,
      scoreLoser:  aWon ? scoreB : scoreA,
    },
    playerMapStats,
    procs: [...procsA, ...procsB],
    newTiltedIdsA,
    newTiltedIdsB,
    momentum,
  };
}

// ── MAIN SIM FUNCTION ─────────────────────────────────────────────────────────
/**
 * simMatch — simulate one CDL BO5 series (AI/burst mode).
 * Internally uses simMap so trait logic is consistent.
 * External result shape is unchanged.
 */
export function simMatch(teamA, teamB, seed) {
  // Pad once so seriesMods, updateForm, and the inner simMap calls all see a
  // consistent 4-starter view.
  teamA = padTeamToFour(teamA);
  teamB = padTeamToFour(teamB);
  const rng   = seededRng(seed);
  const chemA = calcChemistry(teamA.players);
  const chemB = calcChemistry(teamB.players);
  void chemA; void chemB; // chemistry used inside simMap per call

  const seriesMods = generateSeriesMods(
    [...teamA.players.slice(0, 4), ...teamB.players.slice(0, 4)],
    rng
  );

  // ── Map-pool layer (opt-in) ──
  // When both team objects carry a .mapProfile (attached by buildTeamObj /
  // the Match Center), derive the CDL 2026 best-of-5 veto and a small, capped
  // per-map strength modifier. Deterministic from the profiles, so the match
  // preview's projected map set matches what is actually played. When profiles
  // are absent (e.g. legacy callers / diagnostic scripts) this is null and the
  // sim behaves exactly as before.
  let mapSet = null;
  if (teamA.mapProfile && teamB.mapProfile) {
    mapSet = autoVeto(teamA.mapProfile, teamB.mapProfile).map(slot => ({
      selectedMap: { id: slot.id, name: slot.name, mode: slot.mode },
      edgeA: slot.edgeA,
      strModA: mapStrengthMod(slot.edgeA),
    }));
  }

  let winsA = 0, winsB = 0;

  const accStats = {};
  function ensureStat(id, name, tId) {
    if (!accStats[id]) accStats[id] = { name, teamId: tId, kills: 0, deaths: 0 };
  }

  const mapResults = [];

  let tiltedIdsA        = new Set();
  let tiltedIdsB        = new Set();
  let lastMapKDByPlayer = {};

  for (let m = 0; m < 5; m++) {
    if (winsA === 3 || winsB === 3) break;

    const mapMod = mapSet?.[m] ?? null;
    const { mapResult, playerMapStats, newTiltedIdsA, newTiltedIdsB } = simMap(
      teamA, teamB, m,
      {
        tiltedIdsA, tiltedIdsB, lastMapKDByPlayer, seriesMods,
        selectedMap: mapMod?.selectedMap ?? null,
        mapStrModA:  mapMod?.strModA ?? 0,
        mapEdgeA:    mapMod?.edgeA ?? null,
      },
      rng
    );

    if (mapResult.winnerId === teamA.id) winsA++; else winsB++;
    mapResults.push(mapResult);

    for (const [id, s] of Object.entries(playerMapStats)) {
      ensureStat(id, s.name, s.teamId);
      accStats[id].kills  += s.kills;
      accStats[id].deaths += s.deaths;
    }

    tiltedIdsA        = newTiltedIdsA;
    tiltedIdsB        = newTiltedIdsB;
    lastMapKDByPlayer = Object.fromEntries(
      Object.entries(playerMapStats).map(([id, s]) => [id, s.kd])
    );
  }

  // Finalise stats
  const playerStats = {};
  for (const [id, s] of Object.entries(accStats)) {
    playerStats[id] = {
      ...s,
      kd: s.deaths > 0 ? +(s.kills / s.deaths).toFixed(2) : s.kills > 0 ? s.kills : 0,
    };
  }

  const winner = winsA === 3 ? teamA : teamB;
  const loser  = winsA === 3 ? teamB : teamA;
  const score  = `${Math.max(winsA, winsB)}-${Math.min(winsA, winsB)}`;

  const winnerStats = winner.players.slice(0, 4)
    .map(p => ({ p, stat: playerStats[p.id] }))
    .filter(x => x.stat && x.stat.kills >= 3)
    .sort((a, b) => b.stat.kd - a.stat.kd);

  const standout = winnerStats[0]?.p ?? winner.players[0];

  teamA.players.slice(0, 4).forEach(p => updateForm(p, winsA === 3, rng));
  teamB.players.slice(0, 4).forEach(p => updateForm(p, winsB === 3, rng));

  return {
    winnerId:     winner.id,
    loserId:      loser.id,
    winnerName:   winner.name,
    loserName:    loser.name,
    score,
    teamAId:      teamA.id,
    teamAName:    teamA.name,
    teamBId:      teamB.id,
    teamBName:    teamB.name,
    winsA,
    winsB,
    mapResults,
    playerStats,
    standoutId:   standout?.id   ?? null,
    standoutName: standout?.name ?? null,
    standoutKD:   standout ? (playerStats[standout.id]?.kd ?? 0) : 0,
    chemA: calcChemistry(teamA.players),
    chemB: calcChemistry(teamB.players),
  };
}
