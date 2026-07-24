// src/components/MajorTournamentOverlay.jsx
// Full-screen tournament mode takeover — redesigned as a compact, FM-style
// "tournament control room".
//
// Supports both:
//   SE (Champs)  — 3-round single elimination, 8 teams
//   DE (Majors)  — 11-round double elimination, 12/16 teams
//
// Layout:
//   • Sticky command header  (event · round · alive · user status · command bar)
//   • Main area with tabs    (Overview / Winners / Losers / Bracket / Results / Placements)
//   • Sticky right aside      (My Team · Current Match · My Team Path · Latest Results · Placements)
//
// This is a UI/UX redesign only — tournament logic, bracket generation, seeding,
// results, points and simulation are all read from existing state untouched.

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import { MAJOR_PLACEMENT_POINTS } from "../engine/seasonEngine.js";
import SeriesDetail from "./SeriesDetail.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { resolveTeamDisplay } from "../utils/teamDisplay.js";
import { placementText } from "../utils/placementDisplay.js";
import { getMajorPlacementMap } from "../utils/historyProfiles.js";
import { useTeamHub } from "../store/teamHubContext.jsx";
import { useMatchCenter } from "../store/matchCenterContext.jsx";
import { isUserRosterPlayable } from "../utils/rosterValidation.js";
import MatchPreview from "./MatchPreview.jsx";
import { getTeamTextAccent } from "../utils/teamTheme.js";

function getTeamMeta(id, schedule) { return CDL_TEAMS.find(t => t.id === id) ?? schedule?.currentMajorEventTeams?.[id] ?? null; }
function teamTag(id, schedule)  { return resolveTeamDisplay(id, schedule)?.tag ?? id; }
function teamColor(id, schedule){ return getTeamTextAccent(resolveTeamDisplay(id, schedule)); }

// ── Derivation helpers (all read-only over existing bracket state) ─────────────

// Flatten every populated match in round order, with round metadata attached.
function flattenMatches(bracket) {
  const out = [];
  (bracket?.rounds ?? []).forEach((r, ri) => {
    (r.matches ?? []).forEach((m, mi) => {
      out.push({ ...m, roundName: r.name, roundType: r.type, roundIdx: ri, matchIdx: mi });
    });
  });
  return out;
}

// Returns { result, roundName } if user has been fully eliminated, otherwise null.
function getUserElimination(bracket, userTeamId) {
  if (!bracket) return null;
  const allRounds = bracket.rounds ?? [];
  const stillIn = allRounds.some(r =>
    r.matches.some(m => !m.played && (m.a === userTeamId || m.b === userTeamId))
  );
  if (stillIn) return null;
  let lastLoss = null;
  for (const round of allRounds) {
    for (const m of round.matches) {
      if (m.played && m.result?.loserId === userTeamId) {
        lastLoss = { result: m.result, roundName: round.name };
      }
    }
  }
  return lastLoss;
}

function getSeedNum(bracket, teamId, fallback) {
  if (fallback != null) return fallback;
  const idx = bracket.seeds?.indexOf(teamId) ?? -1;
  return idx >= 0 ? idx + 1 : null;
}

// Returns index of the first round with unplayed matches, or -1.
function currentRoundIdx(bracket) {
  if (!bracket) return -1;
  const rounds = bracket.rounds ?? [];
  for (let r = 0; r < rounds.length; r++) {
    if (rounds[r].matches.length > 0 && rounds[r].matches.some(m => !m.played)) return r;
  }
  return -1;
}

// Teams alive = those with fewer than 2 tournament losses (DE) or 1 loss (SE).
function teamsAlive(bracket) {
  if (!bracket) return null;
  const isDE = bracket.type === "DE" || bracket.type === "DE16";
  const maxLosses = isDE ? 1 : 0;
  const lossCount = {};
  for (const round of bracket.rounds) {
    for (const m of round.matches) {
      if (!m.played || !m.result?.loserId) continue;
      const id = m.result.loserId;
      lossCount[id] = (lossCount[id] ?? 0) + 1;
    }
  }
  const gfRound = isDE ? bracket.rounds.find(r => r.type === "GF") : bracket.rounds[2];
  if (gfRound?.matches?.[0]?.played) return 1; // champion only
  const totalTeams = bracket.seeds?.length ?? (isDE ? 12 : 8);
  return totalTeams - Object.values(lossCount).filter(c => c > maxLosses).length;
}

// User's win/loss record inside the event.
function getUserRecord(bracket, userTeamId) {
  let w = 0, l = 0;
  for (const m of flattenMatches(bracket)) {
    if (!m.played || !m.result) continue;
    if (m.result.winnerId === userTeamId) w++;
    else if (m.result.loserId === userTeamId) l++;
  }
  return { w, l };
}

