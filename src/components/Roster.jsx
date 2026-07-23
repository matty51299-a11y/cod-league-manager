// src/components/Roster.jsx
// Displays team rosters. In CDL mode the user manages their CDL franchise; in
// Challenger mode the user manages their Challenger team (sign/release via the
// Market) while CDL rosters remain viewable read-only.

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import { calcChemistry, chemLabel } from "../engine/chemistry.js";
import { getTeamRosterStatus, getChallengerRosterStatus } from "../utils/rosterValidation.js";
import { isChallengerMode, getChallengerRosterPlayers, getUserChallengerTeam } from "../utils/userTeam.js";
import { sortByOverallDesc } from "../utils/rosterSlots.js";
import { usePlayerProfile } from "../store/playerProfileContext.jsx";
import { getMorale, moodForLevel, moraleColor } from "../engine/moraleEngine.js";
import { EmptyState, PageHeader, Pill, SectionCard, StatCard } from "./ui.jsx";

const RATING_KEYS = [
  { key: "gunny",        label: "Gunny" },
  { key: "awareness",    label: "Awareness" },
  { key: "objective",    label: "Obj" },
  { key: "searchIQ",     label: "S.IQ" },
  { key: "clutch",       label: "Clutch" },
  { key: "teamwork",     label: "T.Work" },
  { key: "composure",    label: "Composure" },
  { key: "adaptability", label: "Adapt." },
];

function ratingColor(v) {
  if (v >= 90) return "#fbbf24";
  if (v >= 80) return "#34d399";
  if (v >= 70) return "#60a5fa";
  if (v >= 60) return "#fb923c";
  return "#f87171";
}

