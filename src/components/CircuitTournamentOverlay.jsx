// src/components/CircuitTournamentOverlay.jsx
// Full-screen live tournament for open-circuit LAN/championship events, styled to
// match the modern CDL major overlay (mto- classes): glassy backdrop, command
// header, tabs (Overview / Winners / Losers / Results / Placements), a round-
// column bracket for the WHOLE field, and a My Team aside. The user plays their
// matches live in the Match Center; AI matches auto-sim as the bracket advances.

import { useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { useMatchCenter } from "../store/matchCenterContext.jsx";
import { useTeamHub } from "../store/teamHubContext.jsx";
import TeamLogo from "./TeamLogo.jsx";
import SeriesDetail from "./SeriesDetail.jsx";
import MatchPreview from "./MatchPreview.jsx";
import { resolveTeamDisplay } from "../utils/teamDisplay.js";
import { getTeamTextAccent } from "../utils/teamTheme.js";
import { isUserRosterPlayable } from "../utils/rosterValidation.js";
import { computeLivePlacements } from "../engine/openCircuit/liveDE.js";

const disp = (id, sch) => resolveTeamDisplay(id, sch);
const tTag = (id, sch) => disp(id, sch)?.tag ?? id;
const tCol = (id, sch) => getTeamTextAccent(disp(id, sch));
function ordinal(n) { const v = Number(n); if (!v) return "—"; const s = ["th", "st", "nd", "rd"], m = v % 100; return v + (s[(m - 20) % 10] || s[m] || s[0]); }

function seedNum(bracket, id, fallback) {
  if (fallback != null) return fallback;
  const i = bracket.seeds?.indexOf(id) ?? -1;
  return i >= 0 ? i + 1 : null;
}
function currentRoundIdx(bracket) {
  for (let r = 0; r < bracket.rounds.length; r++) {
    if (bracket.rounds[r].matches.some(m => !m.played && m.a && m.b)) return r;
  }
  return -1;
}
function userRecord(bracket, uid) {
  let w = 0, l = 0;
  for (const r of bracket.rounds) for (const m of r.matches) {
    if (!m.played || !m.result || m.result.bye) continue;
    if (m.result.winnerId === uid) w++; else if (m.result.loserId === uid) l++;
  }
  return { w, l };
}
function userPath(bracket, uid) {
  const path = [];
  for (const r of bracket.rounds) for (const m of r.matches) {
    if (m.a !== uid && m.b !== uid) continue;
    if (m.result?.bye) continue;
    const oppId = m.a === uid ? m.b : m.a;
    if (m.played && m.result) path.push({ roundName: r.name, played: true, won: m.result.winnerId === uid, score: m.result.score, oppId });
    else if (m.a && m.b) path.push({ roundName: r.name, played: false, oppId });
  }
  return path;
}
function latestResults(bracket, n) {
  const out = [];
  bracket.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => {
    if (m.played && m.result && !m.result.bye) out.push({ ...m, roundName: r.name, roundIdx: ri, matchIdx: mi });
  }));
  return out.slice(-n).reverse();
}
function teamsAlive(bracket) {
  if (bracket.champion) return 1;
  const losses = {};
  for (const r of bracket.rounds) for (const m of r.matches) if (m.result?.loserId) losses[m.result.loserId] = (losses[m.result.loserId] || 0) + 1;
  const total = bracket.seeds?.length ?? 0;
  return total - Object.values(losses).filter(c => c >= 2).length;
}

function BracketTeamLine({ id, seed, sch, uid }) {
  const { openTeamHub } = useTeamHub();
  if (!id) return <div className="mto-bc-teamline" style={{ opacity: 0.5 }}><span className="mto-bc-name">bye</span></div>;
  const d = disp(id, sch);
  return (
    <div className={`mto-bc-teamline ${id === uid ? "mto-bc-teamline-you" : ""}`}>
      {seed && <span className="mto-bc-seed">{seed}</span>}
      <TeamLogo team={d} variant="bracket" size={18} />
      <span className="mto-bc-name team-link" style={{ color: d.color }} onClick={() => openTeamHub(id)}>{d.tag}</span>
      {id === uid && <span className="you-badge you-badge-sm">YOU</span>}
    </div>
  );
}

