# CDL Manager — Project Progress

> Read this file at the start of every session before making any changes.
> Branch: `claude/cod-esports-sim-Pe1Uj`
> Stack: React 19 + Vite 8, no external libraries, localStorage persistence.
> Deploy targets: Vercel (`vercel.json`) and Netlify (`netlify.toml`) — both configured for SPA routing.

---

## 1. Implemented Features

### League Structure
- 12 CDL franchises, March 2026 rosters (48 pro players, 4 per team)
- Season format: Stage 1 → Major 1 → Stage 2 → Major 2 → Championship → Offseason
- Stages use full round-robin (66 matches per stage, 12 teams)
- Points system: 3 pts for win, 1 pt for loss
- Three Majors (Major 1, Major 2, Championship) using single-elimination, top-8 seeded by standings points
- Major seeding: 1v8, 2v7, 3v6, 4v5 in Quarterfinals

### Teams & Rosters (`src/data/teams.js`, `src/data/players.js`)
- 12 teams with id, name, tag, hex color
- Each player has: overall, potential, 8 individual ratings (gunny, awareness, objective, searchIQ, clutch, teamwork, composure, adaptability), 5 hidden traits (ego, workEthic, tiltResistance, leadership, metaDependence on 1–5 scale), age, role (primary + secondary), form (default 70), experience, salary
- Roles: Entry SMG, Slayer SMG, Flex, Main AR, Objective, Search Specialist
- `mkPlayer()` computes salary from overall

### Prospect / Challengers Pool (`src/data/prospects.js`)
- 150 generated prospects using seeded PRNG (seed = `Date.now() % 999983` at new game)
- 8 archetypes with weighted selection: raw_upside, polished, smg_heavy, ar_flex, search_spec, risky_ego, glue, obj_spec
- Age range: 18–23 (minimum 18, no underage)
- Age-based overall penalty: 18yo gets −10 to −18, 19yo −5 to −12, 20yo −1 to −6
- Young players get wider potential gap (+2 to +10 above archetype base for ≤19yo)
- Scouting noise: `scoutedOverall` and `scoutedPotential` shown until player is signed
- `developmentCurve`: "early" (25% chance), "standard" (50%), "late" (25%)

### Match Simulation (`src/engine/matchSim.js`)
- Best-of-5 in standard CDL rotation: HP → S&D → CTL → HP → S&D
- Team strength via mode-weighted stat average + form modifier + chemistry bonus + meta risk
- Map win probability: logistic curve `1 / (1 + exp(−diff/8))`
- Series stops at 3 map wins; result includes `winsA`, `winsB`, `mapResults[]`
- **K/D model** (target-first, not emergent):
  - `targetKD` generated first: quality mod `(overall−82)/90` + win/loss ±0.06 + role mod + form + triangle noise
  - Kills generated from activity (mode base: HP=20, S&D=5, CTL=14; role + quality mods; ±3.5 noise)
  - Deaths = `round(kills / targetKD)`, min 1
  - ROLE_KD_MOD: Slayer +0.07, Entry +0.02, Flex 0, AR −0.01, Obj −0.06, Search −0.03
  - Expected K/D: typical 0.90–1.10, good winner 1.10–1.30, elite up to ~1.45
- Standout player: highest K/D with ≥3 kills across the series
- Result object includes: `winnerId`, `loserId`, `winnerName`, `loserName`, `teamAId`, `winsA`, `winsB`, `score`, `mapResults[]`, `standoutName`, `standoutKD`

### Chemistry Engine (`src/engine/chemistry.js`)
- `calcChemistry(players)` → 0–100 score
- Components: role balance (0–25), teamwork average (0–25), ego clash penalty (0 to −20), experience bonus (0–20), leadership bonus (0–10)
- `chemLabel()` returns text ("Toxic", "Low", "OK", "Good", "Great", "Elite")

### AI Roster Engine (`src/engine/rosterAI.js`)
- Team contexts are persisted in save state (`teamContexts`) with philosophy + behavior traits: `win_now`, `youth_upside`, `chemistry_stability`, `balanced_value`, `high_risk_gamble`
- Team evaluation computes pressure from standings rank, major placement, roster chemistry, average age, average overall, and upside (`potential - overall`)
- Decision model chooses no move / 1 / 2 / rare 3-player reset with philosophy and loyalty/volatility variance so bad teams do not react identically
- Candidate selection weights role fit, chemistry delta, age, upside, and philosophy boosts; under-pressure/aging/low-upside teams get stronger Challengers call-up bias
- Logs window activity to `rosterMovesLog` for debugging and multi-season verification

