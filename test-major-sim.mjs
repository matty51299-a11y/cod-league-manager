// test-major-sim.mjs  –  run with:  node test-major-sim.mjs
// Reproduces the "Major stuck after _resolveMajorCompletion" bug.
// Self-contained: copies only the relevant engine logic, no imports from src/.

// ─── Minimal seeded RNG (same as seasonEngine.js) ────────────────────────────
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── Minimal simMatch stub ────────────────────────────────────────────────────
// Returns a deterministic result based on teamA vs teamB and seed.
function simMatch(teamA, teamB, seed) {
  const rng = seededRng(seed);
  const winnerId = rng() < 0.5 ? teamA.id : teamB.id;
  const loserId  = winnerId === teamA.id ? teamB.id : teamA.id;
  return { winnerId, loserId, teamAId: teamA.id, teamBId: teamB.id };
}

function buildTeamObj(teamId) {
  return { id: teamId, name: teamId, players: [] };
}

// ─── majorSeed ────────────────────────────────────────────────────────────────
function majorSeed(season, majorIdx, roundIdx, matchIdx) {
  return season * 1_000_000 + majorIdx * 100_000 + (roundIdx + 1) * 10_000 + (matchIdx + 1) * 100 + 7;
}

// ─── buildMajorBracketDE16 ───────────────────────────────────────────────────
function buildMajorBracketDE16(majorSeeds) {
  const s = majorSeeds;
  const wbR1Matches = [
    { a: s[0],  b: s[15], seedA: 1,  seedB: 16, played: false, result: null },
    { a: s[7],  b: s[8],  seedA: 8,  seedB: 9,  played: false, result: null },
    { a: s[3],  b: s[12], seedA: 4,  seedB: 13, played: false, result: null },
    { a: s[4],  b: s[11], seedA: 5,  seedB: 12, played: false, result: null },
    { a: s[1],  b: s[14], seedA: 2,  seedB: 15, played: false, result: null },
    { a: s[6],  b: s[9],  seedA: 7,  seedB: 10, played: false, result: null },
    { a: s[2],  b: s[13], seedA: 3,  seedB: 14, played: false, result: null },
    { a: s[5],  b: s[10], seedA: 6,  seedB: 11, played: false, result: null },
  ];
  return {
    seeds: majorSeeds,
    type: "DE16",
    rounds: [
      { name: "WB Round 1",   type: "WB", matches: wbR1Matches },
      { name: "LB Round 1",   type: "LB", matches: [] },
      { name: "WB Round 2",   type: "WB", matches: [] },
      { name: "LB Round 2",   type: "LB", matches: [] },
      { name: "LB Round 3",   type: "LB", matches: [] },
      { name: "WB Semifinals",type: "WB", matches: [] },
      { name: "LB Round 4",   type: "LB", matches: [] },
      { name: "WB Final",     type: "WB", matches: [] },
      { name: "LB Round 5",   type: "LB", matches: [] },
      { name: "LB Final",     type: "LB", matches: [] },
      { name: "Grand Final",  type: "GF", matches: [] },
    ],
    completed: false,
    champion:  null,
    _wbChampion: null,
    _wbFLoser:   null,
    _lbr3Winners: null,
  };
}

// ─── _tryPopulateLBFinal ─────────────────────────────────────────────────────
function _tryPopulateLBFinal(bracket) {
  const lbR5 = bracket.rounds[8];
  if (!lbR5.matches.length || !lbR5.matches[0]?.played) return;
  if (!bracket._wbFLoser) return;
  const lbR5Winner = lbR5.matches[0].result.winnerId;
  bracket.rounds[9].matches = [
    { a: bracket._wbFLoser, b: lbR5Winner, played: false, result: null },
  ];
}