// User's route through the event — played legs + the next upcoming leg.
function getUserPath(bracket, userTeamId) {
  const path = [];
  for (const m of flattenMatches(bracket)) {
    const involved = m.a === userTeamId || m.b === userTeamId;
    if (!involved) continue;
    if (m.played && m.result) {
      const won = m.result.winnerId === userTeamId;
      const oppId = won ? m.result.loserId : m.result.winnerId;
      path.push({ roundName: m.roundName, played: true, won, oppId, score: m.result.score });
    } else if (!m.played) {
      const oppId = m.a === userTeamId ? m.b : m.a;
      path.push({ roundName: m.roundName, played: false, oppId });
    }
  }
  return path;
}

// Most-recent-first played results.
function getLatestResults(bracket, n = 8) {
  return flattenMatches(bracket)
    .filter(m => m.played && m.result)
    .sort((a, b) => (b.roundIdx - a.roundIdx) || (b.matchIdx - a.matchIdx))
    .slice(0, n);
}

const PLACEMENT_BANDS = [
  { label: "Champion",   places: [1] },
  { label: "Runner-up",  places: [2] },
  { label: "3rd",        places: [3] },
  { label: "4th",        places: [4] },
  { label: "5th–6th",    places: [5, 6] },
  { label: "7th–8th",    places: [7, 8] },
  { label: "9th–12th",   places: [9, 10, 11, 12] },
  { label: "13th–16th",  places: [13, 14, 15, 16] },
];

// ── Sticky command header ──────────────────────────────────────────────────────
function CommandHeader({
  major, roundName, alive, userStatus, record, finishLabel, nextUserOpp, latestUserLine,
  userTeamId, schedule, curRound, userInNext, dispatch, onPlayMatch,
}) {
  const team = resolveTeamDisplay(userTeamId, schedule);
  const statusClass = userStatus === "Champion" ? "mto-ch-status-champ"
    : userStatus === "Eliminated" ? "mto-ch-status-out"
    : "mto-ch-status-alive";

  return (
    <div className="mto-cmd-header">
      <div className="mto-ch-left">
        <span className="mto-ch-live">●</span>
        <span className="mto-ch-event">{major.name}</span>
        {roundName && <span className="mto-ch-sep">/</span>}
        {roundName && <span className="mto-ch-round">{roundName}</span>}
        {alive != null && <span className="mto-ch-alive">{alive} alive</span>}
      </div>

      <div className="mto-ch-user">
        <TeamLogo team={team} variant="bracket" size={20} />
        <span className="mto-ch-team" style={{ color: team.color }}>{team.name}</span>
        <span className="you-badge">YOUR TEAM</span>
        <span className={`mto-ch-status ${statusClass}`}>{userStatus}</span>
        <span className="mto-ch-rec">{record.w}-{record.l}</span>
        {finishLabel && <span className="mto-ch-finish">{finishLabel}</span>}
        {userStatus === "Alive" && nextUserOpp && (
          <span className="mto-ch-next">Next: {teamTag(nextUserOpp, schedule)}</span>
        )}
        {userStatus === "Eliminated" && latestUserLine && (
          <span className="mto-ch-next">{latestUserLine}</span>
        )}
      </div>

      {curRound >= 0 && (
        <div className="mto-ch-cmds">
          {userInNext ? (
            <button className="btn-primary mto-cmd-btn mto-cmd-primary" onClick={onPlayMatch}>▶ Play Your Match</button>
          ) : (
            <button className="btn-secondary mto-cmd-btn" onClick={() => dispatch({ type: "SIM_NEXT_MAJOR_MATCH" })}>Sim Next</button>
          )}
          <button className="btn-secondary mto-cmd-btn" onClick={() => dispatch({ type: "SIM_MAJOR_ROUND" })}>Sim Round</button>
          <button className="btn-secondary mto-cmd-btn mto-cmd-ghost" onClick={() => dispatch({ type: "SIM_MAJOR" })}>Finish Event</button>
        </div>
      )}
    </div>
  );
}