### Season Engine (`src/engine/seasonEngine.js`)
- `buildSeason(n)` — creates stage + major schedule for season n
- `simNextMatch`, `simMatchday` (up to 6 matches, no team plays twice per matchday), `simStage`
- `simNextMajorMatch`, `simMajorRound`, `simMajor` — three granularity levels
- `_simOneMajorMatch()` internal helper handles single match + wires next round when round completes
- `_advanceMajorPhase()` transitions: Major1→Stage2, Major2→Championship, Championship→Offseason
- Major bracket seed formula: `season×1M + majorIdx×100K + (roundIdx+1)×10K + (matchIdx+1)×100 + 7`
- `advanceOffseason()` — ages all players+prospects (+1), runs progression engine, stores `progressionLog`, builds new season

### Progression / Regression Engine (`src/engine/progression.js`)
- **Two-tier model** per player per offseason:
  - **Tier 1 (base)**: age curve rolls GROWTH / PLATEAU / DECLINE; magnitude weighted by workEthic, adaptability, headroom (potential − overall), team season performance
  - **Tier 2 (special events)**: independent breakout/collapse rolls on top of base
- Age curve (effective age = actual age adjusted by developmentCurve ±2):
  - Peak development eff age 19–22: up to 4.0 max grow
  - Plateau eff age 23–26: 1.3–2.2 max grow, 1.5–2.5 max decline
  - Decline eff age 27+: up to 6.0 max decline
- **Breakout events**: young players (eff ≤26) with headroom; up to 14% base chance for 18–20yo with high potential + workEthic 5; bonus +3 to +9 OVR (biased toward +3–+5)
- **Collapse events**: eff age 25+ players; base 2–18% scaling with age; +9% for workEthic 1; +10% for bad season; drop −3 to −8 OVR
- `calcOverall(p)` — simple average of all 8 stats
- `runProgression(players, prospects, standings, season)` — processes all players; returns `{ updatedPlayers, updatedProspects, progressionLog }`
- `progressionLog` entries: `{ id, name, teamId, age, oldOverall, newOverall, delta, isProspect, eventType: "breakout"|"collapse"|null }`

### State Management (`src/store/gameStore.jsx`)
- React Context + `useReducer`
- `state.players[]` — all signed pros + moved prospects (Roster reads only from here)
- `state.prospects[]` — unsigned challengers pool
- `state.playerSeasonStats` — `{ [playerId]: { kills, deaths, matches } }` — cumulative totals for current season; reset to `{}` at offseason
- `state.playerStatsHistory` — `{ [playerId]: [{ season, kills, deaths, matches, kd }] }` — archived per-season records; appended at each offseason
- `SIGN_PLAYER`: moves prospect from `prospects[]` into `players[]`; updates teamId for pro free agents
- `RELEASE_PLAYER`: returns prospect to `prospects[]`; nulls teamId for pros
- Actions: NEW_GAME, LOAD_GAME, SIM_NEXT_MATCH, SIM_MATCHDAY, SIM_STAGE, SIM_MAJOR, SIM_NEXT_MAJOR_MATCH, SIM_MAJOR_ROUND, ADVANCE_OFFSEASON, SIGN_PLAYER, RELEASE_PLAYER, CLEAR_NOTIF
- Auto-save to localStorage on every state change; auto-load on mount
- 3.5s notification auto-dismiss

### UI Screens (8 tabs)

**Dashboard** (`src/components/Dashboard.jsx`)
- Team header: name (team color), record, points, chemistry, roster count
- Sim controls: Simulate Matchday / Sim Rest of Stage (stage phase); major-mode live callout banner (major phase); Start Season N+1 (offseason)
- Recent Results: last 5 user team matches as clickable cards; click expands full series breakdown inline
- Champion banners for completed majors

**Standings** (`src/components/Standings.jsx`)
- Full league table sorted by points; W/L/pts columns; user team highlighted

**Major** (`src/components/MajorBracket.jsx`) — **tournament event mode**
- Three states:
  1. **Intro screen** — shown when major just seeded, no matches played. Large tournament name, 8-team seedings, QF matchup cards, "Enter Tournament →" button
  2. **Live view** — after entering. Accent event banner (`▶ LIVE · CDL MAJOR 1 · QUARTERFINALS`), 3 sim controls, Next Match spotlight card, bracket with round sections
  3. **Archive view** — completed/not-started majors