// ─── _simOneMajorMatchDE16 ────────────────────────────────────────────────────
// EXACT COPY from seasonEngine.js
function _simOneMajorMatchDE16(schedule, gameState) {
  const majorIdx = schedule.majorIdx;
  const major = schedule.majors[majorIdx];
  const bracket = major.bracket;
  let roundIdx = -1;
  for (let r = 0; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r];
    if (round.matches.length > 0 && round.matches.some(m => !m.played)) { roundIdx = r; break; }
  }
  if (roundIdx === -1) return { roundIdx: -1, allComplete: true };
  const round = bracket.rounds[roundIdx];
  const matchIdx = round.matches.findIndex(m => !m.played);
  const match = round.matches[matchIdx];

  const seed = majorSeed(schedule.season, majorIdx, roundIdx, matchIdx);
  const result = simMatch(buildTeamObj(match.a), buildTeamObj(match.b), seed);

  match.played = true;
  match.result = result;

  if (!round.matches.every(m => m.played)) return { roundIdx, allComplete: false };

  const winners = round.matches.map(m => m.result.winnerId);
  const losers  = round.matches.map(m => m.result.loserId);

  switch (roundIdx) {
    case 0:
      bracket.rounds[1].matches = [
        { a: losers[0], b: losers[1], played:false, result:null },
        { a: losers[2], b: losers[3], played:false, result:null },
        { a: losers[4], b: losers[5], played:false, result:null },
        { a: losers[6], b: losers[7], played:false, result:null },
      ];
      bracket.rounds[2].matches = [
        { a: winners[0], b: winners[1], played:false, result:null },
        { a: winners[2], b: winners[3], played:false, result:null },
        { a: winners[4], b: winners[5], played:false, result:null },
        { a: winners[6], b: winners[7], played:false, result:null },
      ];
      break;
    case 1: break;
    case 2:
      bracket.rounds[5].matches = [
        { a: winners[0], b: winners[1], played:false, result:null },
        { a: winners[2], b: winners[3], played:false, result:null },
      ];
      const lb1w = bracket.rounds[1].matches.map(m => m.result.winnerId);
      bracket.rounds[3].matches = [
        { a: lb1w[0], b: losers[0], played:false, result:null },
        { a: lb1w[1], b: losers[1], played:false, result:null },
        { a: lb1w[2], b: losers[2], played:false, result:null },
        { a: lb1w[3], b: losers[3], played:false, result:null },
      ];
      break;
    case 3:
      bracket.rounds[4].matches = [
        { a: winners[0], b: winners[1], played:false, result:null },
        { a: winners[2], b: winners[3], played:false, result:null },
      ];
      break;
    case 4: bracket._lbr3Winners = winners; break;
    case 5:
      bracket.rounds[7].matches = [{ a: winners[0], b: winners[1], played:false, result:null }];
      bracket.rounds[6].matches = [
        { a: bracket._lbr3Winners[0], b: losers[0], played:false, result:null },
        { a: bracket._lbr3Winners[1], b: losers[1], played:false, result:null },
      ];
      break;
    case 6: bracket.rounds[8].matches = [{ a: winners[0], b: winners[1], played:false, result:null }]; break;
    case 7: bracket._wbChampion = winners[0]; bracket._wbFLoser = losers[0]; _tryPopulateLBFinal(bracket); break;
    case 8: _tryPopulateLBFinal(bracket); break;
    case 9: bracket.rounds[10].matches = [{ a: bracket._wbChampion, b: winners[0], played:false, result:null }]; break;
    case 10: bracket.champion = winners[0]; major.completed = true; return { roundIdx, allComplete: true };
  }
  return { roundIdx, allComplete: false };
}

