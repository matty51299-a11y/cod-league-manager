// src/components/CircuitTournamentOverlay.jsx
// Full-screen live tournament for open-circuit LAN/championship events — the
// historical equivalent of the CDL major overlay. Shows the DE16 playoff
// bracket, a "my team" panel with the user's next match, and drives interactive
// play through the Match Center (results are computed live, never pre-decided).
// When the bracket ends it becomes the champion / placements screen.

import { useGame } from "../store/gameStore.jsx";
import { useMatchCenter } from "../store/matchCenterContext.jsx";
import CircuitBracket from "./CircuitBracket.jsx";
import { circuitBracketView, nextUserCircuitMatch } from "../engine/circuitTournament.js";

function ordinal(n) {
  const v = Number(n); if (!v) return "—";
  const s = ["th", "st", "nd", "rd"], m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
}

export default function CircuitTournamentOverlay() {
  const { state, dispatch } = useGame();
  const { openMatchCenter } = useMatchCenter();
  const t = state?.circuitTournament;
  if (!t) return null;

  const view = circuitBracketView(t);
  const complete = t.status === "complete" || !!t.bracket.champion;
  const pending = complete ? null : nextUserCircuitMatch(t);
  const userTeamName = t.teamsById?.[t.userTeamId]?.name || "Your team";
  const champId = t.bracket.champion;
  const champName = champId ? (t.teamsById?.[champId]?.name || champId) : null;
  const userIsChamp = champId === t.userTeamId;

  // Final placement (folded into openCircuit when finalised).
  const finalResult = complete ? state.openCircuit?.results?.[t.eventId] : null;
  const userRank = finalResult?.userPlacement ?? null;

  return (
    <div className="nmo-backdrop" style={{ alignItems: "stretch", padding: "2vh 2vw" }}>
      <div className="nmo-card" style={{ maxWidth: 1160, width: "100%", maxHeight: "96vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>

        {/* Hero */}
        <div style={{ padding: "16px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "linear-gradient(135deg, rgba(251,191,36,0.10), rgba(96,165,250,0.06))", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>{t.tier}-Tier · {t.eventType.replace(/_/g, " ")}</span>
              <h2 style={{ margin: 0, fontSize: 22 }}>{t.name}</h2>
            </div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              <span style={{ fontWeight: 700, color: "var(--accent,#60a5fa)" }}>{userTeamName}</span>
              {complete
                ? <span style={{ marginLeft: 10, color: userIsChamp ? "#fbbf24" : "inherit", fontWeight: 700 }}>{userIsChamp ? "CHAMPIONS" : userRank ? `Finished ${ordinal(userRank)}` : "Eliminated"}</span>
                : <span style={{ marginLeft: 10, color: "#34d399" }}>Alive · {pending ? `Next: ${t.teamsById?.[pending.opponentId]?.name ?? "TBD"}` : "awaiting draw"}</span>}
            </div>
          </div>
          {complete
            ? <button className="btn-cta" onClick={() => dispatch({ type: "CLOSE_CIRCUIT_TOURNAMENT" })}>Return to Circuit →</button>
            : pending
              ? <button className="btn-cta" style={{ background: "#e4322b" }} onClick={() => openMatchCenter("circuit")}>▶ Play Your Match</button>
              : null}
        </div>

        {/* Champion banner */}
        {complete && (
          <div style={{ padding: "14px 22px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 34 }}>🏆</div>
            <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.7, textTransform: "uppercase" }}>Champion</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#fbbf24" }}>{champName}</div>
            {finalResult?.placements?.length > 0 && (
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginTop: 8, fontSize: 13 }}>
                {finalResult.placements.slice(0, 4).map(p => (
                  <span key={p.teamId} style={p.teamId === t.userTeamId ? { fontWeight: 700, color: "var(--accent,#60a5fa)" } : undefined}>
                    {ordinal(p.rank)} {p.name}
                  </span>
                ))}
              </div>
            )}
            {finalResult?.userPoints > 0 && <div style={{ fontSize: 13, color: "#34d399", marginTop: 6 }}>You earned +{finalResult.userPoints.toLocaleString()} Pro Points/player{finalResult.userPrize ? ` · $${finalResult.userPrize.toLocaleString()}` : ""}</div>}
          </div>
        )}

        {/* Bracket */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 18 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.6, fontWeight: 700, marginBottom: 10 }}>Playoff Bracket · Top 16 seeds</div>
          <CircuitBracket bracket={view} />
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 22px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>{complete ? "Tournament complete." : pending ? "Play your match to advance the bracket." : "Simulating…"}</span>
          {complete
            ? <button className="btn-primary nmo-play-btn" onClick={() => dispatch({ type: "CLOSE_CIRCUIT_TOURNAMENT" })}>Return to Circuit →</button>
            : pending
              ? <button className="btn-primary nmo-play-btn" style={{ background: "#e4322b" }} onClick={() => openMatchCenter("circuit")}>▶ Play Your Match</button>
              : null}
        </div>
      </div>
    </div>
  );
}
