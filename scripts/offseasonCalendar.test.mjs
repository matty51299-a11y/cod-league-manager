import assert from "node:assert/strict";
import { buildOffseasonCalendar, resetOffseasonCalendar } from "../src/engine/contractNegotiation.js";

const staleCalendarState = {
  season: 2,
  calendar: {
    day: 15,
    label: "Offseason 1 Day 16",
    freeAgencyOpenDay: 5,
    rosterDeadlineDay: 12,
    seasonStartDay: 15,
  },
};

const reset = resetOffseasonCalendar(staleCalendarState);
assert.equal(reset.day, 0, "each contract-review window starts on Day 1");
assert.equal(reset.label, "Offseason 2 Day 1");
assert.equal(reset.freeAgencyOpenDay, 5);
assert.equal(reset.seasonStartDay, 15);

const fresh = buildOffseasonCalendar({ season: 2 });
assert.equal(fresh.day, 0);
assert.equal(fresh.label, "Offseason 2 Day 1");

console.log("Offseason calendar reset test passed.");
