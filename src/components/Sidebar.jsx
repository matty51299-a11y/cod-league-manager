// src/components/Sidebar.jsx
// Left sidebar navigation — replaces the horizontal nav-tabs bar.

import { useGame } from "../store/gameStore.jsx";
import { getTeamUiTheme } from "../utils/teamTheme.js";
import { getAcceptedOutgoingTermsOffers } from "../engine/transferEngine.js";
import { resolveUserTeamMeta, isChallengerMode } from "../utils/userTeam.js";
import { stateUsesOpenCircuit } from "../engine/openCircuitCareer.js";
import { getActionRequiredMoraleEvents } from "../engine/moraleEngine.js";
import { getActionRequiredCount, getUnreadCount } from "../engine/eventCentreEngine.js";

const NAV_ITEMS = [
  { id: "home",      icon: "⌂",  label: "Home" },
  { id: "inbox",     icon: "◈",  label: "Inbox" },
  { id: "standings", icon: "≡",  label: "Standings" },
  { id: "schedule",  icon: "◫",  label: "Schedule" },
  { id: "kdleaders", icon: "↑",  label: "K/D Leaders" },
  { id: "roster",    icon: "♟",  label: "Roster" },
  { id: "dynamics",  icon: "♥",  label: "Dynamics" },
  { id: "board",     icon: "⚖",  label: "Board" },
  { id: "career",    icon: "★",  label: "Career", modernOnly: true },
  { id: "fa",        icon: "$",  label: "Free Agency", offseasonOnly: true },
  { id: "scouting",  icon: "◎",  label: "Scouting" },
  { id: "transfers", icon: "⇄",  label: "Transfers" },
  { id: "circuit",   icon: "◆",  label: "Circuit", openCircuitOnly: true },
  { id: "prospects", icon: "◉",  label: "Challengers", hideInOpenCircuit: true },
  { id: "devreport", icon: "⬡",  label: "Dev Report" },
  { id: "staff",     icon: "✦",  label: "Staff" },
  { id: "log",       icon: "▤",  label: "Match Log" },
];

// Labels that read differently when managing a Challenger team.
const CHALLENGER_LABELS = {
  standings: "Circuit",
  transfers: "Buyouts",
  prospects: "Market",
};

export default function Sidebar({ screen, setScreen, onOpenFeed }) {
  const { state } = useGame();
  if (!state) return null;

  const { schedule } = state;
  const team  = resolveUserTeamMeta(state);
  const teamTheme = getTeamUiTheme(team);
  const phase = schedule.phase;
  const challengerMode = isChallengerMode(state);

  // Phase pill text
  const stageIdx  = schedule.stageIdx ?? 0;
  const stageName = schedule.stages?.[stageIdx]?.name ?? "Stage";
  const majorName = schedule.majors?.[schedule.majorIdx ?? 0]?.name ?? "Major";
  const remaining = (() => {
    if (phase !== "stage") return null;
    const st = schedule.stages?.[stageIdx];
    return st ? st.matches.filter(m => !m.played).length : null;
  })();

  const pillText = (() => {
    if (stateUsesOpenCircuit(state) && (phase === "stage" || phase === "major" || phase === "challengerQualifier")) return "Open Circuit";
    if (phase === "stage")      return `${stageName}${remaining != null ? ` · ${remaining} left` : ""}`;
    if (phase === "challengerQualifier") return `${majorName} Qualifier`;
    if (phase === "major")      return `${majorName} — LIVE`;
    if (phase === "preChamps")  return "Pre-Championship";
    if (phase === "offseason")  return "Offseason";
    return phase;
  })();

  const pillClass = phase === "major" || phase === "challengerQualifier" ? "sb-pill sb-pill-live"
                  : phase === "offseason" ? "sb-pill sb-pill-dim"
                  : "sb-pill";

  const hasDevData  = state.progressionLog?.length > 0;
  const unreadFeed  = (state.feed ?? []).filter(f => !f.read).length;
  const inboxActionCount = getActionRequiredCount(state.eventCentre);
  const inboxUnreadCount = getUnreadCount(state.eventCentre);
  const inboxBadge = inboxActionCount > 0 ? inboxActionCount : (inboxUnreadCount > 0 ? inboxUnreadCount : 0);
  const transferActions = getAcceptedOutgoingTermsOffers(state).length;
  const moraleActions = getActionRequiredMoraleEvents(state);
  const moraleActionCount = moraleActions.length;
  const moraleHasHighPriority = moraleActions.some(ev => ev.severity === "high" || ev.severity === "critical");
  const showFreeAgency = phase === "offseason" || phase === "contracts" || !!state.offseason?.freeAgencyOpen;
  const openCircuit = stateUsesOpenCircuit(state);
  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (item.offseasonOnly && !showFreeAgency) return false;
    if (item.openCircuitOnly && !openCircuit) return false;
    if (item.hideInOpenCircuit && openCircuit) return false;
    if (item.modernOnly && state.userTeamType !== "cdl") return false;
    return true;
  });

  return (
    <aside className="sidebar">
      {/* Team identity */}
      <div className="sb-team-block">
        <span className="sb-team-dot" style={{ background: teamTheme.primaryAccent, boxShadow: `0 0 12px ${teamTheme.borderAccent}` }} />
        <span className="sb-team-tag" style={{ color: teamTheme.textAccent }}>
          {team?.tag ?? "???"}
        </span>
        <span className="sb-season">S{state.season}</span>
      </div>

      {/* Nav items */}
      <nav className="sb-nav">
        {visibleNavItems.map(item => (
          <button
            key={item.id}
            className={`sb-item ${screen === item.id ? "active" : ""}`}
            onClick={() => setScreen(item.id)}
          >
            <span className="sb-icon">{item.icon}</span>
            <span className="sb-label">{(() => {
              const label = (challengerMode && CHALLENGER_LABELS[item.id]) || item.label;
              return item.id === "transfers" && transferActions > 0 ? `${label} (${transferActions})` : label;
            })()}</span>
            {item.id === "devreport" && hasDevData && <span className="sb-dot" />}
            {item.id === "inbox" && inboxBadge > 0 && <span className={`sb-badge ${inboxActionCount > 0 ? "sb-badge-warning" : ""}`}>{inboxBadge > 99 ? "99+" : inboxBadge}</span>}
            {item.id === "dynamics" && moraleActionCount > 0 && <span className={`sb-badge ${moraleHasHighPriority ? "sb-badge-warning" : ""}`}>{moraleActionCount > 9 ? "9+" : moraleActionCount}</span>}
            {item.id === "transfers" && transferActions > 0 && <span className="sb-badge">{transferActions > 9 ? "9+" : transferActions}</span>}
          </button>
        ))}

        {/* Feed button — opens overlay, does not navigate screens */}
        <button className="sb-item sb-feed-btn" onClick={onOpenFeed}>
          <span className="sb-icon">◈</span>
          <span className="sb-label">Feed</span>
          {unreadFeed > 0 && (
            <span className="sb-badge">{unreadFeed > 99 ? "99+" : unreadFeed}</span>
          )}
        </button>
      </nav>

      {/* Phase status pill at bottom */}
      <div className="sb-footer">
        <span className={pillClass}>{pillText}</span>
      </div>
    </aside>
  );
}