// ── Aside: My Team panel ───────────────────────────────────────────────────────
function MyTeamPanel({ userTeamId, schedule, bracket, userStatus, record, side, finishLabel, points }) {
  const team = resolveTeamDisplay(userTeamId, schedule);
  const seed = getSeedNum(bracket, userTeamId, null);
  return (
    <div className="mto-aside-card mto-myteam">
      <div className="mto-aside-title">My Team</div>
      <div className="mto-myteam-id">
        <TeamLogo team={team} variant="bracket" size={28} />
        <div className="mto-myteam-meta">
          <span className="mto-myteam-name" style={{ color: team.color }}>{team.name}</span>
          {seed != null && <span className="mto-myteam-seed">Seed #{seed}</span>}
        </div>
      </div>
      <div className="mto-myteam-rows">
        <div className="mto-mt-row"><span>Status</span><strong className={userStatus === "Eliminated" ? "mto-x-out" : userStatus === "Champion" ? "mto-x-champ" : "mto-x-alive"}>{userStatus}</strong></div>
        <div className="mto-mt-row"><span>Record</span><strong>{record.w}-{record.l}</strong></div>
        <div className="mto-mt-row"><span>Bracket</span><strong>{side}</strong></div>
        <div className="mto-mt-row"><span>{userStatus === "Alive" ? "Best possible" : "Finish"}</span><strong>{finishLabel ?? "—"}</strong></div>
        {points != null && <div className="mto-mt-row"><span>Points</span><strong>{points} pts</strong></div>}
      </div>
    </div>
  );
}

// ── Aside: Current Match panel ─────────────────────────────────────────────────
function CurrentMatchPanel({ bracket, curRound, userTeamId, schedule, onPlayMatch, dispatch }) {
  if (curRound < 0) return null;
  const round = bracket.rounds[curRound];
  const next = round?.matches.find(m => !m.played);
  if (!next) return null;
  const seedA = getSeedNum(bracket, next.a, next.seedA);
  const seedB = getSeedNum(bracket, next.b, next.seedB);
  const aYou = next.a === userTeamId;
  const bYou = next.b === userTeamId;
  const userIn = aYou || bYou;

  return (
    <div className={`mto-aside-card mto-curmatch ${userIn ? "mto-curmatch-user" : ""}`}>
      <div className="mto-aside-title">
        {userIn ? "Your Next Match" : "Current Match"}
        <span className="mto-curmatch-round">{round.name}</span>
      </div>
      <div className="mto-curmatch-teams">
        <div className={`mto-cm-team ${aYou ? "mto-cm-you" : ""}`}>
          {seedA != null && <span className="mto-cm-seed">#{seedA}</span>}
          <TeamLogo team={resolveTeamDisplay(next.a, schedule)} variant="bracket" size={18} />
          <span className="mto-cm-name" style={{ color: teamColor(next.a, schedule) }}>{teamTag(next.a, schedule)}</span>
          {aYou && <span className="you-badge you-badge-sm">YOU</span>}
        </div>
        <span className="mto-cm-vs">vs</span>
        <div className={`mto-cm-team ${bYou ? "mto-cm-you" : ""}`}>
          {seedB != null && <span className="mto-cm-seed">#{seedB}</span>}
          <TeamLogo team={resolveTeamDisplay(next.b, schedule)} variant="bracket" size={18} />
          <span className="mto-cm-name" style={{ color: teamColor(next.b, schedule) }}>{teamTag(next.b, schedule)}</span>
          {bYou && <span className="you-badge you-badge-sm">YOU</span>}
        </div>
      </div>
      {userIn ? (
        <button className="btn-primary mto-cm-btn" onClick={onPlayMatch}>▶ Play Your Match</button>
      ) : (
        <button className="btn-secondary mto-cm-btn" onClick={() => dispatch({ type: "SIM_NEXT_MAJOR_MATCH" })}>▶ Sim This Match</button>
      )}
      <MatchPreview teamAId={next.a} teamBId={next.b} compact />
    </div>
  );
}

// ── Aside: My Team Path ────────────────────────────────────────────────────────
function MyTeamPath({ path, schedule, userPlaceLabel, userStatus }) {
  if (!path.length) return null;
  return (
    <div className="mto-aside-card">
      <div className="mto-aside-title">My Team Path</div>
      <div className="mto-path">
        {path.map((leg, i) => (
          <div key={i} className={`mto-path-leg ${leg.played ? (leg.won ? "mto-path-win" : "mto-path-loss") : "mto-path-next"}`}>
            <span className="mto-path-round">{leg.roundName}</span>
            <span className="mto-path-detail">
              {leg.played
                ? <>{leg.won ? "Won" : "Lost"} {leg.score} vs {teamTag(leg.oppId, schedule)}</>
                : <>Next vs {teamTag(leg.oppId, schedule)}</>}
            </span>
          </div>
        ))}
        {userStatus !== "Alive" && userPlaceLabel && (
          <div className="mto-path-finish">Finished {userPlaceLabel}</div>
        )}
      </div>
    </div>
  );
}

// ── Aside: Latest Results ──────────────────────────────────────────────────────
function LatestResults({ results, userTeamId, schedule, onDetails }) {
  if (!results.length) {
    return (
      <div className="mto-aside-card">
        <div className="mto-aside-title">Latest Results</div>
        <div className="mto-lr-empty">No matches played yet.</div>
      </div>
    );
  }
  return (
    <div className="mto-aside-card">
      <div className="mto-aside-title">Latest Results</div>
      <div className="mto-lr-list">
        {results.map((m, i) => {
          const r = m.result;
          const userIn = m.a === userTeamId || m.b === userTeamId;
          return (
            <div key={i} className={`mto-lr-row ${userIn ? "mto-lr-user" : ""}`}>
              <span className="mto-lr-round">{m.roundName}</span>
              <span className="mto-lr-line">
                <span className="mto-lr-win" style={{ color: teamColor(r.winnerId, schedule) }}>{teamTag(r.winnerId, schedule)}</span>
                <span className="mto-lr-score">{r.score}</span>
                <span className="mto-lr-lose" style={{ color: teamColor(r.loserId, schedule) }}>{teamTag(r.loserId, schedule)}</span>
              </span>
              {r.standoutName && r.standoutKD > 0 && (
                <span className="mto-lr-mvp">★ {r.standoutName}</span>
              )}
              <button className="mto-lr-details" onClick={() => onDetails(`${m.roundIdx}-${m.matchIdx}`)}>›</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Placements / points panel ──────────────────────────────────────────────────
function PlacementsPanel({ major, enteredIdx, userTeamId, schedule, compact = false }) {
  const placements = getMajorPlacementMap(major);
  const isRegularMajor = enteredIdx >= 0 && enteredIdx <= 3;
  // Group teamIds by band.
  const byBand = PLACEMENT_BANDS.map(band => {
    const teams = Object.entries(placements)
      .filter(([, p]) => band.places.includes(p))
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);
    return { ...band, teams };
  });

  return (
    <div className={`mto-aside-card ${compact ? "" : "mto-placements-full"}`}>
      <div className="mto-aside-title">Placements{isRegularMajor ? " & Points" : ""}</div>
      <div className="mto-pl-list">
        {byBand.map(band => {
          const pts = isRegularMajor && band.places.length === 1 ? MAJOR_PLACEMENT_POINTS[band.places[0]] : null;
          const ptsRange = isRegularMajor && band.places.length > 1
            ? `${MAJOR_PLACEMENT_POINTS[band.places[band.places.length - 1]] ?? 0}–${MAJOR_PLACEMENT_POINTS[band.places[0]] ?? 0}`
            : null;
          return (
            <div key={band.label} className="mto-pl-band">
              <div className="mto-pl-band-head">
                <span className="mto-pl-band-label">{band.label}</span>
                {pts != null && <span className="mto-pl-pts">{pts} pts</span>}
                {ptsRange != null && <span className="mto-pl-pts">{ptsRange} pts</span>}
              </div>
              <div className="mto-pl-teams">
                {band.teams.length === 0
                  ? <span className="mto-pl-tbd">TBD</span>
                  : band.teams.map(id => (
                      <span key={id} className={`mto-pl-team ${id === userTeamId ? "mto-pl-you" : ""}`} style={{ color: teamColor(id, schedule) }}>
                        {teamTag(id, schedule)}{id === userTeamId && " ◆"}
                      </span>
                    ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Single bracket match card ───────────────────────────────────────────────────
function BracketTeamLine({ teamId, seed, schedule, onClickTeam, isUser }) {
  const display = resolveTeamDisplay(teamId, schedule);
  return (
    <div className={`mto-bc-teamline ${isUser ? "mto-bc-teamline-you" : ""}`}>
      {seed && <span className="mto-bc-seed">{seed}</span>}
      <TeamLogo team={display} variant="bracket" size={18} />
      <span className="mto-bc-name team-link" style={{ color: display.color }} onClick={() => onClickTeam(teamId)}>{display.tag}</span>
      {isUser && <span className="you-badge you-badge-sm">YOU</span>}
    </div>
  );
}

function MatchCard({ match, bracket, userTeamId, expandedKey, setExpandedKey, cardKey, schedule, isNextMatch }) {
  const { openTeamHub } = useTeamHub();
  const isPlayed     = match.played;
  const result       = match.result;
  const seedA        = getSeedNum(bracket, match.a, match.seedA);
  const seedB        = getSeedNum(bracket, match.b, match.seedB);
  const userInvolved = match.a === userTeamId || match.b === userTeamId;
  const userWon      = isPlayed && result?.winnerId === userTeamId && userInvolved;
  const userLost     = isPlayed && result?.loserId  === userTeamId && userInvolved;
  const isOpen       = expandedKey === cardKey;

  function toggle(e) {
    e.stopPropagation();
    setExpandedKey(prev => (prev === cardKey ? null : cardKey));
  }

  if (!isPlayed) {
    const nextUserClass = isNextMatch && userInvolved ? "mto-bc-next-user" : isNextMatch ? "mto-bc-next" : "";
    return (
      <div className={`mto-bracket-card ${nextUserClass} ${userInvolved ? "mto-bc-user-involved" : ""}`}>
        {isNextMatch && (
          <div className={`mto-bc-nextbadge ${userInvolved ? "mto-bc-nextbadge-you" : ""}`}>
            {userInvolved ? "YOUR NEXT MATCH" : "NEXT MATCH"}
          </div>
        )}
        <BracketTeamLine teamId={match.a} seed={seedA} schedule={schedule} onClickTeam={openTeamHub} isUser={match.a === userTeamId} />
        <BracketTeamLine teamId={match.b} seed={seedB} schedule={schedule} onClickTeam={openTeamHub} isUser={match.b === userTeamId} />
      </div>
    );
  }

  const winnerId   = result.winnerId;
  const loserId    = result.loserId;
  const winnerSeed = winnerId === match.a ? seedA : seedB;
  const loserSeed  = loserId  === match.a ? seedA : seedB;

  return (
    <div className={`mto-bracket-card mto-bc-played ${userWon ? "mbc-user-win" : userLost ? "mbc-user-loss" : ""} ${userInvolved ? "mto-bc-user-involved" : ""}`}>
      {userInvolved && (
        <div className={`mto-bc-outcome ${userWon ? "mto-bco-win" : "mto-bco-loss"}`}>
          {userWon ? "VICTORY" : "DEFEAT"}
        </div>
      )}
      <div className="mto-bc-score-center">
        <div className={`mto-bc-sc-side ${winnerId === userTeamId ? "mto-bc-sc-you" : ""}`}>
          {winnerSeed && <span className="mto-bc-seed">{winnerSeed}</span>}
          <TeamLogo team={resolveTeamDisplay(winnerId, schedule)} variant="bracket" size={18} />
          <span className="mto-bc-sc-tag team-link" style={{ color: teamColor(winnerId, schedule) }} onClick={() => openTeamHub(winnerId)}>
            {teamTag(winnerId, schedule)}
          </span>
        </div>
        <span className="mto-bc-sc-score">{result.score}</span>
        <div className={`mto-bc-sc-side mto-bc-sc-loser ${loserId === userTeamId ? "mto-bc-sc-you" : ""}`}>
          <TeamLogo team={resolveTeamDisplay(loserId, schedule)} variant="bracket" size={18} />
          <span className="mto-bc-sc-tag team-link" style={{ color: teamColor(loserId, schedule) }} onClick={() => openTeamHub(loserId)}>
            {teamTag(loserId, schedule)}
          </span>
          {loserSeed && <span className="mto-bc-seed">{loserSeed}</span>}
        </div>
      </div>
      {result.standoutName && result.standoutKD > 0 && (
        <div className="mto-bc-mvp-row">
          <span className="mto-bc-mvp-star">★</span>
          <strong className="mto-bc-mvp-name">{result.standoutName}</strong>
          <span className="mto-bc-mvp-kd">{result.standoutKD.toFixed(2)} K/D</span>
          <span className="mto-bc-mvp-label">MVP</span>
        </div>
      )}
      <button className="mto-bc-details" onClick={toggle}>
        {isOpen ? "Hide ▲" : "Details ▼"}
      </button>
      {isOpen && (
        <div className="mto-bc-expand">
          <SeriesDetail result={result} />
        </div>
      )}
    </div>
  );
}

function TBDCard() {
  return (
    <div className="mto-bracket-card mto-bc-tbd">
      <div className="mto-bc-team"><span className="mto-bc-seed">—</span><span className="mto-bc-name muted">TBD</span></div>
      <div className="mto-bc-team"><span className="mto-bc-seed">—</span><span className="mto-bc-name muted">TBD</span></div>
    </div>
  );
}

const _LEGACY_TBD = { 0:4, 2:4, 5:2, 7:1, 1:2, 3:2, 4:2, 6:2, 8:1, 9:1, 10:1 };

// ── One round column ────────────────────────────────────────────────────────────
function RoundSection({ round, roundIdx, bracket, isCurrentRound, userTeamId, expandedKey, setExpandedKey, tbd, schedule, activeMatchKey }) {
  const hasMatches = round.matches.length > 0;
  const isDone     = hasMatches && round.matches.every(m => m.played);
  return (
    <div className={`mto-round ${isCurrentRound ? "mto-round-active" : ""}`}>
      <div className="mto-round-header">
        <span className="mto-round-name">{round.name}</span>
        {isCurrentRound && <span className="mto-round-badge mto-rb-live">▶ Now</span>}
        {isDone && !isCurrentRound && <span className="mto-round-badge mto-rb-done">✓</span>}
      </div>
      <div className="mto-round-matches">
        {hasMatches ? (
          round.matches.map((match, mi) => (
            <MatchCard
              key={mi}
              match={match}
              bracket={bracket}
              userTeamId={userTeamId}
              expandedKey={expandedKey}
              setExpandedKey={setExpandedKey}
              cardKey={`${roundIdx}-${mi}`}
              isNextMatch={activeMatchKey === `${roundIdx}-${mi}`}
              schedule={schedule}
            />
          ))
        ) : (
          Array.from({ length: tbd ?? 1 }).map((_, i) => <TBDCard key={i} />)
        )}
      </div>
    </div>
  );
}

// Renders a horizontal set of round columns (reused by every bracket tab).
function RoundColumns({ rounds, bracket, curRound, userTeamId, expandedKey, setExpandedKey, schedule, activeMatchKey, empty }) {
  if (!rounds.length) return <div className="mto-tab-empty">{empty ?? "Nothing to show yet."}</div>;
  return (
    <div className="mto-bracket-rounds">
      {rounds.map(r => (
        <RoundSection
          key={r.idx}
          round={r}
          roundIdx={r.idx}
          bracket={bracket}
          isCurrentRound={r.idx === curRound}
          userTeamId={userTeamId}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
          tbd={r._tbd ?? _LEGACY_TBD[r.idx] ?? 1}
          schedule={schedule}
          activeMatchKey={activeMatchKey}
        />
      ))}
    </div>
  );
}

// ── Champion celebration screen ───────────────────────────────────────────────
function ChampionScreen({ major, dispatch, schedule, userTeamId, enteredIdx, hasPendingAwards = false }) {
  const bracket  = major.bracket;
  const champId  = bracket?.champion;
  const champTeam = getTeamMeta(champId, schedule);
  const isDE     = bracket?.type === "DE" || bracket?.type === "DE16";
  const gfRound  = isDE ? bracket?.rounds?.find(r => r.type === "GF") : bracket?.rounds?.[2];
  const gfResult = gfRound?.matches?.[0]?.result;
  const userIsChamp = champId === userTeamId;

  return (
    <div className="mto-champion-screen">
      <div
        className="mto-champ-glow"
        style={{ background: `radial-gradient(ellipse 600px 400px at 50% 40%, ${champTeam?.color ?? "#4f8ef7"}1a 0%, transparent 70%)` }}
      />
      <div className="mto-champ-content">
        <div className="mto-champ-trophy">🏆</div>
        <div className="mto-champ-event-label">{major.name.toUpperCase()} — COMPLETE</div>
        <div className="mto-champ-name" style={{ color: champTeam?.color ?? "var(--text-head)" }}>
          {champTeam?.name ?? champId}
          {userIsChamp && <span className="you-badge" style={{ marginLeft: 10 }}>YOUR TEAM</span>}
        </div>
        <div className="mto-champ-subtitle">{major.name === "Champs" ? "Season Champions" : isDE ? "Major Champion" : "Season Champions"}</div>
        {gfResult && (
          <div className="mto-champ-result">
            <span className="mto-champ-res-side mto-champ-res-winner" style={{ color: teamColor(gfResult.winnerId, schedule) }}>
              {teamTag(gfResult.winnerId, schedule)}
            </span>
            <span className="mto-champ-res-score">{gfResult.score}</span>
            <span className="mto-champ-res-side" style={{ color: teamColor(gfResult.loserId, schedule) }}>
              {teamTag(gfResult.loserId, schedule)}
            </span>
          </div>
        )}
        {gfResult?.standoutName && gfResult.standoutKD > 0 && (
          <div className="mto-champ-mvp">
            ★ <strong>{gfResult.standoutName}</strong>
            <span className="mto-champ-mvp-kd"> {gfResult.standoutKD.toFixed(2)} K/D · Finals MVP</span>
          </div>
        )}

        {/* Final placements summary */}
        <div className="mto-champ-placements">
          <PlacementsPanel major={major} enteredIdx={enteredIdx} userTeamId={userTeamId} schedule={schedule} />
        </div>

        <button className="mto-return-btn" onClick={() => dispatch({ type: "DISMISS_MAJOR" })}>
          {hasPendingAwards ? "Continue to Season Awards →" : "Return to Season →"}
        </button>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function MajorTournamentOverlay() {
  const { state, dispatch } = useGame();
  const { openMatchCenter } = useMatchCenter();
  const [expandedKey, setExpandedKey] = useState(null);
  const [tab, setTab] = useState("overview");

  if (!state) return null;

  const { schedule, userTeamId } = state;
  const enteredIdx  = state.enteredMajorIdx;
  if (enteredIdx == null) return null;

  const isMajorPhase   = schedule.phase === "major";
  const activeMajorIdx = isMajorPhase ? (schedule.majorIdx ?? null) : null;
  const isEntered      = activeMajorIdx !== null && enteredIdx === activeMajorIdx;

  const showLive     = isEntered && isMajorPhase;
  const enteredMajor = schedule.majors?.[enteredIdx];
  // The completion popup shows whenever the entered event is finished and we are
  // not still playing it live. This must NOT be gated on `!isMajorPhase`: after
  // Champs (major idx 4) the engine immediately starts ESWC, flipping the phase
  // back to "major" for idx 5 — the old `!isMajorPhase` test then hid the Champs
  // champion screen entirely. Gating on `!showLive` instead keeps the popup
  // priority for Champs (and Major 4, whose phase becomes challengerQualifier)
  // while never firing during live play (a major is never `completed` mid-play).
  const showChampion = !!enteredMajor?.completed && !showLive;

  if (!showLive && !showChampion) return null;

  if (showChampion) {
    if (!enteredMajor?.bracket) {
      return (
        <div className="mto-backdrop mto-backdrop-champ">
          <div className="mto-champion-screen" style={{ padding: 32 }}>
            <h2 style={{ color: "var(--text-head)" }}>Event complete</h2>
            <button className="mto-return-btn" onClick={() => dispatch({ type: "DISMISS_MAJOR" })}>
              Return to Season →
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="mto-backdrop mto-backdrop-champ">
        <ChampionScreen major={enteredMajor} dispatch={dispatch} schedule={schedule} userTeamId={userTeamId} enteredIdx={enteredIdx} hasPendingAwards={!!state.pendingSeasonAwards} />
      </div>
    );
  }

  const major   = schedule.majors?.[activeMajorIdx];
  const bracket = major?.bracket;

  if (!bracket || !Array.isArray(bracket.rounds) || !bracket.rounds.length) {
    return (
      <div className="mto-backdrop">
        <div className="mto-scroll-area">
          <div className="mto-content" style={{ padding: 32 }}>
            <h2 style={{ color: "var(--text-head)", marginTop: 0 }}>
              {major?.name ?? "Tournament"} bracket unavailable
            </h2>
            <p style={{ color: "var(--text-dim)" }}>
              The bracket for this event hasn't been generated yet, or its data
              is incomplete. This usually means a phase transition didn't
              finish cleanly.
            </p>
            <button className="btn-secondary" onClick={() => dispatch({ type: "DISMISS_MAJOR" })}>
              Return to Season
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isDE      = bracket.type === "DE" || bracket.type === "DE16";
  const curRound  = currentRoundIdx(bracket);
  const roundName = curRound >= 0 ? bracket.rounds[curRound]?.name : null;
  const elimination = getUserElimination(bracket, userTeamId);
  const alive     = teamsAlive(bracket);

  // ── User-centric derivations ──
  const record    = getUserRecord(bracket, userTeamId);
  const path      = getUserPath(bracket, userTeamId);
  const latest    = getLatestResults(bracket, 8);
  const placements = getMajorPlacementMap(major);
  const userPlace = placements[userTeamId] ?? null;
  const userPlaceLabel = userPlace != null ? placementText(userPlace) : null;
  const isChamp   = bracket.champion === userTeamId;
  const userStatus = isChamp ? "Champion" : elimination ? "Eliminated" : "Alive";
  const side      = isChamp ? "Champion" : elimination ? "Eliminated" : (record.l === 0 ? "Winners" : "Losers");
  const isRegularMajor = enteredIdx >= 0 && enteredIdx <= 3;
  const userPoints = (isRegularMajor && userPlace != null) ? (MAJOR_PLACEMENT_POINTS[userPlace] ?? 0) : null;

  const finishLabel = userStatus === "Alive"
    ? "Champion possible"
    : (userPlaceLabel ?? "—");

  // Next match info
  const nextMatch = curRound >= 0 ? bracket.rounds[curRound]?.matches.find(m => !m.played) : null;
  const nextMatchIdx = nextMatch ? bracket.rounds[curRound].matches.indexOf(nextMatch) : -1;
  const activeMatchKey = nextMatch ? `${curRound}-${nextMatchIdx}` : null;
  const userInNext = nextMatch ? (nextMatch.a === userTeamId || nextMatch.b === userTeamId) : false;
  const nextUserOpp = path.find(l => !l.played)?.oppId ?? null;
  const latestUserLeg = [...path].reverse().find(l => l.played && !l.won);
  const latestUserLine = latestUserLeg ? `Lost ${latestUserLeg.score} vs ${teamTag(latestUserLeg.oppId, schedule)}` : null;

  function handlePlayMatch() {
    if (!isUserRosterPlayable(state)) dispatch({ type: "SHOW_ROSTER_INCOMPLETE" });
    else openMatchCenter("major");
  }

  // Aside "Details" jumps to the Results tab (where every played card lives)
  // and expands the chosen series so SeriesDetail is actually on screen.
  function handleAsideDetails(key) {
    setTab("results");
    setExpandedKey(key);
  }

  // ── Tabs ──
  const indexedRounds = bracket.rounds.map((r, i) => ({ ...r, idx: i }));
  const wbRounds = indexedRounds.filter(r => r.type === "WB");
  const lbRounds = indexedRounds.filter(r => r.type === "LB" || r.type === "GF");

  const tabs = isDE
    ? [["overview", "Overview"], ["winners", "Winners"], ["losers", "Losers"], ["results", "Results"], ["placements", "Placements"]]
    : [["overview", "Overview"], ["bracket", "Bracket"], ["results", "Results"], ["placements", "Placements"]];
  const activeTab = tabs.some(([id]) => id === tab) ? tab : "overview";

  // Overview = current round + most recent completed round (compact "what's live now").
  const overviewRounds = (() => {
    const out = [];
    if (curRound >= 0) out.push(indexedRounds[curRound]);
    const prevPlayed = indexedRounds
      .filter(r => r.idx < (curRound < 0 ? indexedRounds.length : curRound) && r.matches.length && r.matches.every(m => m.played));
    if (prevPlayed.length) out.unshift(prevPlayed[prevPlayed.length - 1]);
    if (curRound < 0) {
      // Event finished but not dismissed — show the last couple of rounds.
      return indexedRounds.filter(r => r.matches.length).slice(-2);
    }
    return out;
  })();

  const resultsRounds = indexedRounds.filter(r => r.matches.some(m => m.played));

  return (
    <div className="mto-backdrop mto-redesign">
      <CommandHeader
        major={major}
        roundName={roundName}
        alive={alive}
        userStatus={userStatus}
        record={record}
        finishLabel={finishLabel}
        nextUserOpp={nextUserOpp}
        latestUserLine={latestUserLine}
        userTeamId={userTeamId}
        schedule={schedule}
        curRound={curRound}
        userInNext={userInNext}
        dispatch={dispatch}
        onPlayMatch={handlePlayMatch}
      />

      <div className="mto-scroll-area">
        <div className="mto-layout">
          {/* ── Main bracket area ── */}
          <main className="mto-main">
            <div className="mto-tabs">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  className={`mto-tab ${activeTab === id ? "mto-tab-active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mto-tab-body">
              {activeTab === "overview" && (
                <RoundColumns rounds={overviewRounds.filter(Boolean)} bracket={bracket} curRound={curRound}
                  userTeamId={userTeamId} expandedKey={expandedKey} setExpandedKey={setExpandedKey}
                  schedule={schedule} activeMatchKey={activeMatchKey} empty="Event hasn't started yet." />
              )}
              {activeTab === "winners" && (
                <RoundColumns rounds={wbRounds} bracket={bracket} curRound={curRound}
                  userTeamId={userTeamId} expandedKey={expandedKey} setExpandedKey={setExpandedKey}
                  schedule={schedule} activeMatchKey={activeMatchKey} empty="No winners-bracket rounds." />
              )}
              {activeTab === "losers" && (
                <RoundColumns rounds={lbRounds} bracket={bracket} curRound={curRound}
                  userTeamId={userTeamId} expandedKey={expandedKey} setExpandedKey={setExpandedKey}
                  schedule={schedule} activeMatchKey={activeMatchKey} empty="No losers-bracket rounds yet." />
              )}
              {activeTab === "bracket" && (
                <RoundColumns rounds={indexedRounds} bracket={bracket} curRound={curRound}
                  userTeamId={userTeamId} expandedKey={expandedKey} setExpandedKey={setExpandedKey}
                  schedule={schedule} activeMatchKey={activeMatchKey} />
              )}
              {activeTab === "results" && (
                <RoundColumns rounds={resultsRounds} bracket={bracket} curRound={curRound}
                  userTeamId={userTeamId} expandedKey={expandedKey} setExpandedKey={setExpandedKey}
                  schedule={schedule} activeMatchKey={activeMatchKey} empty="No results yet." />
              )}
              {activeTab === "placements" && (
                <PlacementsPanel major={major} enteredIdx={enteredIdx} userTeamId={userTeamId} schedule={schedule} />
              )}
            </div>
          </main>

          {/* ── Sticky event summary aside ── */}
          <aside className="mto-aside">
            <MyTeamPanel userTeamId={userTeamId} schedule={schedule} bracket={bracket}
              userStatus={userStatus} record={record} side={side} finishLabel={finishLabel} points={userPoints} />
            <CurrentMatchPanel bracket={bracket} curRound={curRound} userTeamId={userTeamId}
              schedule={schedule} onPlayMatch={handlePlayMatch} dispatch={dispatch} />
            <MyTeamPath path={path} schedule={schedule} userPlaceLabel={userPlaceLabel} userStatus={userStatus} />
            <LatestResults results={latest} userTeamId={userTeamId} schedule={schedule} onDetails={handleAsideDetails} />
            <PlacementsPanel major={major} enteredIdx={enteredIdx} userTeamId={userTeamId} schedule={schedule} compact />
          </aside>
        </div>
      </div>
    </div>
  );
}
