// src/engine/openCircuit/brackets.js
// Deterministic tournament brackets for the open circuit.
//
// - Single & double elimination.
// - Fields that are not a power of two are padded with byes given to the top
//   seeds (a bye is a free advance, never a fixture and never a "loser").
// - No team ever plays itself; no duplicate fixture is generated; a team is only
//   eliminated once it has lost the correct number of times (1 in SE, 2 in DE).
// - Final placement is derived from actual elimination order.
//
// `playMatch(a, b, meta) => winnerId` is injected so the caller controls the
// result (team strength + seeded RNG). It is called once per real fixture.

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return Math.max(1, p);
}

// Standard bracket seeding order for a power-of-two size (1-indexed seeds).
// Classic mirror method: 1v2 → 1,4,3,2 → 1,8,5,4,3,6,7,2 …
function seedOrder(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const n = seeds.length * 2;
    const out = [];
    for (const s of seeds) {
      out.push(s);
      out.push(n + 1 - s);
    }
    seeds = out;
  }
  return seeds; // 1-indexed seed numbers in bracket-position order
}

// Build WB round-1 pairings (seed positions → teamId or null for a bye).
function buildRound1(seeds) {
  const size = nextPow2(seeds.length);
  const order = seedOrder(size); // seed numbers per position
  const positions = order.map((seedNum) => seeds[seedNum - 1] ?? null);
  const matches = [];
  for (let i = 0; i < positions.length; i += 2) {
    matches.push([positions[i], positions[i + 1]]);
  }
  return matches;
}

// Play a list of pairings; byes auto-advance. Returns { winners, losers, fixtures }.
function playPairings(pairs, playMatch, meta) {
  const winners = [];
  const losers = [];
  const fixtures = [];
  pairs.forEach(([a, b], matchIndex) => {
    if (a != null && b == null) { winners.push(a); return; }
    if (a == null && b != null) { winners.push(b); return; }
    if (a == null && b == null) return;
    const winner = playMatch(a, b, { ...meta, matchIndex });
    const loser = winner === a ? b : a;
    winners.push(winner);
    losers.push(loser);
    fixtures.push({ ...meta, matchIndex, a, b, winner, loser });
  });
  return { winners, losers, fixtures };
}

// Pair a flat list sequentially (0v1, 2v3, …). An odd tail gets a bye.
function pairList(list) {
  const pairs = [];
  for (let i = 0; i < list.length; i += 2) {
    pairs.push([list[i], list[i + 1] ?? null]);
  }
  return pairs;
}

export function runSingleElimination({ seeds, playMatch }) {
  const teams = seeds.filter((t) => t != null);
  if (teams.length <= 1) {
    return { champion: teams[0] ?? null, placements: teams.map((t, i) => ({ teamId: t, placement: i + 1 })), matches: [] };
  }
  const matches = [];
  const eliminationRound = new Map(); // teamId -> round eliminated
  let round = 0;
  let pairs = buildRound1(seeds);
  let survivors = [];
  // First round.
  {
    const r = playPairings(pairs, playMatch, { bracket: "SE", round });
    matches.push(...r.fixtures);
    r.losers.forEach((l) => eliminationRound.set(l, round));
    survivors = r.winners;
    round++;
  }
  while (survivors.length > 1) {
    const r = playPairings(pairList(survivors), playMatch, { bracket: "SE", round });
    matches.push(...r.fixtures);
    r.losers.forEach((l) => eliminationRound.set(l, round));
    survivors = r.winners;
    round++;
  }
  const champion = survivors[0];
  const placements = derivePlacements([{ teamId: champion, key: Infinity }], eliminationRound, seeds);
  return { champion, placements, matches };
}

