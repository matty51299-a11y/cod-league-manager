// src/components/CircuitMatchOverlay.jsx
// Interactive reveal of the user's matches at an open-circuit event. After the
// event is simulated (SIM_NEXT_CIRCUIT_EVENT), this overlay lets the user click
// through their series map-by-map — mirroring the modern matchday overlay — and
// ends on the event placement + Pro Points earned. A "Sim" path reveals it all
// instantly for the grind events.

import { useEffect, useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import CircuitBracket from "./CircuitBracket.jsx";

function ordinal(n) {
  const v = Number(n); if (!v) return "—";
  const s = ["th", "st", "nd", "rd"], m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
}

export default function CircuitMatchOverlay({ isOpen, onClose }) {
  const { state } = useGame();
  const oc = state?.openCircuit;
  const eventId = oc?.lastPlayedEventId;
  const result = eventId ? oc?.results?.[eventId] : null;

  const [seriesIdx, setSeriesIdx] = useState(0);
  const [revealed, setRevealed] = useState(0); // maps revealed in current series
  const [showBracket, setShowBracket] = useState(false);

  // Reset the walkthrough whenever the overlay opens on a new event.
  useEffect(() => { if (isOpen) { setSeriesIdx(0); setRevealed(0); setShowBracket(false); } }, [isOpen, eventId]);

  if (!isOpen || !state) return null;

  const userMatches = result?.userMatches || [];
  const userRank = result?.userPlacement ?? null;
  const wins = userMatches.filter(m => m.won).length;

  const atSummary = seriesIdx >= userMatches.length;
  const series = !atSummary ? userMatches[seriesIdx] : null;
  const maps = series?.maps || [];
  const seriesDone = revealed >= maps.length;

  function playMap() { setRevealed(r => Math.min(maps.length, r + 1)); }
  function simSeries() { setRevealed(maps.length); }
  function nextSeries() { setSeriesIdx(i => i + 1); setRevealed(0); }
  function skipAll() { setSeriesIdx(userMatches.length); }

  return (
    <div className="nmo-backdrop" onClick={onClose}>
      <div className="nmo-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <button className="nmo-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="nmo-context">{result?.name || "Open Circuit Event"}</div>

        {/* No user matches → either not in the field, or advanced on byes. */}
        {userMatches.length === 0 ? (
          <>
            <div className="nmo-title">EVENT COMPLETE</div>
            <p className="nmo-no-match muted" style={{ textAlign: "center" }}>
              {result?.userInField ? `Your team finished ${ordinal(userRank)} — no head-to-head series this time (byes / group format).` : "Your team was not eligible for this event's region."}
            </p>
            {result?.bracket && (
              <>
                <button className="btn-secondary" style={{ margin: "6px auto", display: "block" }} onClick={() => setShowBracket(v => !v)}>{showBracket ? "Hide" : "View"} Bracket</button>
                {showBracket && <CircuitBracket bracket={result.bracket} />}
              </>
            )}
            <div className="nmo-actions">
              <button className="btn-primary nmo-play-btn" onClick={onClose}>Continue →</button>
            </div>
          </>
        ) : atSummary ? (
          /* ── Event summary ── */
          <>
            <div className={`nmo-result-banner ${userRank === 1 ? "nmo-win" : ""}`}>
              <span className="nmo-result-outcome">{userRank === 1 ? "CHAMPIONS" : `FINISHED ${ordinal(userRank).toUpperCase()}`}</span>
              <div className="nmo-result-score">{wins}-{userMatches.length - wins} series</div>
            </div>
            <div className="nmo-consequences" style={{ textAlign: "center" }}>
              <div className="nmo-consequence-line">{ordinal(userRank)} of {result?.fieldSize || "the"} field</div>
              {result?.userPoints > 0 && <div className="nmo-consequence-line">+{result.userPoints.toLocaleString()} Pro Points per player{result.userPrize ? ` · $${result.userPrize.toLocaleString()}` : ""}</div>}
            </div>
            {result?.bracket && (
              <div style={{ margin: "8px 0" }}>
                <button className="btn-secondary" style={{ margin: "0 auto 8px", display: "block" }} onClick={() => setShowBracket(v => !v)}>{showBracket ? "Hide" : "View"} Bracket</button>
                {showBracket && <CircuitBracket bracket={result.bracket} />}
              </div>
            )}
            <div className="nmo-actions nmo-result-actions">
              <button className="btn-primary nmo-play-btn" onClick={onClose}>Continue →</button>
            </div>
          </>
        ) : (
          /* ── Series walkthrough ── */
          <>
            <div className="nmo-title" style={{ marginBottom: 4 }}>{series.phase}</div>
            <div style={{ textAlign: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, color: "var(--accent,#60a5fa)" }}>{state.openCircuit.teamsById?.[state.userTeamId]?.name || "You"}</span>
              <span style={{ opacity: 0.6, margin: "0 8px" }}>vs</span>
              <span style={{ fontWeight: 700 }}>{series.opponent}</span>
              <span style={{ opacity: 0.6, marginLeft: 8 }}>· Series {seriesIdx + 1}/{userMatches.length}</span>
            </div>

            <div style={{ display: "grid", gap: 6, margin: "10px 0" }}>
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
                    <span style={{ flex: 1 }}>{shown ? m.mode : "— — —"}</span>
                    {shown ? (
                      <>
                        <span style={{ fontWeight: 700, color: m.won ? "#34d399" : "#f87171", width: 46 }}>{m.won ? "WIN" : "LOSS"}</span>
                        <span style={{ width: 64, textAlign: "right", opacity: 0.9 }}>{m.score}</span>
                      </>
                    ) : (
                      <span style={{ opacity: 0.5 }}>hidden</span>
                    )}
                  </div>
                );
              })}
            </div>

            {seriesDone && (
              <div style={{ textAlign: "center", fontWeight: 700, margin: "6px 0 10px", color: series.won ? "#34d399" : "#f87171" }}>
                Series {series.won ? "WON" : "LOST"} {series.score}
              </div>
            )}

            <div className="nmo-actions" style={{ display: "flex", gap: 8, justifyContent: "center" }}>
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
    </div>
  );
}