function MatchCard({ match, bracket, uid, sch, isNext, cardKey, expandedKey, setExpandedKey }) {
  const { openTeamHub } = useTeamHub();
  const seedA = seedNum(bracket, match.a, match.seedA), seedB = seedNum(bracket, match.b, match.seedB);
  const userIn = match.a === uid || match.b === uid;
  if (match.result?.bye) {
    return <div className="mto-bracket-card"><BracketTeamLine id={match.a} seed={seedA} sch={sch} uid={uid} /><BracketTeamLine id={null} sch={sch} uid={uid} /></div>;
  }
  if (!match.played) {
    return (
      <div className={`mto-bracket-card ${isNext && userIn ? "mto-bc-next-user" : isNext ? "mto-bc-next" : ""} ${userIn ? "mto-bc-user-involved" : ""}`}>
        {isNext && <div className={`mto-bc-nextbadge ${userIn ? "mto-bc-nextbadge-you" : ""}`}>{userIn ? "YOUR NEXT MATCH" : "NEXT MATCH"}</div>}
        <BracketTeamLine id={match.a} seed={seedA} sch={sch} uid={uid} />
        <BracketTeamLine id={match.b} seed={seedB} sch={sch} uid={uid} />
      </div>
    );
  }
  const r = match.result;
  const userWon = r.winnerId === uid && userIn, userLost = r.loserId === uid && userIn;
  const isOpen = expandedKey === cardKey;
  return (
    <div className={`mto-bracket-card mto-bc-played ${userWon ? "mbc-user-win" : userLost ? "mbc-user-loss" : ""} ${userIn ? "mto-bc-user-involved" : ""}`}>
      {userIn && <div className={`mto-bc-outcome ${userWon ? "mto-bco-win" : "mto-bco-loss"}`}>{userWon ? "VICTORY" : "DEFEAT"}</div>}
      <div className="mto-bc-score-center">
        <div className={`mto-bc-sc-side ${r.winnerId === uid ? "mto-bc-sc-you" : ""}`}>
          <TeamLogo team={disp(r.winnerId, sch)} variant="bracket" size={18} />
          <span className="mto-bc-sc-tag team-link" style={{ color: tCol(r.winnerId, sch) }} onClick={() => openTeamHub(r.winnerId)}>{tTag(r.winnerId, sch)}</span>
        </div>
        <span className="mto-bc-sc-score">{r.score}</span>
        <div className={`mto-bc-sc-side mto-bc-sc-loser ${r.loserId === uid ? "mto-bc-sc-you" : ""}`}>
          <TeamLogo team={disp(r.loserId, sch)} variant="bracket" size={18} />
          <span className="mto-bc-sc-tag team-link" style={{ color: tCol(r.loserId, sch) }} onClick={() => openTeamHub(r.loserId)}>{tTag(r.loserId, sch)}</span>
        </div>
      </div>
      {r.standoutName && r.standoutKD > 0 && (
        <div className="mto-bc-mvp-row"><span className="mto-bc-mvp-star">★</span><strong className="mto-bc-mvp-name">{r.standoutName}</strong><span className="mto-bc-mvp-kd">{r.standoutKD.toFixed(2)} K/D</span></div>
      )}
      {r.mapResults?.length > 0 && (
        <>
          <button className="mto-bc-details" onClick={() => setExpandedKey(isOpen ? null : cardKey)}>{isOpen ? "Hide ▲" : "Details ▼"}</button>
          {isOpen && <div className="mto-bc-expand"><SeriesDetail result={r} /></div>}
        </>
      )}
    </div>
  );
}

