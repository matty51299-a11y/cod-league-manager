// src/components/TeamSelect.jsx
// Startup screen shown when no save exists. The user chooses a career path:
//   • Manage CDL Team       → pick one of the 12 CDL franchises
//   • Manage Challenger Team → pick one of the 24 Challenger teams ("Road to CDL")
// The Challenger picker shows live roster OVR estimates seeded so the started
// save matches the preview.

import { useMemo, useState } from "react";
import { CDL_TEAMS } from "../data/teams.js";
import { HISTORICAL_START_ERA_ID } from "../data/codEras.js";
import { buildHistoricalSeasonTemplate } from "../data/historicalRosterDb.js";
import { useGame, buildChallengerPreview } from "../store/gameStore.jsx";

export default function TeamSelect() {
  const { dispatch } = useGame();
  const [mode, setMode] = useState("cdl"); // "cdl" | "challenger"
  const [careerMode, setCareerMode] = useState("modern");
  const [strictness, setStrictness] = useState("balanced"); // loose | balanced | strict
  const [seedInput, setSeedInput] = useState("");

  const historicalTeams = useMemo(() => buildHistoricalSeasonTemplate(HISTORICAL_START_ERA_ID)?.teams || [], []);
  // One stable seed for this picker session → preview matches the started save.
  // Lazy state initializer runs once; keeps render pure on subsequent renders.
  const [seed] = useState(() => ((Date.now() % 999983) * 31 + 7) | 0 || 1);
  const challengerTeams = useMemo(() => (mode === "challenger" ? buildChallengerPreview(seed) : []), [mode, seed]);

  // Optional deterministic dynasty seed (blank → random). Non-numeric input is
  // hashed to a stable integer so any text works as a seed.
  function resolveDynastySeed() {
    const raw = seedInput.trim();
    if (!raw) return undefined;
    if (/^-?\d+$/.test(raw)) return (Number(raw) >>> 0) || 1;
    let h = 2166136261;
    for (const ch of raw) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0) || 1;
  }

  function selectCdl(teamId) {
    dispatch({
      type: "NEW_GAME", teamId, teamType: "cdl", careerMode,
      historicalStrictness: careerMode === "historical" ? strictness : undefined,
      dynastySeed: careerMode === "historical" ? resolveDynastySeed() : undefined,
    });
  }
  function selectChallenger(teamId) {
    dispatch({
      type: "NEW_GAME", teamId, teamType: "challenger", seed, careerMode,
      historicalStrictness: careerMode === "historical" ? strictness : undefined,
      dynastySeed: careerMode === "historical" ? resolveDynastySeed() : undefined,
    });
  }

  const STRICTNESS = [
    { id: "loose", label: "Loose History", sub: "Only titles, eras & major league changes are historical" },
    { id: "balanced", label: "Balanced History", sub: "Historical orgs, players & world changes; results are dynamic" },
    { id: "strict", label: "Strict History", sub: "AI leans harder into historical rosters (you keep full control)" },
  ];

  return (
    <div className="team-select">
      <h1 className="title">CDL MANAGER 2026</h1>
      <p className="subtitle">Choose your career path</p>

      <div className="ts-mode-tabs">
        <button
          className={`ts-mode-tab ${careerMode === "modern" ? "active" : ""}`}
          onClick={() => setCareerMode("modern")}
        >
          Modern CDL 2026
          <span className="ts-mode-sub">Default current-era save</span>
        </button>
        <button
          className={`ts-mode-tab ${careerMode === "historical" ? "active" : ""}`}
          onClick={() => setCareerMode("historical")}
        >
          Historical Dynasty: Ghosts Era
          <span className="ts-mode-sub">Start in Call of Duty: Ghosts and advance by title</span>
        </button>
      </div>

      {careerMode === "historical" && (
        <div className="ts-dynasty-config">
          <div className="ts-dynasty-row">
            <span className="ts-dynasty-label">Historical strictness</span>
            <div className="ts-strictness-tabs">
              {STRICTNESS.map(s => (
                <button
                  key={s.id}
                  className={`ts-strictness-tab ${strictness === s.id ? "active" : ""}`}
                  onClick={() => setStrictness(s.id)}
                  title={s.sub}
                >
                  <strong>{s.label}</strong>
                  <span>{s.sub}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ts-dynasty-row">
            <span className="ts-dynasty-label">Random seed <em>(optional)</em></span>
            <input
              className="ts-seed-input"
              type="text"
              placeholder="Blank = random"
              value={seedInput}
              onChange={e => setSeedInput(e.target.value)}
            />
            <span className="ts-dynasty-hint">Start date: 1 Sep 2013 · Pre-season before Call of Duty: Ghosts</span>
          </div>
        </div>
      )}

      {careerMode !== "historical" && <div className="ts-mode-tabs">
        <button
          className={`ts-mode-tab ${mode === "cdl" ? "active" : ""}`}
          onClick={() => setMode("cdl")}
        >
          Manage CDL Team
          <span className="ts-mode-sub">12 franchises · compete for Champs</span>
        </button>
        <button
          className={`ts-mode-tab ${mode === "challenger" ? "active" : ""}`}
          onClick={() => setMode("challenger")}
        >
          Manage Challenger Team
          <span className="ts-mode-sub">24 teams · Road to CDL career</span>
        </button>
      </div>}

      {careerMode === "historical" ? (
        <>
          <h2>Choose a Ghosts Organisation</h2>
          <p className="ts-challenger-note">Choose from the historical Ghosts field. Every organisation competes in the same open circuit through Online 2Ks, Online 5Ks, open LANs, league events and the Call of Duty Championship.</p>
          <div className="team-grid">
            {historicalTeams.map(team => (
              <button key={team.historicalTeamId} className="team-card" onClick={() => selectCdl(team.historicalTeamId)}>
                <span className="team-tag">GHOSTS</span><span className="team-name">{team.teamName}</span>
              </button>
            ))}
          </div>
        </>
      ) : mode === "cdl" ? (
        <div className="team-grid">
          {CDL_TEAMS.map(team => (
            <button
              key={team.id}
              className="team-card"
              style={{ borderColor: team.color }}
              onClick={() => selectCdl(team.id)}
            >
              <span className="team-tag" style={{ color: team.color }}>{team.tag}</span>
              <span className="team-name">{team.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className="ts-challenger-note">
            Develop players, win qualifiers, qualify for Pro-Am Majors, the Challengers Finals and ESWC —
            but bigger CDL teams will try to buy out your best talent.
          </p>
          <div className="team-grid ts-challenger-grid">
            {challengerTeams.map(team => (
              <button
                key={team.id}
                className="team-card ts-challenger-card"
                style={{ borderColor: team.color }}
                onClick={() => selectChallenger(team.id)}
              >
                <span className="team-tag" style={{ color: team.color }}>{team.tag}</span>
                <span className="team-name">{team.name}</span>
                <span className="ts-challenger-meta">
                  <span className="ts-chip">{team.region}</span>
                  <span className="ts-chip">Est. OVR {team.ovr}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
