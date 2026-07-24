# Historical Dynasty — Event Completion Popup Bug Report

_Investigated & fixed on branch `claude/dynasty-event-completion-popup-o6wok6`._

## 1. Summary of the issue

In **Cod Dynasty (Historical Dynasty / open-circuit)** careers, finishing certain
events did not show the final event-completion popup/table (champion, final
placements, user finish, Pro Points, continue button). The known affected event
was **Champs (Call of Duty Championship)**, and at least one other event showed
the same problem.

The root cause is **not** in Champs-specific logic — it is a **routing bug in the
open-circuit "quick-sim" path**. Open-circuit events fall into two families:

- **Interactive events** — Open LAN, World Championship (Champs), Invitational,
  Regional Championship. These are meant to open the **live tournament overlay**
  (`CircuitTournamentOverlay`), which is the **only** surface that renders their
  completion popup / champion screen.
- **Batch events** — Online 2K/5K cups and multi-month League Seasons. These are
  quick-simulated and shown via the reveal overlay (`CircuitMatchOverlay`).

The batch quick-sim (`advanceOpenCircuitEvent` → `simulateOpenCircuitSeason`)
processes the calendar in date order and **rolls past events with an insufficient
field (skips)**, completing whatever comes next. When the next event turned out to
be an **interactive** event, it was **silently batch-completed** — never opening
the live tournament, so **no completion popup ever appeared** for it. Depending on
which button was pressed, the user either saw the wrong summary or (via
"Sim cups to next LAN") **no popup at all**.

## 2. Events tested

A fresh Cod Dynasty (Ghosts 2013/14) save was played through the **entire 81-event
season calendar** (across several teams/seeds) via the real reducer routing:

- Online 2K (34) · Online 5K (11) — batch cups
- League Seasons (6) — batch, multi-month
- Open LAN (13) — interactive
- Invitational (4) — interactive
- Regional Championship (2) — interactive
- World Championship / **Champs** (1) — interactive

## 3. Events that correctly showed the completion popup/table

- Open LANs, Invitationals and Regionals **whose preceding calendar slot was a
  playable cup** (so `nextEventId` pointed directly at them and routed to the live
  tournament).
- All online 2K/5K cups (batch reveal via `CircuitMatchOverlay`).

## 4. Events that FAILED to show the completion popup/table

Reproduced deterministically (OpTic, seed 4242):

- **`gfinity_g3`** (Open LAN)
- **`egl_star_series`** (Open LAN)
- **`lvp_final_cup_s6`** (Open LAN)

Each of these directly follows an Online 5K that gets skipped (no eligible field
after the commitment/overlap system runs). The batch path skipped the 5K and then
**silently completed the LAN** — no live tournament, no champion screen.

**Champs** is affected by the **same mechanism**: whenever the online cups
scheduled between the previous LAN and Champs all skip, the batch path rolls
forward and completes Champs silently. This is seed/calendar dependent, which is
why it was intermittent, but it is the *same* root cause — hence the fix is shared,
not a Champs special-case.

## 5. Root cause

`simulateOpenCircuitSeason` (the batch simulator) had no concept of "interactive"
events. Its "roll past skips" logic (`if (eligible.length < 2) mark skipped;
continue;`) would continue past a skipped cup and play the **next** event on the
calendar — including interactive ones — awarding points and writing a result,
without ever setting `state.circuitTournament`. Since the completion popup is
rendered by `CircuitTournamentOverlay` only when `state.circuitTournament` is set,
the popup never appeared for a swept interactive event.

The engine itself was correct: a manually-built Champs tournament always produces a
champion and full placements. The defect was purely in **which path completed the
event**.

## 6. Files involved

Investigation touchpoints:
- `src/engine/openCircuitEngine.js` — batch simulator (`simulateOpenCircuitSeason`)
- `src/engine/openCircuitCareer.js` — `advanceOpenCircuitEvent`, `simCircuitToNextMajor`, `assembleOpenCircuit`
- `src/engine/circuitTournament.js` — live tournament + `finalizeCircuitTournament`
- `src/store/gameStore.jsx` — `START_CIRCUIT_EVENT` / `SIM_NEXT_CIRCUIT_EVENT` / `SIM_CIRCUIT_TO_MAJOR`
- `src/components/CircuitTournamentOverlay.jsx` — live champion screen (the popup)
- `src/components/CircuitMatchOverlay.jsx` — batch reveal
- `src/data/competitionProfiles.js` — event catalogue + event-type predicate
- `src/App.jsx` — `playNextCircuitEvent` routing

## 7. Fix applied

**Interactive events are now NEVER completed by the batch path — they always open
the live tournament, which owns the completion popup.**

1. **Single source of truth for "interactive"** (`competitionProfiles.js`):
   `INTERACTIVE_EVENT_TYPES` + `isInteractiveCircuitEvent()`. `circuitTournament.js`
   now re-exports it instead of keeping a private copy.

