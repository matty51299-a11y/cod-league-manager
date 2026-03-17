// src/store/gameStore.jsx
// Central game state manager using React Context + useReducer.
// Handles: new game, load/save (localStorage), all sim actions.

import { createContext, useContext, useReducer } from "react";
import { buildInitialRoster } from "../data/players.js";
import { generateProspects } from "../data/prospects.js";
import { buildSeason, simNextMatch, simMatchday, simStage, simMajor, simNextMajorMatch, simMajorRound, advanceOffseason } from "../engine/seasonEngine.js";

const SAVE_KEY = "cdl_manager_save";

// ── Initial state factory ─────────────────────────────────────────────────────
function newGameState(userTeamId) {
  const players = buildInitialRoster();
  const prospects = generateProspects(Date.now() % 999983);
  return {
    userTeamId,
    season: 1,
    players,      // all pro players + any signed prospects (Roster reads from here)
    prospects,    // unsigned challengers pool only
    schedule: buildSeason(1),
    notifications: [],
    saveExists: true,
    playerSeasonStats:  {},  // { [playerId]: { kills, deaths, matches } } – reset each season
    playerStatsHistory: {},  // { [playerId]: [{ season, kills, deaths, matches, kd }] }
  };
}

// ── Reducer ──────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case "NEW_GAME":
      return newGameState(action.teamId);

    case "LOAD_GAME":
      return action.state;

    case "SIM_NEXT_MATCH":
      return simNextMatch({ ...state });

    case "SIM_MATCHDAY":
      return simMatchday({ ...state });

    case "SIM_STAGE":
      return simStage({ ...state });

    case "SIM_MAJOR":
      return simMajor({ ...state });

    case "SIM_NEXT_MAJOR_MATCH":
      return simNextMajorMatch({ ...state });

    case "SIM_MAJOR_ROUND":
      return simMajorRound({ ...state });

    case "ADVANCE_OFFSEASON":
      return advanceOffseason({ ...state });

    // ── SIGN PLAYER ───────────────────────────────────────────────────────────
    // Prospects live in state.prospects; pros live in state.players.
    // Roster.jsx reads ONLY from state.players, so signed prospects must be
    // moved (not just updated) into state.players.
    case "SIGN_PLAYER": {
      const { playerId, slotType } = action;
      const userTeam = state.userTeamId;
      const rosterNow = state.players.filter(p => p.teamId === userTeam);

      if (slotType === "starter" && rosterNow.filter(p => !p.isSub).length >= 4) {
        return addNotif(state, "Starter roster is full (4/4). Release a player first.");
      }
      if (slotType === "sub" && rosterNow.filter(p => p.isSub).length >= 1) {
        return addNotif(state, "Sub slot is full (1/1). Release your sub first.");
      }

      const prospect = state.prospects.find(p => p.id === playerId);

      if (prospect) {
        // Move prospect out of prospects array, into players array
        const signed = { ...prospect, teamId: userTeam, isSub: slotType === "sub", scouted: true };
        return addNotif({
          ...state,
          players: [...state.players, signed],
          prospects: state.prospects.filter(p => p.id !== playerId),
        }, `${signed.name} signed!`);
      }

      // Pro free agent already in players — just update teamId
      const target = state.players.find(p => p.id === playerId);
      if (!target) return addNotif(state, "Player not found.");

      return addNotif({
        ...state,
        players: state.players.map(p =>
          p.id === playerId ? { ...p, teamId: userTeam, isSub: slotType === "sub", scouted: true } : p
        ),
      }, `${target.name} signed!`);
    }

    // ── RELEASE PLAYER ────────────────────────────────────────────────────────
    // Prospects go back to prospects pool; pros stay in players with teamId null.
    case "RELEASE_PLAYER": {
      const player = state.players.find(p => p.id === action.playerId);
      if (!player) return state;

      if (player.isProspect) {
        const released = { ...player, teamId: null, isSub: false };
        return addNotif({
          ...state,
          players: state.players.filter(p => p.id !== action.playerId),
          prospects: [...state.prospects, released],
        }, `${player.name} released.`);
      }

      return addNotif({
        ...state,
        players: state.players.map(p =>
          p.id === action.playerId ? { ...p, teamId: null, isSub: false } : p
        ),
      }, `${player.name} released.`);
    }

    case "CLEAR_NOTIF":
      return { ...state, notifications: state.notifications.slice(1) };

    default:
      return state;
  }
}

function addNotif(state, msg) {
  return { ...state, notifications: [...state.notifications, msg] };
}

// ── Context ───────────────────────────────────────────────────────────────────
const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}

// ── localStorage helpers ──────────────────────────────────────────────────────
export function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Save failed:", e);
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteSave() {
  localStorage.removeItem(SAVE_KEY);
}
