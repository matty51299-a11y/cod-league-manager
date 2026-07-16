// src/components/Dashboard.jsx
// FM-style dashboard: full-width two-column layout with club banner, card grid, and right panel.

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import { calcChemistry, chemLabel } from "../engine/chemistry.js";
import { calcTeamOvr } from "../engine/teamOvr.js";
import { getSigningCost, getResignDemand, getTeamCap, getChallengerStockLabel } from "../engine/rosterAI.js";
import { estimateCompetingInterest, getContractMemory } from "../engine/contractNegotiation.js";
import { getContractReviewBudget } from "../utils/contractBudget.js";
import SeriesDetail from "./SeriesDetail.jsx";
import { useTeamHub } from "../store/teamHubContext.jsx";
import { usePlayerProfile } from "../store/playerProfileContext.jsx";
import TeamLogo from "./TeamLogo.jsx";
import ContractNegotiationModal from "./ContractNegotiationModal.jsx";
import { resolveTeamDisplay } from "../utils/teamDisplay.js";
import { getMajorPlacementMap } from "../utils/historyProfiles.js";
import { isInactivePlayer } from "../utils/playerIdentity.js";
import { getSecurityBand, bandColor, objStatusColor, objStatusLabel, evalAllObjectives } from "../engine/boardEngine.js";
import { getActionRequiredMoraleEvents, getSquadMorale } from "../engine/moraleEngine.js";
import { getActionRequiredCount, getUnreadCount, getSortedEvents, severityColor, CATEGORY_ICON } from "../engine/eventCentreEngine.js";
import { getEra, getNextEra } from "../data/codEras.js";

function fmtMoney(n) { return `$${Math.round((n || 0) / 1000)}k`; }
function placementText(place) {
  if (place == null) return "Not tracked yet";
  const n = Number(place);
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
function readableMoveType(type) {
  const t = String(type || "");
  if (t === "CDL_SIGNING") return "Signing";
  if (t === "FREE_AGENT_ENTERED") return "Free agent";
  if (t === "FREE_AGENT_SIGNING") return "FA signing";
  if (t === "FREE_AGENT_TO_CHALLENGERS") return "To Challengers";
  if (t === "FREE_AGENT_RETIRED") return "Retirement";
  if (t === "CDL_RELEASE_TO_CHALLENGERS") return "Release";
  if (t === "RETIREMENT") return "Retirement";
  if (t === "EMERGENCY_ROSTER_FILL") return "Emergency fill";
  if (t === "INACTIVE") return "Inactive";
  return t.replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase());
}

function formatRecentKd(player, playerSeasonStats, season) {
  if (!player?.id || !playerSeasonStats || season == null) return "—";
  const rows = (playerSeasonStats[player.id] || []).filter(r => Number(r.season) === Number(season) && (r.matches || 0) > 0);
  if (!rows.length) return "—";
  const kills = rows.reduce((sum, r) => sum + (r.kills || 0), 0);
  const deaths = rows.reduce((sum, r) => sum + (r.deaths || 0), 0);
  const kd = deaths > 0 ? kills / deaths : kills > 0 ? kills : 1;
  return kd.toFixed(2);
}

function previousTeamLabel(teamId, schedule) {
  if (!teamId) return "Unsigned";
  return resolveTeamDisplay(teamId, schedule)?.tag || teamId;
}

function stockLabel(player) {
  const ovr = player?.overall || 0;
  const pot = player?.potential || ovr;
  if (isInactivePlayer(player)) return "Inactive";
  if (pot >= 88 && ovr >= 75) return "Blue-chip";
  if (pot >= 86) return "High upside";
  if (ovr >= 82) return "Ready now";
  if (player?.isProspect) return "Developmental";
  return "Depth option";
}

// Darken a hex color until it meets the target contrast ratio vs white (#ffffff).
// minRatio: 4.5 for body text, 3.0 for large/bold text (WCAG AA).
function ensureContrast(hex, minRatio = 4.5) {
  try {
    if (!hex || !hex.startsWith('#') || hex.length !== 7) return hex;
    const toLinear = c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const lum = h => {
      const r = parseInt(h.slice(1, 3), 16) / 255;
      const g = parseInt(h.slice(3, 5), 16) / 255;
      const b = parseInt(h.slice(5, 7), 16) / 255;
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    };
    let factor = 1.0;
    let current = hex;
    while (factor >= 0.3) {
      if (1.05 / (lum(current) + 0.05) >= minRatio) return current;
      factor -= 0.05;
      const ri = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
      const gi = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
      const bi = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
      current = `#${ri.toString(16).padStart(2, '0')}${gi.toString(16).padStart(2, '0')}${bi.toString(16).padStart(2, '0')}`;
    }
    return current;
  } catch { return hex; }
}

function ratingColor(v) {
  if (v >= 90) return "#b45309";   // dark gold (readable on light)
  if (v >= 85) return "#15803d";   // dark green
  if (v >= 80) return "#0f766e";   // teal
  if (v >= 70) return "#d97706";   // amber
  return "#dc2626";                // red
}

function chemColor(chem) {
  if (chem >= 80) return "#15803d";
  if (chem >= 60) return "#d97706";
  return "#dc2626";
}

// ── Board / Owner Expectations widgets ────────────────────────────────────────

function BoardWidget({ boardState, onOpen }) {
  const { state } = useGame();
  if (!boardState || !boardState.objectives?.length) {
    return <div className="fm-empty">Season objectives pending.</div>;
  }
  const { confidence, verdict } = boardState;
  const band = getSecurityBand(confidence);
  const bc = bandColor(band);
  // Live-evaluate so the dashboard reflects in-season progress.
  const objectives = state ? evalAllObjectives(boardState.objectives, state, false) : boardState.objectives;
  const primary = objectives.find(o => o.weight === "primary");

  return (
    <div className="bw-body">
      <div className="bw-band">
        <span className="bw-band-dot" style={{ background: bc }} />
        <span className="bw-band-label" style={{ color: bc }}>{band}</span>
        <span className="bw-conf-num">{confidence}</span>
      </div>
      <div className="bw-bar">
        <span style={{ width: `${Math.max(0, Math.min(100, confidence))}%`, background: bc }} />
      </div>
      {primary && (
        <div className="bw-obj">
          <span className="bw-obj-label">{primary.label}</span>
          <span
            className="bw-obj-badge"
            style={{ color: objStatusColor(primary.status), borderColor: objStatusColor(primary.status) }}
          >
            {objStatusLabel(primary.status)}
          </span>
        </div>
      )}
      {verdict && (
        <div className="bw-verdict">Last verdict: <strong style={{ color: verdict === "Retained" ? "#34d399" : verdict === "Final Warning" ? "#fbbf24" : "#f87171" }}>{verdict}</strong></div>
      )}
      {onOpen && (
        <button className="bw-open-btn" onClick={onOpen}>View Board Objectives ›</button>
      )}
    </div>
  );
}