// ─── _resolveMajorCompletion ─────────────────────────────────────────────────
function _resolveMajorCompletion(major) {
  const bracket = major?.bracket;
  if (!major || !bracket) return false;
  if (major.completed) return true;

  const rounds = bracket.rounds || [];
  const gfRound = rounds.find(r => r.type === "GF") || rounds[rounds.length - 1];
  const gfMatch = gfRound?.matches?.[0] || null;

  if (gfMatch?.played && gfMatch.result?.winnerId) {
    bracket.champion = bracket.champion || gfMatch.result.winnerId;
    major.completed = true;
    return true;
  }

  const hasUnplayed = rounds.some(r => (r.matches || []).some(m => !m.played));
  if (!hasUnplayed && bracket.champion) {
    major.completed = true;
    return true;
  }

  return false;
}

// ─── debugMajorBracketState ───────────────────────────────────────────────────
function debugMajorBracketState(major) {
  const bracket = major?.bracket;
  if (!bracket) return { error: "no bracket" };

  const rounds = bracket.rounds || [];
  let totalMatches = 0, completedMatches = 0, pendingBothTeams = 0, blockedMissing = 0;
  const roundSummary = [];

  for (const r of rounds) {
    const ms = r.matches || [];
    totalMatches += ms.length;
    let rCompleted = 0, rPending = 0, rBlocked = 0;
    for (const m of ms) {
      if (m.played) { rCompleted++; completedMatches++; }
      else if (m.a && m.b) { rPending++; pendingBothTeams++; }
      else { rBlocked++; blockedMissing++; }
    }
    roundSummary.push({
      name: r.name,
      type: r.type,
      count: ms.length,
      completed: rCompleted,
      pending: rPending,
      blocked: rBlocked,
    });
  }

  // Find next simmable match
  let nextSimmable = null;
  for (const r of rounds) {
    const m = (r.matches || []).find(x => !x.played && x.a && x.b);
    if (m) { nextSimmable = { round: r.name, a: m.a, b: m.b }; break; }
  }

  return {
    type: bracket.type,
    completed: major.completed,
    champion: bracket.champion,
    _wbChampion: bracket._wbChampion,
    _wbFLoser: bracket._wbFLoser,
    _lbr3Winners: bracket._lbr3Winners,
    totalMatches, completedMatches, pendingBothTeams, blockedMissing,
    nextSimmable,
    rounds: roundSummary,
  };
}

// ─── Full simulation test ─────────────────────────────────────────────────────
function runMajorTest(label, seeds) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`TEST: ${label}`);
  console.log(`Seeds: ${seeds.join(", ")}`);

  const schedule = {
    season: 1,
    majorIdx: 0,
    phase: "major",
    majors: [
      { name: "Major 1", bracket: buildMajorBracketDE16(seeds), completed: false },
    ],
    matchLog: [],
  };
  const gameState = { schedule };

  let matchesPlayed = 0;
  const MAX_ITERS = 300;

  for (let i = 0; i < MAX_ITERS; i++) {
    const major = schedule.majors[schedule.majorIdx];
    if (!major || major.completed) break;

    const { roundIdx, allComplete } = _simOneMajorMatchDE16(schedule, gameState);

    if (allComplete && roundIdx === -1) {
      // No simmable match found — this is the stuck state
      console.log(`\n!!! STUCK at iteration ${i}: roundIdx=-1 but major.completed=${major.completed}`);
      const dbg = debugMajorBracketState(major);
      console.log("DEBUG STATE:");
      console.log(JSON.stringify(dbg, null, 2));
      return { stuck: true, iteration: i, debug: dbg };
    }

    if (allComplete) {
      matchesPlayed++;
      console.log(`  [${i}] Round ${roundIdx} GF complete → champion=${major.bracket.champion}`);
      break;
    }

    matchesPlayed++;
  }

  const major = schedule.majors[0];
  const dbg = debugMajorBracketState(major);

  if (!major.completed) {
    console.log(`\n!!! Did NOT complete after ${MAX_ITERS} iterations`);
    console.log("Final debug state:");
    console.log(JSON.stringify(dbg, null, 2));
    return { stuck: true, matchesPlayed, debug: dbg };
  }

  console.log(`\n✓ COMPLETED — champion: ${major.bracket.champion}`);
  console.log(`  Total matches played: ${matchesPlayed}`);
  console.log(`  CDL points awarded: (not tested here)`);
  console.log("  Round summary:");
  for (const r of dbg.rounds) {
    console.log(`    ${r.name.padEnd(20)} matches=${r.count} completed=${r.completed}`);
  }
  return { stuck: false, matchesPlayed, champion: major.bracket.champion, debug: dbg };
}

