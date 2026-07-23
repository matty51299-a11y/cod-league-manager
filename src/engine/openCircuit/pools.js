// src/engine/openCircuit/pools.js
// Round-robin pool play for the open circuit.
//
// Each pool plays a full round robin. Standings use, in order:
//   1. match wins
//   2. head-to-head (between exactly-tied teams)
//   3. map/series differential
//   4. deterministic fallback (seed order / teamId)
// Pool results feed the playoff seed. `playSeries(a,b,meta) => { winner, aMaps,
// bMaps }` is injected and called once per fixture (no fixture is simulated
// twice: the round-robin schedule contains each unordered pair exactly once).

function emptyRow(teamId, seedIndex) {
  return { teamId, seedIndex, w: 0, l: 0, mapWins: 0, mapLosses: 0, mapDiff: 0, h2h: {} };
}

// Full round robin over a list of teamIds. Returns sorted standings + fixtures.
export function roundRobinStandings(teams, playSeries, meta = {}) {
  const rows = new Map();
  teams.forEach((t, i) => rows.set(t, emptyRow(t, i)));
  const fixtures = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i];
      const b = teams[j];
      const res = playSeries(a, b, { ...meta, a, b });
      const aMaps = res.aMaps ?? (res.winner === a ? 1 : 0);
      const bMaps = res.bMaps ?? (res.winner === b ? 1 : 0);
      const ra = rows.get(a);
      const rb = rows.get(b);
      ra.mapWins += aMaps; ra.mapLosses += bMaps;
      rb.mapWins += bMaps; rb.mapLosses += aMaps;
      if (res.winner === a) { ra.w++; rb.l++; ra.h2h[b] = 1; rb.h2h[a] = -1; }
      else { rb.w++; ra.l++; rb.h2h[a] = 1; ra.h2h[b] = -1; }
      fixtures.push({ ...meta, a, b, winner: res.winner, aMaps, bMaps });
    }
  }
  for (const r of rows.values()) r.mapDiff = r.mapWins - r.mapLosses;
  const standings = sortStandings([...rows.values()]);
  return { standings, fixtures };
}

// Sort with wins → head-to-head → map differential → seed order.
export function sortStandings(rows) {
  return [...rows].sort((a, b) => {
    if (b.w !== a.w) return b.w - a.w;
    // Head-to-head only meaningful between two teams tied on wins.
    const h = a.h2h?.[b.teamId];
    if (h != null && b.h2h?.[a.teamId] != null) {
      // If a beat b, a ranks higher.
      if (h !== 0) return -h;
    }
    if (b.mapDiff !== a.mapDiff) return b.mapDiff - a.mapDiff;
    return (a.seedIndex ?? 0) - (b.seedIndex ?? 0);
  });
}

// Run several pools and produce a combined playoff seeding.
//   pools: [[teamId,...], ...]
// Combined seeding takes all pool winners first (ordered by record), then all
// runners-up, etc., so pool results genuinely drive the bracket seed.
export function runPools({ pools, playSeries, advancePerPool = null }) {
  const poolStandings = [];
  const allFixtures = [];
  pools.forEach((poolTeams, poolIdx) => {
    const { standings, fixtures } = roundRobinStandings(poolTeams, playSeries, { phase: "pool", poolIdx });
    poolStandings.push(standings);
    allFixtures.push(...fixtures);
  });
  const maxDepth = Math.max(0, ...poolStandings.map((s) => s.length));
  const advance = advancePerPool ?? maxDepth;
  const combined = [];
  for (let place = 0; place < maxDepth; place++) {
    const atPlace = poolStandings
      .map((s) => s[place])
      .filter(Boolean)
      .map((row) => ({ ...row, poolPlace: place + 1 }));
    // Order same-place teams across pools by their own record.
    sortStandings(atPlace).forEach((row) => {
      if (row.poolPlace <= advance) combined.push(row);
    });
  }
  return {
    poolStandings,
    fixtures: allFixtures,
    seeds: combined.map((r) => r.teamId),
    seedRows: combined,
  };
}
