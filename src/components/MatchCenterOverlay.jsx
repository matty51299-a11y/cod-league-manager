// src/components/MatchCenterOverlay.jsx
// Map-by-map interactive match center.
//
// Flow:
//   pregame      — matchup preview, "Start Match" button
//   simming      — 600ms pause then map auto-sims
//   map_result   — show map winner, player stats, procs
//   intermission — 3 tactical adjustment choices between maps
//   complete     — final series result, "Done" dispatches to game store
//
// Attributes drive results per mode (Hardpoint/S&D/Control).
// Traits (Tilt, Clutch, Leadership) apply between maps via applyTraitModifiers.

import { useReducer, useEffect, useState } from "react";
import { useGame }         from "../store/gameStore.jsx";
import { useMatchCenter }  from "../store/matchCenterContext.jsx";
import { CDL_TEAMS }       from "../data/teams.js";
import { simMap, makeMatchRng, generateSeriesMods } from "../engine/matchSim.js";
import { getTeamMapProfile, autoVeto, mapStrengthMod, calcStaffPrep } from "../engine/mapProfile.js";
import TeamLogo from "./TeamLogo.jsx";
import { resolveTeamDisplay } from "../utils/teamDisplay.js";
import { usePlayerProfile } from "../store/playerProfileContext.jsx";
import { formatMapLabel, softenedMapEdge } from "../utils/mapDisplay.js";

function getTeamMeta(id, schedule) { return CDL_TEAMS.find(t => t.id === id) ?? schedule?.currentMajorEventTeams?.[id] ?? null; }
function teamColor(id, schedule) { return getTeamMeta(id, schedule)?.color ?? "#888"; }
function teamName(id, schedule)  { return getTeamMeta(id, schedule)?.name  ?? id; }
function teamTag(id, schedule)   { return getTeamMeta(id, schedule)?.tag   ?? id; }

const MAP_MODES = ["Hardpoint", "Search & Destroy", "Overload", "Hardpoint", "Search & Destroy"];
const TACTICS = [
  {
    id: "standard",
    label: "Standard",
    guidance: "Safest default. No modifier is applied to the next map.",
  },
  {
    id: "aggressive",
    label: "Aggressive Pace",
    guidance: "Best for Hardpoint or when chasing. Riskier if your team has low composure.",
  },
  {
    id: "slow",
    label: "Slow Fundamentals",
    guidance: "Best for S&D/Overload. Reduces chaos but may blunt slaying advantage.",
  },
  {
    id: "protect",
    label: "Protect Lead",
    guidance: "Best when ahead in the series. Poor choice if chasing.",
  },
  {
    id: "swing",
    label: "Swing Momentum",
    guidance: "High-risk option when behind. Can flip a map or backfire.",
  },
];

function addBoost(boosts, attr, amount) {
  if (!amount) return;
  boosts[attr] = (boosts[attr] ?? 0) + amount;
}

function staffTacticSupport(staff, teamId) {
  const prep = calcStaffPrep(staff, teamId);
  const hc = prep.headCoach;
  const analyst = prep.analyst;
  const tacticalAvg = ((hc?.tactical ?? 70) + (analyst?.tactical ?? 70)) / 2;
  const discipline = hc?.discipline ?? 70;
  return {
    bonus: tacticalAvg >= 84 ? 1 : tacticalAvg >= 74 ? 0.5 : 0,
    disciplineRelief: discipline >= 82 ? 0.5 : 0,
    hasStaffRead: Boolean(hc || analyst),
  };
}

function buildTacticEffect(tacticId, { mode, seriesScore, userTeamIsA, staffSupport }) {
  const [wA, wB] = seriesScore;
  const userWins = userTeamIsA ? wA : wB;
  const oppWins = userTeamIsA ? wB : wA;
  const trailing = userWins < oppWins;
  const leading = userWins > oppWins;
  const boosts = {};
  let mapStrModUser = 0;
  let effectText = "No modifier";
  let note = "No risk added.";
  const staff = staffSupport?.bonus ?? 0;
  const relief = staffSupport?.disciplineRelief ?? 0;

  if (tacticId === "aggressive") {
    addBoost(boosts, "gunny", 1 + (trailing ? 1 : 0));
    addBoost(boosts, "objective", mode === "Hardpoint" ? 2 + staff : 1);
    addBoost(boosts, "awareness", -(1.5 - relief));
    mapStrModUser = mode === "Hardpoint" ? 0.5 + staff * 0.2 : trailing ? 0.25 : 0.1;
    effectText = mode === "Hardpoint" ? "Hardpoint pressure +2 · Variance increased" : "Pace +1 · Variance increased";
    note = "Can create pressure, but weaker awareness can backfire.";
  } else if (tacticId === "slow") {
    addBoost(boosts, "awareness", 1.5 + staff);
    addBoost(boosts, "teamwork", 1.5);
    addBoost(boosts, "composure", (mode === "Search & Destroy" || mode === "Overload") ? 2 : 1);
    addBoost(boosts, "gunny", -1);
    mapStrModUser = (mode === "Search & Destroy" || mode === "Overload") ? 0.45 + staff * 0.2 : 0.15;
    effectText = mode === "Search & Destroy" ? "S&D structure +2 · Variance reduced" : mode === "Overload" ? "Overload structure +2 · Variance reduced" : "Structure +1 · Slaying upside reduced";
    note = "Stabilizes the map but lowers slaying upside slightly.";
  } else if (tacticId === "protect") {
    if (leading) {
      addBoost(boosts, "composure", 2 + staff);
      addBoost(boosts, "teamwork", 1.5);
      mapStrModUser = 0.4 + staff * 0.2;
      effectText = "Composure +2 · Collapse risk reduced";
      note = "Best fit: your team is currently leading.";
    } else {
      addBoost(boosts, "gunny", -1);
      addBoost(boosts, "objective", -0.5);
      mapStrModUser = -0.25;
      effectText = "Conservative setup · Poor fit while not ahead";
      note = "Warning: this is intended for protecting a lead, not chasing.";
    }
  } else if (tacticId === "swing") {
    addBoost(boosts, "gunny", trailing ? 2 + staff : 1);
    addBoost(boosts, "clutch", trailing ? 1 : 0.5);
    addBoost(boosts, "awareness", -(2 - relief));
    addBoost(boosts, "composure", -1);
    mapStrModUser = trailing ? 0.55 + staff * 0.2 : -0.15;
    effectText = trailing ? "Comeback spark +2 · Variance high" : "High variance · Poor fit while not behind";
    note = trailing ? "High-risk comeback call with real downside." : "Warning: risky call is best saved for when trailing.";
  }

  const tactic = TACTICS.find(t => t.id === tacticId) ?? TACTICS[0];
  return { id: tacticId, label: tactic.label, boosts, mapStrModUser, effectText, note };
}