export function runDoubleElimination({ seeds, playMatch }) {
  const teams = seeds.filter((t) => t != null);
  if (teams.length <= 1) {
    return { champion: teams[0] ?? null, placements: teams.map((t, i) => ({ teamId: t, placement: i + 1 })), matches: [], rounds: [] };
  }
  const size = nextPow2(teams.length);
  const k = Math.round(Math.log2(size));
  const matches = [];
  const rounds = [];
  const wbLosersByRound = []; // wl[r]

  // ── Winners bracket ──
  let wbSurvivors = [];
  let pairs = buildRound1(seeds);
  for (let r = 0; r < k; r++) {
    const src = r === 0 ? pairs : pairList(wbSurvivors);
    const res = playPairings(src, playMatch, { bracket: "WB", round: r });
    matches.push(...res.fixtures);
    rounds.push({ name: `WB Round ${r + 1}`, type: "WB", fixtures: res.fixtures });
    wbLosersByRound.push(res.losers);
    wbSurvivors = res.winners;
  }
  const wbChampion = wbSurvivors[0];

  // ── Losers bracket ──
  // A team is eliminated when it loses in the LB. Track the LB "stage" it reached
  // (higher = eliminated later = better placement).
  const lbEliminationStage = new Map();
  let stage = 0;
  let lbSurvivors = [];
  // LB round 1: pair losers of WB round 1 among themselves.
  {
    const res = playPairings(pairList(wbLosersByRound[0] || []), playMatch, { bracket: "LB", round: stage });
    matches.push(...res.fixtures);
    rounds.push({ name: `LB Round ${stage + 1}`, type: "LB", fixtures: res.fixtures });
    res.losers.forEach((l) => lbEliminationStage.set(l, stage));
    lbSurvivors = res.winners;
    stage++;
  }
  for (let i = 1; i < k; i++) {
    // Merge round: each LB survivor plays a WB loser from WB round i+1.
    const drops = wbLosersByRound[i] || [];
    const mergePairs = [];
    const maxLen = Math.max(lbSurvivors.length, drops.length);
    for (let j = 0; j < maxLen; j++) mergePairs.push([lbSurvivors[j] ?? null, drops[j] ?? null]);
    const mres = playPairings(mergePairs, playMatch, { bracket: "LB", round: stage });
    matches.push(...mres.fixtures);
    rounds.push({ name: `LB Round ${stage + 1}`, type: "LB", fixtures: mres.fixtures });
    mres.losers.forEach((l) => lbEliminationStage.set(l, stage));
    lbSurvivors = mres.winners;
    stage++;
    // Pairing round (skip when only one survivor remains — that's the LB champ).
    if (lbSurvivors.length > 1) {
      const pres = playPairings(pairList(lbSurvivors), playMatch, { bracket: "LB", round: stage });
      matches.push(...pres.fixtures);
      rounds.push({ name: `LB Round ${stage + 1}`, type: "LB", fixtures: pres.fixtures });
      pres.losers.forEach((l) => lbEliminationStage.set(l, stage));
      lbSurvivors = pres.winners;
      stage++;
    }
  }
  const lbChampion = lbSurvivors[0];

  // ── Grand final ──
  let champion = wbChampion;
  let runnerUp = lbChampion;
  if (wbChampion != null && lbChampion != null) {
    const gfWinner = playMatch(wbChampion, lbChampion, { bracket: "GF", round: 0 });
    const gfLoser = gfWinner === wbChampion ? lbChampion : wbChampion;
    matches.push({ bracket: "GF", round: 0, matchIndex: 0, a: wbChampion, b: lbChampion, winner: gfWinner, loser: gfLoser });
    rounds.push({ name: "Grand Final", type: "GF", fixtures: [matches[matches.length - 1]] });
    champion = gfWinner;
    runnerUp = gfLoser;
  } else {
    champion = wbChampion ?? lbChampion;
    runnerUp = null;
  }

  // ── Placements ──
  // 1st champion, 2nd runner-up, then LB eliminations by stage (later = better),
  // tie-broken by seed. Byes/first-round losers get the earliest stage.
  const rankKey = new Map();
  rankKey.set(champion, Infinity);
  if (runnerUp != null) rankKey.set(runnerUp, Infinity - 1);
  for (const t of teams) {
    if (t === champion || t === runnerUp) continue;
    rankKey.set(t, lbEliminationStage.has(t) ? lbEliminationStage.get(t) : -1);
  }
  const placements = derivePlacementsFromKeys(teams, rankKey, seeds);
  return { champion, runnerUp, placements, matches, rounds };
}

function seedRank(seeds) {
  const rank = new Map();
  seeds.forEach((t, i) => { if (t != null) rank.set(t, i); });
  return rank;
}

function derivePlacementsFromKeys(teams, rankKey, seeds) {
  const srank = seedRank(seeds);
  const sorted = [...teams].sort((a, b) => {
    const ka = rankKey.get(a) ?? -1;
    const kb = rankKey.get(b) ?? -1;
    if (kb !== ka) return kb - ka;
    return (srank.get(a) ?? 0) - (srank.get(b) ?? 0);
  });
  return sorted.map((teamId, i) => ({ teamId, placement: i + 1 }));
}

// SE variant kept for API symmetry.
function derivePlacements(finalOrder, eliminationRound, seeds) {
  const teams = [...new Set(seeds.filter((t) => t != null))];
  const rankKey = new Map();
  for (const f of finalOrder) rankKey.set(f.teamId, f.key);
  for (const t of teams) {
    if (rankKey.has(t)) continue;
    rankKey.set(t, eliminationRound.has(t) ? eliminationRound.get(t) : -1);
  }
  return derivePlacementsFromKeys(teams, rankKey, seeds);
}

export const __test = { nextPow2, seedOrder, buildRound1, pairList };