// ─── Test simMajor loop (reproducing the actual loop from seasonEngine) ───────
function runSimMajorLoop(label, seeds) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`SIM-MAJOR LOOP TEST: ${label}`);

  const schedule = {
    season: 1,
    majorIdx: 0,
    phase: "major",
    majors: [
      { name: "Major 1", bracket: buildMajorBracketDE16(seeds), completed: false },
    ],
    matchLog: [],
  };
  let gameState = { schedule };
  const targetIdx = 0;

  let safety = 0;
  while (!schedule.majors[targetIdx].completed && safety++ < 200) {
    const { allComplete } = _simOneMajorMatchDE16(schedule, gameState);

    if (allComplete || _resolveMajorCompletion(schedule.majors[schedule.majorIdx])) {
      // Simulate _advanceMajorPhase — just mark it
      console.log(`  ADVANCING PHASE at safety=${safety}, major.completed=${schedule.majors[targetIdx].completed}`);
      schedule.phase = "stage";
      schedule.majorIdx = null;
      break;
    }
  }

  const major = schedule.majors[0];
  const dbg = debugMajorBracketState(major);

  if (!major.completed) {
    console.log(`\n!!! simMajor loop DID NOT complete major (safety=${safety})`);
    console.log("  major.completed =", major.completed);
    console.log("  bracket.champion =", major.bracket?.champion);
    console.log("  phase advanced to:", schedule.phase);
    console.log("  Round states:");
    for (const r of dbg.rounds) {
      const status = r.completed === r.count ? "DONE" : r.count === 0 ? "EMPTY" : `${r.completed}/${r.count}`;
      console.log(`    ${r.name.padEnd(20)} ${status} ${r.blocked > 0 ? `BLOCKED(${r.blocked})` : ""}`);
    }
    return { bug: true, debug: dbg };
  }

  console.log(`✓ simMajor loop completed correctly. Champion: ${major.bracket.champion}`);
  return { bug: false, debug: dbg };
}

// ─── Run tests ────────────────────────────────────────────────────────────────

// Generate 16 team IDs (12 CDL + 4 challengers)
const CDL_IDS = ["boston","carolina","cloud9","faze","g2","lat","miami","optic","paris","riyadh","toronto","vancouver"];
const CHAL_IDS = ["major_qual_1_1_1","major_qual_1_1_2","major_qual_1_1_3","major_qual_1_1_4"];
const allSeeds = [...CDL_IDS, ...CHAL_IDS];

// Test 1: Basic forward simulation (one match at a time)
const r1 = runMajorTest("DE16 forward one-match-at-a-time", allSeeds);

// Test 2: Reproduce the simMajor loop
const r2 = runSimMajorLoop("simMajor while-loop reproduction", allSeeds);

// Test 3: Verify bracket ordering — are WB Final (7) and LB R5 (8) order-sensitive?
console.log(`\n${"=".repeat(70)}`);
console.log("ORDER SENSITIVITY TEST:");
console.log("Checking that LB Final gets populated correctly when WB Final completes before LB R5...");

