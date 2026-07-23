// src/components/CircuitBracket.jsx
// Renders an open-circuit event bracket as a horizontally-scrolling column of
// rounds (WB / LB / Grand Final for double elimination), each round a stack of
// match cards. The user's team and match winners are highlighted. Byes (a match
// with only one team) are shown so top seeds' free passes are visible.

function MatchCard({ m }) {
  const row = (name, isWinner, isUser) => (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 7px",
      fontSize: 12, borderRadius: 4,
      background: isUser ? "rgba(120,140,255,0.18)" : "transparent",
      color: name ? (isWinner ? "var(--text-head,#fff)" : "var(--text-dim,#9aa)") : "var(--text-dim,#667)",
      fontWeight: isWinner ? 700 : 400,
    }}>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{name || "—"}</span>
      {isWinner && <span style={{ color: "#34d399" }}>✓</span>}
    </div>
  );
  const bye = !m.a || !m.b;
  return (
    <div style={{
      border: "1px solid rgba(255,255,255,0.10)", borderRadius: 6, overflow: "hidden",
      background: "rgba(255,255,255,0.03)", minWidth: 150,
    }}>
      {row(m.a, m.winner && m.winner === m.a, m.aIsUser)}
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />
      {row(m.b, m.winner && m.winner === m.b, m.bIsUser)}
      {bye && <div style={{ fontSize: 10, textAlign: "center", opacity: 0.5, padding: "1px 0 2px" }}>bye</div>}
    </div>
  );
}

export default function CircuitBracket({ bracket }) {
  if (!bracket || !bracket.rounds?.length) {
    return <div style={{ opacity: 0.7, fontSize: 13, padding: 8 }}>No bracket for this event format.</div>;
  }
  return (
    <div style={{ overflowX: "auto", paddingBottom: 6 }}>
      {bracket.champion && (
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          Champion: <strong style={{ color: "#fbbf24" }}>{bracket.champion}</strong>
        </div>
      )}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", minWidth: "min-content" }}>
        {bracket.rounds.map((rd, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.65, fontWeight: 700 }}>{rd.name}</div>
            {rd.matches.map((m, j) => <MatchCard key={j} m={m} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
