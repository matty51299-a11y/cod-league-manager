// src/engine/openCircuit/calendar.js
// Deterministic season calendar for the open circuit.
//
// Combines the era's curated event catalogue with procedurally-scheduled online
// 2K / 5K Pro Point cups. All dates are generated deterministically from the
// competition profile so reloading a save never moves an event or a cup.
//
// Rules honoured here:
//   - throwback events (e.g. Gfinity London Open 2015) are excluded from the
//     core annual calendar but retained in `throwbacks` for optional support;
//   - no online cup is scheduled on the same date as a major LAN;
//   - enough cups are generated that rankings evolve across the season;
//   - overlapping regional events are allowed, but a single team may not enter
//     two overlapping events.

function parseDate(s) {
  return new Date(`${s}T00:00:00Z`).getTime();
}
function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(iso, days) {
  return toISO(parseDate(iso) + days * 86400000);
}

// Two events overlap if their [startDate,endDate] ranges intersect.
export function eventsOverlap(a, b) {
  const as = parseDate(a.startDate);
  const ae = parseDate(a.endDate || a.startDate);
  const bs = parseDate(b.startDate);
  const be = parseDate(b.endDate || b.startDate);
  return as <= be && bs <= ae;
}

// All unordered pairs of events whose dates overlap (a team can enter only one).
export function findOverlappingPairs(events) {
  const pairs = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (eventsOverlap(events[i], events[j])) pairs.push([events[i].id, events[j].id]);
    }
  }
  return pairs;
}

// Deterministically generate the online 2K/5K cups across the season window,
// skipping any date that collides with a major LAN.
export function generateOnlineCups(schedule, lanEvents = []) {
  if (!schedule) return [];
  // Only actual single-weekend LANs block an online-cup date. League seasons and
  // long invitationals run in PARALLEL across months (and are non-blocking in the
  // sim), so counting their whole span as "LAN dates" would wipe out almost every
  // weekly cup. Restrict collisions to short (≤6 day) non-league events.
  const spanDays = (ev) => Math.round((parseDate(ev.endDate || ev.startDate) - parseDate(ev.startDate)) / 86400000);
  const blockingLans = lanEvents.filter((ev) => ev.eventType !== "LEAGUE_SEASON" && spanDays(ev) <= 6);
  const lanDates = new Set();
  for (const ev of blockingLans) {
    let d = parseDate(ev.startDate);
    const end = parseDate(ev.endDate || ev.startDate);
    for (; d <= end; d += 86400000) lanDates.add(toISO(d));
  }
  const cups = [];
  const mk = (cfg, kind, iso, idx) => ({
    id: `${kind}_${iso.replace(/-/g, "")}`,
    name: `${cfg.label} — ${iso}`,
    eventType: kind === "online5k" ? "ONLINE_5K" : "ONLINE_2K",
    tier: "C",
    startDate: iso,
    endDate: iso,
    online: true,
    targetFieldSize: cfg.fieldSize,
    regionEligibility: cfg.regionEligibility,
    qualificationMode: "OPEN_ENTRY",
    proPointTableId: cfg.proPointTableId,
    seq: idx,
  });
  for (const [key, kind] of [["online2k", "online2k"], ["online5k", "online5k"]]) {
    const cfg = schedule[key];
    if (!cfg) continue;
    let iso = schedule.windowStart;
    let idx = 0;
    let guard = 0;
    while (parseDate(iso) <= parseDate(schedule.windowEnd) && guard < 400) {
      guard++;
      if (!lanDates.has(iso)) {
        cups.push(mk(cfg, kind, iso, idx));
        idx++;
      }
      iso = addDays(iso, cfg.intervalDays);
    }
  }
  return cups;
}

// Build the full deterministic calendar for a competition profile.
// Returns { events, cups, throwbacks, all, overlaps } sorted by date.
export function buildSeasonCalendar(profile) {
  const templates = profile?.eventTemplates || [];
  const core = templates.filter((t) => !t.throwback);
  const throwbacks = templates.filter((t) => t.throwback);
  const cups = generateOnlineCups(profile?.onlineCupSchedule, core);
  const byDate = (a, b) =>
    parseDate(a.startDate) - parseDate(b.startDate) || String(a.id).localeCompare(String(b.id));
  const events = [...core].sort(byDate);
  const all = [...core, ...cups].sort(byDate);
  return {
    events,
    cups: cups.sort(byDate),
    throwbacks,
    all,
    overlaps: findOverlappingPairs(events),
  };
}

export const __test = { parseDate, addDays };
