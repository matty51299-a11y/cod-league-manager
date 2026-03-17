// src/components/SeriesDetail.jsx
// Shared component that renders the full breakdown of one simulated series.
// Used by both Dashboard (inline row expansion) and MatchLog (card expansion).
//
// A result object must contain:
//   mapResults   – array of per-map objects from matchSim
//   playerStats  – { [playerId]: { name, teamId, kills, deaths, kd } }
//   teamAId / teamAName / teamBId / teamBName
//   winnerId / winnerName / score

import { CDL_TEAMS } from "../data/teams.js";

function tag(id)   { return CDL_TEAMS.find(t => t.id === id)?.tag   ?? id; }
function color(id) { return CDL_TEAMS.find(t => t.id === id)?.color ?? "#aaa"; }

const MODE_STYLES = {
  "Hardpoint":         { bg: "rgba(255,152,0,0.15)",  color: "#ffa726", label: "HP"  },
  "Search & Destroy":  { bg: "rgba(239,83,80,0.15)",  color: "#ef5350", label: "S&D" },
  "Control":           { bg: "rgba(79,142,247,0.15)", color: "#4f8ef7", label: "CTL" },
};

function ModeBadge({ mode }) {
  const s = MODE_STYLES[mode];
  if (!s) return <span className="mode-badge mode-badge-default">{mode}</span>;
  return (
    <span className="mode-badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
  );
}

function kdColor(kd) {
  if (kd >= 1.4) return "#00e676";
  if (kd >= 1.1) return "#69f0ae";
  if (kd >= 0.9) return "#ffeb3b";
  if (kd >= 0.7) return "#ffa726";
  return "#ef5350";
}

// ── Player stats table for one team ──────────────────────────────────────────
function StatsTable({ label, stats, won }) {
  return (
    <div className="stats-team-block">
      <div className="stats-team-header" style={{ color: color(label.id) }}>
        {label.name}
        <span className={`result-badge ${won ? "win-badge" : "loss-badge"}`}>{won ? "W" : "L"}</span>
      </div>
      <table className="stats-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>K</th>
            <th>D</th>
            <th>K/D</th>
          </tr>
        </thead>
        <tbody>
          {stats.length === 0 ? (
            <tr><td colSpan={4} className="muted" style={{ padding: "6px 8px" }}>No stats recorded</td></tr>
          ) : (
            stats.map((s, i) => (
              <tr key={i}>
                <td className="player-name">{s.name}</td>
                <td>{s.kills}</td>
                <td>{s.deaths}</td>
                <td style={{ color: kdColor(s.kd), fontWeight: 600 }}>{
                  typeof s.kd === "number" ? s.kd.toFixed(2) : "—"
                }</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SeriesDetail({ result }) {
  if (!result) return null;

  const { mapResults, playerStats, teamAId, teamAName, teamBId, teamBName, winnerId, winnerName, score } = result;

  // Old saves (pre-map-sim update) won't have mapResults — show clear message.
  if (!mapResults || mapResults.length === 0) {
    return (
      <div className="series-detail">
        <p className="muted" style={{ fontSize: 12 }}>
          No map detail for this match — simulate new matches to see series breakdowns.
        </p>
      </div>
    );
  }

  // Split player stats by team
  const rawStats = Object.values(playerStats || {});
  const statsA = rawStats.filter(s => s.teamId === teamAId).sort((a, b) => b.kills - a.kills);
  const statsB = rawStats.filter(s => s.teamId === teamBId).sort((a, b) => b.kills - a.kills);

  const teamAMeta = { id: teamAId, name: teamAName };
  const teamBMeta = { id: teamBId, name: teamBName };

  return (
    <div className="series-detail">

      {/* ── Map-by-map breakdown ── */}
      <div className="map-breakdown">
        <div className="breakdown-title">Series Breakdown</div>

        {mapResults.map((m) => {
          const aWon = m.winnerId === teamAId;
          return (
            <div key={m.mapNum} className="map-row">
              <span className="map-num">Map {m.mapNum}</span>
              <ModeBadge mode={m.mode} />

              {/* Team A score */}
              <span className={`map-team ${aWon ? "win" : "loss"}`} style={{ color: color(teamAId) }}>
                {tag(teamAId)}
              </span>
              <span className="map-score">
                <span style={{ fontWeight: 700, color: aWon ? "#00e676" : "#ef5350" }}>{m.scoreA}</span>
                <span style={{ color: "#555" }}> – </span>
                <span style={{ fontWeight: 700, color: aWon ? "#ef5350" : "#00e676" }}>{m.scoreB}</span>
              </span>
              <span className={`map-team ${!aWon ? "win" : "loss"}`} style={{ color: color(teamBId) }}>
                {tag(teamBId)}
              </span>

              {/* Who won this map */}
              <span className="map-winner-label" style={{ color: color(m.winnerId) }}>
                {tag(m.winnerId)} win
              </span>
            </div>
          );
        })}

        {/* Series result line */}
        <div className="series-result-row">
          <span style={{ color: color(winnerId), fontWeight: 700 }}>{winnerName}</span>
          {" wins "}
          <span style={{ fontWeight: 700, color: "#eceef5" }}>{score}</span>
        </div>
      </div>

      {/* ── Player stats ── */}
      <div className="stats-section">
        <div className="breakdown-title" style={{ marginBottom: 8 }}>Player Stats</div>
        <div className="stats-teams">
          <StatsTable label={teamAMeta} stats={statsA} won={teamAId === winnerId} />
          <StatsTable label={teamBMeta} stats={statsB} won={teamBId === winnerId} />
        </div>
      </div>

    </div>
  );
}
