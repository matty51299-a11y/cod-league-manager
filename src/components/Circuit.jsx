// src/components/Circuit.jsx
// Historical Open-Circuit hub. Shown for Ghosts-era (open-circuit) seasons in
// place of the modern Majors / Challengers screens. Reads the data-driven
// season persisted in state.openCircuit (calendar, phases, brackets, pools,
// Pro Points, placements, prize) — there is no separate Challengers division.

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { PageHeader, SectionCard, Pill, EmptyState, StatCard } from "./ui.jsx";
import CircuitBracket from "./CircuitBracket.jsx";

const TIER_TONE = { S: "gold", A: "positive", B: "info", C: "neutral" };
const PHASE_LABEL = {
  REGISTRATION: "Registration", OPEN_BRACKET: "Open Bracket", POOL_PLAY: "Pool Play",
  CHAMPIONSHIP_BRACKET: "Championship Bracket", GROUP_STAGE: "Group Stage",
  LEAGUE_STANDINGS: "League Standings", PLAYOFFS: "Playoffs",
};
const QUAL_LABEL = {
  OPEN_ENTRY: "Open Entry", PRO_POINTS: "Pro Points", INVITATION: "Invitational",
  REGIONAL_QUALIFIER: "Regional Qualifier", LEAGUE_STANDINGS: "League Standings",
};

function money(n) {
  if (!n) return "—";
  return `$${Number(n).toLocaleString("en-US")}`;
}

export default function Circuit() {
  const { state } = useGame();
  const [tab, setTab] = useState("points");
  const oc = state?.openCircuit;
  if (!oc || oc.error) {
    return (
      <div className="page">
        <PageHeader eyebrow="Open Circuit" title="Historical Circuit" />
        <EmptyState title="No open-circuit data" detail={oc?.error ? String(oc.error) : "This season does not use the open circuit."} />
      </div>
    );
  }

  const title = state.currentGameTitle || "Open Circuit";
  return (
    <div className="page">
      <PageHeader
        eyebrow="Open Circuit"
        title={title}
        subtitle="MLG/CWL-style open ecosystem — frequent online 2K/5K Pro Point cups, many LANs, league seasons, regionals and a world championship. No separate Challengers division."
        meta={<Pill tone="info">{oc.ecosystemType}</Pill>}
      />

      <div className="ui-stat-row">
        <StatCard label="LAN / league events" value={oc.calendar.events.length} />
        <StatCard label="Online 2K/5K cups" value={oc.calendar.cupCount} />
        <StatCard label="Teams ranked" value={oc.ranking.length} />
        <StatCard label="Challengers division" value="Disabled" tone="warning" hint="Not used this era" />
      </div>

      <div className="ui-tabs" style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button className={`btn-secondary-sm ${tab === "points" ? "active" : ""}`} onClick={() => setTab("points")}>Pro Points</button>
        <button className={`btn-secondary-sm ${tab === "events" ? "active" : ""}`} onClick={() => setTab("events")}>Tournament Hub</button>
        {oc.conflicts?.length > 0 && (
          <button className={`btn-secondary-sm ${tab === "notes" ? "active" : ""}`} onClick={() => setTab("notes")}>Roster Notes ({oc.conflicts.length})</button>
        )}
      </div>

      {tab === "points" && <ProPointsTable oc={oc} />}
      {tab === "events" && <TournamentHub oc={oc} />}
      {tab === "notes" && <RosterNotes oc={oc} />}
    </div>
  );
}

