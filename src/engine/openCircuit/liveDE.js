// src/engine/openCircuit/liveDE.js
// Stateful, full-field double-elimination bracket. This is the interactive
// counterpart of runDoubleElimination (brackets.js): it produces the exact same
// bracket structure round-by-round, but PAUSES between rounds so the user can
// play their own matches live (in the Match Center) while AI matches are filled
// in. Every eligible team is in the bracket (the top seeds get first-round byes
// when the field is not a power of two).
//
// Correctness is cross-checked against the batch runDoubleElimination in
// scripts/liveDE.test.mjs: same seeds + same match outcomes ⇒ same champion and
// placements.

import { __test } from "./brackets.js";
const { nextPow2, buildRound1, pairList } = __test;

// A real match (two teams) or a bye (one team auto-advances).
function pairToMatch(pair, roundIdx, matchIdx, seeds) {
  const [a, b] = pair;
  const seedNum = (id) => { const i = seeds.indexOf(id); return i >= 0 ? i + 1 : null; };
  if (a != null && b == null) return { a, b: null, played: true, result: { winnerId: a, loserId: null, bye: true }, seedA: seedNum(a) };
  if (a == null && b != null) return { a: b, b: null, played: true, result: { winnerId: b, loserId: null, bye: true }, seedA: seedNum(b) };
  return { a, b, played: false, result: null, seedA: seedNum(a), seedB: seedNum(b) };
}

function makeRound(name, type, pairs, roundIdx, seeds) {
  return { name, type, matches: pairs.map((p, i) => pairToMatch(p, roundIdx, i, seeds)) };
}

// Resolve a completed round into winners/losers in pair order (matching
// playPairings): byes yield their team as a winner (no loser).
function resolveRound(round) {
  const winners = [];
  const losers = [];
  for (const m of round.matches) {
    if (m.result?.bye) { winners.push(m.result.winnerId); continue; }
    winners.push(m.result.winnerId);
    losers.push(m.result.loserId);
  }
  return { winners, losers };
}

export function roundComplete(round) {
  return (round?.matches || []).every((m) => m.played);
}

// Create the live bracket for a seeded field (seed order, best first).
export function createLiveDE(seeds) {
  const teams = seeds.filter((t) => t != null);
  const size = nextPow2(teams.length);
  const k = Math.max(1, Math.round(Math.log2(size)));
  const round0 = makeRound("WB Round 1", "WB", buildRound1(seeds), 0, seeds);
  const bracket = {
    seeds,
    type: "DE",
    champion: null,
    runnerUp: null,
    rounds: [round0],
    _de: {
      k, phase: "wb", wbRound: 0, wbLosersByRound: [], wbSurvivors: [], wbChampion: null,
      lbStage: 0, lbSurvivors: [], lbI: 0, lbSub: "r1", lbChampion: null,
      elimStage: {},
    },
  };
  advanceLiveDE(bracket); // settle past any all-bye opening rounds
  return bracket;
}

// Find the next unplayed real match (both teams present) in round order.
export function findNextLiveMatch(bracket) {
  for (let r = 0; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r];
    const idx = (round.matches || []).findIndex((m) => !m.played && m.a && m.b);
    if (idx !== -1) return { roundIdx: r, round, matchIdx: idx, match: round.matches[idx] };
  }
  return null;
}

const wbName = (r) => `WB Round ${r + 1}`;
const lbName = (s) => `LB Round ${s + 1}`;

// Advance while the current (last) round is fully played — pushing the next
// round each time, and rolling past all-bye rounds automatically. Returns true
// when the bracket is done.
export function advanceLiveDE(bracket) {
  let guard = 0;
  while (guard++ < 100) {
    if (bracket._de.phase === "done") return true;
    const round = bracket.rounds[bracket.rounds.length - 1];
    if (!roundComplete(round)) return false;
    _advanceOnce(bracket);
  }
  return bracket._de.phase === "done";
}