function mergeMapSlot(mapSet, idx) {
  const slot = mapSet?.[idx];
  if (slot?.selectedMap) return { ...slot.selectedMap, edgeA: slot.edgeA, slot: idx + 1 };
  return { name: null, mode: MAP_MODES[idx], edgeA: null, slot: idx + 1 };
}

// ── Reducer ───────────────────────────────────────────────────────────────────
const INIT = {
  phase:              "pregame",   // pregame | simming | map_result | intermission | complete
  rng:                null,
  seriesMods:         null,        // generated once before map 1, persisted across all maps
  currentMapIdx:      0,
  seriesScore:        [0, 0],      // [winsA, winsB]
  mapResults:         [],
  accStats:           {},          // { [pid]: { name, teamId, kills, deaths } }
  currentMapStats:    null,        // per-player stats for the map just played
  procs:              [],
  momentum:           0.5,
  tiltedIdsA:         new Set(),
  tiltedIdsB:         new Set(),
  lastMapKDByPlayer:  {},
  pendingBoostA:      {},
  pendingBoostB:      {},
  pendingMapStrModA:  0,
  pendingTactic:      null,
  finalResult:        null,
};

function buildFinalResult(teamA, teamB, mapResults, winsA, winsB, accStats) {
  const playerStats = {};
  for (const [id, s] of Object.entries(accStats)) {
    playerStats[id] = {
      ...s,
      kd: s.deaths > 0 ? +(s.kills / s.deaths).toFixed(2) : s.kills > 0 ? s.kills : 0,
    };
  }

  const winner = winsA === 3 ? teamA : teamB;
  const loser  = winsA === 3 ? teamB : teamA;
  const score  = `${Math.max(winsA, winsB)}-${Math.min(winsA, winsB)}`;

  const winnerStats = winner.players.slice(0, 4)
    .map(p => ({ p, stat: playerStats[p.id] }))
    .filter(x => x.stat && x.stat.kills >= 3)
    .sort((a, b) => b.stat.kd - a.stat.kd);
  const standout = winnerStats[0]?.p ?? winner.players[0];

  return {
    winnerId:     winner.id,
    loserId:      loser.id,
    winnerName:   winner.name,
    loserName:    loser.name,
    score,
    teamAId:      teamA.id,
    teamAName:    teamA.name,
    teamBId:      teamB.id,
    teamBName:    teamB.name,
    winsA,
    winsB,
    mapResults,
    playerStats,
    standoutId:   standout?.id   ?? null,
    standoutName: standout?.name ?? null,
    standoutKD:   standout ? (playerStats[standout.id]?.kd ?? 0) : 0,
  };
}

