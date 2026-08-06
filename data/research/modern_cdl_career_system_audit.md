# Modern CDL career system audit

## 1. Existing career systems found

The traced Modern CDL flow already had a substantial `boardState`: team-OVR-ranked owner objectives are created on new game and each offseason, live-evaluated by `boardEngine`, nudged after each regular Major, persisted by the store, and given an end-of-season verdict. `BoardObjectives`, the Home board widget, `BoardReviewOverlay`, feed and Inbox surfaces displayed that data. `boardState.confidence` was the sole job-security-like value. The previous "Released" path was a placeholder: it offered a new mandate or destructive new game, not unemployment. There was no persistent manager identity, career-wide reputation, event-grade review, manager achievement record, job market, or manager-only team switch.

Staff `reputation` and transfer-market GM reputation are separate staff attributes, not a player-manager career reputation. Player/team career histories are simulation archives and are retained separately. Historical Dynasty and Challenger board systems use different flows and are explicitly excluded by the Modern migration guard.

## 2. Existing systems retained

`boardState.objectives`, their team-strength generation, owner ambition/patience, live evaluation, confidence, season review, Board page, Home widget, Inbox/feed hooks and save mechanism remain authoritative. Event placement comes from the completed real bracket. Current rosters, standings, schedule, results, Challengers and ratings are untouched.

## 3. Existing systems replaced or consolidated

The new `managerCareer` wraps the existing objective/confidence data. `jobSecurity` mirrors the authoritative confidence value at career review boundaries rather than running a disconnected mandate. The old released/new-game-only outcome is superseded by a non-destructive unemployed state and job offers. Event reviews are queued after the existing placement overlay instead of replacing it.

## 4. Duplicate logic removed/avoided

Season objectives are normalized from `boardState.objectives`; no second objective generator competes with the board engine. Existing bracket placement and team OVR ranking helpers are reused. Career calculations are centralized in `modernCdlCareer.js`.

## 5. Reputation calculation

Reputation is clamped 0–100 and tiered Unknown, Developing, Established, Respected, Elite and Legendary. Starting reputation derives from current roster power rank (elite 50, playoff 42, mid 36, rebuild 30). It changes only on completed Majors/Champs: placement relative to the frozen target moves it slowly, with modest finals/trophy/Champs bonuses and a bounded -5 to +10 event range. It never resets on a team move.

## 6. Job-security calculation

Job security is 0–100 and shares the board confidence value. Event movement is based on expected-versus-actual placement, the minimum acceptable finish and objective consequences, bounded -16 to +14. Bands are Secure, Stable, Under Review, Under Pressure, Final Warning and Sacked. A single result cannot normally sack a manager because dismissal additionally requires prior escalation and repeated severe underperformance.

## 7. Objective and expectation rules

The readable career set is one mandatory objective, one secondary and one stretch objective selected from the existing strength-aware mandate. Existing measurable target types and their season deadline are retained. Event expectations are generated only for an unfinished event and frozen with roster rank, current seed and tier as their visible basis. Elite, playoff, mid and rebuild teams receive progressively more forgiving minimum/board/stretch placement targets.

## 8. Warning and dismissal rules

Confidence at 55 or below creates concern, 35 or below creates a formal warning, and 20 or below creates one clear next-event top-eight ultimatum. Dismissal requires Final Warning plus three consecutive D/F event reviews (or critically low end-of-season confidence after repeated warnings). Resolution IDs and evaluated-event IDs ensure warnings, reviews and dismissal do not repeat.

## 9. Job-offer rules

Interest is checked at event review points, once per market key. Employed managers need enough reputation for the hiring organisation's prestige; unemployed managers have wider access. At most one deterministic realistic offer is generated per check. It contains roster, standings, strength, expectation, starting security, two-season term, reason and deadline. Accept/reject actions persist.

## 10. Save migration and switching

Only `userTeamType === "cdl"` saves are migrated. Current team, season, calendar, brackets, standings, results, rosters and all other world fields are spread unchanged. Missing career data receives strength-based reputation/security, remaining-event expectation and normalized current objectives. Completed events are never offered as new targets. Accepting an offer changes only `userTeamId`, manager appointment data and the board mandate; no player `teamId`, schedule, standings, results or date changes. The previous club therefore continues under AI control.

## 11. UI changes

A Modern-only Career sidebar page now presents profile, security/warnings, expectations, objectives, event grades, transparent deltas, record, achievements, offers and appointment history. Home adds a compact reputation/event target/warning/offer summary. The post-event board modal shows after placement dismissal and explains every change.

## 12. Remaining limitations

AI manager identities and a full league-wide hiring/firing simulation are not modelled; vacancies are inferred from plausible hiring need. There is no calendar-day contract negotiation or delay action. Career series totals are prepared in the persistent schema but this first pass updates trophy/event totals at event completion; deeper match-by-match record backfill would require a stable historical match ownership snapshot. Unemployed calendar advancement uses the existing simulation controls rather than a dedicated "advance to vacancy" button.