function ProPointsTable({ oc }) {
  const userTeamId = oc.userTeamId;
  const poolCutoff = 12; // top-12 sit in a direct pool-play position
  return (
    <SectionCard title="Season Pro Points" subtitle="Combined points of each team's eligible locked roster. Points belong to players and move with transfers.">
      <div className="table-scroll" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>Team</th><th>Roster</th><th>Points</th><th>Seed status</th>
            </tr>
          </thead>
          <tbody>
            {oc.ranking.map((row) => {
              const isUser = row.teamId === userTeamId;
              const seed = row.rank <= poolCutoff ? "Direct pool play" : "Open bracket";
              return (
                <tr key={row.teamId} style={isUser ? { fontWeight: 700, background: "rgba(120,140,255,0.12)" } : undefined}>
                  <td>{row.rank}</td>
                  <td>{row.name}{isUser && <Pill tone="info" className="ml">You</Pill>}</td>
                  <td style={{ fontSize: 12 }}>
                    {(row.roster || []).map((pid) => {
                      const p = oc.playersById?.[pid];
                      const pts = oc.proPoints?.[pid] || 0;
                      return <span key={pid} style={{ marginRight: 8, whiteSpace: "nowrap" }}>{p?.name || pid} <em style={{ opacity: 0.7 }}>{pts.toLocaleString()}</em></span>;
                    })}
                  </td>
                  <td><strong>{Number(row.points).toLocaleString()}</strong></td>
                  <td><Pill tone={row.rank <= poolCutoff ? "positive" : "neutral"}>{seed}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function EventCard({ ev, r }) {
  const [showBracket, setShowBracket] = useState(false);
  return (
    <div className="ui-section-card" style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <strong>{ev.name}</strong>{" "}
          <Pill tone={TIER_TONE[ev.tier] || "neutral"}>{ev.tier}-Tier</Pill>{" "}
          <Pill tone="neutral">{QUAL_LABEL[ev.qualificationMode] || ev.qualificationMode}</Pill>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
            {ev.startDate}{ev.endDate && ev.endDate !== ev.startDate ? `–${ev.endDate}` : ""}
            {ev.location ? ` · ${ev.location}` : ""} · Field {ev.targetFieldSize} · {money(ev.prizePool)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          {r?.skipped ? <Pill tone="warning">No eligible field</Pill> : r?.completed ? <Pill tone="positive">Completed</Pill> : <Pill tone="neutral">Scheduled</Pill>}
        </div>
      </div>
      {r && !r.skipped && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
            {(r.phases || []).map((ph, i) => <Pill key={i} tone="info">{PHASE_LABEL[ph] || ph}</Pill>)}
          </div>
          <div style={{ display: "grid", gap: 2, fontSize: 13 }}>
            {(r.placements || []).slice(0, 4).map((p) => {
              const award = (r.awards || []).find((a) => a.placement === p.rank);
              return (
                <div key={p.teamId} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{p.rank}. {p.name}</span>
                  {award && <span style={{ opacity: 0.75 }}>{award.pointsPerPlayer.toLocaleString()} pts/player · {money(award.teamPrize)}</span>}
                </div>
              );
            })}
          </div>
          {r.bracket && (
            <div style={{ marginTop: 8 }}>
              <button className="btn-secondary-sm" onClick={() => setShowBracket((v) => !v)}>{showBracket ? "Hide bracket" : "View bracket"}</button>
              {showBracket && <div style={{ marginTop: 8 }}><CircuitBracket bracket={r.bracket} /></div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TournamentHub({ oc }) {
  const results = oc.results || {};
  // Show curated LAN/league events (with any simulated result) in date order.
  const events = [...oc.calendar.events].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  return (
    <SectionCard title="Tournament Hub" subtitle="Every historical event, its format, phases, bracket and final placements.">
      <div className="ui-event-list" style={{ display: "grid", gap: 10 }}>
        {events.map((ev) => <EventCard key={ev.id} ev={ev} r={results[ev.id]} />)}
      </div>
    </SectionCard>
  );
}

function RosterNotes({ oc }) {
  return (
    <SectionCard title="Reconciliation & data notes" subtitle="How the historical roster targets were applied while protecting your team.">
      <div style={{ display: "grid", gap: 8 }}>
        {oc.conflicts.map((c, i) => (
          <div key={i} className="ui-section-card" style={{ padding: 10 }}>
            <Pill tone={c.type === "UNRESOLVED_DATA_WARNING" ? "warning" : "neutral"}>{c.type}</Pill>
            <div style={{ fontSize: 13, marginTop: 4 }}>{c.message}</div>
          </div>
        ))}
        {oc.warnings?.map((w, i) => (
          <div key={`w${i}`} className="ui-section-card" style={{ padding: 10 }}>
            <Pill tone="warning">{w.type || "WARNING"}</Pill>
            <div style={{ fontSize: 13, marginTop: 4 }}>{w.message || w.recommendedAction || JSON.stringify(w)}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
