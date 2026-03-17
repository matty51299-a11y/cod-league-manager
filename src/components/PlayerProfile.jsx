// src/components/PlayerProfile.jsx
// Full player profile modal — shows name, age, team, role, ratings,
// hidden traits (if user's team), current season stats, and season history.
// Triggered by clicking a player row in Roster (or future screens).

import { useEffect } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";

function ratingColor(v) {
  if (v >= 90) return "#00e676";
  if (v >= 80) return "#69f0ae";
  if (v >= 70) return "#ffeb3b";
  if (v >= 60) return "#ffa726";
  return "#ef5350";
}

function kdColor(kd) {
  if (kd >= 1.20) return "#00e676";
  if (kd >= 1.05) return "#69f0ae";
  if (kd >= 0.95) return "#ffeb3b";
  if (kd >= 0.80) return "#ffa726";
  return "#ef5350";
}

const HIDDEN_TRAITS = [
  { label: "Ego",             key: "ego",           desc: "High ego = ego clashes, volatile",   invert: true },
  { label: "Work Ethic",      key: "workEthic",      desc: "Higher = faster development" },
  { label: "Tilt Resistance", key: "tiltResistance", desc: "Higher = bounces back from losses" },
  { label: "Leadership",      key: "leadership",     desc: "Boosts team chemistry" },
  { label: "Meta Dependence", key: "metaDependence", desc: "High = risky on meta shifts",       invert: true },
];

function traitColor(val, invert) {
  const eff = invert ? 6 - val : val;
  if (eff >= 4) return "#00e676";
  if (eff >= 3) return "#ffeb3b";
  return "#ef5350";
}

/**
 * PlayerProfile – full-screen modal overlay.
 * @param {string}   playerId     – ID of the player to display
 * @param {function} onClose      – callback to close the modal
 * @param {boolean}  isUserTeam   – whether the player is on the user's team (shows traits)
 */
export default function PlayerProfile({ playerId, onClose, isUserTeam }) {
  const { state } = useGame();

  // Close on Escape key
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!state || !playerId) return null;

  // Look up in both signed players and unsigned prospects
  const player =
    state.players.find(p => p.id === playerId) ??
    state.prospects.find(p => p.id === playerId);

  if (!player) return null;

  const team = CDL_TEAMS.find(t => t.id === player.teamId);

  // Current season cumulative stats
  const raw = state.playerSeasonStats?.[playerId] ?? { kills: 0, deaths: 0, matches: 0 };
  const currentKD = raw.deaths > 0
    ? (raw.kills / raw.deaths).toFixed(2)
    : raw.kills > 0 ? raw.kills.toFixed(2) : "—";

  // Season-by-season history (oldest → newest)
  const history = state.playerStatsHistory?.[playerId] ?? [];

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={e => e.stopPropagation()}>

        {/* Close button */}
        <button className="profile-close" onClick={onClose} aria-label="Close">✕</button>

        {/* ── Header ── */}
        <div className="profile-header">
          <div>
            <h2 className="profile-name">{player.name}</h2>
            <div className="profile-sub">
              {team
                ? <span style={{ color: team.color }}>{team.name}</span>
                : <span className="muted">Free Agent</span>}
              {player.isSub && <span className="sub-label" style={{ marginLeft: 8 }}>SUB</span>}
            </div>
          </div>
          <div className="profile-ovr-block">
            <div className="profile-ovr" style={{ color: ratingColor(player.overall) }}>{player.overall}</div>
            <div className="profile-ovr-label">OVR</div>
          </div>
        </div>

        {/* ── Meta info ── */}
        <div className="profile-meta-row">
          <span><span className="meta-label">Age</span> {player.age}</span>
          <span><span className="meta-label">Role</span> {player.primary}</span>
          <span><span className="meta-label">2nd</span> {player.secondary ?? "—"}</span>
          <span><span className="meta-label">POT</span> <span style={{ color: ratingColor(player.potential) }}>{player.potential}</span></span>
          <span><span className="meta-label">Exp</span> {player.experience ?? 0} seasons</span>
          <span><span className="meta-label">Dev</span> {player.developmentCurve ?? "standard"}</span>
        </div>

        {/* ── Current season stats ── */}
        <div className="profile-section">
          <div className="profile-section-title">Current Season</div>
          <div className="profile-stats-row">
            <div className="stat-box">
              <div className="stat-label">Matches</div>
              <div className="stat-value">{raw.matches}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Kills</div>
              <div className="stat-value">{raw.kills}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Deaths</div>
              <div className="stat-value">{raw.deaths}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">K/D</div>
              <div className="stat-value" style={{ color: raw.matches > 0 ? kdColor(parseFloat(currentKD)) : undefined }}>
                {currentKD}
              </div>
            </div>
          </div>
          {raw.matches === 0 && (
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>No matches played this season yet.</p>
          )}
        </div>

        {/* ── Season history ── */}
        {history.length > 0 && (
          <div className="profile-section">
            <div className="profile-section-title">Season History</div>
            <table className="profile-history-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Matches</th>
                  <th>Kills</th>
                  <th>Deaths</th>
                  <th>K/D</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map(h => (
                  <tr key={h.season}>
                    <td>S{h.season}</td>
                    <td>{h.matches}</td>
                    <td>{h.kills}</td>
                    <td>{h.deaths}</td>
                    <td style={{ color: kdColor(h.kd), fontWeight: 600 }}>{h.kd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Hidden traits (own team only) ── */}
        {isUserTeam && (
          <div className="profile-section">
            <div className="profile-section-title">Hidden Traits</div>
            <div className="profile-traits">
              {HIDDEN_TRAITS.map(t => (
                <div key={t.key} className="trait-row">
                  <span className="trait-label">{t.label}</span>
                  <span className="trait-dots">
                    {[1, 2, 3, 4, 5].map(d => (
                      <span
                        key={d}
                        className={`dot-pip ${d <= player[t.key] ? "filled" : ""}`}
                        style={d <= player[t.key] ? { background: traitColor(player[t.key], t.invert) } : {}}
                      />
                    ))}
                  </span>
                  <span className="trait-desc muted">{t.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