// Build a bracket and manually fast-forward to near-endgame to check
{
  const schedule = {
    season: 1, majorIdx: 0, phase: "major",
    majors: [{ name: "Major 1", bracket: buildMajorBracketDE16(allSeeds), completed: false }],
    matchLog: [],
  };
  const gs = { schedule };

  // Play all matches one at a time, tracking order
  let iteration = 0;
  const roundHistory = [];
  while (!schedule.majors[0].completed && iteration < 300) {
    iteration++;
    const bracket = schedule.majors[0].bracket;
    let roundIdx = -1;
    for (let r = 0; r < bracket.rounds.length; r++) {
      const rnd = bracket.rounds[r];
      if (rnd.matches.length > 0 && rnd.matches.some(m => !m.played)) { roundIdx = r; break; }
    }
    if (roundIdx === -1) {
      console.log(`  STUCK at iteration ${iteration}!`);
      console.log("  LB R5 (idx 8):", JSON.stringify(bracket.rounds[8].matches.map(m => ({ a: m.a, b: m.b, played: m.played }))));
      console.log("  LB Final (idx 9):", JSON.stringify(bracket.rounds[9].matches));
      console.log("  GF (idx 10):", JSON.stringify(bracket.rounds[10].matches));
      console.log("  _wbFLoser:", bracket._wbFLoser);
      console.log("  _wbChampion:", bracket._wbChampion);
      break;
    }

    const rnd = bracket.rounds[roundIdx];
    const mi  = rnd.matches.findIndex(m => !m.played);
    const m   = rnd.matches[mi];
    const seed = majorSeed(1, 0, roundIdx, mi);
    const res = simMatch(buildTeamObj(m.a), buildTeamObj(m.b), seed);
    m.played = true; m.result = res;

    const roundName = bracket.rounds[roundIdx].name;
    if (!roundHistory.length || roundHistory[roundHistory.length-1] !== roundName)
      roundHistory.push(roundName);

    const allInRoundPlayed = rnd.matches.every(x => x.played);
    if (allInRoundPlayed) {
      const winners = rnd.matches.map(x => x.result.winnerId);
      const losers  = rnd.matches.map(x => x.result.loserId);
      switch (roundIdx) {
        case 0:
          bracket.rounds[1].matches = losers.slice(0,4).map((l,i) => ({ a: losers[i*2 < 8 ? i*2 : i], b: losers[i*2+1 < 8 ? i*2+1 : i+4], played:false,result:null }));
          // Actually follow exact logic:
          bracket.rounds[1].matches = [
            { a: losers[0], b: losers[1], played:false,result:null },
            { a: losers[2], b: losers[3], played:false,result:null },
            { a: losers[4], b: losers[5], played:false,result:null },
            { a: losers[6], b: losers[7], played:false,result:null },
          ];
          bracket.rounds[2].matches = [
            { a: winners[0], b: winners[1], played:false,result:null },
            { a: winners[2], b: winners[3], played:false,result:null },
            { a: winners[4], b: winners[5], played:false,result:null },
            { a: winners[6], b: winners[7], played:false,result:null },
          ];
          break;
        case 1: break;
        case 2: {
          bracket.rounds[5].matches = [
            { a: winners[0], b: winners[1], played:false,result:null },
            { a: winners[2], b: winners[3], played:false,result:null },
          ];
          const lb1w = bracket.rounds[1].matches.map(x => x.result.winnerId);
          bracket.rounds[3].matches = [
            { a: lb1w[0], b: losers[0], played:false,result:null },
            { a: lb1w[1], b: losers[1], played:false,result:null },
            { a: lb1w[2], b: losers[2], played:false,result:null },
            { a: lb1w[3], b: losers[3], played:false,result:null },
          ];
          break;
        }
        case 3:
          bracket.rounds[4].matches = [
            { a: winners[0], b: winners[1], played:false,result:null },
            { a: winners[2], b: winners[3], played:false,result:null },
          ];
          break;
        case 4: bracket._lbr3Winners = winners; break;
        case 5:
          bracket.rounds[7].matches = [{ a: winners[0], b: winners[1], played:false,result:null }];
          bracket.rounds[6].matches = [
            { a: bracket._lbr3Winners[0], b: losers[0], played:false,result:null },
            { a: bracket._lbr3Winners[1], b: losers[1], played:false,result:null },
          ];
          break;
        case 6: bracket.rounds[8].matches = [{ a: winners[0], b: winners[1], played:false,result:null }]; break;
        case 7:
          bracket._wbChampion = winners[0]; bracket._wbFLoser = losers[0];
          _tryPopulateLBFinal(bracket);
          break;
        case 8: _tryPopulateLBFinal(bracket); break;
        case 9: bracket.rounds[10].matches = [{ a: bracket._wbChampion, b: winners[0], played:false,result:null }]; break;
        case 10: bracket.champion = winners[0]; schedule.majors[0].completed = true; break;
      }
    }
  }

  const major = schedule.majors[0];
  if (major.completed) {
    console.log("  ✓ Order sensitivity test PASSED");
    console.log("  Round play order:", roundHistory.join(" → "));
    console.log("  Champion:", major.bracket.champion);
    console.log("  Total matches:", iteration);
  } else {
    console.log("  ✗ Order sensitivity test FAILED — bracket stuck");
  }
}