// Deterministic display tag/colour for a historical organisation (no logo
// assets exist for old-era orgs; TeamLogo falls back to a coloured tag box).
function historicalTag(name) {
  return String(name || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "HST";
}
function historicalColor(id) {
  let h = 2166136261;
  for (const ch of String(id || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `hsl(${(h >>> 0) % 360} 62% 58%)`;
}

export default function Roster({ setScreen }) {
  const { state, dispatch } = useGame();
  const { openPlayerProfile } = usePlayerProfile();
  const challengerMode = isChallengerMode(state);
  const historicalMode = state?.userTeamType === "historical";
  const [selectedTeam, setSelectedTeam] = useState(state?.userTeamId ?? "boston");
  const [swapSubId, setSwapSubId] = useState(null);
  const [swapStarterId, setSwapStarterId] = useState(null);

  if (!state) return null;

  const { players, userTeamId } = state;
  const isUserTab = selectedTeam === userTeamId;
  const userChallengerTab = challengerMode && isUserTab;

  const challengerTeam = getUserChallengerTeam(state);
  const myPlayers = userChallengerTab
    ? getChallengerRosterPlayers(state)
    : players.filter(p => p.teamId === selectedTeam);

  const historicalTeamObj = historicalMode ? (state.teams || []).find(t => t.id === selectedTeam) : null;
  const team = userChallengerTab
    ? { name: challengerTeam?.name ?? "Your Challenger Team", color: challengerTeam?.color, tag: challengerTeam?.tag }
    : historicalMode
      ? (historicalTeamObj ? { id: historicalTeamObj.id, name: historicalTeamObj.name, color: historicalColor(historicalTeamObj.id), tag: historicalTag(historicalTeamObj.name) } : null)
      : CDL_TEAMS.find(t => t.id === selectedTeam);

  const starters = sortByOverallDesc(myPlayers.filter(p => !p.isSub));
  const subs = sortByOverallDesc(myPlayers.filter(p => p.isSub));
  const sortedForChem = [...starters, ...subs];
  const chem = calcChemistry(sortedForChem);
  const rosterStatus = userChallengerTab
    ? getChallengerRosterStatus(state)
    : getTeamRosterStatus(players, selectedTeam);
  const showIncomplete = isUserTab && !rosterStatus.valid;
  const avgOvr = starters.length ? Math.round(starters.reduce((sum, p) => sum + (p.overall ?? 0), 0) / starters.length) : "—";
  const expiringCount = myPlayers.filter(p => (p.contractYears ?? 2) <= 1).length;
  const starCount = myPlayers.filter(p => (p.overall ?? 0) >= 85).length;

  const cdlTabs = CDL_TEAMS.map(t => ({ id: t.id, tag: t.tag, color: t.color }));
  // Historical open-circuit careers field the full era organisation list (~28)
  // — the user's team first — instead of the 12 modern CDL franchises.
  const historicalTabs = historicalMode
    ? [...(state.teams || [])]
        .sort((a, b) => (a.id === userTeamId ? -1 : b.id === userTeamId ? 1 : String(a.name).localeCompare(String(b.name))))
        .map(t => ({ id: t.id, tag: historicalTag(t.name), color: historicalColor(t.id) }))
    : [];
  const tabs = historicalMode
    ? historicalTabs
    : challengerMode
      ? [{ id: userTeamId, tag: challengerTeam?.tag ?? "ME", color: challengerTeam?.color }, ...cdlTabs]
      : cdlTabs;

  const releaseAction = userChallengerTab ? "RELEASE_CHALLENGER_PLAYER" : "RELEASE_PLAYER";
  const canManageCdlSlots = isUserTab && !userChallengerTab;
  const canRelease = isUserTab;

  function clearSwapState() {
    setSwapSubId(null);
    setSwapStarterId(null);
  }

  function promote(subId) {
    if (starters.length >= 4) {
      setSwapSubId(subId);
      setSwapStarterId(null);
      return;
    }
    dispatch({ type: "PROMOTE_PLAYER_TO_STARTER", playerId: subId });
    clearSwapState();
  }

  function swapInSub(subId, starterId) {
    dispatch({ type: "SWAP_STARTER_SUB", subId, starterId });
    clearSwapState();
  }

  function PlayerRows({ rows, section }) {
    return rows.map(p => {
      const isStarter = section === "starter";
      const choosingStarterForSub = swapSubId && isStarter;
      const choosingSubForStarter = swapStarterId && !isStarter;
      return (
        <tr
          key={p.id}
          className={`player-row ${p.isSub ? "sub-row" : ""}`}
          onClick={() => openPlayerProfile(p)}
          title="Click for player detail"
        >
          <td
            className="player-name"
            style={{
              borderLeft: `3px solid ${
                p.overall >= 90 ? "#b45309"
                : p.overall >= 85 ? "#15803d"
                : p.overall >= 80 ? "#3d8f5f"
                : "var(--border)"
              }`,
              borderRadius: "6px 0 0 6px",
              paddingLeft: 8,
            }}
          >
            <button className="link-button player-link roster-player-link" onClick={(e) => { e.stopPropagation(); openPlayerProfile(p); }}>{p.name}</button>
            {p.overall >= 85 && <span className="ui-mini-flag star">★</span>}
            {(p.contractYears ?? 2) <= 1 && !userChallengerTab && <span className="ui-mini-flag warn">EXP</span>}
            {(p.form ?? 50) < 45 && <span className="ui-mini-flag danger">FORM</span>}
            {isUserTab && (() => {
              const m = getMorale(state, p.id);
              return <span className="ui-mini-flag morale-flag" style={{ color: moraleColor(m.level), borderColor: moraleColor(m.level) }} title={`Morale ${m.level}`}>{moodForLevel(m.level)}</span>;
            })()}
            {p.isSub ? <span className="sub-label">SUB</span> : <span className="sub-label">STARTER</span>}
          </td>
          <td>{p.age}</td>
          <td><span className="role-pill ui-pill ui-pill-neutral">{p.primary}</span></td>
          <td><span style={{ color: ratingColor(p.overall), fontWeight: "bold" }}>{p.overall}</span></td>
          <td><span style={{ color: ratingColor(p.potential) }}>{p.potential}</span></td>
          <td>
            <div className="form-bar">
              <div className="form-fill" style={{ width: `${p.form}%`, background: ratingColor(p.form) }} />
            </div>
            <span className="form-num">{Math.round(p.form)}</span>
          </td>
          {RATING_KEYS.map(r => <td key={r.key} style={{ color: ratingColor(p[r.key]) }}>{p[r.key]}</td>)}
          <td className="salary">{p.salary != null ? `$${(p.salary / 1000).toFixed(0)}k` : "—"}</td>
          <td style={{ color: (p.contractYears ?? 2) <= 1 ? "#ff6450" : "var(--text-dim)", fontSize: 12 }}>
            {userChallengerTab ? "—" : (p.contractYears ?? "—")}
          </td>
          {(canManageCdlSlots || canRelease) && (
            <td>
              <div className="roster-action-stack" onClick={e => e.stopPropagation()}>
                {canManageCdlSlots && isStarter && (
                  <>
                    <button className="btn-secondary-sm" onClick={() => dispatch({ type: "MOVE_PLAYER_TO_BENCH", playerId: p.id })}>Move to Bench</button>
                    {subs.length > 0 && <button className="btn-secondary-sm" onClick={() => { setSwapStarterId(p.id); setSwapSubId(null); }}>Swap</button>}
                    {choosingStarterForSub && <button className="btn-primary-sm" onClick={() => swapInSub(swapSubId, p.id)}>Swap Here</button>}
                  </>
                )}
                {canManageCdlSlots && !isStarter && (
                  <>
                    <button className="btn-primary-sm" onClick={() => promote(p.id)}>Promote to Starter</button>
                    {starters.length > 0 && <button className="btn-secondary-sm" onClick={() => { setSwapSubId(p.id); setSwapStarterId(null); }}>Swap With Starter</button>}
                    {choosingSubForStarter && <button className="btn-primary-sm" onClick={() => swapInSub(p.id, swapStarterId)}>Swap Here</button>}
                  </>
                )}
                {canRelease && <button className="btn-danger-sm" onClick={() => dispatch({ type: releaseAction, playerId: p.id })}>Release</button>}
              </div>
            </td>
          )}
        </tr>
      );
    });
  }

  function RosterTable({ rows, section }) {
    if (rows.length === 0) {
      return <EmptyState title={section === "starter" ? "No starters selected" : "No bench players"} detail={section === "starter" ? "Promote bench players or sign players to fill the Starting 4." : "Players signed after the Starting 4 is full appear here."} />;
    }
    return (
      <div className="ui-table-wrap roster-table-wrap"><table className="roster-table data-table">
        <thead>
          <tr>
            <th>Player</th><th>Age</th><th>Role</th><th>OVR</th><th>POT</th><th>Form</th>
            {RATING_KEYS.map(r => <th key={r.key}>{r.label}</th>)}
            <th>Salary</th><th>Yrs</th>{(canManageCdlSlots || canRelease) && <th>Actions</th>}
          </tr>
        </thead>
        <tbody><PlayerRows rows={rows} section={section} /></tbody>
      </table></div>
    );
  }

  return (
    <div className="roster-page">
      <div className="team-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`tab-btn ${selectedTeam === t.id ? "active" : ""}`} style={selectedTeam === t.id ? { borderBottomColor: t.color, color: t.color } : {}} onClick={() => { setSelectedTeam(t.id); clearSwapState(); }}>
            {t.tag}{(challengerMode || historicalMode) && t.id === userTeamId ? " ★" : ""}
          </button>
        ))}
      </div>

      <PageHeader
        eyebrow={userChallengerTab ? "Challenger Squad" : "Squad Management"}
        title={team?.name}
        subtitle={userChallengerTab
          ? "Manage your Challenger roster. Sign players from the Market; releasing below 4 blocks match play."
          : "Manage the active Starting 4 separately from substitutes. Matchday uses the selected starters."}
        accent={team?.color}
        action={userChallengerTab && setScreen ? <button className="btn-cta" onClick={() => setScreen("prospects")}>Open Market ›</button> : canManageCdlSlots ? <button className="btn-cta" onClick={() => { dispatch({ type: "AUTO_PICK_BEST_STARTERS" }); clearSwapState(); }}>Auto Pick Best 4</button> : null}
        meta={(
          <div className="ui-stat-grid compact">
            <StatCard label="Starters" value={`${starters.length}/4`} tone={showIncomplete ? "danger" : "success"} />
            <StatCard label="Bench" value={subs.length} />
            <StatCard label="Avg OVR" value={avgOvr} />
            <StatCard label="Chemistry" value={chem} hint={chemLabel(chem)} />
            {!userChallengerTab && <StatCard label="Expiring" value={expiringCount} tone={expiringCount ? "warning" : "neutral"} />}
          </div>
        )}
      />

      <div className="roster-alert-row">
        {starCount > 0 && <Pill tone="gold">★ {starCount} star player{starCount === 1 ? "" : "s"}</Pill>}
        {expiringCount > 0 && !userChallengerTab && <Pill tone="warning">{expiringCount} expiring contract{expiringCount === 1 ? "" : "s"}</Pill>}
        {starters.some(p => (p.form ?? 50) < 45) && <Pill tone="danger">Low form watchlist</Pill>}
        {swapSubId && <Pill tone="accent">Choose a starter to swap out</Pill>}
        {swapStarterId && <Pill tone="accent">Choose a bench player to swap in</Pill>}
      </div>

      {showIncomplete && (
        <div className="roster-warning" role="status">
          <strong>Roster incomplete</strong> — {team?.name} have {rosterStatus.count}/{rosterStatus.required} starters.
          Promote or sign {rosterStatus.missing} more {rosterStatus.missing === 1 ? "player" : "players"} before playing or simming matches.
        </div>
      )}

      {myPlayers.length === 0 ? (
        <SectionCard title="Roster" subtitle="No active players are assigned to this team.">
          <EmptyState title="No players on this roster" detail={userChallengerTab ? "Use the Market to add players." : "Use Free Agency or Challengers to add players."} />
        </SectionCard>
      ) : (
        <>
          <SectionCard title={`Starting 4 (${starters.length}/4)`} subtitle="These are the active players used on matchday.">
            <RosterTable rows={starters} section="starter" />
          </SectionCard>
          <SectionCard title={`Bench / Substitutes (${subs.length})`} subtitle="Depth players stay on the bench until you promote, swap or auto-pick them.">
            <RosterTable rows={subs} section="bench" />
          </SectionCard>
        </>
      )}
    </div>
  );
}