2. **Batch simulator stops before interactive events** (`openCircuitEngine.js`):
   `simulateOpenCircuitSeason` gains `stopBeforeInteractive`. Un-fieldable events are
   still recorded as skips, but when the next event to play is interactive the batch
   **breaks without completing it**, leaving it as `nextEventId`.
   `advanceOpenCircuitEvent` and `simCircuitToNextMajor` pass `stopBeforeInteractive: true`.

3. **Reducer auto-opens the live tournament** (`gameStore.jsx`): extracted
   `startCircuitLive(state, eventId)` (the START body) and `maybeStartCircuitLive()`.
   After any batch step that stops before an interactive event (nothing new revealed),
   the reducer opens that event's live tournament. Applied to `SIM_NEXT_CIRCUIT_EVENT`,
   `SIM_CIRCUIT_TO_MAJOR` and `START_CIRCUIT_EVENT`. The completion popup is therefore
   **independent of which button is pressed** (Play Next Event / Sim cups to next LAN /
   Sim Event / Play Match / Sim Round / Sim Next Match / Sim My Match).

4. **Unified completion object** (`circuitTournament.js` `finalizeCircuitTournament`
   + `openCircuitCareer.js` `assembleOpenCircuit`): every completed event — live OR
   batch — now produces the same minimum shape:
   `eventId, eventName, eraId, gameTitle, eventTier, eventType, status:"complete",
   championTeamId, championTeamName, placements, finalPlacements, userTeamId,
   userPlacement, userProPointsEarned, proPointsAwarded, completedMatches,
   completedOrder, summaryReady:true`. A safe champion/placements fallback is
   derived from the final placement list so a completed event can never be left
   without a champion or placements.

5. **No duplicate / wrong popup** (`CircuitMatchOverlay.jsx`): the batch reveal now
   returns `null` while a live tournament is active, and `null` for any interactive
   event result — so an interactive event never shows a second summary and there is
   no double popup after the champion screen. Pro Point awards remain idempotent
   (`awardTournamentPoints` per-tournament guard), so no duplicate points/results.

6. **One source of truth for placements**: the popup's `finalPlacements` and the
   truncated top-8 `placements` are both derived from the same
   `computeLivePlacements(bracket)` (live) / result placements (batch), so the popup
   and the Placements tab always agree.

## 8. Remaining limitations

- The live open-circuit tournament runs every interactive event as a full-field
  **double-elimination** bracket. The batch World Championship path models a group
  stage → playoff; the live Champs uses the shared DE format (same as the other
  LANs). This is an intentional simplification, unchanged by this fix.
- League Seasons remain **batch** events (they span months and cannot be played
  match-by-match); their completion is shown via the reveal overlay, not the live
  champion screen. This matches the existing design.
- The "Sim cups to next LAN" button, when the immediate next cups are all
  un-fieldable and the next real event is interactive, will open that live
  tournament directly (correct), rather than first flashing a cup reveal.
- Reopening a completed event from the Circuit / Home surfaces uses the persisted
  unified completion object (champion, finish, Pro Points, placements table). It is
  a data-complete summary, not a re-playable bracket.

## 9. Manual testing checklist

1. Start a fresh Cod Dynasty save. Open Home (Historical Dashboard).
2. Play the current event with **Sim Event** → completion popup/table appears
   (champion, final placements, your finish, Pro Points, Continue).
3. Continue; repeat for several event types (Open LAN, Invitational, Regional).
4. Use **Sim cups to next LAN** through a stretch of online cups → it lands on the
   next LAN's **live tournament** (never silently finishes it).
5. Reach and play **Champs** → live tournament opens; on completion the champion
   screen shows champion, your finish and Pro Points; **Continue** returns to the
   circuit.
6. Confirm **Home** shows Champs as the Last Event summary and the **Circuit /
   Tournament Hub** marks Champs completed with its placements.
7. Reopen a completed event (Home results row / Circuit event card) → it renders
   Champion / Your Finish / Pro Points + a placements table, no blank screen.
8. Confirm the popup does not reappear after dismissal and Pro Points are not
   double-counted.
9. Start a **Modern CDL** save and confirm it still builds and plays (Champs there
   still uses the modern major overlay, untouched).

## 10. Diagnostics

- `scripts/diagnoseEventCompletionPopups.mjs` — new; the primary check. Plays the
  whole calendar via the real routing and asserts every event's completion object,
  champion, placements, user finish, Pro Points, popup trigger, safe reopen, Champs,
  the interactive-never-batched guard, and no duplicate points/results.
- `scripts/diagnoseHistoricalEventStability.mjs` — new; multi-team/seed sweep.
- `scripts/diagnoseEventReadability.mjs` — new; readable names + one-source placements.
- `scripts/diagnoseHistoricalSeasonFlow.mjs` — new; season progresses to completion.
- `scripts/diagnoseModernCdlMode.mjs` — new; modern CDL still builds/simulates.
- Shared harness: `scripts/historicalCircuitHarness.mjs`.
