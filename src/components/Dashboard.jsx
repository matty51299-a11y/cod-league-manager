// src/components/Dashboard.jsx
// Main hub: season state hero, sim controls, recent results.

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import { calcChemistry, chemLabel } from "../engine/chemistry.js";
import SeriesDetail from "./SeriesDetail.jsx";

export default function Dashboard() {
  const { state, dispatch } = useGame();
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!state) return null;

  const { schedule, userTeamId, season, players } = state;
  const team      = CDL_TEAMS.find(t => t.id === userTeamId);
  const myPlayers = players.filter(p => p.teamId === userTeamId);
  const chem      = calcChemistry(myPlayers);

  const standings  = schedule.standings ?? {};
  const myStanding = standings[userTeamId] ?? { wins: 0, losses: 0, points: 0 };

  const phase     = schedule.phase;
  const stageIdx  = schedule.currentStage ?? 0;
  const stageName = schedule.stages?.[stageIdx]?.name ?? "Stage";
  const majorName = schedule.majors?.[stageIdx]?.name ?? "Major";

  const currentStage = schedule.stages?.[stageIdx];
  const remaining    = currentStage ? currentStage.matches.filter(m => !m.played).length : 0;

  // Next unplayed match involving the user's team (stage mode only)
  const nextMyMatch = (phase === "stage" && currentStage)
    ? currentStage.matches.find(m => !m.played && (m.a === userTeamId || m.b === userTeamId))
    : null;
  const nextOppId  = nextMyMatch ? (nextMyMatch.a === userTeamId ? nextMyMatch.b : nextMyMatch.a) : null;
  const nextOpp    = nextOppId ? CDL_TEAMS.find(t => t.id === nextOppId) : null;

  // User's league rank
  const sortedStandings = Object.entries(standings).sort((a, b) => b[1].points - a[1].points);
  const myRank = sortedStandings.findIndex(([id]) => id === userTeamId) + 1;

  // Last 5 results for the user's team
  const myLog = [...(schedule.matchLog || [])]
    .reverse()
    .filter(r => r.winnerId === userTeamId || r.loserId === userTeamId)
    .slice(0, 5);

  const isOffseason = phase === "offseason";
  const isMajor     = phase === "major";
  const isStage     = phase === "stage";

  // Phase descriptor for the hero badge
  const phaseBadge = isStage ? stageName : isMajor ? majorName : "Offseason";
  const starters   = myPlayers.filter(p => !p.isSub);

  function toggleRow(i) {
    setExpandedIdx(prev => (prev === i ? null : i));
  }

  return (
    <div className="dashboard">

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div className="db-hero" style={{ borderLeftColor: team?.color ?? "var(--accent)" }}>
        <div className="db-hero-left">
          <div className="db-hero-eyebrow">
            <span className="db-phase-chip">{phaseBadge}</span>
            <span className="db-season-tag">Season {season}</span>
          </div>

          <h2 className="db-team-name" style={{ color: team?.color ?? "#fff" }}>
            {team?.name ?? userTeamId}
          </h2>

          <div className="db-hero-stats">
            <div className="db-hs">
              <span className="db-hs-val">{myStanding.wins}–{myStanding.losses}</span>
              <span className="db-hs-lbl">Record</span>
            </div>
            <div className="db-hs-div" />
            <div className="db-hs">
              <span className="db-hs-val">{myStanding.points}</span>
              <span className="db-hs-lbl">Points</span>
            </div>
            {myRank > 0 && (
              <>
                <div className="db-hs-div" />
                <div className="db-hs">
                  <span className="db-hs-val">#{myRank}</span>
                  <span className="db-hs-lbl">Rank</span>
                </div>
              </>
            )}
            <div className="db-hs-div" />
            <div className="db-hs">
              <span className="db-hs-val">{chem}</span>
              <span className="db-hs-lbl">Chem ({chemLabel(chem)})</span>
            </div>
          </div>
        </div>

        <div className="db-hero-right">
          {isStage && (
            <div className="db-action-col">
              {nextOpp ? (
                <div className="db-next-hint">
                  Next: <span style={{ color: nextOpp.color, fontWeight: 600 }}>{nextOpp.name}</span>
                </div>
              ) : (
                <div className="db-next-hint muted">All matches played</div>
              )}
              <button
                className="btn-primary db-main-btn"
                onClick={() => { dispatch({ type: "SIM_MATCHDAY" }); setExpandedIdx(null); }}
              >
                Simulate Matchday
                <span className="db-badge-count">{remaining}</span>
              </button>
              <button
                className="btn-secondary db-sub-btn"
                onClick={() => { dispatch({ type: "SIM_STAGE" }); setExpandedIdx(null); }}
              >
                Sim Rest of {stageName}
              </button>
            </div>
          )}

          {isMajor && (
            <div className="db-action-col">
              <div className="db-major-live-row">
                <span className="db-live-pip" />
                <span className="db-live-label">{majorName} — Live</span>
              </div>
              <div className="db-next-hint">
                Use the <strong>Major</strong> tab to simulate
              </div>
            </div>
          )}

          {isOffseason && (
            <div className="db-action-col">
              <div className="db-next-hint muted">Season {season} complete</div>
              <button className="btn-accent db-main-btn" onClick={() => dispatch({ type: "ADVANCE_OFFSEASON" })}>
                Start Season {season + 1}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Champion pills ──────────────────────────────────────────── */}
      {schedule.majors?.some(m => m.completed && m.bracket?.champion) && (
        <div className="db-champ-row">
          {schedule.majors.map((major, i) => {
            if (!major.completed || !major.bracket?.champion) return null;
            const champ = CDL_TEAMS.find(t => t.id === major.bracket.champion);
            const isMe  = major.bracket.champion === userTeamId;
            return (
              <div
                key={i}
                className={`db-champ-pill ${isMe ? "db-champ-me" : ""}`}
                style={{ borderColor: champ?.color ?? "var(--border)" }}
              >
                🏆{" "}
                <span style={{ color: champ?.color, fontWeight: 700 }}>
                  {champ?.name ?? major.bracket.champion}
                </span>
                <span className="muted"> · {major.name}</span>
                {isMe && <span className="db-you-badge">YOU</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Recent Results ──────────────────────────────────────────── */}
      <div className="section">
        <h3>Recent Results</h3>

        {myLog.length === 0 ? (
          <p className="muted">No matches played yet.</p>
        ) : (
          <div className="db-results">
            {myLog.map((r, i) => {
              const won     = r.winnerId === userTeamId;
              const oppId   = won ? r.loserId : r.winnerId;
              const oppTeam = CDL_TEAMS.find(t => t.id === oppId);
              const isOpen  = expandedIdx === i;
              const maps    = r.mapResults?.map(m => m.short) ?? [];

              return (
                <div
                  key={i}
                  className={`db-result ${won ? "db-result-win" : "db-result-loss"} ${isOpen ? "db-result-open" : ""}`}
                  onClick={() => toggleRow(i)}
                >
                  <div className="db-result-row">
                    <div className={`db-result-wl ${won ? "wl-win" : "wl-loss"}`}>
                      {won ? "W" : "L"}
                    </div>

                    <div className="db-result-body">
                      <div className="db-result-top">
                        <span className="db-result-score">{r.score}</span>
                        <span className="db-result-vs">vs</span>
                        <span className="db-result-opp" style={{ color: oppTeam?.color }}>
                          {oppTeam?.name ?? oppId}
                        </span>
                      </div>
                      <div className="db-result-bottom">
                        <span className="muted">{r.stage}</span>
                        {r.standoutName && (
                          <>
                            <span className="db-sub-dot">·</span>
                            <span className="db-standout-line">
                              ⭐ {r.standoutName}
                              {r.standoutKD > 0 && (
                                <span className="db-standout-kd"> {r.standoutKD.toFixed(2)} K/D</span>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {maps.length > 0 && (
                      <div className="db-result-maps">
                        {maps.map((m, mi) => <span key={mi} className="map-chip">{m}</span>)}
                      </div>
                    )}

                    <span className="db-result-chevron">{isOpen ? "▲" : "▼"}</span>
                  </div>

                  {isOpen && (
                    <div onClick={e => e.stopPropagation()}>
                      <SeriesDetail result={r} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