function OwnerReviewSummary({ boardState, review, season }) {
  if (!boardState) return <div className="oh-empty">No board data yet.</div>;

  const confidence = review?.confidenceAfter ?? boardState.confidence;
  const objectives = review?.objectives ?? boardState.objectives ?? [];
  const verdict = review?.verdict ?? boardState.verdict;
  const history = boardState.history ?? [];
  const band = getSecurityBand(confidence);
  const bc = bandColor(band);
  const lastTwo = history.slice(-2).reverse();

  return (
    <div className="oh-board-body">
      <div className="oh-board-conf">
        <span className="oh-board-band" style={{ color: bc }}>{band}</span>
        <span className="oh-board-conf-num">{confidence}</span>
      </div>
      <div className="br-conf-bar" style={{ margin: "4px 0 8px" }}>
        <span style={{ width: `${Math.max(0, Math.min(100, confidence))}%`, background: bc }} />
      </div>
      {verdict && (
        <div className="oh-board-verdict" style={{ color: verdict === "Retained" ? "#34d399" : verdict === "Final Warning" ? "#fbbf24" : "#f87171" }}>
          Verdict: <strong>{verdict}</strong>
        </div>
      )}
      {objectives.length > 0 && (
        <div className="oh-board-objs">
          {objectives.map(obj => (
            <div key={obj.id} className="oh-board-obj-row">
              <span className="oh-board-obj-weight">{obj.weight === "primary" ? "Primary" : obj.weight === "stretch" ? "Stretch" : "Sec"}</span>
              <span className="oh-board-obj-label">{obj.label}</span>
              <span className="oh-board-obj-badge" style={{ color: objStatusColor(obj.status), borderColor: objStatusColor(obj.status) }}>
                {objStatusLabel(obj.status)}
              </span>
              {obj.progressNote && <span className="oh-board-obj-note">{obj.progressNote}</span>}
            </div>
          ))}
        </div>
      )}
      {lastTwo.length > 0 && (
        <div className="oh-board-history">
          <div className="oh-board-history-title">Recent History</div>
          {lastTwo.map(entry => (
            <div key={entry.season} className="oh-board-history-row">
              <span>S{entry.season}</span>
              <span>{entry.confidenceBefore} → {entry.confidenceAfter}</span>
              <span style={{ color: entry.verdict === "Retained" ? "#34d399" : entry.verdict === "Final Warning" ? "#fbbf24" : "#f87171" }}>{entry.verdict}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ setScreen }) {
  const { state, dispatch } = useGame();
  const { openTeamHub } = useTeamHub();
  const { openPlayerProfile } = usePlayerProfile();
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!state) return null;

  const { schedule, userTeamId, season, players, progressionLog, playerSeasonStats } = state;
  const currentEra = getEra(state.currentEraId);
  const nextEra = getNextEra(currentEra.id);
  const team      = CDL_TEAMS.find(t => t.id === userTeamId);
  const myPlayers = players.filter(p => p.teamId === userTeamId);
  const chem      = calcChemistry(myPlayers);
  const teamOvr   = calcTeamOvr(userTeamId, players);

  const phase      = schedule.phase;
  const stageIdx   = schedule.stageIdx  ?? schedule.currentStage ?? 0;
  const majorIdx   = schedule.majorIdx  ?? (phase === "major" ? (schedule.currentStage ?? 0) : 0);
  const stageName  = schedule.stages?.[stageIdx]?.name  ?? "Stage";
  const majorName  = schedule.majors?.[majorIdx]?.name  ?? "Major";

  const stageStandings = schedule.stageStandings ?? {};
  const cumStandings   = schedule.standings ?? {};
  const myStage  = stageStandings[userTeamId] ?? { wins: 0, losses: 0, points: 0 };
  const mySeason = cumStandings[userTeamId]   ?? { wins: 0, losses: 0, points: 0 };

  const isStage     = phase === "stage";
  const isChallengerQualifier = phase === "challengerQualifier";
  const isChallengersFinals = isChallengerQualifier && schedule.currentChallengerQualifier?.eventType === "challengersFinals";
  const isMajor     = phase === "major";
  const isPreChamps = phase === "preChamps";
  const isOffseason = phase === "offseason";
  const isContracts = phase === "contracts";

  // Stage progress
  const currentStage = isStage ? schedule.stages?.[stageIdx] : null;
  const remaining    = currentStage ? currentStage.matches.filter(m => !m.played).length : 0;

  // Standings snapshot
  const standingsSource = (isStage || isMajor) ? stageStandings : cumStandings;
  const allTeamsRanked = CDL_TEAMS
    .map(t => ({ id: t.id, name: t.name, tag: t.tag, color: t.color,
                 rec: standingsSource[t.id] ?? { wins: 0, losses: 0, points: 0 } }))
    .sort((a, b) => b.rec.points - a.rec.points);

  // Next unplayed match for user
  const nextMatchInStage = isStage && currentStage
    ? currentStage.matches.find(m => !m.played && (m.a === userTeamId || m.b === userTeamId))
    : null;
  const nextOppId   = nextMatchInStage ? (nextMatchInStage.a === userTeamId ? nextMatchInStage.b : nextMatchInStage.a) : null;
  const nextOppTeam = nextOppId ? CDL_TEAMS.find(t => t.id === nextOppId) : null;
  const nextOppRec  = nextOppId ? (stageStandings[nextOppId] ?? { wins: 0, losses: 0 }) : null;

  // Remaining fixtures for user in this stage
  const remainingFixtures = isStage && currentStage
    ? currentStage.matches
        .filter(m => !m.played && (m.a === userTeamId || m.b === userTeamId))
        .slice(0, 6)
    : [];

  // Highlights
  const starters = myPlayers.filter(p => !p.isSub && !isInactivePlayer(p));
  const topPlayer = starters.sort((a, b) => b.overall - a.overall)[0] ?? null;
  const bestFormPlayer = starters.length ? [...starters].sort((a, b) => (b.form ?? 0) - (a.form ?? 0))[0] : null;
  const worstFormPlayer = starters.length ? [...starters].sort((a, b) => (a.form ?? 0) - (b.form ?? 0))[0] : null;
  const expiringCount = myPlayers.filter(p => (p.contractYears ?? 2) <= 1).length;
  const teamCap = getTeamCap(userTeamId);
  const committed = starters.reduce((sum, p) => sum + (p.salary ?? getSigningCost(p)), 0);
  const capSpace = teamCap - committed;
  const leagueKdLeader = players
    .map(p => ({ player: p, kd: Number(formatRecentKd(p, playerSeasonStats, season)) }))
    .filter(row => Number.isFinite(row.kd))
    .sort((a, b) => b.kd - a.kd)[0] ?? null;

  const progLog = progressionLog ?? [];
  const breakouts = progLog.filter(e => e.eventType === "breakout" && e.delta > 0).sort((a, b) => b.delta - a.delta);
  const collapses = progLog.filter(e => e.eventType === "collapse" && e.delta < 0).sort((a, b) => a.delta - b.delta);
  const biggestBreakout = breakouts[0] ?? null;
  const biggestCollapse = collapses[0] ?? null;

  // Recent results
  const myLog = [...(schedule.matchLog || [])]
    .reverse()
    .filter(r => r.winnerId === userTeamId || r.loserId === userTeamId)
    .slice(0, 8);
  const feedTeaser = [...(state.feed ?? [])].reverse().slice(0, 3);
  const squadMorale = getSquadMorale(state);
  const moraleActions = getActionRequiredMoraleEvents(state);
  const prospectsToWatch = [...(state.prospects ?? [])]
    .filter(p => !p.teamId && !isInactivePlayer(p))
    .sort((a, b) => (b.scoutedPotential ?? b.potential ?? 0) - (a.scoutedPotential ?? a.potential ?? 0))
    .slice(0, 3);

  // Form guide: last 5 as W/L
  const formResults = myLog.slice(0, 5);
  function toggleRow(i) { setExpandedIdx(prev => (prev === i ? null : i)); }

  const phaseChipClass = isMajor ? "db-phase-chip db-phase-chip-major"
    : (isOffseason || isContracts) ? "db-phase-chip db-phase-chip-offseason"
    : "db-phase-chip";

  const phaseLabel = isChallengersFinals ? "Challengers Finals"
    : isOffseason  ? "Offseason"
    : isContracts  ? "Contract Period"
    : isMajor      ? majorName
    : isPreChamps   ? "Pre-Champs Window"
    : stageName;

  const teamHex = team?.color ?? "#2563eb";
  const teamHexBody = ensureContrast(teamHex, 4.5);   // body-size text threshold

  const unreadEvents = getSortedEvents(state?.eventCentre).filter(e => !e.read);
  const importantInbox = unreadEvents[0] ?? null;
  const biggestIssue = starters.length < 4 ? `Roster incomplete (${starters.length}/4 starters)`
    : moraleActions.length ? `${moraleActions.length} dynamics issue${moraleActions.length !== 1 ? "s" : ""} need attention`
    : expiringCount ? `${expiringCount} expiring contract${expiringCount !== 1 ? "s" : ""}`
    : capSpace < 0 ? "Squad is over salary cap"
    : worstFormPlayer ? `${worstFormPlayer.name} is in poor form`
    : "Squad stable";
  const boardBand = getSecurityBand(state.boardState?.confidence ?? 60);
  const recommendedAction = importantInbox?.actionRequired ? "Open the Event Centre and resolve the priority item"
    : nextOppTeam ? `Prepare for ${nextOppTeam.tag}`
    : moraleActions.length ? "Open Dynamics"
    : "Continue season flow";

  const playerStatsRows = [
    topPlayer && { label: "Team OVR leader", name: topPlayer.name, value: `${topPlayer.overall} OVR`, player: topPlayer },
    leagueKdLeader && { label: "League K/D leader", name: leagueKdLeader.player.name, value: `${leagueKdLeader.kd.toFixed(2)} K/D`, player: leagueKdLeader.player },
    bestFormPlayer && { label: "Best form", name: bestFormPlayer.name, value: Math.round(bestFormPlayer.form ?? 0), player: bestFormPlayer },
    worstFormPlayer && { label: "Worst form", name: worstFormPlayer.name, value: Math.round(worstFormPlayer.form ?? 0), player: worstFormPlayer },
  ].filter(Boolean);

  if (isOffseason || isContracts) {
    return (
      <>
      <EraTransitionModal state={state} dispatch={dispatch} />
      <OffseasonHub
        state={state}
        dispatch={dispatch}
        setScreen={setScreen}
        userTeamId={userTeamId}
        team={team}
        season={season}
        players={players}
        myPlayers={myPlayers}
        mySeason={mySeason}
        chem={chem}
        teamOvr={teamOvr}
        isContracts={isContracts}
        openTeamHub={openTeamHub}
        openPlayerProfile={openPlayerProfile}
      />
    </>
    );
  }

  return (
    <>
    <EraTransitionModal state={state} dispatch={dispatch} />
    <div className="dashboard fm-dashboard fm-home-3col">
      {/* Compact club header bar — inline stats, no tile clutter */}
      <section className="fm-club-bar" style={{ borderLeftColor: teamHex }}>
        <TeamLogo team={resolveTeamDisplay(userTeamId, schedule)} size={40} className="fm-club-logo" />
        <div className="fm-club-bar-main">
          <div className="fm-kicker">Home · Season {season}</div>
          <h2>{team?.name ?? userTeamId}</h2>
        </div>
        <div className="fm-club-bar-stats">
          <span className={phaseChipClass}>{phaseLabel}</span>
          <span><i>Record</i> {isStage ? `${myStage.wins}W-${myStage.losses}L` : `${mySeason.wins}W-${mySeason.losses}L`}</span>
          <span><i>Season Pts</i> {mySeason.points}</span>
          <span><i>Team OVR</i> <b style={{ color: ratingColor(teamOvr) }}>{teamOvr}</b></span>
          <span><i>Chem</i> <b style={{ color: chemColor(chem) }}>{chem}</b> {chemLabel(chem)}</span>
          <span><i>Cap</i> <b style={{ color: capSpace >= 0 ? "var(--green)" : "var(--red)" }}>{fmtMoney(capSpace)}</b></span>
        </div>
        <div className="fm-club-bar-action">
          {isStage && remaining > 0 && (
            <button className="btn-cta fm-compact-cta" onClick={() => { dispatch({ type: "SIM_STAGE" }); setExpandedIdx(null); }}>
              Sim Stage <span>{remaining}</span>
            </button>
          )}
          {isChallengerQualifier && (
            <button className="btn-cta fm-compact-cta" onClick={() => dispatch({ type: schedule.currentChallengerQualifier?.completed ? "CONTINUE_FROM_CHALLENGER_QUALIFIER" : "SIM_CHALLENGER_QUALIFIER" })}>
              {schedule.currentChallengerQualifier?.completed ? "Continue" : "Run Qualifier"}
            </button>
          )}
          {isPreChamps && <button className="btn-cta fm-compact-cta" onClick={() => dispatch({ type: "BEGIN_CHAMPS" })}>Begin Champs</button>}
          {isMajor && <span className="fm-action-note">Tournament overlay active</span>}
        </div>
      </section>

      <div className="fm-home-columns">
        {/* ── LEFT: league table hero ─────────────────────────────────────── */}
        <div className="fm-col fm-col-left">
          <section className="fm-panel fm-league-table fm-league-hero">
            <PanelTitle title={isStage ? `${stageName} Table` : isMajor ? "Stage Table" : "Season Table"} action={<button className="fm-panel-link" onClick={() => setScreen?.("standings")}>Full ›</button>} />
            <div className="fm-table-head"><span>Pos</span><span>Team</span><span>W-L</span><span>Pts</span></div>
            {allTeamsRanked.map((t, i) => (
              <div key={t.id} className={`fm-table-row ${t.id === userTeamId ? "is-you" : ""} ${i < 4 ? "is-top" : i >= allTeamsRanked.length - 2 ? "is-bottom" : ""}`}>
                <span>{i + 1}</span>
                <button className="link-button team-link" onClick={() => openTeamHub(t.id)}><TeamLogo team={t} size={18} /><span className="fm-table-tag">{t.tag}</span></button>
                <span>{t.rec.wins}-{t.rec.losses}</span>
                <strong>{t.rec.points}</strong>
              </div>
            ))}
          </section>
        </div>

        {/* ── CENTER: next match, briefing, results ────────────────────────── */}
        <div className="fm-col fm-col-center">
          <section className="fm-panel fm-next-panel">
            <PanelTitle title="Next Match" action={nextOppTeam ? stageName : "No fixture"} />
            {isStage && nextOppTeam ? (
              <>
                <div className="fm-next-matchline fm-next-matchline-lg">
                  <span className="fm-next-side"><TeamLogo team={resolveTeamDisplay(userTeamId, schedule)} size={30} /><strong style={{ color: teamHexBody }}>{team?.tag ?? userTeamId}</strong></span>
                  <span className="fm-next-vs">vs</span>
                  <button className="link-button team-link fm-next-side" style={{ color: ensureContrast(nextOppTeam.color, 4.5) }} onClick={() => openTeamHub(nextOppId)}><TeamLogo team={nextOppTeam} size={30} />{nextOppTeam.tag}</button>
                </div>
                <div className="fm-mini-muted">{myStage.wins}W-{myStage.losses}L · Opp {nextOppRec.wins}W-{nextOppRec.losses}L</div>
              </>
            ) : <CompactEmpty text="No scheduled match awaiting your team." />}
          </section>

          <section className="fm-panel fm-manager-briefing">
            <PanelTitle title="Manager Briefing" action={<button className="fm-panel-link" onClick={() => setScreen?.("inbox")}>Event Centre ›</button>} />
            <div className="fm-brief-rows">
              <div className="fm-brief-row"><span>Squad Issue</span><strong style={{ color: biggestIssue === "Squad stable" ? "var(--green)" : "var(--yellow)" }}>{biggestIssue}</strong></div>
              <div className="fm-brief-row"><span>Board</span><strong style={{ color: bandColor(boardBand) }}>{boardBand} · {state.boardState?.confidence ?? 60}/100</strong></div>
              <div className="fm-brief-row"><span>Dynamics</span><strong style={{ color: moraleActions.length ? "var(--yellow)" : "var(--text-head)" }}>{squadMorale.mood}{moraleActions.length ? ` · ${moraleActions.length} action${moraleActions.length !== 1 ? "s" : ""}` : ""}</strong></div>
            </div>
            <div className="mb-priority">
              <span>Priority Inbox</span>
              <strong>{importantInbox ? importantInbox.title : "No unread items"}</strong>
              {importantInbox?.summary && <em>{importantInbox.summary}</em>}
            </div>
            <button className="btn-secondary-sm fm-dynamics-open" onClick={() => importantInbox ? setScreen?.("inbox") : nextOppTeam ? setScreen?.("schedule") : setScreen?.("home")}>{recommendedAction}</button>
          </section>

          <section className="fm-panel fm-results-panel">
            <PanelTitle title="Recent Results" action={formResults.length ? <span className="fm-form-inline">{formResults.slice(0, 5).map((r, i) => <em key={i} className={r.winnerId === userTeamId ? "w" : "l"}>{r.winnerId === userTeamId ? "W" : "L"}</em>)}</span> : "click rows"} />
            {myLog.length === 0 ? <CompactEmpty text="No matches played yet." /> : myLog.slice(0, 6).map((r, i) => {
              const won = r.winnerId === userTeamId;
              const opp = won ? r.loserName : r.winnerName;
              const isOpen = expandedIdx === i;
              return (
                <div key={i} className={`fm-result-row ${won ? "win" : "loss"}`} onClick={() => toggleRow(i)}>
                  <span>{won ? "W" : "L"}</span>
                  <strong>{r.score}</strong>
                  <em>{opp}</em>
                  {r.standoutName && <small>★ {r.standoutName}{r.standoutKD ? ` ${r.standoutKD.toFixed(2)}` : ""}</small>}
                  {isOpen && <div className="fm-result-detail" onClick={e => e.stopPropagation()}><SeriesDetail result={r} /></div>}
                </div>
              );
            })}
          </section>
        </div>

        {/* ── RIGHT: fixtures, finance/squad, development ──────────────────── */}
        <div className="fm-col fm-col-right">
          <section className="fm-panel fm-fixtures-panel">
            <PanelTitle title="Upcoming Fixtures" action={`${remainingFixtures.length} listed`} />
            {remainingFixtures.length ? remainingFixtures.slice(0, 6).map((m, i) => {
              const oppId = m.a === userTeamId ? m.b : m.a;
              const oppTeam = CDL_TEAMS.find(t => t.id === oppId);
              return <div key={i} className="fm-list-row"><span>{team?.tag}</span><em>vs</em><button className="link-button team-link" onClick={() => openTeamHub(oppId)}><TeamLogo team={oppTeam ?? resolveTeamDisplay(oppId, schedule)} size={16} />{oppTeam?.tag ?? oppId}</button></div>;
            }) : <CompactEmpty text="No upcoming stage fixtures." />}
          </section>

          <section className="fm-panel fm-finance-panel">
            <PanelTitle title="Finance & Salary" action={<button className="fm-panel-link" onClick={() => setScreen?.("transfers")}>Transfers ›</button>} />
            <div className="fm-fin-rows">
              <div className="fm-brief-row"><span>Salary Cap</span><strong>{fmtMoney(teamCap)}</strong></div>
              <div className="fm-brief-row"><span>Committed</span><strong>{fmtMoney(committed)}</strong></div>
              <div className="fm-brief-row"><span>Available</span><strong style={{ color: capSpace >= 0 ? "var(--green)" : "var(--red)" }}>{fmtMoney(capSpace)}</strong></div>
              <div className="fm-brief-row"><span>Expiring</span><strong style={{ color: expiringCount ? "var(--yellow)" : "var(--text-head)" }}>{expiringCount}</strong></div>
            </div>
            <div className="fm-cap-bar"><span style={{ width: `${Math.min(100, Math.max(0, Math.round((committed / teamCap) * 100)))}%` }} /></div>
          </section>

          <section className="fm-panel fm-stats-panel">
            <PanelTitle title="Key Players" action={<button className="fm-panel-link" onClick={() => setScreen?.("roster")}>Roster ›</button>} />
            {playerStatsRows.map(row => (
              <div key={row.label} className="fm-player-stat-row">
                <div><span>{row.label}</span><button className="link-button player-link" onClick={() => openPlayerProfile(row.player)}>{row.name}</button></div>
                <strong>{row.value}</strong>
              </div>
            ))}
          </section>

          <section className="fm-panel fm-dev-panel">
            <PanelTitle title="Development & News" action={<button className="fm-panel-link" onClick={() => setScreen?.("log")}>Log ›</button>} />
            {biggestBreakout && <div className="fm-dev-row up"><span>Breakout</span><strong>{biggestBreakout.name}</strong><em>+{biggestBreakout.delta} OVR</em></div>}
            {biggestCollapse && <div className="fm-dev-row down"><span>Collapse</span><strong>{biggestCollapse.name}</strong><em>{biggestCollapse.delta} OVR</em></div>}
            {prospectsToWatch.slice(0, 2).map(p => <div key={p.id} className="fm-dev-row"><span>Prospect</span><button className="link-button player-link" onClick={() => openPlayerProfile(p)}>{p.name}</button><em>{p.scoutedPotential ?? p.potential} POT</em></div>)}
            {feedTeaser.slice(0, 2).map(item => (
              <div key={item.id} className="fm-news-row"><strong>{item.title || item.message}</strong><span>{item.body || `S${item.season} · ${item.phase}`}</span></div>
            ))}
            {!biggestBreakout && !biggestCollapse && prospectsToWatch.length === 0 && feedTeaser.length === 0 && <CompactEmpty text="No development headlines yet." />}
          </section>
        </div>
      </div>

      {isPreChamps && (
        <div className="prechamps-info-box">
          <div className="pib-header"><span className="pib-icon">🏆</span><div><div className="pib-title">Championship Seeding</div><div className="pib-note muted">Top 8 by cumulative season points. Make roster moves before locking in.</div></div></div>
          <div className="pib-seeds">
            {CDL_TEAMS.map(t => ({ ...t, rec: cumStandings[t.id] ?? { wins: 0, losses: 0, points: 0 } })).sort((a, b) => b.rec.points - a.rec.points).slice(0, 8).map((t, i) => (
              <div key={t.id} className={`pib-seed-row ${t.id === userTeamId ? "pib-seed-you" : ""}`}><span className="pib-seed-num">{i + 1}</span><span className="pib-dot" style={{ background: t.color }} /><span className="pib-name">{t.name}</span><span className="pib-pts muted">{t.rec.points} pts</span>{t.id === userTeamId && <span className="you-badge">YOU</span>}</div>
            ))}
          </div>
        </div>
      )}

      {isContracts && <ContractReviewPanel players={myPlayers} dispatch={dispatch} state={state} season={season} userTeamId={userTeamId} playerSeasonStats={state.playerSeasonStats} />}

      {schedule.majors?.map((major, i) => {
        if (!major.completed || !major.bracket?.champion) return null;
        const champ = CDL_TEAMS.find(t => t.id === major.bracket.champion);
        return <div key={i} className="champion-banner" style={{ borderColor: champ?.color }}>🏆 {major.name} Champion: <strong className="team-link" style={{ color: champ?.color }} onClick={() => openTeamHub(major.bracket.champion)}>{champ?.name ?? major.bracket.champion}</strong></div>;
      })}
    </div>
    </>
  );
}

function MiniMetric({ label, value, sub, tone }) {
  return <div className="fm-mini-metric"><span>{label}</span><strong style={tone ? { color: tone } : undefined}>{value}</strong>{sub && <em>{sub}</em>}</div>;
}

function PanelTitle({ title, action }) {
  return <div className="fm-panel-title"><h3>{title}</h3>{action && <span>{action}</span>}</div>;
}

function CompactEmpty({ text }) {
  return <div className="fm-empty">{text}</div>;
}

function InboxWidget({ state, setScreen }) {
  const actionCount = getActionRequiredCount(state?.eventCentre);
  const unreadCount = getUnreadCount(state?.eventCentre);
  const topEvents = getSortedEvents(state?.eventCentre).slice(0, 4);

  return (
    <div className="fm-inbox-widget">
      {actionCount > 0 && (
        <div className="fm-inbox-action-bar">
          <span className="fm-inbox-action-count" style={{ color: "#f59e0b" }}>
            ⚡ {actionCount} action{actionCount !== 1 ? "s" : ""} required
          </span>
        </div>
      )}
      {topEvents.length > 0 ? topEvents.map((ev, i) => (
        <div
          key={ev.id}
          className={`fm-inbox-row ${ev.actionRequired && !ev.read ? "fm-inbox-row--action" : ""} ${!ev.read ? "fm-inbox-row--unread" : ""}`}
          style={{ borderLeftColor: severityColor(ev.severity) }}
        >
          <span className="fm-inbox-row-icon" style={{ color: severityColor(ev.severity) }}>
            {CATEGORY_ICON[ev.category] ?? "·"}
          </span>
          <div className="fm-inbox-row-text">
            <strong>{ev.title}</strong>
            {ev.summary && <span>{ev.summary}</span>}
          </div>
        </div>
      )) : (
        <div className="fm-empty">All clear — no inbox events right now.</div>
      )}
      {(unreadCount > 4 || topEvents.length > 0) && (
        <button className="fm-panel-link fm-inbox-open" onClick={() => setScreen?.("inbox")}>
          Open Inbox{unreadCount > 0 ? ` (${unreadCount})` : ""} ›
        </button>
      )}
    </div>
  );
}


function EraInfoCard({ era, nextEra, state }) {
  if (!era) return null;
  const modes = (era.modes || []).join(" · ");
  return (
    <section className="oh-card" style={{ borderTopColor: state?.careerMode === "historical" ? "#fbbf24" : "#60a5fa", marginBottom: 14 }}>
      <div className="oh-card-header">
        <div>
          <h3>Current Title: {era.gameTitle}</h3>
          <p>{era.seasonLabel} · {String(era.movementStyle || "modern").replace("_", " ")} era · {state?.careerMode === "historical" ? "Historical Dynasty" : "Modern CDL 2026"}</p>
        </div>
        <span className="oh-ok">{nextEra ? `Next Title: ${nextEra.shortTitle}` : "Current Era"}</span>
      </div>
      <div className="cm-chip-row">
        <span className="ts-chip">Modes: {modes}</span>
        <span className="ts-chip">Maps loaded: {Object.values(era.mapPool || {}).reduce((n, arr) => n + (arr?.length || 0), 0)}</span>
        <span className="ts-chip">{era.rulesNote}</span>
      </div>
    </section>
  );
}

function EraTransitionModal({ state, dispatch }) {
  const transition = state?.pendingEraTransition;
  if (!transition) return null;
  const previous = getEra(transition.previousEraId);
  const next = getEra(transition.newEraId);
  return (
    <div className="modal-backdrop" style={{ zIndex: 1300 }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <h2>New Game Released</h2>
        <h3>{next.gameTitle}</h3>
        <p className="muted">The dynasty moves from {previous.gameTitle} to {next.gameTitle}.</p>
        <div className="ui-stat-grid compact">
          <StatCard label="Movement" value={next.movementStyle} />
          <StatCard label="Modes" value={(next.modes || []).join(" / ")} />
          <StatCard label="Rookie Class" value={next.rookieClassId ? "Added" : "None"} tone={next.rookieClassId ? "success" : "neutral"} />
        </div>
        <p>{next.rulesNote}</p>
        <ul>
          <li>New maps and modes are now available for era display.</li>
          <li>New movement style: {next.movementStyle}.</li>
          <li>Rookie/prospect class added once for this era.</li>
          <li>Offseason market flow remains intact.</li>
        </ul>
        <button className="btn-primary" onClick={() => dispatch({ type: "ACK_ERA_TRANSITION" })}>Continue to Offseason</button>
      </div>
    </div>
  );
}

function OffseasonHub({ state, dispatch, setScreen, userTeamId, team, season, players, myPlayers, mySeason, chem, teamOvr, isContracts, openTeamHub, openPlayerProfile }) {
  const schedule = state.schedule || {};
  const activeStarters = myPlayers.filter(p => !p.isSub && !isInactivePlayer(p));
  const subs = myPlayers.filter(p => p.isSub && !isInactivePlayer(p));
  const roles = ["Main AR", "Flex", "Entry SMG", "Slayer SMG"];
  const roleCounts = roles.map(role => ({ role, count: activeStarters.filter(p => p.primary === role).length }));
  const missingRoles = roleCounts.filter(r => r.count === 0).map(r => r.role);
  const weakest = activeStarters.length ? [...activeStarters].sort((a, b) => (a.overall || 0) - (b.overall || 0))[0] : null;
  const bestPlayer = activeStarters.length ? [...activeStarters].sort((a, b) => (b.overall || 0) - (a.overall || 0))[0] : null;
  const { cap, lockedCost, space } = getContractReviewBudget(myPlayers, userTeamId);
  const rosterWarning = activeStarters.length < 4 ? `Roster incomplete: ${activeStarters.length}/4 starters signed.` : null;
  const completedSeason = season;
  const nextSeason = Number(season || 1) + 1;

  const standingsRows = CDL_TEAMS
    .map(t => ({ ...t, rec: schedule.standings?.[t.id] || { wins: 0, losses: 0, points: 0 } }))
    .sort((a, b) => (b.rec.points || 0) - (a.rec.points || 0) || (b.rec.wins || 0) - (a.rec.wins || 0));
  const standingsWinner = standingsRows[0] || null;
  const champs = schedule.majors?.[4];
  const champsWinnerId = champs?.bracket?.champion || null;
  const champsWinner = champsWinnerId ? resolveTeamDisplay(champsWinnerId, schedule) : null;
  const champsPlacement = champs?.bracket ? getMajorPlacementMap(champs)[userTeamId] : null;
  const majorWinners = (schedule.majors || []).slice(0, 4).map((major, idx) => ({
    name: major?.name || `Major ${idx + 1}`,
    winnerId: major?.bracket?.champion || null,
    winner: major?.bracket?.champion ? resolveTeamDisplay(major.bracket.champion, schedule) : null,
  }));
  const seasonAwards = (state.awards || []).filter(a => Number(a.season) === Number(completedSeason));
  const awardByKey = key => seasonAwards.find(a => a.key === key) || null;
  const seasonMvp = awardByKey("season_mvp");
  const rookie = awardByKey("rookie_of_year");
  const champsMvp = awardByKey("champs_mvp");

  const recentMoves = [...(state.challengerTransactions || [])]
    .filter(tx => Number(tx.season ?? completedSeason) === Number(completedSeason))
    .slice(-8)
    .reverse();
  const graduates = recentMoves.filter(tx => tx.type === "CDL_SIGNING" && tx.fromTeamId && tx.toTeamId).slice(0, 5);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketRole, setMarketRole] = useState("All");
  const freeAgentPool = (players || [])
    .filter(ply => !ply.teamId && !ply.isProspect && !isInactivePlayer(ply))
    .filter(ply => !ply.status || ply.status === "freeAgent")
    .sort((a, b) => (b.overall || 0) - (a.overall || 0) || (b.potential || 0) - (a.potential || 0));
  const marketRoles = ["All", ...Array.from(new Set(freeAgentPool.map(ply => ply.primary).filter(Boolean))).sort()];
  const searchNeedle = marketSearch.trim().toLowerCase();
  const filteredFreeAgents = freeAgentPool.filter(ply => {
    const roleOk = marketRole === "All" || ply.primary === marketRole;
    const searchOk = !searchNeedle || [ply.name, ply.primary, previousTeamLabel(ply.previousTeamId, schedule)]
      .some(value => String(value || "").toLowerCase().includes(searchNeedle));
    return roleOk && searchOk;
  });
  const marketPreview = filteredFreeAgents.slice(0, 25);
  const powerRankings = CDL_TEAMS.map(t => {
    const starters = (players || []).filter(ply => ply.teamId === t.id && !ply.isSub && !isInactivePlayer(ply));
    const keyPlayer = starters.sort((a, b) => (b.overall || 0) - (a.overall || 0))[0];
    const history = (state.teamCareerHistory || []).find(h => h.teamId === t.id && Number(h.season) === Number(completedSeason));
    const prev = history?.champs?.placement || history?.bestChamps || (history?.record ? `${history.record.wins}W-${history.record.losses}L` : "Season archived");
    return { team: t, ovr: calcTeamOvr(t.id, players || []), keyPlayer, prev };
  }).sort((a, b) => b.ovr - a.ovr).slice(0, 6);

  const freeAgencyOpen = !!state.offseason?.freeAgencyOpen;
  const primaryAction = isContracts
    ? { label: "Advance Day", hint: "Time will pass; contract replies arrive through the Event Centre", type: "ADVANCE_OFFSEASON_DAY" }
    : freeAgencyOpen
      ? { label: `Advance to Season ${nextSeason}`, hint: "AI clubs work behind the scenes as dates advance", type: "ADVANCE_OFFSEASON_DAY" }
      : { label: "Review Contracts →", hint: "Lock in extensions before the market opens", type: "ENTER_CONTRACT_PHASE" };

  return (
    <div className="dashboard offseason-hub">
      <section className="oh-hero" style={{ borderTopColor: team?.color || "var(--accent)" }}>
        <div className="oh-hero-left">
          <TeamLogo team={resolveTeamDisplay(userTeamId, schedule)} size={54} className="oh-logo" />
          <div>
            <div className="oh-kicker">Season {completedSeason} Complete</div>
            <h2>Offseason Hub</h2>
            <div className="oh-team-line">
              <button className="link-button team-link" onClick={() => openTeamHub(userTeamId)}>{team?.name || userTeamId}</button>
              <span>{mySeason.wins}W – {mySeason.losses}L</span>
              <span>{mySeason.points || 0} CDL pts</span>
              <span>{champsPlacement ? `Champs: ${placementText(champsPlacement)}` : "Champs: Not tracked"}</span>
            </div>
          </div>
        </div>
        <div className="oh-hero-stats">
          <div><span>Team OVR</span><strong>{teamOvr || "—"}</strong></div>
          <div><span>Chemistry</span><strong>{chem} <em>{chemLabel(chem)}</em></strong></div>
          <div><span>Cap Space</span><strong>{fmtMoney(Math.max(0, space))}</strong></div>
        </div>
        <div className="oh-hero-action">
          <span>{primaryAction.hint}</span>
          <button className="btn-cta" onClick={() => dispatch({ type: primaryAction.type })}>{primaryAction.label}</button>
        </div>
      </section>
        <div className="oh-calendar-actions">
          <span>{state.calendar?.label || `Offseason ${completedSeason} Day 1`}</span>
          <button className="btn-secondary-sm" onClick={() => dispatch({ type: "ADVANCE_OFFSEASON_DAY" })}>Advance Day</button>
          <button className="btn-secondary-sm" onClick={() => dispatch({ type: "ADVANCE_OFFSEASON_DAY" })}>Continue</button>
          <button className="btn-secondary-sm" onClick={() => dispatch({ type: "ADVANCE_OFFSEASON_DAY" })}>Advance to Next Important Date</button>
        </div>
        <div className="oh-task-list">
          {["Review expiring contracts", "Submit contract offers", "Wait for player responses", "Scout free agents", freeAgencyOpen ? "Free agency is open" : "Free agency opens soon", "Fill roster needs", "Register roster before deadline", "Advance to season start"].map((task, idx) => <span key={task} className={idx < 2 || (freeAgencyOpen && idx === 4) ? "done" : ""}>{task}</span>)}
        </div>

      <div className="oh-layout">
        <main className="oh-main">
          <section className="oh-card oh-contract-card">
            <div className="oh-card-header">
              <div>
                <h3>Your Team Contract Center</h3>
                <p>{activeStarters.length}/4 starters · {subs.length} sub · locked {fmtMoney(lockedCost)} / {fmtMoney(cap)}</p>
              </div>
              {rosterWarning ? <span className="oh-warning">{rosterWarning}</span> : <span className="oh-ok">Roster complete</span>}
            </div>
            <ContractReviewPanel
              players={myPlayers}
              dispatch={dispatch}
              state={state}
              season={season}
              userTeamId={userTeamId}
              playerSeasonStats={state.playerSeasonStats}
            />
            <div className="oh-contract-footer">
              <span>{isContracts ? "Unre-signed players will enter free agency first." : freeAgencyOpen ? "Open market is live. AI teams wait until you advance." : "Enter the contract period to preserve the current offseason flow."}</span>
              <button className="btn-primary" onClick={() => dispatch({ type: primaryAction.type })}>{primaryAction.label}</button>
            </div>
          </section>

          {freeAgencyOpen && (
            <section className="oh-card oh-market-card">
              <div className="oh-card-header oh-market-header">
                <div>
                  <h3>Free Agency Market</h3>
                  <p>AI teams are paused. Sign players now before running AI free agency.</p>
                </div>
                <button className="btn-secondary" onClick={() => setScreen?.("fa")}>Open Full Free Agency</button>
              </div>
              <div className="oh-market-toolbar">
                <strong>Free Agency Open</strong>
                <span>AI teams will not sign players until you click Run AI Free Agency.</span>
                <input
                  type="search"
                  value={marketSearch}
                  onChange={(e) => setMarketSearch(e.target.value)}
                  placeholder="Search player, role, previous team…"
                  aria-label="Search free agents"
                />
                <select value={marketRole} onChange={(e) => setMarketRole(e.target.value)} aria-label="Filter free agents by role">
                  {marketRoles.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
              {marketPreview.length ? (
                <>
                  <div className="oh-market-table-wrap">
                    <table className="oh-market-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Age</th>
                          <th>Role</th>
                          <th>Previous Team</th>
                          <th>OVR</th>
                          <th>POT</th>
                          <th>Recent K/D</th>
                          <th>Stock</th>
                          <th>Salary Demand</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {marketPreview.map(ply => {
                          const roster = players.filter(p => p.teamId === userTeamId && !isInactivePlayer(p));
                          const starters = roster.filter(p => !p.isSub);
                          const subCount = roster.filter(p => p.isSub).length;
                          const committed = starters.reduce((sum, p) => sum + (p.salary ?? getSigningCost(p)), 0);
                          const demand = getSigningCost(ply);
                          const cap = getTeamCap(userTeamId);
                          const starterOverBy = Math.max(0, committed + demand - cap);
                          const starterDisabledReason = starters.length >= 4
                            ? "Roster full"
                            : starterOverBy > 0
                              ? `Over cap by ${fmtMoney(starterOverBy)}`
                              : null;
                          const subDisabledReason = subCount >= 1 ? "Sub slot full" : null;
                          return (
                            <tr key={ply.id}>
                              <td><button className="link-button player-link" onClick={() => openPlayerProfile(ply.id)}>{ply.name}</button></td>
                              <td>{ply.age ?? "—"}</td>
                              <td><span className="role-pill">{ply.primary || "Role TBD"}</span></td>
                              <td>{previousTeamLabel(ply.previousTeamId, schedule)}</td>
                              <td><strong style={{ color: ratingColor(ply.overall || 0) }}>{ply.overall || "—"}</strong></td>
                              <td><span style={{ color: ratingColor(ply.potential || 0) }}>{ply.potential || "—"}</span></td>
                              <td>{formatRecentKd(ply, state.playerSeasonStats, completedSeason)}</td>
                              <td>{getChallengerStockLabel(ply, state)}</td>
                              <td>{fmtMoney(demand)}</td>
                              <td>
                                <div className="oh-market-actions">
                                  <button
                                    className="btn-primary-sm"
                                    disabled={!!starterDisabledReason}
                                    title={starterDisabledReason || `Sign ${ply.name} as a starter`}
                                    onClick={() => dispatch({ type: "SIGN_PLAYER", playerId: ply.id, slotType: "starter" })}
                                  >
                                    {starterDisabledReason || "Sign as Starter"}
                                  </button>
                                  <button
                                    className="btn-secondary-sm"
                                    disabled={!!subDisabledReason}
                                    title={subDisabledReason || `Sign ${ply.name} as a sub`}
                                    onClick={() => dispatch({ type: "SIGN_PLAYER", playerId: ply.id, slotType: "sub" })}
                                  >
                                    {subDisabledReason || "Sign as Sub"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {filteredFreeAgents.length > marketPreview.length && (
                    <div className="oh-market-footer">
                      <span>Showing top {marketPreview.length} of {filteredFreeAgents.length} free agents.</span>
                      <button className="db-rp-link" onClick={() => setScreen?.("fa")}>View Full Free Agency</button>
                    </div>
                  )}
                </>
              ) : (
                <p className="oh-empty">No free agents available yet.</p>
              )}
            </section>
          )}

          <section className="oh-card">
            <div className="oh-card-header"><h3>Roster Needs / Team Outlook</h3></div>
            <div className="oh-outlook-grid">
              <div><span>Need</span><strong>{missingRoles.length ? missingRoles.map(r => `1 ${r}`).join(", ") : "No role gaps"}</strong></div>
              <div><span>Roles covered</span><strong>{roleCounts.filter(r => r.count > 0).map(r => r.role).join(", ") || "None"}</strong></div>
              <div><span>Weakest starter</span><strong>{weakest ? `${weakest.name} (${weakest.overall})` : "No starters"}</strong></div>
              <div><span>Best player</span><strong>{bestPlayer ? `${bestPlayer.name} (${bestPlayer.overall})` : "No starters"}</strong></div>
              <div><span>Core under contract</span><strong>{activeStarters.filter(p => (p.contractYears ?? 2) > 1).map(p => p.name).slice(0, 4).join(", ") || "None locked yet"}</strong></div>
              <div><span>Available now</span><strong>{fmtMoney(Math.max(0, space))}</strong></div>
            </div>
          </section>

          <section className="oh-card">
            <div className="oh-card-header"><h3>Early Power Rankings</h3></div>
            <div className="oh-list">
              {powerRankings.map((row, idx) => (
                <div className="oh-rank-row" key={row.team.id}>
                  <span className="oh-rank-num">#{idx + 1}</span>
                  <TeamLogo team={row.team} size={24} />
                  <button className="link-button team-link" onClick={() => openTeamHub(row.team.id)}>{row.team.name}</button>
                  <strong>{row.ovr || "—"} OVR</strong>
                  <span>{row.keyPlayer?.name || "No key player"}</span>
                  <em>{row.prev || "No previous result"}</em>
                </div>
              ))}
            </div>
          </section>
        </main>

        <aside className="oh-side">
          <section className="oh-card oh-board-card">
            <div className="oh-card-header"><h3>Owner Review</h3></div>
            <OwnerReviewSummary boardState={state.boardState} review={state.pendingBoardReview} season={completedSeason} />
          </section>

          <section className="oh-card">
            <div className="oh-card-header"><h3>Season Recap</h3></div>
            <div className="oh-recap-list">
              <RecapRow label="Champs Winner" value={champsWinner?.name || "Not tracked"} teamId={champsWinnerId} openTeamHub={openTeamHub} />
              <RecapRow label="Your Champs Result" value={champsPlacement ? placementText(champsPlacement) : "Not tracked"} />
              <RecapRow label="Season Standings Winner" value={standingsWinner?.name || "Not tracked"} teamId={standingsWinner?.id} openTeamHub={openTeamHub} />
              <RecapRow label="Season MVP" value={seasonMvp?.playerName || "Not awarded"} playerId={seasonMvp?.playerId} openPlayerProfile={openPlayerProfile} />
              <RecapRow label="Rookie of the Year" value={rookie?.playerName || "No eligible rookie"} playerId={rookie?.playerId} openPlayerProfile={openPlayerProfile} />
              <RecapRow label="Champs MVP" value={champsMvp?.playerName || "Not awarded"} playerId={champsMvp?.playerId} openPlayerProfile={openPlayerProfile} />
            </div>
            <div className="oh-major-winners">
              {majorWinners.map(m => (
                <div key={m.name}><span>{m.name}</span>{m.winnerId ? <button className="link-button team-link" onClick={() => openTeamHub(m.winnerId)}>{m.winner?.tag || m.winnerId}</button> : <em>—</em>}</div>
              ))}
            </div>
          </section>

          <section className="oh-card">
            <div className="oh-card-header"><h3>League Moves</h3></div>
            {recentMoves.length ? <div className="oh-list compact">
              {recentMoves.map((tx, idx) => (
                <div className="oh-move-row" key={`${tx.playerId || tx.playerName}_${idx}`}>
                  <strong>{readableMoveType(tx.type)}</strong>
                  <span>{tx.note || `${tx.playerName} ${readableMoveType(tx.type).toLowerCase()}`}</span>
                </div>
              ))}
            </div> : <p className="oh-empty">No offseason moves yet.</p>}
          </section>

          <section className="oh-card">
            <div className="oh-card-header"><h3>Challenger Graduates</h3></div>
            {graduates.length ? <div className="oh-list compact">
              {graduates.map((tx, idx) => (
                <div className="oh-grad-row" key={`${tx.playerId}_${idx}`}>
                  <button className="link-button player-link" onClick={() => openPlayerProfile(tx.playerId)}>{tx.playerName}</button>
                  <span>{resolveTeamDisplay(tx.fromTeamId, schedule).name} → {resolveTeamDisplay(tx.toTeamId, schedule).tag}</span>
                  <em>{players.find(p => p.id === tx.playerId)?.primary || "Role TBD"} · {stockLabel(players.find(p => p.id === tx.playerId) || {})}</em>
                </div>
              ))}
            </div> : <p className="oh-empty">No Challenger graduates yet.</p>}
          </section>

          <section className="oh-card">
            <div className="oh-card-header"><h3>{freeAgencyOpen ? "Free Agents — User Window" : "Top Available Players"}</h3><button className="db-rp-link" onClick={() => setScreen?.("fa")}>Free Agency →</button></div>
            {freeAgencyOpen && <p className="oh-empty">AI signings are paused until you advance. Normal cap and roster limits apply.</p>}
            {freeAgentPool.length ? <div className="oh-list compact">
              {freeAgentPool.slice(0, 6).map(ply => {
                const roster = players.filter(p => p.teamId === userTeamId);
                const starters = roster.filter(p => !p.isSub);
                const committed = starters.reduce((sum, p) => sum + (p.salary ?? getSigningCost(p)), 0);
                const signSlot = starters.length < 4 ? "starter" : "sub";
                const canSign = freeAgencyOpen && (signSlot === "sub" || committed + getSigningCost(ply) <= getTeamCap(userTeamId));
                return (
                <div className="oh-available-row" key={ply.id}>
                  <button className="link-button player-link" onClick={() => openPlayerProfile(ply.id)}>{ply.name}</button>
                  <span>{ply.primary || ply.role || "Role TBD"} · {ply.overall || "—"}/{ply.potential || "—"}</span>
                  <em>{fmtMoney(getSigningCost(ply))} · {stockLabel(ply)} · {ply.region || "NA"}</em>
                  {freeAgencyOpen && (canSign ? <button className="btn-primary-sm" onClick={() => dispatch({ type: "SIGN_PLAYER", playerId: ply.id, slotType: signSlot })}>Sign</button> : <small className="muted">Over cap</small>)}
                </div>
              );})}
            </div> : <p className="oh-empty">No available free agents found.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function RecapRow({ label, value, teamId, playerId, openTeamHub, openPlayerProfile }) {
  const clickable = teamId || playerId;
  return (
    <div className="oh-recap-row">
      <span>{label}</span>
      {clickable ? (
        <button className={`link-button ${teamId ? "team-link" : "player-link"}`} onClick={() => teamId ? openTeamHub?.(teamId) : openPlayerProfile?.(playerId)}>{value}</button>
      ) : <strong>{value}</strong>}
    </div>
  );
}

// ── Contract Review Panel ─────────────────────────────────────────────────────
function ContractReviewPanel({ players, dispatch, state, season, userTeamId, playerSeasonStats }) {
  const [negPlayer, setNegPlayer] = useState(null);
  const starters = players.filter(p => !p.isSub);
  const subs     = players.filter(p => p.isSub);
  const expiring = starters.filter(p => (p.contractYears ?? 2) === 1);
  const locked   = starters.filter(p => (p.contractYears ?? 2) > 1);

  const { cap, lockedCost, space } = getContractReviewBudget(players, userTeamId);

  function fmt(n) { return `$${Math.round(n / 1000)}k`; }


  return (
    <div className="contract-panel">
      <div className="cp-header">
        <span className="cp-icon">📋</span>
        <div>
          <div className="cp-title">Contract Review — End of Season {season}</div>
          <div className="cp-note muted">
            Extend expiring contracts now or let players walk to free agency.
          </div>
        </div>
      </div>

      {/* Budget summary */}
      <div className="cp-budget-bar">
        <span className="cp-budget-item">
          <span className="cp-budget-label">Cap</span>
          <span className="cp-budget-val">{fmt(cap)}</span>
        </span>
        <span className="cp-budget-sep">·</span>
        <span className="cp-budget-item">
          <span className="cp-budget-label">Locked</span>
          <span className="cp-budget-val">{fmt(lockedCost)}</span>
        </span>
        <span className="cp-budget-sep">·</span>
        <span className="cp-budget-item">
          <span className="cp-budget-label">Available</span>
          <span className="cp-budget-val" style={{ color: space > 0 ? "var(--green)" : "var(--red)" }}>
            {fmt(Math.max(0, space))}
          </span>
        </span>
      </div>

      {expiring.length === 0 && locked.length === 0 && (
        <p className="muted" style={{ padding: "8px 0" }}>
          No players on your roster. Sign players from Free Agency.
        </p>
      )}

      {expiring.length > 0 && (
        <div className="cp-section">
          <div className="cp-section-label">Expiring Contracts</div>
          {expiring.map(p => {
            const curSalary = p.salary ?? getSigningCost(p);
            const morale = state.playerMorale?.[p.id]?.level ?? 65;
            const interest = estimateCompetingInterest(p, state, userTeamId).level;
            const memory = getContractMemory(state, p.id);
            const status = memory.talksStatus || "Not approached";
            return (
              <div key={p.id} className="cp-row cp-row--expiring cp-table-row">
                <span className="cp-name">{p.name}</span>
                <span className="cp-role">{p.primary || "Flex"}</span>
                <span className="cp-ovr" style={{ color: p.overall >= 90 ? "#b45309" : p.overall >= 80 ? "#15803d" : "#d97706" }}>{p.overall ?? "?"}/{p.potential ?? "?"}</span>
                <span>{fmt(curSalary)}</span>
                <span>{p.isSub ? "Sub" : "Starter"}</span>
                <span>{morale >= 75 ? "Happy" : morale < 45 ? "Unhappy" : "Settled"}</span>
                <span>{p.age ?? "—"}</span>
                <span>End of Season {season}</span>
                <span className={`cp-status cp-status--${String(interest).toLowerCase()}`}>{interest}</span>
                <span className="cp-status">{status}</span>
                <button className="cp-deal-btn" disabled={!!memory.pendingOffer || status === "Accepted"} onClick={() => setNegPlayer(p)}><span className="cp-deal-length">Negotiate</span></button>
              </div>
            );
          })}
        </div>
      )}

      {negPlayer && <ContractNegotiationModal player={negPlayer} state={state} mode="resign" slot={negPlayer.isSub ? "sub" : "starter"} onClose={() => setNegPlayer(null)} onSubmit={(offer) => { dispatch({ type: "RESIGN_PLAYER", playerId: negPlayer.id, ...offer }); setNegPlayer(null); }} />}

      {locked.length > 0 && (
        <div className="cp-section">
          <div className="cp-section-label">Under Contract</div>
          {locked.map(p => {
            const rem = (p.contractYears ?? 2) - 1;
            const salary = p.salary ?? getSigningCost(p);
            return (
              <div key={p.id} className="cp-row">
                <div className="cp-player-info">
                  <span className="cp-name">{p.name}</span>
                  <span className="cp-role">{p.primary}</span>
                  <span className="cp-ovr"
                    style={{ color: p.overall >= 90 ? "#b45309" : p.overall >= 80 ? "#15803d" : "#d97706" }}>
                    {p.overall} OVR
                  </span>
                  <span className="cp-current-salary">{fmt(salary)}/yr</span>
                </div>
                <span className="cp-years-remaining">
                  {rem} yr{rem !== 1 ? "s" : ""} remaining
                </span>
              </div>
            );
          })}
        </div>
      )}

      {subs.length > 0 && (
        <div className="cp-section">
          <div className="cp-section-label">Sub</div>
          {subs.map(p => {
            const years       = p.contractYears ?? 2;
            const expiresSoon = years === 1;
            return (
              <div key={p.id} className={`cp-row ${expiresSoon ? "cp-row--expiring" : ""}`}>
                <div className="cp-player-info">
                  <span className="cp-name">{p.name}</span>
                  <span className="cp-role">SUB</span>
                  <span className="cp-ovr">{p.overall} OVR</span>
                  {expiresSoon && (
                    <span className="cp-current-salary">
                      Current: {fmt(p.salary ?? getSigningCost(p))}
                    </span>
                  )}
                </div>
                {expiresSoon ? (
                  <button className="cp-deal-btn" onClick={() => setNegPlayer(p)}><span className="cp-deal-length">Negotiate</span></button>
                ) : (
                  <span className="cp-years-remaining">
                    {years - 1} yr{(years - 1) !== 1 ? "s" : ""} remaining
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