// Summary
console.log(`\n${"=".repeat(70)}`);
console.log("SUMMARY:");
console.log("  One-at-a-time test stuck:", r1.stuck);
console.log("  simMajor loop bug found:", r2.bug);

if (!r1.stuck && !r2.bug) {
  console.log("\nNOTE: Basic DE16 logic appears correct in isolation.");
  console.log("The bug may be state-related: persisted bracket from a save-game");
  console.log("OR a specific Challenger team ID not resolving in buildTeamObj.");
  console.log("OR simMajor exits early when allComplete:true fires before bracket is truly done.");
  console.log("\nChecking simMajor early-exit scenario...");

  // Simulate what happens when roundIdx===-1 fires prematurely:
  // This can happen if the bracket state is persisted/restored incorrectly
  // (e.g. matches array is empty after deserialization)
  const fakeSchedule = {
    season: 1, majorIdx: 0, phase: "major",
    majors: [{ name: "Major 1", bracket: buildMajorBracketDE16(allSeeds), completed: false }],
    matchLog: [],
  };
  // Manually put the bracket into a "stuck" state: play rounds 0-8 except round 9 (LB Final)
  // by marking all matches as played without populating round 9
  const b = fakeSchedule.majors[0].bracket;

  // Round 0: mark all 8 as played, set results
  for (let i = 0; i < b.rounds[0].matches.length; i++) {
    const m = b.rounds[0].matches[i];
    m.played = true;
    m.result = { winnerId: m.a, loserId: m.b };
  }
  const w0 = b.rounds[0].matches.map(m => m.result.winnerId);
  const l0 = b.rounds[0].matches.map(m => m.result.loserId);

  // Populate and play round 1 (LB R1)
  b.rounds[1].matches = [
    { a: l0[0], b: l0[1], played: true, result: { winnerId: l0[0], loserId: l0[1] } },
    { a: l0[2], b: l0[3], played: true, result: { winnerId: l0[2], loserId: l0[3] } },
    { a: l0[4], b: l0[5], played: true, result: { winnerId: l0[4], loserId: l0[5] } },
    { a: l0[6], b: l0[7], played: true, result: { winnerId: l0[6], loserId: l0[7] } },
  ];

  // Populate and play round 2 (WB R2)
  b.rounds[2].matches = [
    { a: w0[0], b: w0[1], played: true, result: { winnerId: w0[0], loserId: w0[1] } },
    { a: w0[2], b: w0[3], played: true, result: { winnerId: w0[2], loserId: w0[3] } },
    { a: w0[4], b: w0[5], played: true, result: { winnerId: w0[4], loserId: w0[5] } },
    { a: w0[6], b: w0[7], played: true, result: { winnerId: w0[6], loserId: w0[7] } },
  ];
  const w2 = b.rounds[2].matches.map(m => m.result.winnerId);
  const l2 = b.rounds[2].matches.map(m => m.result.loserId);
  const lb1w = b.rounds[1].matches.map(m => m.result.winnerId);

  // Populate and play round 3 (LB R2)
  b.rounds[3].matches = [
    { a: lb1w[0], b: l2[0], played: true, result: { winnerId: lb1w[0], loserId: l2[0] } },
    { a: lb1w[1], b: l2[1], played: true, result: { winnerId: lb1w[1], loserId: l2[1] } },
    { a: lb1w[2], b: l2[2], played: true, result: { winnerId: lb1w[2], loserId: l2[2] } },
    { a: lb1w[3], b: l2[3], played: true, result: { winnerId: lb1w[3], loserId: l2[3] } },
  ];
  const w3 = b.rounds[3].matches.map(m => m.result.winnerId);

  // Populate and play round 4 (LB R3)
  b.rounds[4].matches = [
    { a: w3[0], b: w3[1], played: true, result: { winnerId: w3[0], loserId: w3[1] } },
    { a: w3[2], b: w3[3], played: true, result: { winnerId: w3[2], loserId: w3[3] } },
  ];
  b._lbr3Winners = [w3[0], w3[2]];

  // Populate and play round 5 (WB Semis)
  b.rounds[5].matches = [
    { a: w2[0], b: w2[1], played: true, result: { winnerId: w2[0], loserId: w2[1] } },
    { a: w2[2], b: w2[3], played: true, result: { winnerId: w2[2], loserId: w2[3] } },
  ];
  const w5 = b.rounds[5].matches.map(m => m.result.winnerId);
  const l5 = b.rounds[5].matches.map(m => m.result.loserId);

  // Populate and play round 6 (LB R4)
  b.rounds[6].matches = [
    { a: b._lbr3Winners[0], b: l5[0], played: true, result: { winnerId: b._lbr3Winners[0], loserId: l5[0] } },
    { a: b._lbr3Winners[1], b: l5[1], played: true, result: { winnerId: b._lbr3Winners[1], loserId: l5[1] } },
  ];
  const w6 = b.rounds[6].matches.map(m => m.result.winnerId);

  // Populate and play round 7 (WB Final)
  b.rounds[7].matches = [
    { a: w5[0], b: w5[1], played: true, result: { winnerId: w5[0], loserId: w5[1] } },
  ];
  b._wbChampion = w5[0];
  b._wbFLoser = w5[1];

  // Populate and play round 8 (LB R5) — but DON'T call _tryPopulateLBFinal
  b.rounds[8].matches = [
    { a: w6[0], b: w6[1], played: true, result: { winnerId: w6[0], loserId: w6[1] } },
  ];
  // Round 9 (LB Final) is still empty — this simulates a state where
  // _tryPopulateLBFinal was NOT called after round 8 (e.g., due to ordering bug)

  console.log("\n  Simulating scenario: rounds 0-8 all played but LB Final (9) empty:");
  console.log("  _wbFLoser:", b._wbFLoser, "  _wbChampion:", b._wbChampion);
  console.log("  LB R5 played?", b.rounds[8].matches[0]?.played);
  console.log("  LB Final matches:", b.rounds[9].matches.length);
  console.log("  GF matches:", b.rounds[10].matches.length);

  // Now call _tryPopulateLBFinal to see if it fixes it
  _tryPopulateLBFinal(b);
  console.log("  After _tryPopulateLBFinal: LB Final matches:", b.rounds[9].matches.length);
  if (b.rounds[9].matches.length > 0) {
    console.log("  → LB Final CAN be populated retroactively");
  } else {
    console.log("  → LB Final CANNOT be populated (bug!)");
  }

  // Now check what _simOneMajorMatchDE16 returns
  const testResult = _simOneMajorMatchDE16(fakeSchedule, { schedule: fakeSchedule });
  console.log("\n  _simOneMajorMatchDE16 with LB Final now populated:");
  console.log("  roundIdx returned:", testResult.roundIdx);
  console.log("  allComplete:", testResult.allComplete);
}
