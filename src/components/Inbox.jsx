// src/components/Inbox.jsx
// Full-page Inbox / Event Centre — FM-style manager news and action hub.

import { useState, useMemo } from "react";
import { useGame } from "../store/gameStore.jsx";
import { usePlayerProfile } from "../store/playerProfileContext.jsx";
import {
  getSortedEvents, getActiveEvents, getActionRequiredCount, getUnreadCount,
  CATEGORY_LIST, CATEGORY_ICON,
  severityColor,
} from "../engine/eventCentreEngine.js";
import { CDL_TEAMS } from "../data/teams.js";

const PHASE_LABEL = {
  stage: "Stage", major: "Major", challengerQualifier: "Qualifier",
  preChamps: "Pre-Champs", offseason: "Offseason", contracts: "Contracts",
};

const FILTER_CATEGORIES = [
  "All", "Unread", "Action Required",
  "Transfers", "Morale", "Board", "Scouting", "Contracts",
  "Match Results", "Tournament", "Awards", "Staff", "League News", "Rival Moves",
];

export default function Inbox({ setScreen }) {
  const { state, dispatch } = useGame();
  const { openProfile } = usePlayerProfile?.() ?? {};
  const [selectedId, setSelectedId] = useState(null);
  const [activeFilter, setActiveFilter] = useState("All");

  const ec = state?.eventCentre;
  const sortedAll = useMemo(() => getSortedEvents(ec), [ec]);

  const filtered = useMemo(() => {
    let items = sortedAll;
    if (activeFilter === "Unread") items = items.filter(e => !e.read);
    else if (activeFilter === "Action Required") items = items.filter(e => e.actionRequired && !e.read);
    else if (activeFilter !== "All") items = items.filter(e => e.category === activeFilter);
    return items;
  }, [sortedAll, activeFilter]);

  const selected = useMemo(() => {
    if (!selectedId) return filtered[0] ?? null;
    return (ec?.events ?? []).find(e => e.id === selectedId && !e.dismissed) ?? filtered[0] ?? null;
  }, [selectedId, ec, filtered]);

  const categoryCounts = useMemo(() => {
    const active = getActiveEvents(ec);
    const counts = {};
    for (const c of CATEGORY_LIST) counts[c] = 0;
    for (const e of active) {
      if (e.category) counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  }, [ec]);

  const actionCount = getActionRequiredCount(ec);
  const unreadCount = getUnreadCount(ec);

  function handleSelectEvent(ev) {
    setSelectedId(ev.id);
    if (!ev.read) dispatch({ type: "MARK_EVENT_READ", eventId: ev.id });
  }

  function handleDismiss(ev) {
    dispatch({ type: "DISMISS_EVENT", eventId: ev.id });
    if (selectedId === ev.id) setSelectedId(null);
  }

  function handleMarkAllRead() {
    dispatch({ type: "MARK_ALL_EVENTS_READ" });
  }

  function handleAction(ev, action) {
    if (!ev.read) dispatch({ type: "MARK_EVENT_READ", eventId: ev.id });
    switch (action) {
      case "review_offer":
      case "open_transfers":
        setScreen?.("transfers"); break;
      case "open_player":
        if (ev.relatedPlayerId && openProfile) {
          const p = (state.players ?? []).find(pl => pl.id === ev.relatedPlayerId)
            || (state.prospects ?? []).find(pl => pl.id === ev.relatedPlayerId);
          if (p) openProfile(p);
        }
        break;
      case "talk_to_player":
      case "talk_now":
      case "go_dynamics":
      case "open_dynamics":
        setScreen?.("dynamics"); break;
      case "view_board":
      case "review_objectives":
        setScreen?.("board"); break;
      case "open_scouting":
      case "view_report":
      case "shortlist":
      case "scout_again":
        setScreen?.("scouting"); break;
      case "review_contracts":
        setScreen?.("home"); break;
      case "open_fa":
        setScreen?.("fa"); break;
      case "view_bracket":
        setScreen?.("home"); break;
      case "view_standings":
        setScreen?.("standings"); break;
      case "view_schedule":
        setScreen?.("schedule"); break;
      case "continue":
        setScreen?.("home"); break;
      case "view_details":
      case "open_match_log":
        setScreen?.("log"); break;
      case "open_roster":
        setScreen?.("roster"); break;
      case "dismiss":
        handleDismiss(ev); break;
      default: break;
    }
  }

  function resolveTeam(teamId) {
    return CDL_TEAMS.find(t => t.id === teamId);
  }

  if (!ec) return <div className="inbox-page"><div className="inbox-loading">Loading Event Centre...</div></div>;

  return (
    <div className="inbox-page">
      {/* Header */}
      <div className="inbox-header">
        <div className="inbox-header-left">
          <h1 className="inbox-title">Event Centre</h1>
          <div className="inbox-counts">
            {actionCount > 0 && (
              <span className="inbox-count-chip inbox-count-chip--action">
                {actionCount} Action{actionCount !== 1 ? "s" : ""} Required
              </span>
            )}
            {unreadCount > 0 && (
              <span className="inbox-count-chip inbox-count-chip--unread">
                {unreadCount} Unread
              </span>
            )}
          </div>
        </div>
        <div className="inbox-header-right">
          {unreadCount > 0 && (
            <button className="inbox-mark-all-btn" onClick={handleMarkAllRead}>
              Mark All Read
            </button>
          )}
        </div>
      </div>

      {/* Filter chips bar */}
      <div className="inbox-filter-bar">
        {FILTER_CATEGORIES.map(cat => {
          const isActive = activeFilter === cat;
          const count = cat === "All" ? sortedAll.length
            : cat === "Unread" ? unreadCount
            : cat === "Action Required" ? actionCount
            : categoryCounts[cat] ?? 0;
          return (
            <button
              key={cat}
              className={`inbox-chip ${isActive ? "inbox-chip--active" : ""} ${cat === "Action Required" && actionCount > 0 ? "inbox-chip--warning" : ""}`}
              onClick={() => setActiveFilter(cat)}
            >
              {CATEGORY_ICON[cat] && <span className="inbox-chip-icon">{CATEGORY_ICON[cat]}</span>}
              {cat}
              {count > 0 && <span className="inbox-chip-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <div className="inbox-body">
        {/* Event list */}
        <div className="inbox-list">
          {filtered.length === 0 ? (
            <div className="inbox-empty-state">
              <div className="inbox-empty-icon">
                {activeFilter === "Action Required" ? "✓" : activeFilter === "Unread" ? "✓" : "◈"}
              </div>
              <h3 className="inbox-empty-title">
                {activeFilter === "Action Required" ? "No actions required"
                  : activeFilter === "Unread" ? "All caught up!"
                  : "No inbox items yet"}
              </h3>
              <p className="inbox-empty-body">
                {activeFilter === "Action Required"
                  ? "No urgent items need your attention right now."
                  : activeFilter === "Unread"
                  ? "You've read all your events. New reports will appear as matches are played."
                  : "Play a match or advance the stage to generate reports, offers, scouting notes and board updates."}
              </p>
              {activeFilter === "All" && (
                <button className="inbox-empty-cta" onClick={() => setScreen?.("home")}>
                  Go Home
                </button>
              )}
            </div>
          ) : filtered.map(ev => (
            <div
              key={ev.id}
              className={[
                "inbox-card",
                !ev.read && "inbox-card--unread",
                ev.actionRequired && !ev.read && "inbox-card--action",
                selected?.id === ev.id && "inbox-card--selected",
              ].filter(Boolean).join(" ")}
              onClick={() => handleSelectEvent(ev)}
            >
              <div className="inbox-card-top">
                <span className="inbox-card-category">
                  <span className="inbox-card-cat-icon" style={{ color: severityColor(ev.severity) }}>
                    {CATEGORY_ICON[ev.category] ?? "·"}
                  </span>
                  {ev.category}
                </span>
                <div className="inbox-card-badges">
                  {ev.actionRequired && !ev.read && (
                    <span className="inbox-card-action-chip">Action</span>
                  )}
                  <span className="inbox-card-sev-chip" style={{ background: severityColor(ev.severity) + "22", color: severityColor(ev.severity) }}>
                    {ev.severity}
                  </span>
                  {!ev.read && <span className="inbox-card-unread-dot" />}
                </div>
              </div>
              <div className="inbox-card-title">{ev.title}</div>
              {ev.summary && <div className="inbox-card-summary">{ev.summary}</div>}
              <div className="inbox-card-meta">
                <span>S{ev.season} · {PHASE_LABEL[ev.phase] ?? ev.phase}</span>
                {ev.relatedTeamId && (
                  <span className="inbox-card-team">{resolveTeam(ev.relatedTeamId)?.tag ?? ""}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <aside className="inbox-detail">
          {selected ? (
            <div className="inbox-detail-inner">
              <div className="inbox-detail-header">
                <span className="inbox-detail-cat" style={{ color: severityColor(selected.severity) }}>
                  {CATEGORY_ICON[selected.category] ?? "·"} {selected.category}
                </span>
                <span className="inbox-detail-sev" style={{
                  background: severityColor(selected.severity),
                  color: "#fff",
                }}>
                  {selected.severity}
                </span>
              </div>

              <h2 className="inbox-detail-title">{selected.title}</h2>
              <p className="inbox-detail-summary">{selected.summary}</p>

              <div className="inbox-detail-meta">
                <span>Season {selected.season}</span>
                <span>{PHASE_LABEL[selected.phase] ?? selected.phase}</span>
                {selected.stage != null && <span>Stage {selected.stage + 1}</span>}
              </div>

              {/* Match data */}
              {selected.matchData && (
                <div className="inbox-detail-match">
                  <div className="inbox-detail-match-score">
                    <span>{selected.matchData.teamATag}</span>
                    <span className="inbox-detail-match-vs">
                      {selected.matchData.scoreA} - {selected.matchData.scoreB}
                    </span>
                    <span>{selected.matchData.teamBTag}</span>
                  </div>
                  {selected.matchData.maps && selected.matchData.maps.length > 0 && (
                    <div className="inbox-detail-maps">
                      {selected.matchData.maps.map((m, i) => (
                        <div key={i} className="inbox-detail-map-row">
                          <span className="inbox-detail-map-name">{m.mapName ?? `Map ${i + 1}`}</span>
                          <span>{m.scoreA} - {m.scoreB}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selected.matchData.bestPerformer && (
                    <div className="inbox-detail-performer">
                      MVP: {selected.matchData.bestPerformer.name} ({selected.matchData.bestPerformer.kd} K/D)
                    </div>
                  )}
                </div>
              )}


              {selected.reportData && (
                <div className="inbox-report-grid">
                  {Object.entries(selected.reportData).map(([label, value]) => (
                    <div key={label} className={label === "Recommendation" || label === "Suggested Next Action" ? "inbox-report-row inbox-report-row--wide" : "inbox-report-row"}>
                      <span>{label}</span>
                      <strong>{String(value)}</strong>
                    </div>
                  ))}
                </div>
              )}

              {/* Related player */}
              {selected.relatedPlayerId && (() => {
                const p = (state.players ?? []).find(pl => pl.id === selected.relatedPlayerId)
                  || (state.prospects ?? []).find(pl => pl.id === selected.relatedPlayerId);
                if (!p) return null;
                const t = p.teamId ? resolveTeam(p.teamId) : null;
                return (
                  <div className="inbox-detail-related">
                    <div className="inbox-detail-related-label">Related Player</div>
                    <div className="inbox-detail-related-name"
                      style={{ cursor: openProfile ? "pointer" : "default" }}
                      onClick={() => openProfile?.(p)}
                    >
                      {p.name}
                    </div>
                    <div className="inbox-detail-related-info">
                      OVR {p.overall} · Age {p.age} · {p.primary}
                      {t ? ` · ${t.tag}` : ""}
                    </div>
                  </div>
                );
              })()}

              {/* Related team */}
              {selected.relatedTeamId && (() => {
                const t = resolveTeam(selected.relatedTeamId);
                if (!t) return null;
                return (
                  <div className="inbox-detail-related">
                    <div className="inbox-detail-related-label">Related Team</div>
                    <div className="inbox-detail-related-name">{t.name}</div>
                  </div>
                );
              })()}

              {/* Recommendations */}
              {selected.type === "transfer_offer" && (
                <div className="inbox-detail-recommendation">
                  <span className="inbox-rec-role">Assistant GM</span>
                  Review this offer carefully. Consider the player's value to your squad and the fee on the table.
                </div>
              )}
              {selected.type === "morale_meeting" && (
                <div className="inbox-detail-recommendation">
                  <span className="inbox-rec-role">Assistant GM</span>
                  This player has something on their mind. A timely conversation could prevent issues.
                </div>
              )}
              {selected.type === "board_warning" && (
                <div className="inbox-detail-recommendation">
                  <span className="inbox-rec-role">Assistant GM</span>
                  The board expects a response. Improved results or a strategic plan could restore confidence.
                </div>
              )}
              {selected.type === "contract_review" && (
                <div className="inbox-detail-recommendation">
                  <span className="inbox-rec-role">Assistant GM</span>
                  Don't let key players slip away. Review expiring contracts before free agency opens.
                </div>
              )}
              {selected.type === "scout_report" && (
                <div className="inbox-detail-recommendation">
                  <span className="inbox-rec-role">Analyst</span>
                  This report is ready for review. Deeper scouting could narrow our estimates further.
                </div>
              )}
              {selected.type === "promise_at_risk" && (
                <div className="inbox-detail-recommendation">
                  <span className="inbox-rec-role">Assistant GM</span>
                  This promise is at risk of being broken. Act now to maintain trust.
                </div>
              )}
              {(selected.type === "match_summary" || selected.type === "user_match_result") && (
                <div className="inbox-detail-recommendation">
                  <span className="inbox-rec-role">Head Coach</span>
                  {selected.matchData?.won ? "Strong result. Keep the momentum going into the next series." : "We need to regroup. Let's review what went wrong and prepare for the next opponent."}
                </div>
              )}

              {/* Action buttons */}
              {selected.actions?.length > 0 && (
                <div className="inbox-detail-actions">
                  {selected.actions.filter(a => a !== "dismiss").map(a => (
                    <button
                      key={a}
                      className="inbox-action-btn"
                      onClick={() => handleAction(selected, a)}
                    >
                      {formatActionLabel(a)}
                    </button>
                  ))}
                  <button
                    className="inbox-action-btn inbox-action-btn--secondary"
                    onClick={() => handleDismiss(selected)}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="inbox-detail-empty">
              <div className="inbox-empty-icon">◈</div>
              <div className="inbox-empty-body">Select an event to see details</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function formatActionLabel(action) {
  const labels = {
    review_offer: "Review Offer",
    open_player: "View Player",
    open_transfers: "Open Transfers",
    dismiss: "Dismiss",
    talk_now: "Talk Now",
    go_dynamics: "Open Dynamics",
    open_dynamics: "Open Dynamics",
    delay: "Delay",
    view_board: "View Board",
    review_objectives: "Review Objectives",
    view_report: "View Report",
    scout_again: "Scout Again",
    shortlist: "Shortlist",
    review_contracts: "Review Contracts",
    open_fa: "Open Free Agency",
    open_roster: "Open Roster",
    view_bracket: "View Bracket",
    view_standings: "View Standings",
    view_schedule: "View Schedule",
    view_details: "View Details",
    open_match_log: "View Match Log",
    continue: "Continue",
    talk_to_player: "Talk to Player",
    open_scouting: "Open Scouting",
  };
  return labels[action] ?? action.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
}
