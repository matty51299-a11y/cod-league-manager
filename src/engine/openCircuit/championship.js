// src/engine/openCircuit/championship.js
// Call of Duty Championship format — dynamic group stage + double-elimination
// playoff. The eligible field is NOT assumed to be exactly 32: the corrected DB
// ships ~28-29 teams, so the group structure adapts:
//
//   - target up to 32 eligible teams;
//   - use the largest number of 4-team groups that fits (capped so the playoff
//     does not exceed 16), the rest fall to a play-in and are cut;
//   - top two of each group qualify automatically;
//   - remaining playoff spots are filled by the best third-place records
//     (deterministic tiebreak), then fourths, until the playoff field is full;
//   - with exactly 32 → eight groups of four, top two advance (16, no thirds).
//
// It never requires exactly 32 teams and never produces broken uneven pools.

import { roundRobinStandings, sortStandings } from "./pools.js";
import { runDoubleElimination } from "./brackets.js";

function largestPow2AtMost(n) {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return Math.max(1, p);
}

// Snake-distribute seeded teams into `groupCount` groups so each group has a mix
// of seeds (group A gets seed 1, group B seed 2, … then reverse).
function snakeGroups(teams, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  let dir = 1;
  let g = 0;
  for (const t of teams) {
    groups[g].push(t);
    if (dir === 1) { if (g === groupCount - 1) dir = -1; else g++; }
    else { if (g === 0) dir = 1; else g--; }
  }
  return groups;
}

// Plan the championship structure for a seeded eligible field.
export function planChampionship(seededTeams, { groupSize = 4, maxPlayoff = 16 } = {}) {
  const n = seededTeams.length;
  const groupCount = Math.max(1, Math.min(Math.floor(n / groupSize), Math.floor(maxPlayoff / 2)));
  const fieldForGroups = groupCount * groupSize;
  const groupTeams = seededTeams.slice(0, fieldForGroups);
  const playInTeams = seededTeams.slice(fieldForGroups); // cut before groups
  const groups = snakeGroups(groupTeams, groupCount);
  const playoffSize = largestPow2AtMost(Math.min(maxPlayoff, fieldForGroups));
  return { groupCount, groupSize, groups, playInTeams, playoffSize, fieldForGroups };
}

// Run the full championship. `playSeries` is used for group round-robin and the
// playoff bracket (a series result with map differential).
export function runChampionship({ seededTeams, playSeries, groupSize = 4, maxPlayoff = 16 }) {
  const plan = planChampionship(seededTeams, { groupSize, maxPlayoff });
  const groupStandings = [];
  const groupFixtures = [];
  plan.groups.forEach((groupTeams, gi) => {
    const { standings, fixtures } = roundRobinStandings(groupTeams, playSeries, { phase: "champ-group", groupIdx: gi });
    groupStandings.push(standings);
    groupFixtures.push(...fixtures);
  });

  // Auto-qualifiers: top two per group.
  const qualifiers = [];
  const thirdCandidates = [];
  const lowerCandidates = [];
  groupStandings.forEach((standings) => {
    standings.forEach((row, place) => {
      if (place < 2) qualifiers.push({ ...row, groupPlace: place + 1 });
      else if (place === 2) thirdCandidates.push({ ...row, groupPlace: place + 1 });
      else lowerCandidates.push({ ...row, groupPlace: place + 1 });
    });
  });

  // Fill remaining playoff spots with best thirds, then lower, deterministically.
  const need = plan.playoffSize - qualifiers.length;
  const fill = [...sortStandings(thirdCandidates), ...sortStandings(lowerCandidates)].slice(0, Math.max(0, need));
  const playoffRows = [...sortStandings(qualifiers), ...fill].slice(0, plan.playoffSize);
  const playoffSeeds = playoffRows.map((r) => r.teamId);

  // Playoff: double elimination on the qualified field.
  const playoff = runDoubleElimination({
    seeds: playoffSeeds,
    playMatch: (a, b, meta) => {
      const res = playSeries(a, b, { ...meta, phase: "champ-playoff" });
      return res.winner;
    },
  });

  return {
    plan,
    groupStandings,
    groupFixtures,
    playoffSeeds,
    playoff,
    champion: playoff.champion,
    placements: playoff.placements,
  };
}