function RoundColumns({ rounds, bracket, uid, sch, curRound, expandedKey, setExpandedKey, empty }) {
  const cols = rounds.filter(r => r.matches.length);
  if (!cols.length) return <div style={{ padding: 24, opacity: 0.6 }}>{empty || "Nothing here yet."}</div>;
  const nextMatch = curRound >= 0 ? bracket.rounds[curRound]?.matches.find(m => !m.played && m.a && m.b) : null;
  return (
    <div className="mto-bracket-rounds">
      {cols.map((r) => {
        const isCur = r.idx === curRound;
        const isDone = r.matches.every(m => m.played);
        return (
          <div key={r.idx} className={`mto-round ${isCur ? "mto-round-active" : ""}`}>
            <div className="mto-round-header">
              <span className="mto-round-name">{r.name}</span>
              {isCur && <span className="mto-round-badge mto-rb-live">▶ Now</span>}
              {isDone && !isCur && <span className="mto-round-badge mto-rb-done">✓</span>}
            </div>
            <div className="mto-round-matches">
              {r.matches.map((m, mi) => (
                <MatchCard key={mi} match={m} bracket={bracket} uid={uid} sch={sch}
                  isNext={m === nextMatch} cardKey={`${r.idx}-${mi}`} expandedKey={expandedKey} setExpandedKey={setExpandedKey} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlacementsPanel({ bracket, uid, sch, complete, compact }) {
  if (!complete) return <div style={{ padding: 24, opacity: 0.6 }}>Placements are set once the bracket finishes.</div>;
  const pl = computeLivePlacements(bracket);
  const rows = Object.entries(pl).map(([teamId, place]) => ({ teamId, place })).sort((a, b) => a.place - b.place).slice(0, compact ? 8 : 32);
  return (
    <div className={compact ? "mto-aside-card" : ""} style={compact ? undefined : { padding: 12 }}>
      {compact && <div className="mto-aside-title">Placements &amp; Points</div>}
      {/* Full placements (champion screen / placements tab) go side-by-side in
          two columns so a 28-team field isn't one very tall list; the aside
          "compact" variant stays single-column. */}
      <div style={{ display: "grid", gap: 4, gridTemplateColumns: compact ? "1fr" : "repeat(2, minmax(0, 1fr))" }}>
        {rows.map(row => (
          <div key={row.teamId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 6, fontSize: 13, background: row.teamId === uid ? "rgba(120,140,255,0.14)" : "rgba(255,255,255,0.02)", fontWeight: row.teamId === uid ? 700 : 400 }}>
            <span style={{ width: 34, opacity: 0.7 }}>{ordinal(row.place)}</span>
            <TeamLogo team={disp(row.teamId, sch)} variant="bracket" size={16} />
            <span style={{ color: tCol(row.teamId, sch) }}>{disp(row.teamId, sch)?.name ?? tTag(row.teamId, sch)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CircuitTournamentOverlay() {
  const { state, dispatch } = useGame();
  const { openMatchCenter } = useMatchCenter();
  const [tab, setTab] = useState("overview");
  const [expandedKey, setExpandedKey] = useState(null);

  const t = state?.circuitTournament;
  if (!t) return null;
  const sch = state.schedule;
  const uid = state.userTeamId;
  const bracket = t.bracket;
  const complete = t.status === "complete" || !!bracket.champion;

  const curRound = currentRoundIdx(bracket);
  const record = userRecord(bracket, uid);
  const path = userPath(bracket, uid);
  const latest = latestResults(bracket, 8);
  const alive = teamsAlive(bracket);
  const champId = bracket.champion;
  const isChamp = champId === uid;
  const stillIn = bracket.rounds.some(r => r.matches.some(m => !m.played && (m.a === uid || m.b === uid)));
  const userStatus = isChamp ? "Champion" : (complete || !stillIn) ? "Eliminated" : "Alive";
  const finalResult = complete ? state.openCircuit?.results?.[t.eventId] : null;
  const userRank = finalResult?.userPlacement ?? null;

  const nextMatch = curRound >= 0 ? bracket.rounds[curRound].matches.find(m => !m.played && m.a && m.b) : null;
  const userInNext = nextMatch ? (nextMatch.a === uid || nextMatch.b === uid) : false;
  const nextOpp = path.find(l => !l.played)?.oppId ?? null;

  function handlePlay() {
    if (!isUserRosterPlayable(state)) dispatch({ type: "SHOW_ROSTER_INCOMPLETE" });
    else openMatchCenter("circuit");
  }

  // ── Champion screen ──
  if (complete) {
    return (
      <div className="mto-backdrop mto-backdrop-champ">
        <div className="mto-champion-screen">
          <div className="mto-champ-trophy">🏆</div>
          <div className="mto-champ-title" style={{ color: tCol(champId, sch) }}>
            {disp(champId, sch)?.name ?? champId}{isChamp && <span className="you-badge" style={{ marginLeft: 10 }}>YOUR TEAM</span>}
          </div>
          <div className="mto-champ-subtitle">{t.name} — Champion</div>
          <div style={{ margin: "10px 0", fontSize: 14 }}>
            You finished <strong style={{ color: isChamp ? "#fbbf24" : "inherit" }}>{userRank ? ordinal(userRank) : "—"}</strong>
            {finalResult?.userPoints > 0 && <span style={{ color: "#34d399", marginLeft: 10 }}>+{finalResult.userPoints.toLocaleString()} Pro Points/player</span>}
          </div>
          <div className="mto-champ-placements"><PlacementsPanel bracket={bracket} uid={uid} sch={sch} complete /></div>
          <button className="mto-return-btn" onClick={() => dispatch({ type: "CLOSE_CIRCUIT_TOURNAMENT" })}>Return to Circuit →</button>
        </div>
      </div>
    );
  }

  const indexed = bracket.rounds.map((r, i) => ({ ...r, idx: i }));
  const wb = indexed.filter(r => r.type === "WB");
  const lb = indexed.filter(r => r.type === "LB" || r.type === "GF");
  const overview = (() => {
    const out = [];
    if (curRound >= 0) out.push(indexed[curRound]);
    const prev = indexed.filter(r => r.idx < curRound && r.matches.length && r.matches.every(m => m.played));
    if (prev.length) out.unshift(prev[prev.length - 1]);
    return out;
  })();
  const resultsRounds = indexed.filter(r => r.matches.some(m => m.played && !m.result?.bye));
  const tabs = [["overview", "Overview"], ["winners", "Winners"], ["losers", "Losers"], ["results", "Results"], ["placements", "Placements"]];

  return (
    <div className="mto-backdrop mto-redesign">
      {/* Command header */}
      <div className="mto-cmd-header">
        <div className="mto-ch-left">
          <span className="mto-ch-live">●</span>
          <span className="mto-ch-event">{t.name}</span>
          {curRound >= 0 && <><span className="mto-ch-sep">/</span><span className="mto-ch-round">{bracket.rounds[curRound].name}</span></>}
          <span className="mto-ch-alive">{alive} alive</span>
        </div>
        <div className="mto-ch-user">
          <TeamLogo team={disp(uid, sch)} variant="bracket" size={20} />
          <span className="mto-ch-team" style={{ color: tCol(uid, sch) }}>{disp(uid, sch)?.name}</span>
          <span className="you-badge">YOUR TEAM</span>
          <span className={`mto-ch-status ${userStatus === "Eliminated" ? "mto-ch-status-out" : "mto-ch-status-alive"}`}>{userStatus}</span>
          <span className="mto-ch-rec">{record.w}-{record.l}</span>
          {userStatus === "Alive" && nextOpp && <span className="mto-ch-next">Next: {tTag(nextOpp, sch)}</span>}
        </div>
        <div className="mto-ch-cmds">
          {userInNext
            ? <button className="btn-primary mto-cmd-btn mto-cmd-primary" onClick={handlePlay}>▶ Play Your Match</button>
            : <button className="btn-secondary mto-cmd-btn" onClick={() => dispatch({ type: "SIM_CIRCUIT_USER_MATCH" })}>Sim Next</button>}
          {userInNext && <button className="btn-secondary mto-cmd-btn" onClick={() => dispatch({ type: "SIM_CIRCUIT_USER_MATCH" })}>Sim My Match</button>}
          <button className="btn-secondary mto-cmd-btn mto-cmd-ghost" onClick={() => dispatch({ type: "SIM_CIRCUIT_FINISH" })}>Finish Event</button>
        </div>
      </div>

      <div className="mto-scroll-area">
        <div className="mto-layout">
          <main className="mto-main">
            <div className="mto-tabs">
              {tabs.map(([id, label]) => (
                <button key={id} className={`mto-tab ${tab === id ? "mto-tab-active" : ""}`} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            <div className="mto-tab-body">
              {tab === "overview" && <RoundColumns rounds={overview.filter(Boolean)} bracket={bracket} uid={uid} sch={sch} curRound={curRound} expandedKey={expandedKey} setExpandedKey={setExpandedKey} empty="Event hasn't started yet." />}
              {tab === "winners" && <RoundColumns rounds={wb} bracket={bracket} uid={uid} sch={sch} curRound={curRound} expandedKey={expandedKey} setExpandedKey={setExpandedKey} empty="No winners-bracket rounds." />}
              {tab === "losers" && <RoundColumns rounds={lb} bracket={bracket} uid={uid} sch={sch} curRound={curRound} expandedKey={expandedKey} setExpandedKey={setExpandedKey} empty="No losers-bracket rounds yet." />}
              {tab === "results" && <RoundColumns rounds={resultsRounds} bracket={bracket} uid={uid} sch={sch} curRound={curRound} expandedKey={expandedKey} setExpandedKey={setExpandedKey} empty="No results yet." />}
              {tab === "placements" && <PlacementsPanel bracket={bracket} uid={uid} sch={sch} complete={complete} />}
            </div>
          </main>

          <aside className="mto-aside">
            <div className="mto-aside-card mto-myteam">
              <div className="mto-aside-title">My Team</div>
              <div className="mto-myteam-id">
                <TeamLogo team={disp(uid, sch)} variant="bracket" size={28} />
                <div className="mto-myteam-meta">
                  <span className="mto-myteam-name" style={{ color: tCol(uid, sch) }}>{disp(uid, sch)?.name}</span>
                  <span className="mto-myteam-seed">Seed #{seedNum(bracket, uid, null)}</span>
                </div>
              </div>
              <div className="mto-myteam-rows">
                <div className="mto-mt-row"><span>Status</span><strong className={userStatus === "Eliminated" ? "mto-x-out" : "mto-x-alive"}>{userStatus}</strong></div>
                <div className="mto-mt-row"><span>Record</span><strong>{record.w}-{record.l}</strong></div>
                <div className="mto-mt-row"><span>Bracket</span><strong>{userStatus === "Eliminated" ? "Out" : record.l === 0 ? "Winners" : "Losers"}</strong></div>
              </div>
            </div>

            {nextMatch && (
              <div className={`mto-aside-card mto-curmatch ${userInNext ? "mto-curmatch-user" : ""}`}>
                <div className="mto-aside-title">{userInNext ? "Your Next Match" : "Current Match"}<span className="mto-curmatch-round">{bracket.rounds[curRound].name}</span></div>
                <div className="mto-curmatch-teams">
                  <div className={`mto-cm-team ${nextMatch.a === uid ? "mto-cm-you" : ""}`}>
                    <TeamLogo team={disp(nextMatch.a, sch)} variant="bracket" size={18} />
                    <span className="mto-cm-name" style={{ color: tCol(nextMatch.a, sch) }}>{tTag(nextMatch.a, sch)}</span>
                    {nextMatch.a === uid && <span className="you-badge you-badge-sm">YOU</span>}
                  </div>
                  <span className="mto-cm-vs">vs</span>
                  <div className={`mto-cm-team ${nextMatch.b === uid ? "mto-cm-you" : ""}`}>
                    <TeamLogo team={disp(nextMatch.b, sch)} variant="bracket" size={18} />
                    <span className="mto-cm-name" style={{ color: tCol(nextMatch.b, sch) }}>{tTag(nextMatch.b, sch)}</span>
                    {nextMatch.b === uid && <span className="you-badge you-badge-sm">YOU</span>}
                  </div>
                </div>
                {userInNext
                  ? <button className="btn-primary mto-cm-btn" onClick={handlePlay}>▶ Play Your Match</button>
                  : <button className="btn-secondary mto-cm-btn" onClick={() => dispatch({ type: "SIM_CIRCUIT_USER_MATCH" })}>▶ Sim This Match</button>}
                <MatchPreview teamAId={nextMatch.a} teamBId={nextMatch.b} compact />
              </div>
            )}

            {path.length > 0 && (
              <div className="mto-aside-card">
                <div className="mto-aside-title">My Team Path</div>
                <div className="mto-path">
                  {path.map((leg, i) => (
                    <div key={i} className={`mto-path-leg ${leg.played ? (leg.won ? "mto-path-win" : "mto-path-loss") : "mto-path-next"}`}>
                      <span className="mto-path-round">{leg.roundName}</span>
                      <span className="mto-path-detail">{leg.played ? <>{leg.won ? "Won" : "Lost"} {leg.score} vs {tTag(leg.oppId, sch)}</> : <>Next vs {tTag(leg.oppId, sch)}</>}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mto-aside-card">
              <div className="mto-aside-title">Latest Results</div>
              {latest.length === 0 ? <div className="mto-lr-empty">No matches played yet.</div> : (
                <div className="mto-lr-list">
                  {latest.map((m, i) => (
                    <div key={i} className={`mto-lr-row ${m.a === uid || m.b === uid ? "mto-lr-user" : ""}`}>
                      <span className="mto-lr-round">{m.roundName}</span>
                      <span className="mto-lr-line">
                        <span className="mto-lr-win" style={{ color: tCol(m.result.winnerId, sch) }}>{tTag(m.result.winnerId, sch)}</span>
                        <span className="mto-lr-score">{m.result.score}</span>
                        <span className="mto-lr-lose" style={{ color: tCol(m.result.loserId, sch) }}>{tTag(m.result.loserId, sch)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