function reducer(state, action) {
  switch (action.type) {

    case "RESET":
      return { ...INIT, tiltedIdsA: new Set(), tiltedIdsB: new Set() };

    case "START":
      return { ...state, phase: "simming", rng: makeMatchRng(action.seed) };

    case "SIM_MAP": {
      const { teamA, teamB, mapSet } = action;

      // Generate series performance modifiers once on map 1, reuse for all subsequent maps
      let seriesMods = state.seriesMods;
      if (seriesMods === null) {
        const allPlayers = [...teamA.players.slice(0, 4), ...teamB.players.slice(0, 4)];
        seriesMods = generateSeriesMods(allPlayers, state.rng);
      }

      // CDL 2026 map layer (opt-in): real map identity + capped strength edge.
      const mapMod = mapSet?.[state.currentMapIdx] ?? null;

      const { mapResult, playerMapStats, procs, newTiltedIdsA, newTiltedIdsB, momentum } =
        simMap(teamA, teamB, state.currentMapIdx, {
          tiltedIdsA:        state.tiltedIdsA,
          tiltedIdsB:        state.tiltedIdsB,
          lastMapKDByPlayer: state.lastMapKDByPlayer,
          extraBoostsA:      state.pendingBoostA,
          extraBoostsB:      state.pendingBoostB,
          seriesMods,
          selectedMap:       mapMod?.selectedMap ?? null,
          mapStrModA:        (mapMod?.strModA ?? 0) + (state.pendingMapStrModA ?? 0),
          mapEdgeA:          mapMod?.edgeA ?? null,
        }, state.rng);

      const aWon     = mapResult.winnerId === teamA.id;
      const newWinsA = state.seriesScore[0] + (aWon ? 1 : 0);
      const newWinsB = state.seriesScore[1] + (aWon ? 0 : 1);
      const done     = newWinsA === 3 || newWinsB === 3;

      // Accumulate series stats
      const newAccStats = { ...state.accStats };
      for (const [id, s] of Object.entries(playerMapStats)) {
        if (!newAccStats[id]) newAccStats[id] = { name: s.name, teamId: s.teamId, kills: 0, deaths: 0 };
        newAccStats[id].kills  += s.kills;
        newAccStats[id].deaths += s.deaths;
      }

      const enrichedMapResult = state.pendingTactic
        ? { ...mapResult, tacticName: state.pendingTactic.label, tacticEffect: state.pendingTactic.effectText }
        : mapResult;
      const allMapResults = [...state.mapResults, enrichedMapResult];

      return {
        ...state,
        phase:             done ? "complete" : "map_result",
        seriesMods,
        seriesScore:       [newWinsA, newWinsB],
        mapResults:        allMapResults,
        accStats:          newAccStats,
        currentMapStats:   playerMapStats,
        procs,
        momentum,
        tiltedIdsA:        newTiltedIdsA,
        tiltedIdsB:        newTiltedIdsB,
        lastMapKDByPlayer: Object.fromEntries(
          Object.entries(playerMapStats).map(([id, s]) => [id, s.kd])
        ),
        pendingBoostA:     {}, // consumed
        pendingBoostB:     {},
        pendingMapStrModA: 0,
        pendingTactic:     null,
        finalResult: done ? buildFinalResult(teamA, teamB, allMapResults, newWinsA, newWinsB, newAccStats) : null,
      };
    }

    case "SHOW_INTERMISSION":
      return { ...state, phase: "intermission" };

    case "APPLY_TACTIC": {
      const userIsA = action.userTeamId === action.teamAId;
      const effect = action.effect ?? { boosts: {}, mapStrModUser: 0, label: "Standard", effectText: "No modifier" };
      return {
        ...state,
        pendingBoostA: userIsA ? effect.boosts : {},
        pendingBoostB: userIsA ? {} : effect.boosts,
        pendingMapStrModA: userIsA ? (effect.mapStrModUser ?? 0) : -(effect.mapStrModUser ?? 0),
        pendingTactic: { id: action.tactic, label: effect.label, effectText: effect.effectText, note: effect.note },
      };
    }

    case "NEXT_MAP":
      return {
        ...state,
        phase:          "simming",
        currentMapIdx:  state.currentMapIdx + 1,
        currentMapStats: null,
        procs:          [],
      };

    default:
      return state;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Scoreboard({ teamA, teamB, seriesScore, mapIdx, userTeamId, schedule, mapSet, mapResults, phase }) {
  const [wA, wB] = seriesScore;
  const currentSlot = mergeMapSlot(mapSet, mapIdx);
  const lastMap = mapResults[mapResults.length - 1];
  const showLast = (phase === "map_result" || phase === "intermission") && lastMap;
  const detail = showLast
    ? `Map ${lastMap.mapNum}: ${lastMap.mapName ? `${lastMap.mapName} ` : ""}${lastMap.mode} · ${teamTag(lastMap.winnerId, schedule)} win ${lastMap.scoreWinner}-${lastMap.scoreLoser}`
    : `${phase === "simming" ? "Live" : "Next"}: ${formatMapLabel(currentSlot, mapIdx)}`;
  const nextIdx = showLast ? mapIdx + 1 : mapIdx;
  const nextSlot = mergeMapSlot(mapSet, nextIdx);
  const nextLine = showLast && nextIdx < 5 ? `Next: ${formatMapLabel(nextSlot, nextIdx)}` : null;

  return (
    <div className="mco-scoreboard">
      <div className={`mco-sb-team ${teamA.id === userTeamId ? "mco-sb-you" : ""}`}>
        <TeamLogo team={resolveTeamDisplay(teamA.id, schedule)} size={40} className="mco-sb-logo" />
        <span className="mco-sb-tag" style={{ color: teamColor(teamA.id, schedule) }}>{teamTag(teamA.id, schedule)}</span>
        {teamA.id === userTeamId && <span className="mco-sb-you-badge">YOU</span>}
      </div>
      <div className="mco-sb-center">
        <div className="mco-sb-series-line">
          <span style={{ color: teamColor(teamA.id, schedule) }}>{teamTag(teamA.id, schedule)}</span>
          <span className="mco-sb-num">{wA}</span>
          <span className="mco-sb-sep">-</span>
          <span className="mco-sb-num">{wB}</span>
          <span style={{ color: teamColor(teamB.id, schedule) }}>{teamTag(teamB.id, schedule)}</span>
        </div>
        <div className="mco-sb-detail">{detail}</div>
        {nextLine && <div className="mco-sb-next">{nextLine}</div>}
      </div>
      <div className={`mco-sb-team mco-sb-team-b ${teamB.id === userTeamId ? "mco-sb-you" : ""}`}>
        {teamB.id === userTeamId && <span className="mco-sb-you-badge">YOU</span>}
        <span className="mco-sb-tag" style={{ color: teamColor(teamB.id, schedule) }}>{teamTag(teamB.id, schedule)}</span>
        <TeamLogo team={resolveTeamDisplay(teamB.id, schedule)} size={40} className="mco-sb-logo" />
      </div>
    </div>
  );
}

function MomentumBar({ momentum, teamA, teamB, schedule }) {
  const pct = Math.round(momentum * 100);
  return (
    <div className="mco-momentum-wrap">
      <span className="mco-mom-label" style={{ color: teamColor(teamA.id, schedule) }}>{teamTag(teamA.id, schedule)}</span>
      <div className="mco-momentum-bar">
        <div
          className="mco-momentum-fill"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${teamColor(teamA.id, schedule)}, ${teamColor(teamB.id, schedule)})`,
          }}
        />
        <div className="mco-momentum-marker" style={{ left: `${pct}%` }} />
      </div>
      <span className="mco-mom-label" style={{ color: teamColor(teamB.id, schedule) }}>{teamTag(teamB.id, schedule)}</span>
    </div>
  );
}

function PlayerRow({ pid, stats, teamId, userTeamId, isHeader, schedule, onPlayer }) {
  if (isHeader) {
    return (
      <div className="mco-player-row mco-player-header">
        <span className="mco-pr-name">Player</span>
        <span className="mco-pr-k">K</span>
        <span className="mco-pr-d">D</span>
        <span className="mco-pr-kd">K/D</span>
      </div>
    );
  }

  if (!stats) return null;
  const isUser = teamId === userTeamId;
  const kdCls  = stats.kd >= 1.2 ? "mco-kd-great" : stats.kd >= 1.0 ? "mco-kd-ok" : "mco-kd-bad";

  return (
    <div className={`mco-player-row ${isUser ? "mco-pr-user-team" : ""}`}>
      <span className="mco-pr-name" style={isUser ? { color: teamColor(teamId, schedule) } : {}}>
        <button className="link-button player-link" onClick={() => onPlayer(pid)}>{stats.name}</button>
      </span>
      <span className="mco-pr-k">{stats.kills}</span>
      <span className="mco-pr-d">{stats.deaths}</span>
      <span className={`mco-pr-kd ${kdCls}`}>{stats.kd?.toFixed(2)}</span>
    </div>
  );
}

function LiveView({ teamA, teamB, currentMapStats, userTeamId, schedule, onPlayer }) {
  const aPlayers = teamA.players.slice(0, 4);
  const bPlayers = teamB.players.slice(0, 4);

  return (
    <div className="mco-live-view">
      <div className="mco-team-col">
        <div className="mco-team-col-header" style={{ color: teamColor(teamA.id, schedule) }}>{teamTag(teamA.id, schedule)}</div>
        <PlayerRow isHeader schedule={schedule} />
        {aPlayers.map(p => (
          <PlayerRow
            key={p.id} pid={p.id}
            stats={currentMapStats?.[p.id] ?? { name: p.name, kills: "—", deaths: "—", kd: null }}
            teamId={teamA.id} userTeamId={userTeamId}
            schedule={schedule}
            onPlayer={onPlayer}
          />
        ))}
      </div>

      <div className="mco-live-divider">
        <span className="mco-live-vs">vs</span>
      </div>

      <div className="mco-team-col">
        <div className="mco-team-col-header" style={{ color: teamColor(teamB.id, schedule) }}>{teamTag(teamB.id, schedule)}</div>
        <PlayerRow isHeader schedule={schedule} />
        {bPlayers.map(p => (
          <PlayerRow
            key={p.id} pid={p.id}
            stats={currentMapStats?.[p.id] ?? { name: p.name, kills: "—", deaths: "—", kd: null }}
            teamId={teamB.id} userTeamId={userTeamId}
            schedule={schedule}
            onPlayer={onPlayer}
          />
        ))}
      </div>
    </div>
  );
}

function MapHistoryRow({ mr, teamA, schedule }) {
  const won = mr.winnerId === teamA.id;
  const label = `${mr.mapName ? `${mr.mapName} ` : ""}${mr.mode}`;
  return (
    <div className={`mco-map-history-row ${won ? "mco-mhr-a" : "mco-mhr-b"}`}>
      <span className="mco-mhr-map">Map {mr.mapNum}: {label}</span>
      <span className="mco-mhr-score">
        <span style={{ color: teamColor(mr.winnerId, schedule) }}>{teamTag(mr.winnerId, schedule)}</span>
        <span className="mco-mhr-sc">{mr.scoreWinner}–{mr.scoreLoser}</span>
      </span>
      {mr.tacticName && <span className="mco-mhr-tactic">Tactic: {mr.tacticName}</span>}
    </div>
  );
}

function SeriesMapSet({ mapSet, mapResults, currentMapIdx, teamA, teamB, schedule }) {
  const tags = { a: teamTag(teamA.id, schedule), b: teamTag(teamB.id, schedule) };
  return (
    <div className="mco-series-mapset">
      <div className="mco-history-label">Series Map Set</div>
      {[0, 1, 2, 3, 4].map(i => {
        const result = mapResults.find(m => m.mapNum === i + 1);
        const slot = mergeMapSlot(mapSet, i);
        const edge = softenedMapEdge(slot.edgeA, tags.a, tags.b, { includeNumber: true });
        const isNext = !result && i === currentMapIdx;
        return (
          <div key={i} className={`mco-mapset-row ${result ? "mco-mapset-done" : isNext ? "mco-mapset-next" : ""}`}>
            <span className="mco-mapset-num">{i + 1}.</span>
            <span className="mco-mapset-main">
              <span className="mco-mapset-map">{formatMapLabel(slot, i, { includePrefix: false })}</span>
              {result ? (
                <span className="mco-mapset-status" style={{ color: teamColor(result.winnerId, schedule) }}>
                  {teamTag(result.winnerId, schedule)} {result.scoreWinner}-{result.scoreLoser}
                </span>
              ) : isNext ? (
                <span className="mco-mapset-status mco-mapset-next-label">Next</span>
              ) : edge.visibleValue > 0 ? (
                <span className="mco-mapset-status">{edge.text}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TacticsPanel({ nextMapIdx, nextSlot, selected, onSelect, seriesScore, userTeamIsA, staffSupport }) {
  return (
    <div className="mco-tactic-panel">
      <div className="mco-int-label">Choose tactic for {formatMapLabel(nextSlot, nextMapIdx)}</div>
      <div className="mco-tactics">
        {TACTICS.map(t => {
          const effect = buildTacticEffect(t.id, { mode: nextSlot.mode, seriesScore, userTeamIsA, staffSupport });
          return (
            <TacticButton
              key={t.id}
              label={t.label}
              desc={t.guidance}
              effect={effect.effectText}
              active={selected?.id === t.id}
              disabled={false}
              onClick={() => onSelect(t.id, effect)}
            />
          );
        })}
      </div>
      {selected && (
        <div className="mco-selected-tactic">
          <strong>Current tactic:</strong> {selected.label}
          <span>{selected.effectText}</span>
          {selected.note && <em>{selected.note}</em>}
        </div>
      )}
    </div>
  );
}

function ProcsFeed({ procs }) {
  if (!procs.length) return null;
  return (
    <div className="mco-procs">
      {procs.map((pr, i) => (
        <div key={i} className="mco-proc-badge">
          ★ {pr.label} — {pr.playerName}
        </div>
      ))}
    </div>
  );
}

function TacticButton({ label, desc, effect, active, disabled, onClick }) {
  return (
    <button
      className={`mco-tactic-btn ${active ? "mco-tactic-active" : ""} ${disabled ? "mco-tactic-disabled" : ""}`}
      onClick={!disabled ? onClick : undefined}
    >
      <div className="mco-tactic-label">{label}</div>
      <div className="mco-tactic-desc">{desc}</div>
      {effect && <div className="mco-tactic-effect">{effect}</div>}
    </button>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function MatchCenterOverlay() {
  const { ctx, closeMatchCenter }  = useMatchCenter();
  const { state, dispatch: gDispatch } = useGame();
  const { openPlayerProfile } = usePlayerProfile();
  const [mcState, mcDispatch]      = useReducer(reducer, INIT);
  const [visibleProcs, setVisibleProcs] = useState([]);

  const isOpen = ctx !== null;

  // Reset state whenever the overlay opens
  useEffect(() => {
    if (isOpen) {
      mcDispatch({ type: "RESET" });
    }
  }, [isOpen]);

  // Auto-clear procs after 2.5s
  useEffect(() => {
    if (mcState.procs.length === 0) return;
    const show = setTimeout(() => setVisibleProcs(mcState.procs), 0);
    const hide = setTimeout(() => setVisibleProcs([]), 2500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [mcState.procs]);

  // Derive team objects from game state
  function buildSide(id) {
    const eventTeam = state?.schedule?.currentMajorEventTeams?.[id];
    if (eventTeam) return { id: eventTeam.id, name: eventTeam.name, tag: eventTeam.tag, color: eventTeam.color, players: eventTeam.players || [], mapProfile: getTeamMapProfile(state, id) };
    const meta = CDL_TEAMS.find(t => t.id === id) ?? { id, name: id, tag: id, color: "#888" };
    return { id: meta.id, name: meta.name, tag: meta.tag, color: meta.color, players: (state.players || []).filter(p => p.teamId === id), mapProfile: getTeamMapProfile(state, id) };
  }

  const teamA = (() => {
    if (!state || !ctx) return null;
    const { schedule, userTeamId } = state;
    if (ctx.type === "stage") {
      const stage = schedule.stages?.[schedule.stageIdx];
      const m = stage?.matches.find(mx => !mx.played && (mx.a === userTeamId || mx.b === userTeamId));
      if (!m) return null;
      const id = m.a;
      return buildSide(id);
    }
    if (ctx.type === "major") {
      const bracket = schedule.majors?.[schedule.majorIdx]?.bracket;
      if (!bracket) return null;
      for (const round of bracket.rounds) {
        const m = round.matches.find(mx => !mx.played && (mx.a === userTeamId || mx.b === userTeamId));
        if (m) {
          const id = m.a;
          return buildSide(id);
        }
      }
    }
    return null;
  })();

  const teamB = (() => {
    if (!state || !ctx || !teamA) return null;
    const { schedule, userTeamId } = state;
    if (ctx.type === "stage") {
      const stage = schedule.stages?.[schedule.stageIdx];
      const m = stage?.matches.find(mx => !mx.played && (mx.a === userTeamId || mx.b === userTeamId));
      if (!m) return null;
      const id = m.b;
      return buildSide(id);
    }
    if (ctx.type === "major") {
      const bracket = schedule.majors?.[schedule.majorIdx]?.bracket;
      if (!bracket) return null;
      for (const round of bracket.rounds) {
        const m = round.matches.find(mx => !mx.played && (mx.a === state.userTeamId || mx.b === state.userTeamId));
        if (m) {
          const id = m.b;
          return buildSide(id);
        }
      }
    }
    return null;
  })();

  // CDL 2026 veto: deterministic projected map set for this series (matches the
  // preview + the burst sim). Recomputed only when the two teams change.
  const mapSet = (teamA?.mapProfile && teamB?.mapProfile)
    ? autoVeto(teamA.mapProfile, teamB.mapProfile).map(slot => ({
        selectedMap: { id: slot.id, name: slot.name, mode: slot.mode },
        edgeA: slot.edgeA,
        strModA: mapStrengthMod(slot.edgeA),
      }))
    : null;

  // Auto-sim: when phase becomes "simming", wait 600ms then sim the map
  useEffect(() => {
    if (mcState.phase !== "simming" || !teamA || !teamB) return;
    const t = setTimeout(() => {
      mcDispatch({ type: "SIM_MAP", teamA, teamB, mapSet });
    }, 600);
    return () => clearTimeout(t);
  }, [mcState.phase, mcState.currentMapIdx]); // eslint-disable-line

  if (!isOpen || !state || !ctx) return null;
  if (!teamA || !teamB) return null;

  const { userTeamId } = state;
  const { phase, seriesScore, mapResults, currentMapStats, momentum, finalResult,
          currentMapIdx, tiltedIdsA, pendingTactic } = mcState;

  const currentSlot = mergeMapSlot(mapSet, currentMapIdx);

  // Count how many user team players are tilted
  const userTeamIsA = teamA.id === userTeamId;
  const myTiltCount = userTeamIsA
    ? teamA.players.slice(0, 4).filter(p => tiltedIdsA.has(p.id)).length
    : teamB.players.slice(0, 4).filter(p => mcState.tiltedIdsB.has(p.id)).length;

  const staffSupport = staffTacticSupport(state.staff, userTeamId);

  function handleStart() {
    mcDispatch({ type: "START", seed: ctx.seed });
  }

  function handleTactic(tactic, effect) {
    mcDispatch({
      type: "APPLY_TACTIC",
      tactic,
      effect,
      userTeamId,
      teamAId: teamA.id,
    });
  }

  function handleNextMap() {
    mcDispatch({ type: "NEXT_MAP" });
  }

  function handleDone() {
    if (!finalResult) return;
    gDispatch({ type: "COMMIT_USER_MATCH_RESULT", result: finalResult });
    closeMatchCenter();
  }

  // ── Pregame ──────────────────────────────────────────────────────────────────
  if (phase === "pregame") {
    const teamOvr = t => {
      const starters = (t.players || []).slice(0, 4).filter(p => !p.isSub);
      if (!starters.length) return 0;
      return Math.round(starters.reduce((s, p) => s + (p.overall || 0), 0) / starters.length);
    };
    const userOvr = userTeamIsA ? teamOvr(teamA) : teamOvr(teamB);
    const oppOvr  = userTeamIsA ? teamOvr(teamB) : teamOvr(teamA);
    const ctxLabel = ctx.type === "major"
      ? (() => {
          const bracket = state.schedule.majors?.[state.schedule.majorIdx]?.bracket;
          for (const r of bracket?.rounds ?? []) {
            if (r.matches.some(m => !m.played && (m.a === userTeamId || m.b === userTeamId)))
              return r.name;
          }
          return "Tournament";
        })()
      : `Stage ${(state.schedule.stageIdx ?? 0) + 1}`;

    return (
      <div className="mco-backdrop">
        <div className="mco-pregame-card">
          <div className="mco-pg-context">{ctxLabel}</div>
          <div className="mco-pg-title">MATCH CENTER</div>
          <div className="mco-pg-subtitle">BO5 — Map-by-Map</div>

          <div className="mco-pg-matchup">
            <div className="mco-pg-team">
              <div className="mco-pg-crest" style={{ borderColor: teamColor(teamA.id, state.schedule) }}><TeamLogo team={resolveTeamDisplay(teamA.id, state.schedule)} size={64} variant="hero" /></div>
              <div className="mco-pg-tag" style={{ color: teamColor(teamA.id, state.schedule) }}>{teamTag(teamA.id, state.schedule)}</div>
              <div className="mco-pg-name">{teamName(teamA.id, state.schedule)}</div>
              <div className="mco-pg-ovr">{teamA.id === userTeamId ? userOvr : oppOvr} OVR</div>
              {teamA.id === userTeamId && <span className="mco-pg-you">YOU</span>}
            </div>
            <div className="mco-pg-vs">vs</div>
            <div className="mco-pg-team">
              <div className="mco-pg-crest" style={{ borderColor: teamColor(teamB.id, state.schedule) }}><TeamLogo team={resolveTeamDisplay(teamB.id, state.schedule)} size={64} variant="hero" /></div>
              <div className="mco-pg-tag" style={{ color: teamColor(teamB.id, state.schedule) }}>{teamTag(teamB.id, state.schedule)}</div>
              <div className="mco-pg-name">{teamName(teamB.id, state.schedule)}</div>
              <div className="mco-pg-ovr">{teamB.id === userTeamId ? userOvr : oppOvr} OVR</div>
              {teamB.id === userTeamId && <span className="mco-pg-you">YOU</span>}
            </div>
          </div>

          <div className="mco-pg-maps mco-pg-mapset">
            {[0, 1, 2, 3, 4].map(i => {
              const slot = mergeMapSlot(mapSet, i);
              const edge = softenedMapEdge(slot.edgeA, teamTag(teamA.id, state.schedule), teamTag(teamB.id, state.schedule));
              return (
                <span key={i} className="mco-pg-map-badge">
                  {formatMapLabel(slot, i, { compact: true })}
                  {edge.visibleValue > 0 && <small>{edge.text}</small>}
                </span>
              );
            })}
          </div>

          <button className="btn-primary mco-start-btn" onClick={handleStart}>
            ▶ Start Match
          </button>
        </div>
      </div>
    );
  }

  // ── Complete ──────────────────────────────────────────────────────────────────
  if (phase === "complete" && finalResult) {
    const userWon = finalResult.winnerId === userTeamId;
    return (
      <div className="mco-backdrop">
        <div className="mco-complete-card">
          <div className={`mco-final-banner ${userWon ? "mco-final-win" : "mco-final-loss"}`}>
            <div className="mco-final-outcome">{userWon ? "VICTORY" : "DEFEAT"}</div>
            <div className="mco-final-score">{finalResult.score}</div>
            <div className="mco-final-teams">
              <span className="mco-final-team-win" style={{ color: teamColor(finalResult.winnerId, state.schedule) }}><TeamLogo team={resolveTeamDisplay(finalResult.winnerId, state.schedule)} size={30} variant="hero" /> {teamTag(finalResult.winnerId, state.schedule)}</span>
              <span className="mco-final-dash">—</span>
              <span className="mco-final-team-lose" style={{ color: teamColor(finalResult.loserId, state.schedule) }}><TeamLogo team={resolveTeamDisplay(finalResult.loserId, state.schedule)} size={30} variant="hero" /> {teamTag(finalResult.loserId, state.schedule)}</span>
            </div>
          </div>

          {finalResult.standoutName && finalResult.standoutKD > 0 && (
            <div className="mco-final-mvp">
              ★ <strong>{finalResult.standoutName}</strong>
              <span className="mco-final-mvp-kd"> {finalResult.standoutKD.toFixed(2)} K/D · Series MVP</span>
            </div>
          )}

          <div className="mco-final-maps">
            {mapResults.map(mr => (
              <MapHistoryRow key={mr.mapNum} mr={mr} teamA={teamA} teamB={teamB} schedule={state.schedule} />
            ))}
          </div>

          <div className="mco-final-stats">
            <div className="mco-fst-header">
              <span className="mco-fst-name">Player</span>
              <span className="mco-fst-k">K</span>
              <span className="mco-fst-d">D</span>
              <span className="mco-fst-kd">K/D</span>
            </div>
            {[...teamA.players.slice(0, 4), ...teamB.players.slice(0, 4)].map(p => {
              const s = finalResult.playerStats[p.id];
              if (!s) return null;
              const kdCls = s.kd >= 1.2 ? "mco-kd-great" : s.kd >= 1.0 ? "mco-kd-ok" : "mco-kd-bad";
              const divider = p === teamB.players[0] ? "mco-fst-divider" : "";
              return (
                <div key={p.id} className={`mco-fst-row ${p.teamId === userTeamId ? "mco-fst-user" : ""} ${divider}`}>
                  <span className="mco-fst-name" style={{ color: teamColor(p.teamId, state.schedule) }}><button className="link-button player-link" onClick={() => openPlayerProfile(p.id)}>{s.name}</button></span>
                  <span className="mco-fst-k">{s.kills}</span>
                  <span className="mco-fst-d">{s.deaths}</span>
                  <span className={`mco-fst-kd ${kdCls}`}>{s.kd?.toFixed(2)}</span>
                </div>
              );
            })}
          </div>

          <button className="btn-primary mco-done-btn" onClick={handleDone}>
            {userWon ? "Continue →" : "Continue →"}
          </button>
        </div>
      </div>
    );
  }

  // ── Live / map result / intermission ─────────────────────────────────────────
  const isSimming      = phase === "simming";
  const isMapResult    = phase === "map_result";
  const isIntermission = phase === "intermission";

  const lastMapResult  = mapResults[mapResults.length - 1];
  const seriesMapIdx   = isMapResult || isIntermission ? currentMapIdx : currentMapIdx;

  return (
    <div className="mco-backdrop">
      <div className="mco-live-card">

        {/* Scoreboard */}
        <Scoreboard
          teamA={teamA} teamB={teamB}
          seriesScore={seriesScore}
          mapIdx={seriesMapIdx}
          userTeamId={userTeamId}
          schedule={state.schedule}
          mapSet={mapSet}
          mapResults={mapResults}
          phase={phase}
        />

        {/* Momentum bar */}
        <MomentumBar momentum={momentum} teamA={teamA} teamB={teamB} />

        {/* Main body */}
        <div className="mco-body">

          {/* Left: live stats */}
          <div className="mco-body-left">
            {isSimming && (
              <div className="mco-simming-msg">
                <span className="mco-spin">⟳</span> Simulating {formatMapLabel(currentSlot, currentMapIdx)}…
              </div>
            )}

            {(isMapResult || isIntermission) && (
              <>
                {lastMapResult && (
                  <div className={`mco-map-winner ${lastMapResult.winnerId === userTeamId ? "mco-mw-user-win" : lastMapResult.loserId === userTeamId ? "mco-mw-user-loss" : ""}`}>
                    <span style={{ color: teamColor(lastMapResult.winnerId, state.schedule) }}>{teamTag(lastMapResult.winnerId, state.schedule)}</span>
                    {" "}win {formatMapLabel({ name: lastMapResult.mapName, mode: lastMapResult.mode }, lastMapResult.mapNum - 1)}
                    <span className="mco-mw-score"> {lastMapResult.scoreWinner}–{lastMapResult.scoreLoser}</span>
                    {lastMapResult.tacticName && <span className="mco-mw-tactic">Tactic: {lastMapResult.tacticName}</span>}
                  </div>
                )}
                <LiveView
                  teamA={teamA} teamB={teamB}
                  currentMapStats={currentMapStats}
                  userTeamId={userTeamId}
                  schedule={state.schedule}
                  onPlayer={openPlayerProfile}
                />
              </>
            )}

            {/* Proc events */}
            <ProcsFeed procs={visibleProcs} />
          </div>

          {/* Right: full series map set */}
          <div className="mco-body-right">
            <SeriesMapSet
              mapSet={mapSet}
              mapResults={mapResults}
              currentMapIdx={isMapResult || isIntermission ? currentMapIdx + 1 : currentMapIdx}
              teamA={teamA}
              teamB={teamB}
              schedule={state.schedule}
            />

            {pendingTactic && (
              <div className="mco-current-tactic">
                <div className="mco-current-tactic-label">Current tactic</div>
                <strong>{pendingTactic.label}</strong>
                <span>{pendingTactic.effectText}</span>
              </div>
            )}

            {myTiltCount > 0 && (
              <div className="mco-tilt-notice">
                ⚠ {myTiltCount} player{myTiltCount > 1 ? "s" : ""} tilted
              </div>
            )}
          </div>
        </div>

        {/* Intermission panel */}
        {isIntermission && (() => {
          const nextMapIdx = currentMapIdx + 1;
          const nextSlot = mergeMapSlot(mapSet, nextMapIdx);
          return (
            <div className="mco-intermission">
              <TacticsPanel
                nextMapIdx={nextMapIdx}
                nextSlot={nextSlot}
                selected={pendingTactic}
                onSelect={handleTactic}
                seriesScore={seriesScore}
                userTeamIsA={userTeamIsA}
                staffSupport={staffSupport}
              />
              {staffSupport.hasStaffRead && (
                <div className="mco-staff-note">Staff input: tactical staff can add up to a very small bonus; discipline softens riskier downsides.</div>
              )}
              <button className="btn-primary mco-next-map-btn" onClick={handleNextMap}>
                ▶ {formatMapLabel(nextSlot, nextMapIdx)}
              </button>
            </div>
          );
        })()}

        {/* Map result → "Continue" (no intermission after map 5 or series clinched) */}
        {isMapResult && (() => {
          const seriesClinched = seriesScore[0] === 3 || seriesScore[1] === 3;
          if (seriesClinched) return null;
          return (
            <div className="mco-map-result-actions">
              <button
                className="btn-secondary mco-int-skip-btn"
                onClick={() => mcDispatch({ type: "SHOW_INTERMISSION" })}
              >
                Adjust Tactics
              </button>
              <button className="btn-primary mco-next-map-btn" onClick={handleNextMap}>
                ▶ {formatMapLabel(mergeMapSlot(mapSet, currentMapIdx + 1), currentMapIdx + 1)}
              </button>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
