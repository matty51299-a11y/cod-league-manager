// src/components/MatchLog.jsx
// Full season match log as expandable cards.

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import SeriesDetail from "./SeriesDetail.jsx";

function color(id) { return CDL_TEAMS.find(t => t.id === id)?.color ?? "#aaa"; }

export default function MatchLog() {
  const { state } = useGame();
  const [expanded, setExpanded] = useState(null);

  if (!state) return null;

  const log = [...(state.schedule.matchLog || [])].reverse();

  function toggle(i) {
    setExpanded(prev => (prev === i ? null : i));
  }

  return (
    <div className="matchlog-page">
      <h2>Match Log</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        Season {state.season} · {log.length} match{log.length !== 1 ? "es" : ""} played
      </p>

      {log.length === 0 ? (
        <p className="muted">No matches played yet. Simulate a matchday to see results here.</p>
      ) : (
        <div className="ml-list">
          {log.map((r, i) => {
            const isUser  = r.winnerId === state.userTeamId || r.loserId === state.userTeamId;
            const userWon = r.winnerId === state.userTeamId;
            const isOpen  = expanded === i;
            const maps    = r.mapResults?.map(m => m.short) ?? [];

            return (
              <div
                key={i}
                className={`ml-card ${isUser ? (userWon ? "ml-user-win" : "ml-user-loss") : ""}`}
              >
                {/* ── Card header ── */}
                <div className="ml-header" onClick={() => toggle(i)}>

                  {/* Left: match number + stage */}
                  <div className="ml-meta">
                    <span className="ml-num">#{log.length - i}</span>
                    <span className="ml-stage">{r.stage}</span>
                  </div>

                  {/* Centre: teams + score */}
                  <div className="ml-matchup">
                    <span className="ml-team-name" style={{ color: color(r.winnerId) }}>
                      {r.winnerName}
                    </span>
                    <span className="ml-score">{r.score}</span>
                    <span className="ml-team-name ml-loser-name" style={{ color: color(r.loserId) }}>
                      {r.loserName}
                    </span>
                  </div>

                  {/* Right: standout + maps + expand */}
                  <div className="ml-right">
                    <div className="ml-details-row">
                      {r.standoutName && (
                        <span className="ml-standout">
                          ⭐ {r.standoutName}
                          {r.standoutKD > 0 && (
                            <span className="ml-standout-kd"> {r.standoutKD.toFixed(2)} K/D</span>
                          )}
                        </span>
                      )}
                      {maps.length > 0 && (
                        <span className="ml-maps">
                          {maps.map((m, mi) => (
                            <span key={mi} className="map-chip">{m}</span>
                          ))}
                        </span>
                      )}
                    </div>
                    <button
                      className="ml-expand-btn"
                      onClick={e => { e.stopPropagation(); toggle(i); }}
                    >
                      {isOpen ? "Hide ▲" : "Details ▼"}
                    </button>
                  </div>

                </div>

                {/* ── Expanded series detail ── */}
                {isOpen && <SeriesDetail result={r} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
