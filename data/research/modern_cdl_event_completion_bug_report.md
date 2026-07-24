# Modern CDL — Major 4 & Champs Event Completion Popup Bug Report

_Investigated & fixed on branch `claude/dynasty-event-completion-popup-o6wok6`._

## 1. Summary of the actual issue

In **Modern CDL** mode, the final-placements completion popup/table did not appear
for **Major 4** or **Champs**. The event finished (result saved, points awarded),
but the completion popup (the `MajorTournamentOverlay` champion screen showing
champion, final placements, user finish, Continue) was immediately covered or
skipped by the next event that the engine started — the **Challengers Finals
qualifier** (after Major 4) and **ESWC** (after Champs).

## 2. This is NOT the Historical Dynasty / open-circuit bug

This is a separate bug in the **Modern CDL** season/event system
(`seasonEngine.js` majors/Champs + the CDL overlays). It has nothing to do with
the Historical Dynasty open-circuit event routing. **No Historical Dynasty
routing, open-circuit tournaments, eras, Rostermania, or rosters were changed.**
Historical Dynasty was only smoke-tested to confirm it still starts.

## 3. Events tested

Full Modern CDL season, driven through the real engine:
Stage → Challenger Qualifier → **Major 1 → Major 2 → Major 3 → Major 4** →
Challengers Finals → **Champs** → ESWC → Season Awards.

## 4. Do Major 1, 2, 3 work?

**Yes.** When Majors 1–3 complete, the engine advances to `phase = "stage"`.
The champion screen condition (`!isMajorPhase && enteredMajor.completed`) was true
and no other full-screen overlay competes during the stage phase, so their
completion popup showed correctly.

## 5. Does Major 4 fail?

**Yes (before the fix).** When Major 4 (major idx 3) completes, `_advanceMajorPhase`
sets `phase = "challengerQualifier"` and creates the Challengers Finals event.
The `ChallengerQualifierOverlay` renders for `phase === "challengerQualifier"` and
was drawn over the Major 4 champion screen (both mounted), so the user saw the
Challengers Finals qualifier instead of the Major 4 completion popup.

## 6. Does Champs fail?

**Yes (before the fix).** When Champs (major idx 4) completes, `_advanceMajorPhase`
immediately calls `beginEswc`, which sets `phase = "major"` and `majorIdx = 5`
(ESWC). The champion-screen condition `!isMajorPhase && …` became **false**
(phase is back to `"major"`), and `showLive` was false (active idx 5 ≠ entered idx
4), so the overlay returned `null` — the Champs popup **never rendered** and the
ESWC entry gate (`MajorEntryOverlay`) appeared instead. Confirmed headlessly: after
Champs, `phase === "major"`, `majorIdx === 5`, so the old `!isMajorPhase` test hid
the popup.

## 7. How the Challengers Qualifier / next event interfered

The engine starts the **next competitive event in the same tick the major
completes** (Challengers Finals for Major 4; ESWC for Champs). Both next-event
overlays key only on the current phase/active major, not on whether a just-finished
event still owes the user its completion popup. So the next-event overlay rendered
on top of (Major 4) or instead of (Champs) the completion popup.

## 8. Root cause

The completion popup and the next-event overlays shared no priority contract:

- **Major 4:** `ChallengerQualifierOverlay` rendered whenever
  `phase === "challengerQualifier"`, ignoring a pending completed-major popup.
- **Champs:** the champion-screen visibility test was gated on `!isMajorPhase`,
  which is false once `beginEswc` flips the phase back to `"major"` for ESWC, so
  the Champs popup was suppressed entirely and the ESWC entry gate showed.

Notably, `SeasonAwardsOverlay` **already** implemented the correct priority guard
(`if (enteredMajor?.completed) return null;`), which is why the ESWC → Awards popup
ordering already worked. The fix extends that same proven pattern to the two
overlays that lacked it, and generalises the champion-screen visibility test.

## 9. Files changed

- `src/components/MajorTournamentOverlay.jsx` — champion-screen visibility
  generalised from `!isMajorPhase && completed` to `completed && !showLive`, so the
  Champs popup shows even though ESWC has flipped the phase back to `"major"`.
- `src/components/MajorEntryOverlay.jsx` — yields (returns `null`) while a
  different, completed major's popup is pending, so the ESWC entry gate no longer
  covers the Champs popup.
