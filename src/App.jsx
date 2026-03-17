// src/App.jsx
// Root application component.
// Handles: save/load lifecycle, navigation, notifications, major-intro overlay.

import { useEffect, useRef, useState } from "react";
import { useGame, saveGame, loadGame, deleteSave } from "./store/gameStore.jsx";
import TeamSelect from "./components/TeamSelect.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Standings from "./components/Standings.jsx";
import Roster from "./components/Roster.jsx";
import FreeAgency from "./components/FreeAgency.jsx";
import Prospects from "./components/Prospects.jsx";
import MatchLog from "./components/MatchLog.jsx";
import MajorBracket from "./components/MajorBracket.jsx";
import OffseasonReport from "./components/OffseasonReport.jsx";
import MajorIntroOverlay from "./components/MajorIntroOverlay.jsx";
import { CDL_TEAMS } from "./data/teams.js";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "standings", label: "Standings" },
  { id: "major",     label: "Major" },
  { id: "roster",    label: "Roster" },
  { id: "fa",        label: "Free Agency" },
  { id: "prospects", label: "Challengers" },
  { id: "devreport", label: "Dev Report" },
  { id: "log",       label: "Match Log" },
];

// Stable key for a major event — used to track which intros have been seen.
function majorKey(season, stageIdx) {
  return `${season}_${stageIdx}`;
}

// Persist seen-intro keys in localStorage so they survive page reloads.
function loadSeenIntros() {
  try {
    return JSON.parse(localStorage.getItem("cdl_seen_major_intros") || "[]");
  } catch {
    return [];
  }
}

function saveSeenIntros(arr) {
  try {
    localStorage.setItem("cdl_seen_major_intros", JSON.stringify(arr));
  } catch {}
}

export default function App() {
  const { state, dispatch } = useGame();
  const [tab, setTab]             = useState("dashboard");
  const [confirmNew, setConfirmNew] = useState(false);

  // Track previous schedule phase to detect fresh transitions (not page-reload state).
  const prevPhaseRef = useRef(null);

  // Which major intros the user has already seen (keyed by "season_stageIdx").
  const [seenIntros, setSeenIntros] = useState(loadSeenIntros);

  // Whether to show the intro overlay right now.
  const [showMajorIntro, setShowMajorIntro] = useState(false);

  // On mount: auto-load a save if one exists
  useEffect(() => {
    const saved = loadGame();
    if (saved) {
      dispatch({ type: "LOAD_GAME", state: saved });
    }
  }, []);

  // Auto-save whenever state changes
  useEffect(() => {
    if (state) saveGame(state);
  }, [state]);

  // Notifications: auto-dismiss after 3.5s
  useEffect(() => {
    if (state?.notifications?.length > 0) {
      const t = setTimeout(() => dispatch({ type: "CLEAR_NOTIF" }), 3500);
      return () => clearTimeout(t);
    }
  }, [state?.notifications]);

  // Detect fresh transition into major phase.
  // prevPhaseRef.current is null on first render, so page-reloads into an
  // already-live major will not trigger the overlay or force a tab switch.
  useEffect(() => {
    if (!state) return;

    const phase    = state.schedule?.phase;
    const stageIdx = state.schedule?.currentStage;
    const prevPhase = prevPhaseRef.current;

    if (
      phase === "major" &&
      prevPhase !== null &&          // ignore first render / page reload
      prevPhase !== "major"          // only on actual transition
    ) {
      const key = majorKey(state.season, stageIdx);
      if (!seenIntros.includes(key)) {
        // Auto-navigate to Major tab and show the intro overlay
        setTab("major");
        setShowMajorIntro(true);
      }
    }

    prevPhaseRef.current = phase;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.schedule?.phase, state?.schedule?.currentStage, state?.season]);

  // ── Overlay handlers ──────────────────────────────────────────────────────
  function dismissMajorIntro() {
    const key = majorKey(state.season, state.schedule?.currentStage);
    const updated = seenIntros.includes(key) ? seenIntros : [...seenIntros, key];
    setSeenIntros(updated);
    saveSeenIntros(updated);
    setShowMajorIntro(false);
  }

  function enterMajor() {
    setTab("major");
    dismissMajorIntro();
  }

  // No save loaded yet → show team select
  if (!state) {
    return (
      <div className="app">
        <TeamSelect />
      </div>
    );
  }

  const team = CDL_TEAMS.find(t => t.id === state.userTeamId);
  const notification = state.notifications?.[0];

  function handleNewGame() {
    deleteSave();
    dispatch({ type: "LOAD_GAME", state: null });
    setConfirmNew(false);
  }

  return (
    <div className="app">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="app-title">CDL MANAGER</span>
          <span className="season-badge">S{state.season}</span>
          {team && (
            <span className="user-team-badge" style={{ color: team.color }}>
              {team.tag}
            </span>
          )}
        </div>
        <div className="topbar-right">
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

      {/* Notification toast */}
      {notification && (
        <div className="toast">{notification}</div>
      )}

      {/* Navigation tabs */}
      <nav className="nav-tabs">
        {TABS.map(t => {
          const isMajorLive = t.id === "major" && state.schedule?.phase === "major";
          const hasDevData  = t.id === "devreport" && state.progressionLog?.length > 0;
          return (
            <button
              key={t.id}
              className={`nav-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {isMajorLive && <span className="tab-live-dot" />}
              {hasDevData   && <span className="tab-dev-dot" />}
            </button>
          );
        })}
      </nav>

      {/* Page content */}
      <main className="main-content">
        {tab === "dashboard" && <Dashboard />}
        {tab === "standings" && <Standings />}
        {tab === "major"     && <MajorBracket />}
        {tab === "roster"    && <Roster />}
        {tab === "fa"        && <FreeAgency />}
        {tab === "prospects" && <Prospects />}
        {tab === "devreport" && <OffseasonReport />}
        {tab === "log"       && <MatchLog />}
      </main>

      {/* Major intro overlay — shown once per major on fresh transition */}
      {showMajorIntro && state.schedule?.phase === "major" && (
        <MajorIntroOverlay
          state={state}
          onEnter={enterMajor}
          onDismiss={dismissMajorIntro}
        />
      )}
    </div>
  );
}
