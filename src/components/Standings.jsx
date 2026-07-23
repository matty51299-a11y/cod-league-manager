// src/components/Standings.jsx
// Shows league standings table sorted by points.
// During stage play → stageStandings (per-stage, resets each stage).
// During offseason / Champs seeding → cumulative standings.

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import { useTeamHub } from "../store/teamHubContext.jsx";
import { calcTeamOvr } from "../engine/teamOvr.js";
import TeamLogo from "./TeamLogo.jsx";
import { resolveTeamDisplay } from "../utils/teamDisplay.js";
import { isChallengerMode, getChallengerRosterPlayers } from "../utils/userTeam.js";

export default function Standings() {
  const { state } = useGame();
  const { openTeamHub } = useTeamHub();
  const [showCumulative, setShowCumulative] = useState(false);
  // Challenger users default to the Circuit standings; they can flip to CDL.
  const [view, setView] = useState(isChallengerMode(state) ? "circuit" : "cdl");
  if (!state) return null;

  const { schedule, userTeamId, players } = state;
  if (state.competitionProfile?.usesProPoints) {
    const rows = state.openCircuit?.ranking || [];
    return <div className="standings-page"><div className="standings-header-row"><div><h2>Ghosts Pro Points — Season {state.season}</h2><p className="muted">All teams begin at zero. First-event seeding uses team overall, then stable organisation ID.</p></div></div>
      <table className="standings-table"><thead><tr><th>#</th><th>Team</th><th>Pro Points</th></tr></thead><tbody>{rows.map((row) => <tr key={row.teamId} className={row.teamId === userTeamId ? "user-row" : ""}><td>{row.rank}</td><td>{row.name}</td><td>{row.points}</td></tr>)}</tbody></table></div>;
  }
  const phase = schedule.phase;
  const challengerMode = isChallengerMode(state);

  if (challengerMode && view === "circuit") {
    return (
      <ChallengerCircuit
        state={state}
        openTeamHub={openTeamHub}
        onSwitch={() => setView("cdl")}
      />
    );
  }

  // During stage/major: default to per-stage standings; toggle to season total.
  // During preChamps/offseason: always use cumulative.
  const isStagePhase = phase === "stage" || phase === "challengerQualifier" || phase === "major";
  const useStage = isStagePhase && !showCumulative;

  const displayStandings = useStage
    ? (schedule.stageStandings ?? schedule.standings ?? {})
    : (schedule.standings ?? {});

  const sorted = CDL_TEAMS
    .map(team => ({
      team,
      record: displayStandings[team.id] ?? { wins: 0, losses: 0, points: 0 },
    }))
    .sort((a, b) => b.record.points - a.record.points);

  const stageIdx  = schedule.stageIdx  ?? schedule.currentStage ?? 0;
  const majorIdx  = schedule.majorIdx  ?? 0;
  const phaseLabel =
    phase === "stage"       ? schedule.stages?.[stageIdx]?.name
    : phase === "challengerQualifier" ? `${schedule.majors?.[majorIdx]?.name ?? "Major"} Qualifier`
    : phase === "major"     ? schedule.majors?.[majorIdx]?.name
    : phase === "preChamps" ? "Pre-Championship Window"
    : "Offseason";

  return (
    <div className="standings-page">
      <div className="standings-header-row">
        <div>
          <h2>CDL League Standings – Season {state.season}</h2>
          <p className="muted">Phase: {phaseLabel}{challengerMode ? " · CDL season runs in the background" : ""}</p>
          {challengerMode && (
            <button className="link-button" onClick={() => setView("circuit")}>‹ Back to Challenger Circuit</button>
          )}
        </div>
        {isStagePhase && (
          <div className="standings-toggle">
            <button
              className={`stg-toggle-btn ${!showCumulative ? "active" : ""}`}
              onClick={() => setShowCumulative(false)}
            >
              {phase === "major"
                ? `${schedule.stages?.[stageIdx]?.name ?? "Stage"} (seeding)`
                : "This Stage"}
            </button>
            <button
              className={`stg-toggle-btn ${showCumulative ? "active" : ""}`}
              onClick={() => setShowCumulative(true)}
            >
              Season Total
            </button>
          </div>
        )}
      </div>

      {useStage && (
        <p className="muted standings-note">
          {phase === "major"
            ? "Showing the stage standings used to seed this bracket. Season total is used for Champs seeding."
            : "Per-stage record — resets between stages. Cumulative season pts seed the Championship."}
        </p>
      )}

      <table className="standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>W</th>
            <th>L</th>
            <th>Pts</th>
            <th>OVR</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ team, record }, i) => {
            const ovr = calcTeamOvr(team.id, players);
            const display = resolveTeamDisplay(team.id, schedule);
            return (
            <tr key={team.id} className={team.id === userTeamId ? "user-row" : ""}>
              <td style={{ borderLeft: `3px solid ${team.color}`, borderRadius: "6px 0 0 6px", paddingLeft: 8 }}>
                {i + 1}
              </td>
              <td className="standings-team-cell">
                <span
                  className="team-link standings-team-link"
                  style={{ color: display.color }}
                  onClick={() => openTeamHub(team.id)}
                >
                  <span className="standings-team-logo-slot">
                    <TeamLogo team={display} variant="table" className="standings-team-logo" />
                  </span>
                  <span className="standings-team-name">{display.name}</span>
                </span>
                {team.id === userTeamId && <span className="you-badge"> YOU</span>}
              </td>
              <td>{record.wins}</td>
              <td>{record.losses}</td>
              <td className="pts">{record.points}</td>
              <td className="pts">{ovr}</td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* Show major bracket results */}
      {schedule.majors?.map((major, i) => {
        if (!major.bracket) return null;
        return <MajorBracketSummary key={i} major={major} />;
      })}
    </div>
  );
}