- `src/components/ChallengerQualifierOverlay.jsx` — yields while the entered,
  completed major's popup is pending, so the Challengers Finals qualifier no longer
  covers the Major 4 popup.
- `src/engine/seasonEngine.js` — added `buildCdlEventCompletionSummary()` and
  stores it on `schedule.lastCompletedCdlEvent` for every completed major (unified
  completion summary object; pure derivation, no routing change).

## 10. Fix applied

**Overlay-priority (display-layer) fix — engine routing is intentionally
unchanged**, so all headless simulations and Historical Dynasty behave identically:

1. **Popup priority.** A completed, entered major's champion screen now takes
   precedence over every next-event overlay. The next event's UI (Challengers
   Finals qualifier / ESWC entry) is suppressed until the user clicks Continue
   (`DISMISS_MAJOR`, which clears `enteredMajorIdx`). The next event does **not**
   auto-play while suppressed (qualifier/ESWC matches only run on explicit user
   input), so nothing is lost.
2. **Major 4 == Majors 1–3.** With the qualifier overlay yielding, Major 4 shows
   the same completion popup/table as Majors 1–3; on Continue the Challengers Finals
   qualifier appears.
3. **Champs.** The generalised champion-screen test shows the Champs popup; the
   ESWC entry gate is suppressed until Continue, then routes to ESWC.
4. **Unified summary.** `schedule.lastCompletedCdlEvent` carries `eventId,
   eventName, eventType, mode:"modern_cdl", status:"complete", championTeamId,
   championTeamName, placements, userTeamId, userPlacement, proPointsAwarded,
   prizeMoney, completedMatches, summaryReady:true`. Placements are derived with
   the **same** `getMajorPlacementMap` the popup's Placements panel uses (one source
   of truth).
5. **No duplicate popups / points.** The popup is shown once per major via
   `enteredMajorIdx`; `DISMISS_MAJOR` clears it so it cannot reappear. Pro-point
   awards remain guarded by `major.pointsAwarded` (idempotent).

## 11. Remaining limitations

- The fix is display-layer: the engine still *builds* the next event (Challengers
  Finals bracket / ESWC bracket) at completion time. No next-event **matches** are
  simulated until the user dismisses the popup and acts, so the user-visible
  ordering is correct (popup first, then next event). This deliberately preserves
  the engine flow that headless season simulations depend on (`diagnosePostSeasonFlow`,
  `diagnoseFullSeasonFlow`).
- `lastCompletedCdlEvent` is a single "last event" slot (not a per-event archive).
  It is sufficient for the popup and a Home "last event" summary; a full per-event
  history could be added later if needed.
- `prizeMoney` is `0` (prize money is not modelled for CDL majors in this codebase).

## 12. Manual testing checklist

1. Start Modern CDL mode; sim/play Major 1 → confirm completion popup/table.
   Continue. Repeat for Major 2 and Major 3.
2. Reach and complete **Major 4** → confirm the placements popup/table appears and
   the **Challengers Finals qualifier does not block it**. Continue → the qualifier
   then appears.
3. Play the Challengers Finals → Pre-Champs → Begin Champs.
4. Complete **Champs** → confirm the placements popup/table appears and **ESWC does
   not replace it**. Continue → the ESWC entry gate appears.
5. Play ESWC → confirm the ESWC champion screen → Continue → Season Awards (order
   unchanged).
6. Confirm no popup reappears after dismissal and standings points are not
   double-counted.
7. Start **Historical Dynasty** and confirm it still opens (unchanged).

## 13. Diagnostics

- `scripts/diagnoseModernCdlEventCompletion.mjs` — new; drives the full CDL season
  and asserts the completion popup shows for Majors 1–4 and Champs, that the
  Challengers Qualifier / ESWC entry are suppressed until Continue, that the unified
  summary is produced, and that no duplicate points are awarded. Also smoke-tests
  Historical Dynasty start.
- `scripts/diagnoseModernCdlMode.mjs` — upgraded to a full-season smoke test
  (Stage → Qualifier → Major ×4 → Challengers Finals → Champs → ESWC → Awards) with
  no route/phase crash.
- Regression: `diagnosePostSeasonFlow`, `diagnoseFullSeasonFlow`,
  `diagnoseHistoricalDynasty` still pass; `npm run build` passes.
- `scripts/diagnoseHistoricalRosterImport.mjs` was requested but **does not exist**
  in the repo; the Historical smoke was run via `diagnoseHistoricalDynasty.mjs`
  instead.
