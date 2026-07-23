// src/components/HistoricalDashboard.jsx
// Home screen for Historical Dynasty (open-circuit) careers. The modern
// Dashboard is built around the CDL stage/major schedule, which open-circuit
// seasons do not use — so Ghosts-era saves get this focused home instead:
// the user's organisation, their results across the simulated open circuit,
// the Pro Points table, and the controls to manage the squad and roll the
// season forward. Rendered as a standard scrolling `.page`.

import { useGame } from "../store/gameStore.jsx";
import { resolveUserTeamMeta } from "../utils/userTeam.js";
import { getEra } from "../data/codEras.js";
import { PageHeader, SectionCard, StatCard, Pill, EmptyState } from "./ui.jsx";

function money(n) { return n ? `$${Number(n).toLocaleString("en-US")}` : "—"; }
function ordinal(n) {
  const v = Number(n);
  if (!v) return "—";
  const s = ["th", "st", "nd", "rd"], m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
}

export default function HistoricalDashboard({ setScreen }) {
  const { state, dispatch } = useGame();
  if (!state) return null;

  const oc = state.openCircuit;
  const team = resolveUserTeamMeta(state);
  const era = getEra(state.currentEraId);
  const userTeamId = state.userTeamId;

  // User's active roster + team OVR from the real player records.
  const roster = (state.players || []).filter(p => p.teamId === userTeamId && !p.isSub);
  const teamOvr = roster.length ? Math.round(roster.reduce((s, p) => s + (p.overall || 0), 0) / roster.length) : "—";

  if (!oc || oc.error) {
    return (
      <div className="page">
        <PageHeader eyebrow="Historical Dynasty" title={team?.name || "Your organisation"}
          subtitle={`${era?.gameTitle || "Open circuit"} · Season ${state.season}`} />
        <EmptyState title="Open circuit not available"
          detail={oc?.error ? `The circuit could not be built: ${String(oc.error)}` : "This save does not have an open-circuit season."} />
      </div>
    );
  }

  const ranking = oc.ranking || [];
  const userRank = ranking.find(r => r.teamId === userTeamId);
  const results = oc.results || {};

  // The user's own event finishes across the simulated season, most recent first.
  const userEvents = Object.entries(results)
    .map(([id, r]) => {
      if (!r || r.skipped) return null;
      const placement = (r.placements || []).find(p => p.teamId === userTeamId);
      if (!placement) return null;
      const award = (r.awards || []).find(a => a.placement === placement.rank);
      return { id, name: r.name, startDate: r.startDate, rank: placement.rank, eventType: r.eventType,
        points: award?.pointsPerPlayer || 0, prize: award?.teamPrize || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));

  const wins = userEvents.filter(e => e.rank === 1).length;
  const podiums = userEvents.filter(e => e.rank <= 3).length;
  const topRanking = ranking.slice(0, 10);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Historical Dynasty · Open Circuit"
        title={team?.name || userTeamId}
        subtitle={`${era?.gameTitle || "Open circuit"} · ${era?.seasonLabel || `Season ${state.season}`} — you compete across online 2K/5K cups, open LANs, league play and the Championship. Pro Points decide seeding.`}
        accent={team?.color}
        action={
          <button className="btn-cta" onClick={() => dispatch({ type: "ADVANCE_OFFSEASON" })}
            title="Roll the dynasty forward to the next title/season">
            Advance to Next Season ›
          </button>
        }
      />

      <div className="ui-stat-row" style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "4px 0 14px" }}>
        <StatCard label="Pro Points rank" value={userRank ? `${ordinal(userRank.rank)} / ${ranking.length}` : "—"} tone={userRank && userRank.rank <= 8 ? "success" : "neutral"} />
        <StatCard label="Pro Points" value={userRank ? Number(userRank.points).toLocaleString() : "0"} />
        <StatCard label="Team OVR" value={teamOvr} />
        <StatCard label="Event wins" value={wins} tone={wins ? "success" : "neutral"} />
        <StatCard label="Podiums" value={podiums} />
      </div>

      <div className="ui-quicknav" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button className="btn-secondary-sm" onClick={() => setScreen?.("circuit")}>View Full Circuit ›</button>
        <button className="btn-secondary-sm" onClick={() => setScreen?.("standings")}>Pro Points Table ›</button>
        <button className="btn-secondary-sm" onClick={() => setScreen?.("roster")}>Manage Squad ›</button>
        <button className="btn-secondary-sm" onClick={() => setScreen?.("transfers")}>Transfer Centre ›</button>
      </div>

      <SectionCard title={`${team?.name || "Your"} results this season`}
        subtitle="Every open-circuit event your organisation reached the money rounds in, most recent first. Full brackets live in the Circuit tab.">
        {userEvents.length === 0 ? (
          <EmptyState title="No deep runs yet"
            detail="Your squad didn't reach a top-8 finish in this season's events. Strengthen the roster via the Transfer Centre, then advance the season." />
        ) : (
          <div className="table-scroll" style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Event</th><th>Finish</th><th>Pro Points</th><th>Prize</th></tr></thead>
              <tbody>
                {userEvents.map(e => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: "nowrap", opacity: 0.8 }}>{e.startDate}</td>
                    <td>{e.name}</td>
                    <td><Pill tone={e.rank === 1 ? "gold" : e.rank <= 3 ? "positive" : "neutral"}>{ordinal(e.rank)}</Pill></td>
                    <td>{e.points ? e.points.toLocaleString() : "—"}</td>
                    <td style={{ opacity: 0.85 }}>{money(e.prize)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Pro Points — Top 10"
        subtitle="Season standings across the full historical field."
        action={<button className="fm-panel-link" onClick={() => setScreen?.("standings")}>Full table ›</button>}>
        <div className="table-scroll" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>#</th><th>Team</th><th>Pro Points</th></tr></thead>
            <tbody>
              {topRanking.map(row => (
                <tr key={row.teamId} style={row.teamId === userTeamId ? { fontWeight: 700, background: "rgba(120,140,255,0.12)" } : undefined}>
                  <td>{row.rank}</td>
                  <td>{row.name}{row.teamId === userTeamId && <Pill tone="info" className="ml">You</Pill>}</td>
                  <td>{Number(row.points).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