function _advanceOnce(bracket) {
  const de = bracket._de;
  if (de.phase === "done") return true;
  const round = bracket.rounds[bracket.rounds.length - 1];
  if (!roundComplete(round)) return false;
  const { winners, losers } = resolveRound(round);

  if (de.phase === "wb") {
    de.wbLosersByRound[de.wbRound] = losers;
    de.wbSurvivors = winners;
    de.wbRound += 1;
    if (de.wbRound < de.k) {
      bracket.rounds.push(makeRound(wbName(de.wbRound), "WB", pairList(de.wbSurvivors), de.wbRound, bracket.seeds));
      return false;
    }
    // WB done → LB Round 1 (pair WB round-1 losers).
    de.wbChampion = de.wbSurvivors[0];
    de.phase = "lb";
    de.lbStage = 0;
    de.lbSub = "r1";
    bracket.rounds.push(makeRound(lbName(de.lbStage), "LB", pairList(de.wbLosersByRound[0] || []), de.lbStage, bracket.seeds));
    return false;
  }

  if (de.phase === "lb") {
    for (const l of losers) de.elimStage[l] = de.lbStage;
    de.lbSurvivors = winners;
    de.lbStage += 1;

    const openMerge = (i) => {
      const drops = de.wbLosersByRound[i] || [];
      const pairs = [];
      const maxLen = Math.max(de.lbSurvivors.length, drops.length);
      for (let j = 0; j < maxLen; j++) pairs.push([de.lbSurvivors[j] ?? null, drops[j] ?? null]);
      bracket.rounds.push(makeRound(lbName(de.lbStage), "LB", pairs, de.lbStage, bracket.seeds));
    };
    const openPair = () => bracket.rounds.push(makeRound(lbName(de.lbStage), "LB", pairList(de.lbSurvivors), de.lbStage, bracket.seeds));
    const gotoGF = () => {
      de.lbChampion = de.lbSurvivors[0];
      de.phase = "gf";
      const gf = { name: "Grand Final", type: "GF", matches: [pairToMatch([de.wbChampion, de.lbChampion], 0, 0, bracket.seeds)] };
      bracket.rounds.push(gf);
    };

    if (de.lbSub === "r1") {
      de.lbI = 1;
      if (de.lbI < de.k) { de.lbSub = "merge"; openMerge(de.lbI); } else gotoGF();
      return false;
    }
    if (de.lbSub === "merge") {
      if (de.lbSurvivors.length > 1) { de.lbSub = "pair"; openPair(); }
      else { de.lbI += 1; if (de.lbI < de.k) { de.lbSub = "merge"; openMerge(de.lbI); } else gotoGF(); }
      return false;
    }
    // just finished a pair round
    de.lbI += 1;
    if (de.lbI < de.k) { de.lbSub = "merge"; openMerge(de.lbI); } else gotoGF();
    return false;
  }

  if (de.phase === "gf") {
    de.champion = winners[0];
    de.runnerUp = losers[0] ?? null;
    bracket.champion = de.champion;
    bracket.runnerUp = de.runnerUp;
    de.phase = "done";
    return true;
  }
  return de.phase === "done";
}

// Record a played match result (from AI sim or the live Match Center) into the
// bracket, then advance as far as the next unplayed real match. Mutates.
export function recordLiveMatch(bracket, roundIdx, matchIdx, result) {
  const m = bracket.rounds[roundIdx].matches[matchIdx];
  m.played = true;
  m.result = result;
  advanceLiveDE(bracket);
}

// Final placements: champion, runner-up, then LB eliminations (later = better),
// tie-broken by seed. Returns { teamId: placement }.
export function computeLivePlacements(bracket) {
  const de = bracket._de;
  const teams = bracket.seeds.filter((t) => t != null);
  const seedRank = new Map(bracket.seeds.map((t, i) => [t, i]));
  const key = new Map();
  key.set(de.champion, Infinity);
  if (de.runnerUp != null) key.set(de.runnerUp, Infinity - 1);
  for (const t of teams) {
    if (t === de.champion || t === de.runnerUp) continue;
    key.set(t, de.elimStage[t] != null ? de.elimStage[t] : -1);
  }
  const sorted = [...teams].sort((a, b) => {
    const ka = key.get(a) ?? -1, kb = key.get(b) ?? -1;
    if (kb !== ka) return kb - ka;
    return (seedRank.get(a) ?? 0) - (seedRank.get(b) ?? 0);
  });
  const out = {};
  sorted.forEach((teamId, i) => { out[teamId] = i + 1; });
  return out;
}
