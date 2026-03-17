// src/components/MajorBracket.jsx
// Major / Championship bracket screen.
//
// Three modes based on state:
//   1. INTRO    – bracket freshly seeded, no matches played, isActive
//                 → full-page "tournament start" screen with seedings + QF preview
//   2. LIVE     – matches in progress, isActive
//                 → event banner + next-match spotlight + bracket
//   3. ARCHIVE  – major is completed or not yet active
//                 → normal view with champion / seedings / results

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import SeriesDetail from "./SeriesDetail.jsx";

function teamName(id) { return CDL_TEAMS.find(t => t.id === id)?.name  ?? id; }
function teamTag(id)  { return CDL_TEAMS.find(t => t.id === id)?.tag   ?? id; }
function teamColor(id){ return CDL_TEAMS.find(t => t.id === id)?.color ?? "#888"; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSeedNum(bracket, teamId, fallback) {
  if (fallback != null) return fallback;
  const idx = bracket.seeds?.indexOf(teamId) ?? -1;
  return idx >= 0 ? idx + 1 : null;
}

function currentRoundIdx(bracket) {
  if (!bracket) return -1;
  for (let r = 0; r < bracket.rounds.length; r++) {
    const rnd = bracket.rounds[r];
    if (rnd.matches.length > 0 && rnd.matches.some(m => !m.played)) return r;
  }
  return -1;
}

// ── Major Intro (tournament start screen) ─────────────────────────────────────
function MajorIntro({ major, schedule, userTeamId, onEnter }) {
  const bracket = major.bracket;
  if (!bracket) return null;

  return (
    <div className="major-intro">
      {/* Header */}
      <div className="mi-header">
        <span className="mi-live-badge">LIVE TOURNAMENT</span>
        <h1 className="mi-title">{major.name.toUpperCase()}</h1>
        <div className="mi-season">Season {schedule.season}</div>
      </div>

      <div className="mi-body">
        {/* Seedings */}
        <div className="mi-section">
          <div className="mi-section-label">QUALIFIED TEAMS</div>
          <div className="mi-seeds">
            {bracket.seeds.map((id, i) => {
              const rec    = schedule.standings[id] ?? { wins: 0, losses: 0, points: 0 };
              const isUser = id === userTeamId;
              return (
                <div key={id} className={`mi-seed-row ${isUser ? "mi-seed-user" : ""}`}>
                  <span className="mi-seed-num">{i + 1}</span>
                  <span className="mi-seed-dot" style={{ background: teamColor(id) }} />
                  <span className="mi-seed-name">{teamName(id)}</span>
                  <span className="mi-seed-rec">{rec.wins}W–{rec.losses}L</span>
                  <span className="mi-seed-pts">{rec.points} pts</span>
                  {isUser && <span className="mi-seed-you">YOU</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Quarterfinal matchups */}
        <div className="mi-section">
          <div className="mi-section-label">QUARTERFINAL MATCHUPS</div>
          <div className="mi-matchups">
            {bracket.rounds[0].matches.map((m, i) => {
              const userInvolved = m.a === userTeamId || m.b === userTeamId;
              return (
                <div key={i} className={`mi-matchup ${userInvolved ? "mi-matchup-user" : ""}`}>
                  <div className="mi-matchup-side">
                    <span className="mi-matchup-seed">#{m.seedA}</span>
                    <span className="mi-matchup-tag" style={{ color: teamColor(m.a) }}>
                      {teamTag(m.a)}
                    </span>
                    {m.a === userTeamId && <span className="mi-matchup-you">YOU</span>}
                  </div>
                  <span className="mi-matchup-vs">vs</span>
                  <div className="mi-matchup-side mi-matchup-side-b">
                    <span className="mi-matchup-seed">#{m.seedB}</span>
                    <span className="mi-matchup-tag" style={{ color: teamColor(m.b) }}>
                      {teamTag(m.b)}
                    </span>
                    {m.b === userTeamId && <span className="mi-matchup-you">YOU</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <button className="mi-enter-btn" onClick={onEnter}>
        Enter Tournament →
      </button>
    </div>
  );
}

// ── Event banner (shown when major is live) ───────────────────────────────────
function EventBanner({ major, roundName }) {
  return (
    <div className="major-event-banner">
      <div className="meb-top">
        <span className="meb-live-pip" />
        <span className="meb-live">LIVE</span>
        <span className="meb-name">{major.name.toUpperCase()}</span>
      </div>
      {roundName && (
        <div className="meb-round-line">{roundName}</div>
      )}
    </div>
  );
}

// ── Next match spotlight ──────────────────────────────────────────────────────
function NextMatchCard({ bracket, roundIdx, userTeamId }) {
  if (roundIdx < 0) return null;
  const round = bracket.rounds[roundIdx];
  const next  = round?.matches.find(m => !m.played);
  if (!next) return null;

  const seedA = getSeedNum(bracket, next.a, next.seedA);
  const seedB = getSeedNum(bracket, next.b, next.seedB);
  const userIn = next.a === userTeamId || next.b === userTeamId;

  return (
    <div className={`next-match-card ${userIn ? "nmc-user" : ""}`}>
      <div className="nmc-label">NEXT MATCH · {round.name.toUpperCase()}</div>
      <div className="nmc-matchup">
        <div className="nmc-team">
          {seedA && <span className="nmc-seed">#{seedA}</span>}
          <span className="nmc-tag" style={{ color: teamColor(next.a) }}>{teamTag(next.a)}</span>
          {next.a === userTeamId && <span className="nmc-you">YOUR TEAM</span>}
        </div>
        <span className="nmc-vs">vs</span>
        <div className="nmc-team nmc-team-b">
          {seedB && <span className="nmc-seed">#{seedB}</span>}
          <span className="nmc-tag" style={{ color: teamColor(next.b) }}>{teamTag(next.b)}</span>
          {next.b === userTeamId && <span className="nmc-you">YOUR TEAM</span>}
        </div>
      </div>
    </div>
  );
}

// ── Sim controls ──────────────────────────────────────────────────────────────
function TournamentControls({ dispatch, roundName }) {
  return (
    <div className="tournament-controls">
      <button className="btn-primary tc-btn" onClick={() => dispatch({ type: "SIM_NEXT_MAJOR_MATCH" })}>
        ▶ Sim Next Match
      </button>
      <button className="btn-secondary tc-btn" onClick={() => dispatch({ type: "SIM_MAJOR_ROUND" })}>
        ▶▶ Sim {roundName ?? "Round"}
      </button>
      <button className="btn-secondary tc-btn" onClick={() => dispatch({ type: "SIM_MAJOR" })}>
        ▶▶▶ Sim Entire Major
      </button>
    </div>
  );
}

// ── Seed list ─────────────────────────────────────────────────────────────────
function SeedList({ seeds, standings }) {
  return (
    <div className="seed-list">
      <div className="seed-list-title">Seedings</div>
      <div className="seed-rows">
        {seeds.map((id, i) => {
          const rec = standings[id] ?? { wins: 0, losses: 0, points: 0 };
          return (
            <div key={id} className="seed-row">
              <span className="seed-num">{i + 1}</span>
              <span className="seed-dot" style={{ background: teamColor(id) }} />
              <span className="seed-name">{teamName(id)}</span>
              <span className="seed-record muted">{rec.wins}W–{rec.losses}L</span>
              <span className="seed-pts">{rec.points} pts</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Single match card ─────────────────────────────────────────────────────────
function MatchCard({ match, bracket, userTeamId, expandedKey, setExpandedKey, cardKey }) {
  const isPlayed    = match.played;
  const result      = match.result;
  const seedA       = getSeedNum(bracket, match.a, match.seedA);
  const seedB       = getSeedNum(bracket, match.b, match.seedB);
  const userInvolved= match.a === userTeamId || match.b === userTeamId;
  const userWon     = isPlayed && result?.winnerId === userTeamId && userInvolved;
  const userLost    = isPlayed && result?.loserId  === userTeamId && userInvolved;
  const isOpen      = expandedKey === cardKey;
  const scoreA      = isPlayed ? (result.teamAId === match.a ? result.winsA : result.winsB) : null;
  const scoreB      = isPlayed ? (result.teamAId === match.a ? result.winsB : result.winsA) : null;

  function toggle(e) {
    e.stopPropagation();
    setExpandedKey(prev => prev === cardKey ? null : cardKey);
  }

  return (
    <div className={`bracket-card ${userWon ? "bc-user-win" : userLost ? "bc-user-loss" : ""}`}>
      <div className={`bc-team ${isPlayed && result?.winnerId === match.a ? "bc-winner" : isPlayed ? "bc-loser" : ""}`}>
        {seedA && <span className="bc-seed">{seedA}</span>}
        <span className="bc-name" style={{ color: teamColor(match.a) }}>{teamTag(match.a)}</span>
        {isPlayed && (
          <span className={`bc-score ${result?.winnerId === match.a ? "bc-score-win" : "bc-score-loss"}`}>
            {scoreA}
          </span>
        )}
      </div>
      <div className={`bc-team ${isPlayed && result?.winnerId === match.b ? "bc-winner" : isPlayed ? "bc-loser" : ""}`}>
        {seedB && <span className="bc-seed">{seedB}</span>}
        <span className="bc-name" style={{ color: teamColor(match.b) }}>{teamTag(match.b)}</span>
        {isPlayed && (
          <span className={`bc-score ${result?.winnerId === match.b ? "bc-score-win" : "bc-score-loss"}`}>
            {scoreB}
          </span>
        )}
      </div>
      {isPlayed && (
        <button className="bc-details-btn" onClick={toggle}>
          {isOpen ? "Hide ▲" : "Details ▼"}
        </button>
      )}
      {isOpen && isPlayed && (
        <div className="bc-expansion">
          <SeriesDetail result={result} />
        </div>
      )}
    </div>
  );
}

function TBDCard() {
  return (
    <div className="bracket-card bc-tbd">
      <div className="bc-team"><span className="bc-seed">—</span><span className="bc-name muted">TBD</span></div>
      <div className="bc-team"><span className="bc-seed">—</span><span className="bc-name muted">TBD</span></div>
    </div>
  );
}

// ── One round section ─────────────────────────────────────────────────────────
function RoundSection({ round, bracket, isCurrentRound, userTeamId, expandedKey, setExpandedKey, roundIdx }) {
  const hasMatches = round.matches.length > 0;
  return (
    <div className={`bracket-round-section ${isCurrentRound ? "brs-active" : ""}`}>
      <div className="brs-header">
        <span className="brs-name">{round.name}</span>
        {isCurrentRound && <span className="brs-badge">▶ In Progress</span>}
        {!isCurrentRound && hasMatches && round.matches.every(m => m.played) && (
          <span className="brs-badge brs-done">✓ Complete</span>
        )}
      </div>
      <div className="brs-matches">
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
            />
          ))
        ) : (
          Array.from({ length: roundIdx === 1 ? 2 : 1 }).map((_, i) => (
            <TBDCard key={i} />
          ))
        )}
      </div>
    </div>
  );
}

// ── MajorView ─────────────────────────────────────────────────────────────────
function MajorView({ major, isActive, schedule, userTeamId, dispatch }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const [enteredMajor, setEnteredMajor] = useState(false);
  const bracket = major.bracket;

  if (!bracket) {
    return (
      <div className="bracket-empty">
        <p className="muted">This event hasn't started yet. Complete the preceding stage to seed the bracket.</p>
      </div>
    );
  }

  const curRound    = currentRoundIdx(bracket);
  const roundName   = curRound >= 0 ? bracket.rounds[curRound].name : null;
  const champTeam   = bracket.champion ? CDL_TEAMS.find(t => t.id === bracket.champion) : null;

  // Show intro when: active major, no matches played yet, user hasn't clicked "Enter"
  const noMatchesPlayed = bracket.rounds[0]?.matches.every(m => !m.played);
  if (isActive && !major.completed && noMatchesPlayed && !enteredMajor) {
    return (
      <MajorIntro
        major={major}
        schedule={schedule}
        userTeamId={userTeamId}
        onEnter={() => setEnteredMajor(true)}
      />
    );
  }

  return (
    <div className="major-view">
      {/* Event banner — only while live */}
      {isActive && !major.completed && (
        <EventBanner major={major} roundName={roundName} />
      )}

      {/* Next match spotlight — first thing you see in live mode */}
      {isActive && !major.completed && curRound >= 0 && (
        <NextMatchCard bracket={bracket} roundIdx={curRound} userTeamId={userTeamId} />
      )}

      {/* Sim controls — below spotlight */}
      {isActive && !major.completed && (
        <TournamentControls dispatch={dispatch} roundName={roundName} />
      )}

      {/* Champion banner */}
      {champTeam && (
        <div className="bracket-champion-banner" style={{ borderColor: champTeam.color }}>
          🏆 <strong style={{ color: champTeam.color }}>{champTeam.name}</strong> — {major.name} Champion
        </div>
      )}

      {/* Rounds — bracket is the centrepiece */}
      <div className="bracket-rounds">
        {bracket.rounds.map((round, ri) => (
          <RoundSection
            key={ri}
            round={round}
            roundIdx={ri}
            bracket={bracket}
            isCurrentRound={ri === curRound}
            userTeamId={userTeamId}
            expandedKey={expandedKey}
            setExpandedKey={setExpandedKey}
          />
        ))}
      </div>

      {/* Seedings — reference info, shown at bottom */}
      {bracket.seeds && (
        <div className="bracket-seeds-footer">
          <SeedList seeds={bracket.seeds} standings={schedule.standings} />
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function MajorBracket() {
  const { state, dispatch } = useGame();

  if (!state) return null;

  const { schedule, userTeamId, season } = state;
  const majors        = schedule.majors ?? [];
  const activeMajorIdx= schedule.phase === "major" ? schedule.currentStage : null;
  const [viewIdx, setViewIdx] = useState(activeMajorIdx ?? 0);
  const isLive        = schedule.phase === "major";
  const activeMajor   = activeMajorIdx !== null ? majors[activeMajorIdx] : null;

  return (
    <div className={`major-page ${isLive ? "major-page-live" : ""}`}>

      {/* Page header — condensed when live (event banner takes over) */}
      <div className="major-page-header">
        <h2>
          {isLive
            ? `Tournaments — Season ${season}`
            : `Tournaments — Season ${season}`}
        </h2>
        <p className="muted" style={{ marginTop: 2 }}>
          {isLive
            ? `${activeMajor?.name} is now live — bracket below`
            : schedule.phase === "stage"
            ? `Stage play in progress · ${majors.filter(m => m.completed).length} event(s) completed`
            : "Season complete"}
        </p>
      </div>

      {/* Tab strip */}
      <div className="major-tabs">
        {majors.map((major, i) => {
          const isActive   = i === activeMajorIdx;
          const isDone     = major.completed;
          const hasStarted = !!major.bracket;
          return (
            <button
              key={i}
              className={`major-tab ${viewIdx === i ? "mt-selected" : ""} ${isActive ? "mt-live" : ""}`}
              onClick={() => setViewIdx(i)}
            >
              {major.name}
              {isActive && <span className="mt-live-dot" />}
              {isDone && !isActive && <span className="mt-done"> ✓</span>}
              {!hasStarted && !isActive && <span className="muted"> –</span>}
            </button>
          );
        })}
      </div>

      {/* Selected major */}
      <MajorView
        major={majors[viewIdx]}
        majorIdx={viewIdx}
        isActive={viewIdx === activeMajorIdx}
        schedule={schedule}
        userTeamId={userTeamId}
        dispatch={dispatch}
      />
    </div>
  );
}