- MatchCard: shows seed numbers, team tags (colored), BO5 score, "Details ▼" expandable series breakdown
- Tab strip for Major 1 / Major 2 / Championship (live dot on active)

**Roster** (`src/components/Roster.jsx`)
- Shows user's 4 starters + 1 sub slot
- Release buttons per player

**Free Agency** (`src/components/FreeAgency.jsx`)
- Lists all players with `teamId === null`; sign to starter or sub slot

**Challengers** (`src/components/Prospects.jsx`)
- Lists 150 unsigned prospects with scouted ratings; sign to starter or sub slot

**Dev Report** (`src/components/OffseasonReport.jsx`)
- Available after advancing offseason
- Summary bar: improved / plateau / declined / breakouts ⚡ / fall-offs ↘ / pros tracked
- Biggest Leap / Sharp Decline standout cards (relabeled "Breakout Season" / "Sharp Decline" when event-driven)
- Filterable: All / My Team / Pros Only / Challengers / Improved / Declined / Breakouts / Fall-offs
- Sortable: Δ OVR / Rating / Age / Name
- Breakout rows have yellow tint + ⚡; collapse rows have red tint + ↘

**Match Log** (`src/components/MatchLog.jsx`)
- All played matches; clickable rows expand full series breakdown

**Player Profile** (`src/components/PlayerProfile.jsx`) — modal overlay, opened by clicking any player row on the Roster screen
- Shows name, age, team, role, secondary role, OVR (color-coded), POT, dev curve, experience
- Current season stats panel: matches played, kills, deaths, K/D (color-coded)
- Season history table (most-recent-first): one row per completed season with kills/deaths/matches/K/D
- Hidden traits panel shown only for the user's own players
- Closes on overlay click or Escape key

### Shared Components
- `SeriesDetail` (`src/components/SeriesDetail.jsx`) — reusable BO5 breakdown: map-by-map scores, winner labels, two-column player K/D stat tables (color-coded)

---

## 2. Design Rules to Preserve

### Match Format
- Always BO5; always HP → S&D → CTL → HP → S&D
- Series ends at 3 wins; never play all 5 if one team reaches 3 first
- Map results must carry: mode, short label, teamA score, teamB score, winner
- Per-player stats per map: kills, deaths, kd — stored in `mapResults[].playerStats[]`

### K/D Realism (do not revert)
- K/D is generated TARGET-FIRST, not emergent from independent kills/deaths
- `deaths = round(kills / targetKD)` — this is intentional and must stay
- Typical K/D 0.90–1.10; elite winners rarely above 1.45; bad losers rarely below 0.70
- Entry SMG gets wider noise (±0.13 vs ±0.10) for volatility
- Mode kill bases: HP=20, S&D=5, CTL=14 — do not change without testing

### Major Tournament Rules
- Top 8 by points, seeded 1–8
- Single-elimination: QF (1v8, 2v7, 3v6, 4v5) → SF → GF
- Intro screen must show before any matches are simulated (intro hides once `enteredMajor = true`)
- Champion stored in `bracket.champion`; shown in Dashboard + bracket screen
- Never show intro for archived/completed majors

### Player Development Rules
- `overall` is a standalone field (NOT auto-computed from stats on load — only updated during offseason)
- Individual stats are nudged proportionally with overall changes (2 stats per overall point)
- Growth is capped by `potential - overall` (headroom)
- `developmentCurve` must shift effective age ±2 for early/late bloomers
- `eventType` must NOT be stored permanently on the player object — only in `progressionLog`
- Prospects remain in `prospects[]` until signed; signed prospects move to `players[]`

### Prospect Generation Rules
- Minimum age 18 — no 17-year-olds
- Age penalty is mandatory for 18–20yo to prevent elite teenagers
- Scouted ratings (`scoutedOverall`, `scoutedPotential`) are noisy approximations shown pre-sign
- `isProspect: true` flag differentiates them from pros in the roster/release logic

### UI/UX Principles
- Dark theme only; CSS variables for all colors (`--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--accent`, `--green`, `--red`, `--yellow`)
- No animations beyond the pulsing live dot (`.tab-live-dot`, `.mt-live-dot`, `.mmc-live-badge`)
- Notifications auto-dismiss at 3.5s; only one shown at a time
- User team always highlighted in relevant tables/cards (border or background tint)
- All pages use `page-shell` or named page class for max-width containment