function ChallengerCircuit({ state, openTeamHub, onSwitch }) {
  const teams = state.challengerTeams || [];
  const rows = teams
    .map(t => {
      const roster = getChallengerRosterPlayers(state, t.id);
      const ovr = roster.length ? Math.round(roster.reduce((s, p) => s + (p.overall ?? 60), 0) / roster.length) : 0;
      return {
        id: t.id, name: t.name, tag: t.tag, color: t.color, region: t.region,
        circuitPoints: t.circuitPoints ?? 0, form: t.form ?? 0,
        lastQualifierPlacement: t.lastQualifierPlacement, ovr,
      };
    })
    .sort((a, b) => b.circuitPoints - a.circuitPoints || b.ovr - a.ovr);

  return (
    <div className="standings-page">
      <div className="standings-header-row">
        <div>
          <h2>Challenger Circuit Standings – Season {state.season}</h2>
          <p className="muted">Ranked by circuit points. Top teams seed the qualifiers, Challengers Finals and ESWC.</p>
        </div>
        <div className="standings-toggle">
          <button className="stg-toggle-btn active">Circuit</button>
          <button className="stg-toggle-btn" onClick={onSwitch}>CDL League</button>
        </div>
      </div>

      <table className="standings-table">
        <thead>
          <tr><th>#</th><th>Team</th><th>Region</th><th>Circuit Pts</th><th>Form</th><th>Best Qual</th><th>OVR</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.id === state.userTeamId ? "user-row" : ""}>
              <td style={{ borderLeft: `3px solid ${r.color}`, borderRadius: "6px 0 0 6px", paddingLeft: 8 }}>{i + 1}</td>
              <td className="standings-team-cell">
                <span className="team-link" style={{ color: r.color }} onClick={() => openTeamHub(r.id)}>{r.name}</span>
                {r.id === state.userTeamId && <span className="you-badge"> YOU</span>}
              </td>
              <td>{r.region}</td>
              <td className="pts">{r.circuitPoints}</td>
              <td>{r.form > 0 ? `+${r.form}` : r.form}</td>
              <td>{r.lastQualifierPlacement ? `${r.lastQualifierPlacement}` : "—"}</td>
              <td className="pts">{r.ovr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MajorBracketSummary({ major }) {
  const { openTeamHub } = useTeamHub();
  const { bracket } = major;
  if (!bracket?.rounds) return null;

  return (
    <div className="bracket-section">
      <h3>{major.name}</h3>
      {bracket.champion && (
        <p className="champion-text">
          Champion: <strong>{CDL_TEAMS.find(t => t.id === bracket.champion)?.name ?? bracket.champion}</strong>
        </p>
      )}
      {bracket.rounds.map((round, ri) => {
        if (!round.matches || round.matches.length === 0) return null;
        return (
          <div key={ri} className="bracket-round">
            <h4>{round.name}</h4>
            <div className="bracket-matches">
              {round.matches.map((m, mi) => {
                if (!m.a && !m.b) return null;
                const teamA = CDL_TEAMS.find(t => t.id === m.a);
                const teamB = CDL_TEAMS.find(t => t.id === m.b);
                const winnerA = m.result?.winnerId === m.a;
                const winnerB = m.result?.winnerId === m.b;
                return (
                  <div key={mi} className="bracket-match">
                    <span
                      className={`team-link ${winnerA ? "winner" : (m.played ? "loser" : "")}`}
                      onClick={() => openTeamHub(m.a)}
                    >
                      {teamA?.tag ?? m.a}
                    </span>
                    {" vs "}
                    <span
                      className={`team-link ${winnerB ? "winner" : (m.played ? "loser" : "")}`}
                      onClick={() => openTeamHub(m.b)}
                    >
                      {teamB?.tag ?? m.b}
                    </span>
                    {m.result && <span className="score"> {m.result.score}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
