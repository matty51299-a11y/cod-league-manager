// src/components/HistoricalDashboard.jsx
// Home screen for Historical Dynasty (open-circuit) careers. The modern
// Dashboard is built around the CDL stage/major schedule, which open-circuit
// seasons do not use — so Ghosts-era saves get this focused home instead.
//
// The open circuit is played event by event: the user reviews the next
// tournament, plays it (SIM_NEXT_CIRCUIT_EVENT), and sees their result and
// match log. When every event has been played, the season is rolled forward to
// the next title (ADVANCE_OFFSEASON). Rendered as a standard scrolling `.page`.

import { useState, Fragment } from "react";
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
const EVENT_TYPE_LABEL = {
  ONLINE_CUP: "Online Cup", OPEN_LAN: "Open LAN", LEAGUE_SEASON: "League",
  WORLD_CHAMPIONSHIP: "Championship", INVITATIONAL: "Invitational", REGIONAL: "Regional",
};

export default function HistoricalDashboard({ setScreen, onPlayEvent }) {
  const { state, dispatch } = useGame();
  const [expanded, setExpanded] = useState(null);
  if (!state) return null;
  const playNext = () => (onPlayEvent ? onPlayEvent() : dispatch({ type: "SIM_NEXT_CIRCUIT_EVENT" }));

  const oc = state.openCircuit;
  const team = resolveUserTeamMeta(state);
  const era = getEra(state.currentEraId);
  const userTeamId = state.userTeamId;

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
  const all = oc.calendar?.all || [];
  const nextEvent = oc.seasonComplete ? null : all.find(e => e.id === oc.nextEventId) || all.find(e => !results[e.id]);

  // The user's own event finishes across the season so far, most recent first.
  const userEvents = Object.entries(results)
    .map(([id, r]) => {
      if (!r || r.skipped) return null;
      const placement = (r.placements || []).find(p => p.teamId === userTeamId);
      if (!placement) return null;
      const award = (r.awards || []).find(a => a.rank === placement.rank || a.placement === placement.rank);
      return { id, name: r.name, startDate: r.startDate, rank: placement.rank, eventType: r.eventType,
        points: award?.pointsPerPlayer || 0, prize: award?.teamPrize || 0, userMatches: r.userMatches || [] };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));

  const wins = userEvents.filter(e => e.rank === 1).length;
  const podiums = userEvents.filter(e => e.rank <= 3).length;
  const lastResult = oc.lastPlayedEventId ? results[oc.lastPlayedEventId] : null;
  const lastUserPlace = lastResult && (lastResult.placements || []).find(p => p.teamId === userTeamId);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Historical Dynasty · Open Circuit"
        title={team?.name || userTeamId}
        subtitle={`${era?.gameTitle || "Open circuit"} · ${era?.seasonLabel || `Season ${state.season}`} — play through online 2K/5K cups, open LANs, league play and the Championship. Pro Points decide seeding.`}
        accent={team?.color}
        action={
          oc.seasonComplete ? (
            <button className="btn-cta" onClick={() => dispatch({ type: "ADVANCE_OFFSEASON" })} title="Roll the dynasty forward to the next title/season">
              Advance to Next Season ›
            </button>
          ) : (
            <button className="btn-cta" onClick={playNext} title={nextEvent ? `Play ${nextEvent.name}` : "Play the next event"}>
              Play Next Event ›
            </button>
          )
        }
      />

      <div className="ui-stat-row" style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "4px 0 14px" }}>
        <StatCard label="Pro Points rank" value={userRank ? `${ordinal(userRank.rank)} / ${ranking.length}` : "—"} tone={userRank && userRank.rank <= 8 ? "success" : "neutral"} />
        <StatCard label="Pro Points" value={userRank ? Number(userRank.points).toLocaleString() : "0"} />
        <StatCard label="Team OVR" value={teamOvr} />
        <StatCard label="Event wins" value={wins} tone={wins ? "success" : "neutral"} />
        <StatCard label="Podiums" value={podiums} />
        <StatCard label="Season progress" value={`${oc.playedCount || 0} / ${oc.totalEvents || all.length}`} hint="events played" />
      </div>

      {/* Next event to play (or season-complete prompt). */}
      {nextEvent ? (
        <SectionCard title="Next event"
          subtitle="Play through the circuit one tournament at a time. Your matches are recorded below.">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{nextEvent.name}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <Pill tone="info">{EVENT_TYPE_LABEL[nextEvent.eventType] || nextEvent.eventType}</Pill>
                {nextEvent.tier && <Pill tone="neutral">{nextEvent.tier}-Tier</Pill>}
                <Pill tone="neutral">{nextEvent.startDate}</Pill>
                {nextEvent.targetFieldSize ? <Pill tone="neutral">Field {nextEvent.targetFieldSize}</Pill> : null}
                {nextEvent.prizePool ? <Pill tone="gold">{money(nextEvent.prizePool)}</Pill> : null}
              </div>
              {nextEvent.location && <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{nextEvent.location}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
              <button className="btn-cta" onClick={playNext}>▶ Play {EVENT_TYPE_LABEL[nextEvent.eventType] || "Event"}</button>
              {(nextEvent.eventType === "ONLINE_2K" || nextEvent.eventType === "ONLINE_5K") && (
                <button className="btn-secondary-sm" onClick={() => dispatch({ type: "SIM_CIRCUIT_TO_MAJOR" })} title="Quick-sim the online cups up to the next LAN / league / championship">
                  Sim cups to next LAN »
                </button>
              )}
            </div>
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Season complete"
          subtitle="Every event on this season's circuit has been played.">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>Final Pro Points rank: <strong>{userRank ? `${ordinal(userRank.rank)} of ${ranking.length}` : "—"}</strong></div>
            <button className="btn-cta" onClick={() => dispatch({ type: "ADVANCE_OFFSEASON" })}>Advance to Next Season ›</button>
          </div>
        </SectionCard>
      )}

      {/* Last result banner + its match log. */}
      {lastResult && lastUserPlace && (
        <SectionCard title={`Latest result — ${lastResult.name}`}
          subtitle={`You finished ${ordinal(lastUserPlace.rank)}.`}>
          {(lastResult.userMatches || []).length === 0 ? (
            <div style={{ opacity: 0.75, fontSize: 13 }}>Your team was not drawn into a played match at this event.</div>
          ) : (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead><tr><th>Round</th><th>Opponent</th><th>Result</th><th>Maps</th></tr></thead>
                <tbody>
                  {lastResult.userMatches.map((m, i) => (
                    <tr key={i}>
                      <td>{m.phase}</td>
                      <td>{m.opponent}</td>
                      <td><Pill tone={m.won ? "positive" : "danger"}>{m.won ? "WIN" : "LOSS"}</Pill></td>
                      <td>{m.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      <div className="ui-quicknav" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
        <button className="btn-secondary-sm" onClick={() => setScreen?.("circuit")}>View Full Circuit ›</button>
        <button className="btn-secondary-sm" onClick={() => setScreen?.("standings")}>Pro Points Table ›</button>
        <button className="btn-secondary-sm" onClick={() => setScreen?.("roster")}>Manage Squad ›</button>
        <button className="btn-secondary-sm" onClick={() => setScreen?.("transfers")}>Transfer Centre ›</button>
      </div>

      <SectionCard title={`${team?.name || "Your"} results this season`}
        subtitle="Every event your organisation reached the money rounds in, most recent first. Click a row for the match log.">
        {userEvents.length === 0 ? (
          <EmptyState title="No results yet"
            detail={oc.playedCount ? "Your squad hasn't reached a top-8 finish yet. Keep playing events or strengthen the roster." : "Play your first event to see results here."} />
        ) : (
          <div className="table-scroll" style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Event</th><th>Finish</th><th>Pro Points</th><th>Prize</th><th>Matches</th></tr></thead>
              <tbody>
                {userEvents.map(e => (
                  <Fragment key={e.id}>
                    <tr onClick={() => setExpanded(expanded === e.id ? null : e.id)} style={{ cursor: e.userMatches.length ? "pointer" : "default" }}>
                      <td style={{ whiteSpace: "nowrap", opacity: 0.8 }}>{e.startDate}</td>
                      <td>{e.name}</td>
                      <td><Pill tone={e.rank === 1 ? "gold" : e.rank <= 3 ? "positive" : "neutral"}>{ordinal(e.rank)}</Pill></td>
                      <td>{e.points ? e.points.toLocaleString() : "—"}</td>
                      <td style={{ opacity: 0.85 }}>{money(e.prize)}</td>
                      <td style={{ opacity: 0.7 }}>{e.userMatches.length ? `${e.userMatches.length} ▾` : "—"}</td>
                    </tr>
                    {expanded === e.id && e.userMatches.length > 0 && (
                      <tr>
                        <td colSpan={6} style={{ background: "rgba(255,255,255,0.03)" }}>
                          <div style={{ display: "grid", gap: 3, padding: "6px 4px" }}>
                            {e.userMatches.map((m, i) => (
                              <div key={i} style={{ display: "flex", gap: 10, fontSize: 13 }}>
                                <span style={{ width: 90, opacity: 0.7 }}>{m.phase}</span>
                                <span style={{ width: 70, fontWeight: 700, color: m.won ? "var(--green,#34d399)" : "var(--red,#f87171)" }}>{m.won ? "WIN" : "LOSS"}</span>
                                <span style={{ width: 48 }}>{m.score}</span>
                                <span style={{ opacity: 0.85 }}>vs {m.opponent}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
              {ranking.slice(0, 10).map(row => (
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
