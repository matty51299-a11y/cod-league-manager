// src/App.jsx
// Root application component.
// Handles: save/load lifecycle, sidebar navigation, notifications, overlays.

import { useEffect, useState } from "react";
import { useGame, saveGame, loadGame, deleteSave } from "./store/gameStore.jsx";
import { isValidGameState } from "./store/gameValidation.js";
import "./engine/poolReport.js"; // registers window.poolReport() console utility
import { TeamHubProvider }        from "./store/teamHubContext.jsx";
import { PlayerProfileProvider }  from "./store/playerProfileContext.jsx";
import { MatchCenterProvider }    from "./store/matchCenterContext.jsx";
import ErrorBoundary              from "./components/ErrorBoundary.jsx";
import MatchCenterOverlay         from "./components/MatchCenterOverlay.jsx";
import TeamSelect        from "./components/TeamSelect.jsx";
import Sidebar           from "./components/Sidebar.jsx";
import NextMatchControl  from "./components/NextMatchControl.jsx";
import NextMatchOverlay  from "./components/NextMatchOverlay.jsx";
import Dashboard         from "./components/Dashboard.jsx";
import ChallengerDashboard from "./components/ChallengerDashboard.jsx";
import Standings         from "./components/Standings.jsx";
import Schedule          from "./components/Schedule.jsx";
import KDLeaders         from "./components/KDLeaders.jsx";
import Roster            from "./components/Roster.jsx";
import Dynamics          from "./components/Dynamics.jsx";
import BoardObjectives   from "./components/BoardObjectives.jsx";
import ChallengerBoard   from "./components/ChallengerBoard.jsx";
import FreeAgency        from "./components/FreeAgency.jsx";
import Prospects         from "./components/Prospects.jsx";
import Circuit           from "./components/Circuit.jsx";
import Scouting          from "./components/Scouting.jsx";
import TransferCentre    from "./components/TransferCentre.jsx";
import MatchLog          from "./components/MatchLog.jsx";
import StaffPanel        from "./components/StaffPanel.jsx";
import MajorEntryOverlay    from "./components/MajorEntryOverlay.jsx";
import ChallengerQualifierOverlay from "./components/ChallengerQualifierOverlay.jsx";
import MajorTournamentOverlay from "./components/MajorTournamentOverlay.jsx";
import OffseasonReport   from "./components/OffseasonReport.jsx";
import TeamHubOverlay    from "./components/TeamHubOverlay.jsx";
import PlayerProfileOverlay from "./components/PlayerProfileOverlay.jsx";
import SeasonAwardsOverlay from "./components/SeasonAwardsOverlay.jsx";
import BoardReviewOverlay from "./components/BoardReviewOverlay.jsx";
import TransferAcceptedModal from "./components/TransferAcceptedModal.jsx";
import NotificationsFeed from "./components/NotificationsFeed.jsx";
import Inbox from "./components/Inbox.jsx";
import ConversationModal from "./components/ConversationModal.jsx";
import { getTeamThemeStyle } from "./utils/teamTheme.js";
import { resolveUserTeamMeta, isChallengerMode } from "./utils/userTeam.js";
import { getMorale, getPopupRequiredMoraleEvents, moodForLevel, moraleColor } from "./engine/moraleEngine.js";

