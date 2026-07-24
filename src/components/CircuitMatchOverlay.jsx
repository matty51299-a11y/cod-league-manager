// src/components/CircuitMatchOverlay.jsx
// Full-screen tournament pop-up for an open-circuit event — the whole-event
// presentation (like the modern CDL major overlay). After the event is
// simulated (SIM_NEXT_CIRCUIT_EVENT) this overlay shows the tournament: the
// user's run down the left (played series map-by-map), the full bracket as the
// centrepiece on the right, and the final placement + Pro Points at the end.

import { useEffect, useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import CircuitBracket from "./CircuitBracket.jsx";
import { isInteractiveCircuitEvent } from "../engine/circuitTournament.js";

function ordinal(n) {
  const v = Number(n); if (!v) return "—";
  const s = ["th", "st", "nd", "rd"], m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
}
function money(n) { return n ? `$${Number(n).toLocaleString("en-US")}` : null; }
const EVENT_TYPE_LABEL = {
  ONLINE_2K: "Online 2K", ONLINE_5K: "Online 5K", OPEN_LAN: "Open LAN", LEAGUE_SEASON: "League",
  WORLD_CHAMPIONSHIP: "World Championship", INVITATIONAL: "Invitational", REGIONAL_CHAMPIONSHIP: "Regional",
};

export default function CircuitMatchOverlay({ isOpen, onClose }) {
  const { state } = useGame();
  const oc = state?.openCircuit;
  const eventId = oc?.lastPlayedEventId;
  const result = eventId ? oc?.results?.[eventId] : null;

  const [seriesIdx, setSeriesIdx] = useState(0);
  const [revealed, setRevealed] = useState(0); // maps revealed in the current series

  useEffect(() => { if (isOpen) { setSeriesIdx(0); setRevealed(0); } }, [isOpen, eventId]);

  if (!isOpen || !state) return null;
  // The batch reveal is only for quick-simmed cups / league seasons. Interactive
  // events (Open LAN / Championship / Invitational / Regional) are played and
  // resolved in the live tournament overlay, which owns their completion popup —
  // never show a second summary for them, and never show while a live tournament
  // is active (its champion screen is the popup).
  if (state.circuitTournament) return null;
  if (result && isInteractiveCircuitEvent(result.eventType)) return null;

  const userTeamName = oc?.teamsById?.[state.userTeamId]?.name || "Your team";
  const userMatches = result?.userMatches || [];
  const userRank = result?.userPlacement ?? null;
  const wins = userMatches.filter(m => m.won).length;

  const atSummary = userMatches.length === 0 || seriesIdx >= userMatches.length;
  const series = !atSummary ? userMatches[seriesIdx] : null;
  const maps = series?.maps || [];
  const seriesDone = revealed >= maps.length;

  function playMap() { setRevealed(r => Math.min(maps.length, r + 1)); }
  function simSeries() { setRevealed(maps.length); }
  function nextSeries() { setSeriesIdx(i => i + 1); setRevealed(0); }
  function skipAll() { setSeriesIdx(userMatches.length); }

  const isChamp = userRank === 1;

  return (
    <div className="nmo-backdrop" onClick={onClose} style={{ alignItems: "stretch", justifyContent: "center", padding: "2vh 2vw" }}>
      <div
        className="nmo-card"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 1120, width: "100%", maxHeight: "96vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
      >
        <button className="nmo-close" onClick={onClose} aria-label="Close">✕</button>

        {/* ── Hero header ── */}
        <div style={{
          padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(135deg, rgba(251,191,36,0.10), rgba(96,165,250,0.06))",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>{EVENT_TYPE_LABEL[result?.eventType] || "Open Circuit"}</span>
            <h2 style={{ margin: 0, fontSize: 22 }}>{result?.name || "Open Circuit Event"}</h2>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: 13, opacity: 0.85 }}>
            <span>Field {result?.fieldSize ?? "—"}</span>
            {result?.tier && <span>{result.tier}-Tier</span>}
            <span style={{ fontWeight: 700, color: "var(--accent,#60a5fa)" }}>{userTeamName}</span>
            {userRank != null && <span style={{ color: isChamp ? "#fbbf24" : "inherit", fontWeight: 700 }}>{result?.userInField ? `Finished ${ordinal(userRank)}` : "Not competing"}</span>}
            {result?.userPoints > 0 && <span style={{ color: "#34d399" }}>+{result.userPoints.toLocaleString()} Pro Points/player</span>}
          </div>
        </div>

        {/* ── Body: your run (left) + bracket (right) ── */}
        <div style={{ display: "flex", gap: 0, flex: 1, minHeight: 0 }}>
          {/* Left column — your run */}
          <div style={{ width: 380, minWidth: 320, borderRight: "1px solid rgba(255,255,255,0.08)", padding: 18, overflowY: "auto" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.6, fontWeight: 700, marginBottom: 10 }}>Your Run</div>

            {userMatches.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                {result?.userInField ? "Your team advanced without a played series (byes / group format)." : "Your team is not competing at this event."}
              </p>
            ) : atSummary ? (
              <div style={{ textAlign: "center" }}>
                <div className={`nmo-result-banner ${isChamp ? "nmo-win" : ""}`} style={{ marginBottom: 12 }}>
                  <span className="nmo-result-outcome">{isChamp ? "CHAMPIONS" : `${ordinal(userRank).toUpperCase()} PLACE`}</span>
                  <div className="nmo-result-score">{wins}-{userMatches.length - wins} series</div>
                </div>
                <div style={{ fontSize: 13, opacity: 0.85 }}>{ordinal(userRank)} of {result?.fieldSize || "the"} field</div>
                {result?.userPoints > 0 && <div style={{ fontSize: 13, color: "#34d399", marginTop: 4 }}>+{result.userPoints.toLocaleString()} Pro Points/player{result.userPrize ? ` · ${money(result.userPrize)}` : ""}</div>}
                {/* Full run recap */}
                <div style={{ display: "grid", gap: 4, marginTop: 14, textAlign: "left" }}>
                  {userMatches.map((m, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
                      <span style={{ width: 78, opacity: 0.6 }}>{m.phase}</span>
                      <span style={{ width: 44, fontWeight: 700, color: m.won ? "#34d399" : "#f87171" }}>{m.won ? "WIN" : "LOSS"}</span>
                      <span style={{ width: 34 }}>{m.score}</span>
                      <span style={{ opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>vs {m.opponent}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>{series.phase} · Series {seriesIdx + 1}/{userMatches.length}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
                    <span style={{ color: "var(--accent,#60a5fa)" }}>{userTeamName}</span>
                    <span style={{ opacity: 0.6, margin: "0 8px" }}>vs</span>
                    <span>{series.opponent}</span>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  {maps.map((m, i) => {
                    const shown = i < revealed;
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8,
                        background: shown ? (m.won ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)") : "rgba(255,255,255,0.04)",
                        border: `1px solid ${shown ? (m.won ? "rgba(52,211,153,0.4)" : "rgba(248,113,113,0.4)") : "rgba(255,255,255,0.08)"}`,
                        opacity: shown ? 1 : 0.5,
                      }}>
                        <span style={{ width: 24, opacity: 0.6, fontSize: 12 }}>M{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 13 }}>{shown ? m.mode : "— — —"}</span>
                        {shown ? (
                          <>
                            <span style={{ fontWeight: 700, color: m.won ? "#34d399" : "#f87171", width: 46 }}>{m.won ? "WIN" : "LOSS"}</span>
                            <span style={{ width: 60, textAlign: "right", opacity: 0.9 }}>{m.score}</span>
                          </>
                        ) : <span style={{ opacity: 0.5, fontSize: 12 }}>hidden</span>}
                      </div>
                    );
                  })}
                </div>

                {seriesDone && (
                  <div style={{ textAlign: "center", fontWeight: 700, margin: "10px 0", color: series.won ? "#34d399" : "#f87171" }}>
                    Series {series.won ? "WON" : "LOST"} {series.score}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {!seriesDone ? (
                    <>
                      <button className="btn-primary nmo-play-btn" onClick={playMap}>▶ Play Map {revealed + 1}</button>
                      <button className="btn-secondary" onClick={simSeries}>Sim Series</button>
                    </>
                  ) : (
                    <button className="btn-primary nmo-play-btn" onClick={nextSeries}>
                      {seriesIdx + 1 < userMatches.length ? "Next Match →" : "See Result →"}
                    </button>
                  )}
                  <button className="btn-secondary" onClick={skipAll}>Skip to Result</button>
                </div>
              </>
            )}
          </div>

          {/* Right column — the full bracket */}
          <div style={{ flex: 1, minWidth: 0, padding: 18, overflow: "auto" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.6, fontWeight: 700, marginBottom: 10 }}>
              {result?.bracket?.title || "Bracket"}
            </div>
            {result?.bracket ? (
              <CircuitBracket bracket={result.bracket} />
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>This event format has no bracket to display.</p>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: "12px 22px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "flex-end" }}>
          <button className="btn-primary nmo-play-btn" onClick={onClose}>{atSummary ? "Continue →" : "Close"}</button>
        </div>
      </div>
    </div>
  );
}
