// src/components/MajorBracket.jsx
// Major / Championship bracket screen.
//
// Three modes based on state:
//   1. INTRO    – bracket freshly seeded, no matches played, isActive
//                 → full-page "tournament start" screen with seedings + QF preview
//   2. LIVE     – matches in progress, isActive
//                 → tournament hero (name + next match + sim controls) + bracket
//   3. ARCHIVE  – major is completed or not yet active
//                 → tournament hero (champion + summary) + bracket

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

// ── Tournament hero ────────────────────────────────────────────────────────────
// Replaces the old EventBanner + NextMatchCard + TournamentControls.
// Shows event identity, status, and action — all in one hero card.
function TournamentHero({ major, bracket, curRound, roundName, userTeamId, isActive, dispatch }) {
  const isComplete = major.completed;
  const champTeam  = bracket.champion ? CDL_TEAMS.find(t => t.id === bracket.champion) : null;

  // Walk all rounds forward to find user's finish
  let userFinish = null;
  if (userTeamId) {
    for (let r = 0; r < bracket.rounds.length; r++) {
      const rnd = bracket.rounds[r];
      for (const m of rnd.matches) {
        if (!m.played) continue;
        if (m.result?.loserId === userTeamId) {
          userFinish = rnd.name;
        } else if (m.result?.winnerId === userTeamId && r === bracket.rounds.length - 1) {
          userFinish = "Champion 🏆";
        }
      }
    }
  }

  // Grand Final match
  const gfRound = bracket.rounds[bracket.rounds.length - 1];
  const gfMatch = gfRound?.matches[0];

  // Find standout from GF (top kills)
  let gfStandout = null;
  if (isComplete && gfMatch?.played && gfMatch.result?.playerStats) {
    const stats = Object.values(gfMatch.result.playerStats);
    if (stats.length > 0) {
      gfStandout = [...stats].sort((a, b) => b.kills - a.kills)[0];
    }
  }

  // Next unplayed match
  let nextMatch = null, nextRound = null;
  if (!isComplete && curRound >= 0) {
    nextRound = bracket.rounds[curRound];
    nextMatch = nextRound?.matches.find(m => !m.played);
  }
  const userInNext = nextMatch && (nextMatch.a === userTeamId || nextMatch.b === userTeamId);

  return (
    <div className={`t-hero ${isComplete ? "t-hero-done" : "t-hero-live"}`}
         style={champTeam ? { borderTopColor: champTeam.color } : {}}>

      {/* Status row */}
      <div className="t-status-row">
        {isComplete ? (
          <span className="t-status-chip t-status-chip-done">✓ COMPLETE</span>
        ) : (
          <span className="t-status-chip t-status-chip-live">
            <span className="t-live-pip" />LIVE
          </span>
        )}
        <span className="t-hero-name">{major.name.toUpperCase()}</span>
        {!isComplete && roundName && (
          <span className="t-hero-round-badge">{roundName}</span>
        )}
      </div>

      {/* Main content */}
      <div className="t-hero-content">

        {/* Feature — champion (done) or next match (live) */}
        <div className="t-hero-feature">
          {isComplete && champTeam && (
            <div className="t-champ-block">
              <div className="t-champ-trophy">🏆</div>
              <div>
                <div className="t-champ-label">CHAMPION</div>
                <div className="t-champ-name" style={{ color: champTeam.color }}>{champTeam.name}</div>
                {gfMatch?.played && gfMatch.result?.score && (
                  <div className="t-champ-score">Grand Final · {gfMatch.result.score}</div>
                )}
              </div>
            </div>
          )}

          {!isComplete && nextMatch && (
            <div className={`t-next-block ${userInNext ? "t-next-user" : ""}`}>
              <div className="t-next-label">NEXT MATCH · {nextRound?.name.toUpperCase()}</div>
              <div className="t-next-matchup">
                <span className="t-next-tag" style={{ color: teamColor(nextMatch.a) }}>
                  {teamTag(nextMatch.a)}
                </span>
                {nextMatch.a === userTeamId && <span className="t-you-pill">YOUR TEAM</span>}
                <span className="t-next-vs">vs</span>
                <span className="t-next-tag" style={{ color: teamColor(nextMatch.b) }}>
                  {teamTag(nextMatch.b)}
                </span>
                {nextMatch.b === userTeamId && <span className="t-you-pill">YOUR TEAM</span>}
              </div>
            </div>
          )}

          {!isComplete && !nextMatch && (
            <div className="t-hero-idle muted">All matches in progress — sim to continue.</div>
          )}
        </div>

        {/* Aside — sim controls (live) or event summary (done) */}
        <div className="t-hero-aside">
          {isActive && !isComplete && (
            <div className="t-sim-controls">
              <button className="btn-primary t-sim-primary" onClick={() => dispatch({ type: "SIM_NEXT_MAJOR_MATCH" })}>
                ▶ Sim Next Match
              </button>
              <button className="btn-secondary t-sim-secondary" onClick={() => dispatch({ type: "SIM_MAJOR_ROUND" })}>
                ▶▶ Sim {roundName ?? "Round"}
              </button>
              <button className="btn-secondary t-sim-secondary" onClick={() => dispatch({ type: "SIM_MAJOR" })}>
                ▶▶▶ Sim Entire Major
              </button>
            </div>
          )}

          {isComplete && (
            <div className="t-event-summary">
              {userFinish && (
                <div className="t-summary-item">
                  <span className="t-summary-label">YOUR FINISH</span>
                  <span className="t-summary-val">{userFinish}</span>
                </div>
              )}
              {gfStandout && (
                <div className="t-summary-item">
                  <span className="t-summary-label">FINAL MVP</span>
                  <span className="t-summary-val">
                    {gfStandout.name}
                    <span className="t-summary-sub"> · {gfStandout.kills}K/{gfStandout.deaths}D</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Grand Final Card ───────────────────────────────────────────────────────────
// A wide, prominent card used only for the last round's match.
function GrandFinalCard({ match, bracket, userTeamId, expandedKey, setExpandedKey }) {
  const isPlayed    = match.played;
  const result      = match.result;
  const userInvolved= match.a === userTeamId || match.b === userTeamId;
  const userWon     = isPlayed && result?.winnerId === userTeamId && userInvolved;
  const userLost    = isPlayed && result?.loserId  === userTeamId && userInvolved;
  const scoreA      = isPlayed ? (result.teamAId === match.a ? result.winsA : result.winsB) : null;
  const scoreB      = isPlayed ? (result.teamAId === match.a ? result.winsB : result.winsA) : null;
  const winnerTeam  = isPlayed ? CDL_TEAMS.find(t => t.id === result.winnerId) : null;
  const isOpen      = expandedKey === "gf-0";

  function toggle(e) {
    e.stopPropagation();
    setExpandedKey(prev => prev === "gf-0" ? null : "gf-0");
  }

  return (
    <div className={`gf-card ${userWon ? "gf-user-win" : userLost ? "gf-user-loss" : ""}`}
         style={winnerTeam ? { borderTopColor: winnerTeam.color } : {}}>

      {/* Champion line */}
      {isPlayed && winnerTeam && (
        <div className="gf-champion-line">
          <span className="gf-trophy">🏆</span>
          <span style={{ color: winnerTeam.color, fontWeight: 700 }}>{winnerTeam.name}</span>
          <span className="gf-champ-sublabel"> — Grand Final Champion</span>
        </div>
      )}

      {/* Main matchup */}
      <div className="gf-matchup">
        {/* Team A */}
        <div className={`gf-side ${isPlayed ? (result?.winnerId === match.a ? "gf-side-win" : "gf-side-loss") : ""}`}>
          {match.a === userTeamId && <span className="gf-you-pill">YOU</span>}
          <span className="gf-team-tag" style={{ color: teamColor(match.a) }}>{teamTag(match.a)}</span>
          <span className="gf-team-full-name">{teamName(match.a)}</span>
          {isPlayed && (
            <span className={`gf-score ${result?.winnerId === match.a ? "gf-score-win" : "gf-score-loss"}`}>
              {scoreA}
            </span>
          )}
        </div>

        <div className="gf-vs-block">
          {isPlayed
            ? <span className="gf-vs-done">FINAL</span>
            : <span className="gf-vs">vs</span>
          }
        </div>

        {/* Team B */}
        <div className={`gf-side gf-side-right ${isPlayed ? (result?.winnerId === match.b ? "gf-side-win" : "gf-side-loss") : ""}`}>
          {isPlayed && (
            <span className={`gf-score ${result?.winnerId === match.b ? "gf-score-win" : "gf-score-loss"}`}>
              {scoreB}
            </span>
          )}
          <span className="gf-team-full-name">{teamName(match.b)}</span>
          <span className="gf-team-tag" style={{ color: teamColor(match.b) }}>{teamTag(match.b)}</span>
          {match.b === userTeamId && <span className="gf-you-pill">YOU</span>}
        </div>
      </div>

      {!isPlayed && (
        <div className="gf-tbd">Finalists to be determined</div>
      )}

      {isPlayed && (
        <button className="gf-series-btn" onClick={toggle}>
          {isOpen ? "▲ Hide Series Details" : "▼ View Series Details"}
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

// ── Regular match card ─────────────────────────────────────────────────────────
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
    <div className={`bracket-card ${userWon ? "bc-user-win" : userLost ? "bc-user-loss" : ""} ${userInvolved ? "bc-user-match" : ""}`}>
      <div className={`bc-team ${isPlayed ? (result?.winnerId === match.a ? "bc-winner" : "bc-loser") : ""}`}>
        {seedA && <span className="bc-seed">{seedA}</span>}
        <span className="bc-name" style={{ color: teamColor(match.a) }}>{teamTag(match.a)}</span>
        {match.a === userTeamId && <span className="bc-you">YOU</span>}
        {isPlayed && (
          <span className={`bc-score ${result?.winnerId === match.a ? "bc-score-win" : "bc-score-loss"}`}>
            {scoreA}
          </span>
        )}
      </div>
      <div className={`bc-team ${isPlayed ? (result?.winnerId === match.b ? "bc-winner" : "bc-loser") : ""}`}>
        {seedB && <span className="bc-seed">{seedB}</span>}
        <span className="bc-name" style={{ color: teamColor(match.b) }}>{teamTag(match.b)}</span>
        {match.b === userTeamId && <span className="bc-you">YOU</span>}
        {isPlayed && (
          <span className={`bc-score ${result?.winnerId === match.b ? "bc-score-win" : "bc-score-loss"}`}>
            {scoreB}
          </span>
        )}
      </div>
      {isPlayed && (
        <button className="bc-details-btn" onClick={toggle}>
          {isOpen ? "▲ Hide Details" : "▼ Series Details"}
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

// ── Round section ─────────────────────────────────────────────────────────────
function RoundSection({ round, bracket, isCurrentRound, userTeamId, expandedKey, setExpandedKey, roundIdx, isFinalRound }) {
  const hasMatches = round.matches.length > 0;
  const allPlayed  = hasMatches && round.matches.every(m => m.played);

  return (
    <div className={`bracket-round-section ${isCurrentRound ? "brs-active" : ""} ${isFinalRound ? "brs-final" : ""}`}>
      <div className="brs-header">
        <span className="brs-name">{round.name}</span>
        {isFinalRound && <span className="brs-badge brs-final-badge">GRAND FINAL</span>}
        {isCurrentRound && !isFinalRound && <span className="brs-badge">▶ In Progress</span>}
        {!isCurrentRound && allPlayed && !isFinalRound && <span className="brs-badge brs-done">✓ Complete</span>}
        {isFinalRound && allPlayed && <span className="brs-badge brs-done">✓ Complete</span>}
      </div>

      <div className={`brs-matches ${isFinalRound ? "brs-final-matches" : ""}`}>
        {hasMatches ? (
          isFinalRound ? (
            <GrandFinalCard
              match={round.matches[0]}
              bracket={bracket}
              userTeamId={userTeamId}
              expandedKey={expandedKey}
              setExpandedKey={setExpandedKey}
            />
          ) : (
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
          )
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

  const curRound  = currentRoundIdx(bracket);
  const roundName = curRound >= 0 ? bracket.rounds[curRound].name : null;

  // Show intro when: active major, no matches played yet, user hasn't dismissed
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

      {/* Tournament hero — event identity, status, action */}
      <TournamentHero
        major={major}
        bracket={bracket}
        curRound={curRound}
        roundName={roundName}
        userTeamId={userTeamId}
        isActive={isActive}
        dispatch={dispatch}
      />

      {/* Bracket section label */}
      <div className="bracket-section-header">
        <span className="bsh-title">BRACKET</span>
        <span className="bsh-divider" />
      </div>

      {/* Rounds — bracket is the centrepiece */}
      <div className="bracket-rounds">
        {bracket.rounds.map((round, ri) => (
          <RoundSection
            key={ri}
            round={round}
            roundIdx={ri}
            bracket={bracket}
            isCurrentRound={ri === curRound}
            isFinalRound={ri === bracket.rounds.length - 1}
            userTeamId={userTeamId}
            expandedKey={expandedKey}
            setExpandedKey={setExpandedKey}
          />
        ))}
      </div>

      {/* Seedings — reference info, pushed to footer */}
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

      {/* Page header */}
      <div className="major-page-header">
        <h2>Tournaments — Season {season}</h2>
        <p className="muted" style={{ marginTop: 2 }}>
          {isLive
            ? `${activeMajor?.name} is live`
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
