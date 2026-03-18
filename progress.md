# CDL Manager — Project Progress (UPDATED)

> Read this file at the start of every session before making any changes.
> This document reflects the CURRENT implemented state of the game, not planned features.

---

# 🔹 1. Current Game Overview

The game simulates a full CDL-style season with:

```
Stage 1 → Major 1
Stage 2 → Major 2
Stage 3 → Major 3
Stage 4 → Major 4
→ Pre-Champs
→ Champs
→ Offseason → Contract Period → next season
```

Key principles:
- Match-driven gameplay loop
- Event-based presentation (Majors & Champs as overlays)
- Football Manager–style navigation with a clean, modern UI

---

# 🔹 2. Core Systems (Implemented)

## Season Structure

- 4 stages and 4 Majors per season
- Pre-Champs roster window
- Championship tournament
- Offseason: contract review → progression → AI roster window → new season

State fields:
- `stageIdx` → current stage
- `majorIdx` → current major
- `phase` → `"stage" | "major" | "preChamps" | "offseason" | "contracts"`

---

## Standings System

Two parallel standings models:

- `standings` — cumulative across entire season; used for Champs seeding
- `stageStandings` — resets every stage; used for Major seeding

UI behavior:
- Stage/Major → defaults to **This Stage**
- Pre-Champs/Offseason → defaults to **Season Total**

---

## Match Simulation

- BO5 CDL format: HP → S&D → CTL → HP → S&D
- Series ends at 3 map wins
- Includes map-by-map results, player stats (kills, deaths, K/D), standout detection

---

## Player Stats System

```
playerSeasonStats: {
  [playerId]: [{ season, kills, deaths, matches }]
}
```

- Current season K/D
- Career K/D (true cumulative)
- Season-by-season history via player modal

---

## Contract System

Each player has `contractYears` (integer, years remaining).

**Initial values:** 1–3 years, assigned deterministically via name hash in `players.js`.

**Offseason flow:**
1. Champs ends → `phase = "offseason"`
2. Dashboard shows **"Review Contracts →"** button
3. `ENTER_CONTRACT_PHASE` action → `phase = "contracts"` (migrates legacy saves without `contractYears`)
4. `ContractReviewPanel` in Dashboard shows:
   - **Expiring** players (`contractYears === 1`) — with +1/+2/+3 yr re-sign buttons
   - **Locked** players — shows years remaining after the upcoming decrement
5. User clicks **"Advance Offseason →"** → `ADVANCE_OFFSEASON` action
6. `advanceOffseason()` processes contracts:
   - AI teams: any player on 1-yr contract auto-renews to 2 yrs (prevents star exodus)
   - All signed players: `contractYears -= 1`
   - Players hitting 0: `teamId = null` → become free agents
7. Then: age, retire, progress, **prospect pool refresh**, AI offseason roster window, new season built

**Prospect Pool Refresh** (runs after progression each offseason):
- Removes unsigned challengers: age 26+ & OVR < 70 (hard), age 25+ & OVR < 67 (70% chance), age 24+ & OVR < 62 (80% chance)
- Generates ~20 new prospects per year: 2–4 elite (OVR 75–83, POT 87–95), 4–6 mid-tier, rest lower
- New prospects are mostly age 18–20 (occasional 21)
- Pool hard-capped at 60 unsigned challengers total

**Signing:** `SIGN_PLAYER` gives all newly signed players `contractYears: 2`.

**Re-sign action:** `RESIGN_PLAYER` sets `contractYears` to the chosen value (before decrement).

**Roster display:** Roster table shows a "Yrs" column (red if expiring). Player modal bio shows contract remaining with ⚠ warning when 1 yr left.

---

## Progression System

- Age-based growth / plateau / decline
- Breakout and collapse events
- Development curves (early / standard / late)
- Headroom-based growth (potential − overall)

---

## Retirement System

Age-curve based retirement probabilities:
- < 27: 0% | 27: 3% | 28: 8% | 29: 20% | 30: 35% | 31: 50% | 32: 65% | 33+: 80%

Modifiers: elite players (90+ OVR) retire much later; players far below potential retire sooner.
Retirees are removed from rosters; AI fills gaps in the offseason window.

---

## Budget / Economy System

- Each franchise has a `budgetTier` (2–6) defined in `teams.js`
- `BUDGET_CAPS` maps tier → max combined signing cost for 4 starters
- `getSigningCost()` uses a power curve (OVR-based): $25k (70 OVR) → $600k (99 OVR)
- Prospects cheaper: $15k–$65k
- Hard cap enforced on SIGN_PLAYER; AI respects budget in all windows

---

## Roster / AI System

