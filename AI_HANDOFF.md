# CDL MANAGER — AI HANDOFF

This file provides the current state of the project, core systems, constraints, and active development direction.

Any AI working on this repo MUST read this before making changes.

---

# 🧠 PROJECT OVERVIEW

CDL Manager is a Call of Duty League simulation/management game inspired by Basketball GM and Football Manager.

Core pillars:
- Long-term career simulation
- Player development and progression
- Roster building and contracts
- Challengers → CDL pipeline
- Clean, modern, FM-style UI

---

# ⚙️ CURRENT IMPLEMENTED SYSTEMS

## Season Structure
- 4 stages → 4 majors → Champs
- Pre-Champs phase
- Offseason phase
- Contracts phase after offseason

## Historical Dynasty Mode
Selectable at team-select (`careerMode: "modern" | "historical"`). A historical
dynasty starts in the **Call of Duty: Ghosts** (2013/14) season and advances one
Call of Duty title per season.

Key modules:
- `src/data/codEras.js` — data-driven season definitions (Ghosts → Black Ops 6),
  ecosystem tags (MLG / CWL / CDL), roster sizes, modes, map pools, role weights,
  championships, `dataStatus` (`historical` vs `fictional`). Also
  `generateFutureEra()` — deterministic procedural future seasons after BO6, and a
  runtime registry so `getEra(id)` resolves generated eras after reload.
- `src/engine/historicalDynasty.js` — era advancement (`advanceHistoricalEraIfNeeded`,
  idempotent via a season-indexed guard so a transition never runs twice),
  rookie-class introduction (historical + procedural), dynasty config
  (`historicalStrictness`, `dynastySeed`), save migration.
- Roster-size transitions (4 ↔ 5) are era-aware everywhere required starters are
  computed: `getRequiredStarters(state)` in `rosterValidation.js`, the promote /
  auto-pick / signing-slot guards in the store, and `rosterAI.ensureCdlRosterIntegrity`
  (fills up to the era size; releases excess starters to free agency on reduction).
- Era-transition news is emitted via `makeEraTransitionEvents` (eventCentre) and a
  season-transition modal + dashboard `EraInfoCard` (Dashboard.jsx).
- Match sim reads the era's `roleWeights` (opt-in, via `buildTeamObj`) so different
  titles value different roster roles.

Tests: `npm run test:dynasty` (unit), `npm run test:dynasty-sim` (13-season
long-run), `npm run test:full-season` (modern regression). All run through
`scripts/register-assets.mjs` (node asset loader for image imports).

## Historical Open-Circuit Ecosystem (Ghosts-era)

Ghosts-era historical seasons use a data-driven OPEN CIRCUIT instead of the
modern four-Major + Challengers structure. The ecosystem is chosen per COD title
by a competition profile, so modern Major/CDL logic stays available for genuinely
modern seasons but is disabled for the open era.

Key modules:
- `src/data/cod_dynasty_rosters.corrected.json` — corrected historical roster DB
  (stable `playerId` identity; two distinct "Vortex" and two "MethodZ" players;
  preserved Blackk duplicate warning). Accessed via `src/data/historicalRosterDb.js`.
- `src/utils/stableIdentity.js` — identity is the permanent playerId, never the
  gamertag; lets same-name players coexist.
- `src/engine/seasonRosterEngine.js` — historical roster reconciliation. Protects
  the user's roster (never reset/released); full user roster → historical signing
  goes to free agency; AI teams blocked by user-owned players sign replacements;
  5v5→4v4 flags non-compliance instead of auto-cutting. Idempotent
  (`processedSeasonIds`). Adapted from the supplied `.ts` reference (kept in
  `src/engine/reference/`).
- `src/data/competitionProfiles.js` — `SeasonCompetitionProfile` per era, Pro
  Point tables, the full Ghosts event catalogue (28 events) and 2K/5K cup config.
- `src/engine/proPoints.js` — player-level seasonal Pro Points
  (`playerSeasonProPoints[seasonId][playerId]`); points move with transfers;
  awarded once per tournament; team rank = sum of the locked eligible roster.
- `src/engine/openCircuit/{brackets,pools,championship,calendar}.js` — double/
  single elimination with byes, round-robin pools with tiebreakers, dynamic
  championship groups (28→7 groups→16-team DE), deterministic calendar + cups.
- `src/engine/openCircuitEngine.js` — builds the circuit world from the DB + the
  user's protected roster, runs the whole season (open bracket → pools → DE
  playoffs, championship groups, leagues, cups), awarding points/prize once.