---

## 3. Known Issues / Rough Edges

### Simulation
- **Form stat does nothing during seasons**: `form` is read by `teamStrength()` but never updated during stage play. It resets to 70 at every offseason. Hot/cold streaks don't exist.
- **No CPU/AI major bracket representation**: All 12 teams' players age and develop, but only the user manages their roster. No concept of CPU team building or budget.
- **AI roster movement now exists**: CPU teams evaluate results after Major 1, Major 2, and in the offseason, then decide no move / 1 move / 2 moves / rare reset based on pressure + team philosophy + volatility.
- **Challengers call-ups are now integrated**: AI teams can sign real Challengers prospects directly, with scoring based on role fit, age, potential/upside, chemistry impact, and philosophy fit (not just overall).

### League / Season Structure
- **No relegation or promotion system**: The same 12 teams compete every season forever.
- **No player contracts or salary cap**: Salary field exists but is never enforced. You can sign infinite players.
- **No trade system**: Players can only move via release → free agency → sign.
- **Schedule imbalance**: Round-robin produces 66 matches per stage, but no concept of home/away or travel.
- **Championship always seeds the same way**: No playoff format variation — it's always top 8 of cumulative points.

### Progression
- **Prospects don't get regenerated**: The same 150 prospects exist forever. Over many seasons, they all age out or get signed, and the pool empties. No new prospect class enters each year.
- **No retirement mechanic**: 35+ year old players never retire. They just keep declining indefinitely.
- **Potential never changes**: Once set at player creation, potential is fixed. No breakout revision upward or ceiling revision downward.

### UI
- **No way to view opponent rosters**: You can see standings and match results, but cannot inspect CPU team rosters.
- **Offseason report resets on new save**: `progressionLog` is per-session; starting a new game clears it.
- **Dev Report tab always shows yellow dot** once any progression has run — there's no way to "clear" it after reviewing.
- **No pagination on Challengers screen**: All 150 prospects listed at once; becomes unwieldy with filters.
- **Dashboard "Advance Offseason" button** is labeled "Start Season N+1" which is slightly misleading (it runs progression first, then starts the season).

### Bugs / Edge Cases
- If a user releases a signed prospect and that prospect ID already exists in `prospects[]` (e.g., from a page reload edge case), there could be a duplicate. Low risk but worth noting.
- `viewIdx` in `MajorBracket` is local state seeded from `activeMajorIdx` at mount; if the user navigates away and back, it resets to the active major rather than keeping their last-viewed tab.

---

## 4. Next Priorities (Suggested Order)

1. **New prospect class each offseason** — generate a fresh batch of 18–19yo prospects each year (separate from or replacing the oldest existing ones) so the challenger pool stays populated
2. **Player retirement** — players aged 33+ (or heavily declined) should retire at offseason, freeing their roster slot
3. **CPU roster management** — basic AI: release declined/aging players, sign free agents to fill gaps
4. **Form system during seasons** — update `form` based on recent match results so hot/cold streaks affect simulation
5. **Opponent roster viewer** — a screen or popup to inspect any team's players, stats, chemistry
6. **Salary cap / contract system** — enforce a budget per team; players demand raises each season; over-budget teams can't sign
7. **View season history** — a record of past season standings, major champions, and award leaders per season
8. **Player awards/stats** — track cumulative stats (K/D average, matches played) across seasons; show a leaderboard
9. **Trade system** — basic bilateral trade between user and CPU team
10. **Potential revision** — breakout seasons slightly raise potential ceiling; consecutive bad seasons slightly lower it

---

## 5. Important Implementation Notes

### Branch & Repo
- All work is on `claude/cod-esports-sim-Pe1Uj`
- Always `git push -u origin claude/cod-esports-sim-Pe1Uj`
- Do NOT push to main/master without explicit permission

### Critical Files — Read Before Modifying
- `src/store/gameStore.jsx` — central state; any new action needs a reducer case here
- `src/engine/progression.js` — `developPlayer()` returns `{ player, eventType }` tuple, NOT a plain player object. `runProgression()` destructures this. Do not change the return shape without updating `runProgression`.
- `src/engine/matchSim.js` — K/D target-first model must not be reverted to independent kills/deaths generation
- `src/engine/seasonEngine.js` — `advanceOffseason()` must age players BEFORE calling `runProgression()`, not after

### State Shape (key fields)