- CPU teams use philosophy-based decision making (`win_now`, `youth_upside`, `chemistry_stability`, `balanced_value`, `high_risk_gamble`)
- Windows: after each Major, after Champs (offseason)
- AI decisions influenced by: standings, chemistry, age, upside, budget, K/D performance
- Drop protection: elite (87+ OVR) and top-2 starters rarely cut
- Champion teams protected by strong stability bias
- Minimum roster guarantee: AI teams always filled to 4 starters

---

## Free Agency / Challengers

- Pro FAs: players with `teamId === null` in `players` array
- Challengers: unsigned prospects in `prospects` array
- User signs from both via Free Agency and Prospects screens
- Budget shown on both screens

---

# 🔹 3. UI Architecture (CURRENT)

## Event Overlay System

### Major Entry
- `MajorEntryOverlay` — full-screen takeover, animated sequence, non-dismissable

### Major Tournament Mode
- `MajorTournamentOverlay` — full-screen event mode (no tab navigation)
- Bracket, seedings, sim controls, champion screen

### Next Match Overlay
- `NextMatchOverlay` — triggered from top-right control
- Shows opponent, match context, play/sim options

### Team Hub Overlay
- `TeamHubOverlay` — team info, recent form, roster overview

---

## Navigation

- Left sidebar (FM-style) with screen routing
- Top bar: season badge, team badge, Next Match control
- Screens: Dashboard, Standings, Schedule, K/D Leaders, Roster, Free Agency, Challengers, Dev Report, Match Log

---

## Dashboard

Phase-aware hub. Shows:
- Phase card (stage/major/preChamps/offseason/contracts)
- Contract review panel during `"contracts"` phase
- Standing snapshot, recent results, team stats
- Phase-specific CTAs (next match, enter major, review contracts, advance offseason)

---

## Player UI

- Clicking player opens modal overlay
- Shows: attributes grid, K/D stats, season history table, hidden traits (user team only), bio (age, salary, contract, dev curve)

---

# 🔹 4. Design Direction

- Fast, addictive match-driven loop
- Strong event moments (Majors & Champs)
- Football Manager–inspired structure
- Clarity, speed, and visual hierarchy over dense information

Core philosophy: **focus → action → result → world update**

---

# 🔹 5. Known Limitations

- Match loop not fully implemented yet (NextMatchOverlay exists but flow not complete)
- Navigation system mid-transition (some legacy top-tab remnants)
- No league narrative (news, storylines)
- No opponent roster viewer
- No contract salary negotiation (re-signing is free / year-only decision)

---

# 🔹 6. Next Priorities

## HIGH PRIORITY

1. Core match loop
   - result reveal flow after user match
   - other results shown after user match resolves

2. UI polish
   - finalize sidebar navigation
   - remove any remaining legacy top-tab usage

---

## MID PRIORITY

3. ~~Prospect pool regeneration (yearly fresh wave)~~ ✅ Done
4. History / records screen
5. Contract salary cost on re-signing

---

## LOW PRIORITY

6. Narrative system (news, storylines)
7. Opponent roster viewer
8. Contract salary negotiation

---

# 🔹 7. Key Principles (DO NOT BREAK)

- Major and Champs must remain **event overlays**, not pages
- Match simulation must remain **target-K/D based**
- `stageStandings` must reset every stage
- `standings` must remain cumulative
- Player history must persist across seasons
- Contract years must decrement **once per offseason** in `advanceOffseason()`
- AI teams auto-renew 1-yr contracts before decrement (do not change this — prevents star churn)
- `phase = "contracts"` must come **between** `"offseason"` and `ADVANCE_OFFSEASON` dispatch
- Budget caps are hard limits — never sign over cap in AI or user flows
- Roster minimum is 4 starters — AI fill runs after every window

---

# 🔹 8. State Shape Reference

```js
{
  userTeamId,
  season,           // current season number
  players,          // all pros + signed prospects; teamId null = free agent
  prospects,        // unsigned challengers only
  schedule: {
    season, phase, stageIdx, majorIdx,
    stages[], majors[], standings, stageStandings,
    matchLog[], currentMatchday
  },
  notifications[],
  enteredMajorIdx,
  playerSeasonStats: { [playerId]: [{ season, kills, deaths, matches }] },
  progressionLog[],
  retiredPlayers[],
  rosterMovesLog[],
  teamContexts: { [teamId]: { philosophy, loyalty, volatility, challengerTrust, pressure } },
}
```

Player shape (key fields):
```js
{
  id, name, teamId, age, primary, secondary,
  overall, potential, salary,
  contractYears,   // years remaining; 0 = expired → FA
  form, experience, isProspect,
  gunny, awareness, objective, searchIQ, clutch, teamwork, composure, adaptability,
  ego, workEthic, tiltResistance, leadership, metaDependence,
}
```