- `src/engine/openCircuitCareer.js` — wires it into the career flow (new game,
  load, season transition); idempotent via an era+season build key; gates
  Challengers off; emits roster-change inbox stories.
- UI: `src/components/Circuit.jsx` (Pro Points table + tournament hub). The
  Sidebar hides Challengers and shows a Circuit tab for open-circuit seasons.

Tests: `npm run test:open-circuit` (22 checks covering all 20 required
validations + identity cases).

## Contracts System
- Players have `contractYears`
- Decrements once per offseason
- Expired players → free agents
- AI auto-renews 1-year deals before expiry
- User:
  - SIGN_PLAYER → 2-year deal
  - RESIGN_PLAYER → selectable years

## Player Progression (IMPORTANT)
- Fully reworked system
- Young high-potential players now develop properly
- Added:
  - `potentialMult` scaling with headroom
  - improved growth curves by age
  - stronger breakout system
- Veterans decline naturally

Design intent:
- 18–22 = growth window
- 23–26 = peak
- 27+ = decline
- High POT must actually matter

## Challengers / Prospect Pool
- Maintained between **150–200 players**
- ~20 new prospects added per offseason
- Top-up system ensures minimum size
- Hard cap at 200

Removal rules:
- Weak older players removed gradually
- Strong players (75+ OVR) protected until ~age 32
- No deleting good players purely due to age

IMPORTANT:
- Challengers pool must NEVER collapse below 150
- Must NOT skew too young (balance required)

## Player Profiles
Each player includes:
- region (NA / EU / MENA etc)
- developmentCurve (early / standard / late)
- teamHistory (season-level)
- playerOvrHistory (season-level)

UI shows:
- OVR history
- career teams
- stats + attributes
- hidden traits

---

# 🎨 UI / UX DIRECTION (VERY IMPORTANT)

Current direction:
- FM24-style interface
- Brighter navy/slate palette
- Gradients used across UI
- Card-based layout system
- Full-width responsive layout

Goals:
- Reduce empty space
- Increase information density
- Improve visual hierarchy
- Make it feel like a real management game

---

# 🚨 CURRENT UI PROBLEMS TO FIX

## 1. Readability Issues
- Dark text on dark gradients (unreadable)
- Yellow/light text on light backgrounds (washed out)
- Inconsistent contrast across components

## 2. Flat Visual Hierarchy
- Cards have similar weight
- No strong focal point
- UI lacks depth and priority

## 3. Colour Usage
- Colours exist but are not used meaningfully
- Gradients look good but hurt readability
- Need controlled colour system

---

# 🎯 REQUIRED UI RULES

## Text Contrast System
Define and enforce:

- Primary text:
  - Always high contrast
  - White on dark/gradient
  - Dark on light

- Secondary text:
  - Slightly muted but readable

- NEVER:
  - low contrast text on gradients
  - yellow text on light surfaces

---

## Surface Rules

### Dark surfaces
- Light text only

### Gradient surfaces
- Always white text
- Optional subtle overlay for readability

### Light surfaces
- Dark text only
- No bright/yellow text

---

## Layout Rules
- Must be full-width (no unused right-side space)
- Use responsive grid
- Prefer vertical density over stretched horizontal cards
- Use right-side panels where appropriate

---

## Visual Hierarchy
Three levels:
1. Hero (club banner / major events)
2. Primary cards (main info)
3. Secondary panels (support info)

---

# ❗ HARD CONSTRAINTS (DO NOT BREAK)

- Do NOT break season flow
- Do NOT break contract system
- Do NOT remove progression logic
- Do NOT delete challengers pool rules
- Do NOT infer player region from team automatically
- Do NOT remove existing working features

---

# 🧪 DEVELOPMENT APPROACH

When implementing changes:

1. Read this file + progress.md
2. Identify affected files
3. Explain plan BEFORE coding
4. Make focused, minimal changes
5. Do not refactor unrelated systems

---

# 🚧 CURRENT PRIORITY TASK

Fix UI readability and visual clarity across the app.

Specifically:
- Fix contrast issues (dark-on-dark, light-on-light)
- Improve gradient readability
- Clean up stat colours
- Strengthen hierarchy and spacing

DO NOT redesign everything.
This is a refinement pass.

---

# 🔜 NEXT PHASE (AFTER UI FIX)

- Improve Roster / Free Agency UI
- Add player tags (hot, cold, breakout)
- Improve stats presentation
- Add more dynamic UI elements

---

# 🧠 FINAL NOTE

This project is already functional.

The focus now is:
- polish
- clarity
- feel

Every change should improve:
- readability
- usability
- visual impact
