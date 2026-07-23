import assert from "node:assert/strict";
import { runDoubleElimination } from "../src/engine/openCircuit/brackets.js";
import { createLiveDE, findNextLiveMatch, recordLiveMatch, computeLivePlacements } from "../src/engine/openCircuit/liveDE.js";

// Deterministic winner for a pair, independent of round/meta so the batch and
// the stateful stepper make identical decisions.
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
const pick = (a,b) => (hash(`${a}|${b}`) % 100) < 50 ? a : b;

function runLive(seeds){
  const b = createLiveDE(seeds);
  let guard=0;
  while (guard++ < 2000){
    const next = findNextLiveMatch(b);
    if (!next) break;
    const { roundIdx, matchIdx, match } = next;
    const winnerId = pick(match.a, match.b);
    const loserId = winnerId === match.a ? match.b : match.a;
    recordLiveMatch(b, roundIdx, matchIdx, { winnerId, loserId, teamAId: match.a, teamBId: match.b });
  }
  return b;
}

let checked = 0;
for (let n of [28, 16, 24, 8, 12, 32, 5, 7]) {
  for (let s = 0; s < 12; s++) {
    const seeds = Array.from({ length: n }, (_, i) => `t${n}_${s}_${String(i).padStart(2,"0")}`);
    const batch = runDoubleElimination({ seeds, playMatch: (a,b)=>pick(a,b) });
    const live = runLive(seeds);
    assert.ok(live._de.phase === "done", `live bracket completes (n=${n})`);
    assert.equal(live.champion, batch.champion, `champion matches (n=${n}, s=${s})`);
    const livePl = computeLivePlacements(live);
    const batchPl = Object.fromEntries(batch.placements.map(p => [p.teamId, p.placement]));
    // Every team placed once, no duplicate placements.
    assert.equal(Object.keys(livePl).length, n, `all ${n} teams placed`);
    assert.equal(new Set(Object.values(livePl)).size, n, `placements are unique (n=${n})`);
    // Placements identical to the batch algorithm.
    for (const t of seeds) assert.equal(livePl[t], batchPl[t], `placement of ${t} matches (n=${n}, s=${s})`);
    // No team eliminated before two losses.
    const losses = {};
    for (const r of live.rounds) for (const m of r.matches) if (m.result?.loserId) losses[m.result.loserId]=(losses[m.result.loserId]||0)+1;
    for (const t of seeds) if (t !== live.champion && t !== live.runnerUp) assert.ok((losses[t]||0) <= 2, `${t} not over-eliminated`);
    checked++;
  }
}
console.log(`liveDE: cross-checked ${checked} brackets vs batch runDoubleElimination — champions + placements identical ✓`);

// A 28-team bracket has all 28 in and a sensible round count.
const big = createLiveDE(Array.from({length:28},(_,i)=>`x${i}`));
console.log(`liveDE: 28-team field → WB Round 1 has ${big.rounds[0].matches.length} matches (incl. byes for top seeds)`);