export default function App() {
  const { state, dispatch } = useGame();
  const [screen, setScreen]           = useState("home");
  const [confirmNew, setConfirmNew]   = useState(false);
  const [showMatchOverlay, setShowMatchOverlay] = useState(false);
  const [showFeed, setShowFeed]       = useState(false);
  const [activeMoraleMeeting, setActiveMoraleMeeting] = useState(null);
  const [suppressedMoralePrompts, setSuppressedMoralePrompts] = useState([]);

  // On mount: auto-load a save if one exists
  useEffect(() => {
    const saved = loadGame();
    if (saved) {
      dispatch({ type: "LOAD_GAME", state: saved });
    }
  }, [dispatch]);

  // Auto-save only complete, playable game states. This prevents a reset to
  // team select from persisting over a deliberately cleared save.
  useEffect(() => {
    if (isValidGameState(state)) saveGame(state);
  }, [state]);

  // Notifications: auto-dismiss after 3.5s
  useEffect(() => {
    if (state?.notifications?.length > 0) {
      const t = setTimeout(() => dispatch({ type: "CLEAR_NOTIF" }), 3500);
      return () => clearTimeout(t);
    }
  }, [state?.notifications, dispatch]);

  // No save loaded yet → show team select
  if (!isValidGameState(state)) {
    return (
      <ErrorBoundary>
        <div className="app">
          <TeamSelect />
        </div>
      </ErrorBoundary>
    );
  }

  const team         = resolveUserTeamMeta(state);
  const teamThemeStyle = getTeamThemeStyle(team);
  const challengerMode = isChallengerMode(state);
  const notification = state.notifications?.[0];
  const popupMoraleEvents = getPopupRequiredMoraleEvents(state);
  const appMoralePrompt = !activeMoraleMeeting && screen !== "dynamics"
    ? popupMoraleEvents.find(ev => !suppressedMoralePrompts.includes(ev.id))
    : null;

  function handleNewGame() {
    deleteSave();
    dispatch({ type: "RESET_TO_TEAM_SELECT" });
    setScreen("home");
    setShowMatchOverlay(false);
    setShowFeed(false);
    setActiveMoraleMeeting(null);
    setSuppressedMoralePrompts([]);
    setConfirmNew(false);
  }

  return (
    <ErrorBoundary>
    <MatchCenterProvider>
    <TeamHubProvider>
    <PlayerProfileProvider>
    <div className="app" style={teamThemeStyle}>
      {/* ── Top bar ── */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="app-title">{challengerMode ? "CHALLENGER MANAGER" : "CDL MANAGER"}</span>
          <span className="season-badge">S{state.season}</span>
          {team && (
            <span className="user-team-badge" style={{ color: "var(--shell-text)" }}>
              <strong>{team.tag}</strong>
              <span className="user-team-name">{team.name}</span>
            </span>
          )}
        </div>
        <div className="topbar-right">
          {/* Next Match launcher — opens NextMatchOverlay (no direct sim) */}
          <NextMatchControl onOpen={() => setShowMatchOverlay(true)} />

          {!confirmNew ? (
            <button className="btn-new-game" onClick={() => setConfirmNew(true)}>
              New Game
            </button>
          ) : (
            <span className="confirm-row">
              <span className="confirm-text">Erase save?</span>
              <button className="btn-danger-sm" onClick={handleNewGame}>Yes</button>
              <button className="btn-secondary-sm" onClick={() => setConfirmNew(false)}>Cancel</button>
            </span>
          )}
        </div>
      </header>

      {/* ── Notification toast ── */}
      {notification && (
        <div className="toast">{notification}</div>
      )}

      {/* ── App body: sidebar + main ── */}
      <div className="app-body">
        <Sidebar screen={screen} setScreen={setScreen} onOpenFeed={() => setShowFeed(true)} />

        {/* Event overlays — sit above sidebar + main content */}
        <NextMatchOverlay
          isOpen={showMatchOverlay}
          onClose={() => setShowMatchOverlay(false)}
        />
        <MatchCenterOverlay />
        <ChallengerQualifierOverlay />
        <MajorEntryOverlay />
        <MajorTournamentOverlay />
        <TeamHubOverlay />
        <PlayerProfileOverlay />
        <SeasonAwardsOverlay />
        <BoardReviewOverlay />
        <TransferAcceptedModal setScreen={setScreen} />
        <NotificationsFeed isOpen={showFeed} onClose={() => setShowFeed(false)} />
        <AppMoralePrompt
          state={state}
          event={appMoralePrompt}
          onTalkNow={(ev) => {
            setSuppressedMoralePrompts(prev => prev.includes(ev.id) ? prev : [...prev, ev.id]);
            setActiveMoraleMeeting({ player: ev.player, event: ev });
          }}
          onLater={(ev) => {
            setSuppressedMoralePrompts(prev => prev.includes(ev.id) ? prev : [...prev, ev.id]);
            dispatch({ type: "DELAY_MORALE_CONVERSATION", eventId: ev.id });
          }}
          onGoDynamics={(ev) => {
            setSuppressedMoralePrompts(prev => prev.includes(ev.id) ? prev : [...prev, ev.id]);
            setScreen("dynamics");
          }}
        />
        {activeMoraleMeeting && (
          <ConversationModal
            player={activeMoraleMeeting.player}
            event={activeMoraleMeeting.event}
            onClose={() => setActiveMoraleMeeting(null)}
          />
        )}


        {/* Screen content */}
        <main className="main-content">
          {screen === "home"      && (challengerMode ? <ChallengerDashboard setScreen={setScreen} /> : <Dashboard setScreen={setScreen} />)}
          {screen === "inbox"    && <Inbox setScreen={setScreen} />}
          {screen === "standings" && <Standings />}
          {screen === "schedule"  && <Schedule />}
          {screen === "kdleaders" && <KDLeaders />}
          {screen === "roster"    && <Roster setScreen={setScreen} />}
          {screen === "dynamics"  && <Dynamics />}
          {screen === "board"     && (challengerMode ? <ChallengerBoard /> : <BoardObjectives />)}
          {screen === "fa"        && <FreeAgency />}
          {screen === "prospects" && <Prospects />}
          {screen === "circuit"   && <Circuit />}
          {screen === "scouting"  && <Scouting />}
          {screen === "transfers" && <TransferCentre />}
          {screen === "devreport" && <OffseasonReport />}
          {screen === "staff"     && <StaffPanel />}
          {screen === "log"       && <MatchLog />}
        </main>
      </div>
    </div>
    </PlayerProfileProvider>
    </TeamHubProvider>
    </MatchCenterProvider>
    </ErrorBoundary>
  );
}


function AppMoralePrompt({ state, event, onTalkNow, onLater, onGoDynamics }) {
  if (!event?.player) return null;
  const morale = getMorale(state, event.player.id);
  const concern = event.topic ? event.topic.replaceAll("_", " ") : "squad dynamics";
  return (
    <div className="app-morale-backdrop">
      <div className={`app-morale-prompt sev-${event.severity}`}>
        <div className="meeting-eyebrow">Player Meeting Required</div>
        <h3>{event.player.name} wants to speak about {concern}.</h3>
        <div className="app-morale-grid">
          <span><b>Player</b>{event.player.name}</span>
          <span><b>Morale</b><em style={{ color: moraleColor(morale.level) }}>{morale.level} {moodForLevel(morale.level)}</em></span>
          <span><b>Concern</b>{concern}</span>
          <span><b>Severity</b>{event.severity}</span>
        </div>
        <p>{event.trigger}</p>
        <div className="app-morale-actions">
          <button className="btn-primary-sm" onClick={() => onTalkNow?.(event)}>Talk Now</button>
          <button className="btn-secondary-sm" onClick={() => onLater?.(event)}>Later</button>
          <button className="btn-secondary-sm" onClick={() => onGoDynamics?.(event)}>Go to Dynamics</button>
        </div>
      </div>
    </div>
  );
}
