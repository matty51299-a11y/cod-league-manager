import { useMemo, useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { usePlayerProfile } from "../store/playerProfileContext.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { buildPlayerHistory, findPlayerEverywhere, getPlayerCurrentStatus, kdText } from "../utils/historyProfiles.js";
import { resolveTeamDisplay } from "../utils/teamDisplay.js";
import { isCdlTeamId } from "../utils/playerIdentity.js";
import {
  getPlayerValuation, getAskingPrice, getTransferStatus, getTransferBudget,
  isTransferWindowOpen, fmtFee, getTransferIntel,
} from "../engine/transferEngine.js";
import { getMorale, moodForLevel, moraleColor, derivePersonality, getPromiseRiskLabel, buildConversationContext } from "../engine/moraleEngine.js";
import { isChallengerMode } from "../utils/userTeam.js";
import ConversationModal from "./ConversationModal.jsx";

function ratingColor(v) {
  if (v >= 90) return "#166534";
  if (v >= 80) return "#15803d";
  if (v >= 70) return "#1d4ed8";
  if (v >= 60) return "#9a3412";
  return "#dc2626";
}

function statText(value, fallback = "Not tracked yet") {
  return value == null || Number.isNaN(value) ? fallback : value;
}

function stockLabel(player) {
  const ovr = player?.overall ?? player?.scoutedOverall ?? 0;
  const pot = player?.potential ?? player?.scoutedPotential ?? ovr;
  if (!player) return null;
  if (ovr >= 80 && pot >= 88) return "Blue Chip";
  if (ovr >= 78 || (ovr >= 75 && pot >= 86)) return "CDL Ready";
  if (player.isProspect) return "Prospect";
  if (!player.teamId) return "Free Agent";
  return null;
}

export default function PlayerProfileOverlay() {
  const { state, dispatch } = useGame();
  const { openPlayerRef, closePlayerProfile } = usePlayerProfile();
  const [tab, setTab] = useState(null);
  const [offerK, setOfferK] = useState("");
  const [showTalk, setShowTalk] = useState(false);
  const player = useMemo(() => findPlayerEverywhere(state, openPlayerRef), [state, openPlayerRef]);
  const history = useMemo(() => buildPlayerHistory(state, player), [state, player]);

  if (!state || !openPlayerRef) return null;

  const status = getPlayerCurrentStatus(player, state);
  const seasons = history.seasons.length ? history.seasons : [{ season: state.season, kills: 0, deaths: 0, matches: 0, maps: 0, teams: new Set(player?.teamId ? [player.teamId] : []), roles: new Set(player?.primary ? [player.primary] : []), events: [] }];
  const activeSeason = tab ?? seasons[seasons.length - 1]?.season;
  const season = seasons.find(s => s.season === activeSeason) ?? seasons[0];
  const summary = history.summary || {};

  const careerRows = seasons.map(s => {
    const teams = [...(s.teams || [])].map(tid => resolveTeamDisplay(tid, state.schedule)).filter(Boolean);
    return {
      season: s.season,
      teams,
      roles: [...(s.roles || [])].join(", ") || player?.primary || "—",
      matches: s.matches || 0,
      maps: s.maps || 0,
      kills: s.kills || 0,
      deaths: s.deaths || 0,
      kd: kdText(s.kills, s.deaths),
      events: s.events?.length || 0,
      awards: s.awards?.length || 0,
    };
  }).sort((a, b) => Number(b.season) - Number(a.season));
  const totals = careerRows.reduce((acc, row) => ({
    matches: acc.matches + row.matches,
    maps: acc.maps + row.maps,
    kills: acc.kills + row.kills,
    deaths: acc.deaths + row.deaths,
    events: acc.events + row.events,
    awards: acc.awards + row.awards,
  }), { matches: 0, maps: 0, kills: 0, deaths: 0, events: 0, awards: 0 });
  const ovr = player?.overall ?? player?.scoutedOverall;
  const pot = player?.potential ?? player?.scoutedPotential;

  return (
    <div className="player-modal-backdrop" onClick={closePlayerProfile}>
      <div className="player-modal pm-wide profile-modal" onClick={e => e.stopPropagation()}>
        <div className="pm-header" style={{ borderTopColor: status.team?.color ?? "var(--accent)" }}>
          <div className="pm-crest" style={{ borderColor: status.team?.color ?? "var(--border)" }}>
            {status.team
              ? <TeamLogo team={status.team} size={52} variant="hero" />
              : <span className="pm-crest-fa">FA</span>}
          </div>
          <div className="pm-identity">
            <div className="pm-name">{player?.name ?? "Unknown Player"}</div>
            <div className="pm-meta">
              {status.team && <span className="pm-team" style={{ color: status.team.color, display: "inline-flex", alignItems: "center", gap: 6 }}><TeamLogo team={status.team} size={18} />{status.team.name}</span>}
              {!status.team && <span className="muted">{status.label}</span>}
              {player?.region && <><span className="pm-dot">·</span><span className="pm-region-badge">{player.region}</span></>}
              {player?.primary && <><span className="pm-dot">·</span><span className="role-pill pm-role">{player.primary}</span></>}
              {player?.isSub && <span className="sub-label">SUB</span>}
            </div>
            <div className="pm-info-strip">
              <span><span className="pm-strip-lbl">Age</span> {player?.age ?? "—"}</span>
              <span><span className="pm-strip-lbl">POT</span> <b style={{ color: ratingColor(pot) }}>{pot ?? "—"}</b></span>
              <span><span className="pm-strip-lbl">Salary</span> {player?.salary ? `$${(player.salary / 1000).toFixed(0)}k` : "—"}</span>
              <span><span className="pm-strip-lbl">Contract</span> {player?.contractYears != null ? `${player.contractYears} yr${player.contractYears === 1 ? "" : "s"}` : "—"}</span>
              {stockLabel(player) && <span><span className="pm-strip-lbl">Stock</span> {stockLabel(player)}</span>}
            </div>
          </div>
          <div className="pm-ovr-block"><div className="pm-ovr" style={{ color: ratingColor(ovr) }}>{ovr ?? "—"}</div><div className="pm-ovr-label">OVR</div></div>
          <button className="pm-close" onClick={closePlayerProfile} aria-label="Close">✕</button>
        </div>

        <div className="pm-body">
          <div className="pm-history-shell">
            <div className="pm-history-title">
              <span>Career Stats</span>
              <div className="profile-tabs pm-history-tabs">
                {seasons.map(s => <button key={s.season} className={s.season === season.season ? "active" : ""} onClick={() => setTab(s.season)}>S{s.season}</button>)}
              </div>
            </div>
            <div className="pm-history-table-wrap">
              <table className="pm-career-table">
                <thead><tr><th>Year</th><th>Team</th><th>Info</th><th>Role</th><th>Matches</th><th>Maps</th><th>K</th><th>D</th><th>K/D</th><th>Events</th><th>Awards</th></tr></thead>
                <tbody>
                  {careerRows.map(row => (
                    <tr key={row.season} className={row.season === season.season ? "is-active" : ""} onClick={() => setTab(row.season)}>
                      <td><span className="pm-season-dot" />S{row.season}</td>
                      <td>{row.teams.length ? row.teams.map((t, idx) => <span key={`${row.season}_${t.id}_${idx}`} className="pm-career-team"><TeamLogo team={t} size={22} />{t.tag}</span>) : status.label}</td>
                      <td>{row.teams.map(t => t.name).join(" / ") || "Unsigned"}</td>
                      <td>{row.roles}</td>
                      <td>{row.matches}</td><td>{row.maps || "—"}</td><td>{row.kills}</td><td>{row.deaths}</td><td>{row.kd}</td><td>{row.events}</td><td>{row.awards || "—"}</td>
                    </tr>
                  ))}
                  <tr className="pm-career-total"><td>Total</td><td colSpan="3">Career tracked totals</td><td>{totals.matches}</td><td>{totals.maps || "—"}</td><td>{totals.kills}</td><td>{totals.deaths}</td><td>{summary.kd == null ? "—" : summary.kd.toFixed(2)}</td><td>{totals.events}</td><td>{totals.awards || "—"}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="pm-section pm-summary-compact">
            <div className="pm-section-title">Career Summary</div>
            <div className="profile-summary-grid">
              <ProfileStat label="Seasons" value={summary.seasonsPlayed ?? 0} />
              <ProfileStat label="Teams" value={summary.teamsPlayed ?? 0} />
              <ProfileStat label="Career K/D" value={summary.kd == null ? "—" : summary.kd.toFixed(2)} />
              <ProfileStat label="Best Major" value={summary.bestMajor || "Not tracked"} />
              <ProfileStat label="Best Champs" value={summary.bestChamps || "Not tracked"} />
              <ProfileStat label="Best CQ" value={summary.bestCQ || "Not tracked"} />
            </div>
          </div>

          {player && player.teamId && isCdlTeamId(player.teamId) && (() => {
            const isMine = player.teamId === state.userTeamId;
            const val = getPlayerValuation(player, state);
            const status = getTransferStatus(player, state);
            const windowOpen = isTransferWindowOpen(state);
            const intel = !isMine ? getTransferIntel(player, state, state.userTeamId) : null;
            return (
              <div className="pm-section pm-transfer-section">
                <div className="pm-section-title">Transfer</div>
                <div className="pm-info-strip">
                  <span><span className="pm-strip-lbl">Club</span> {resolveTeamDisplay(player.teamId, state.schedule)?.name ?? player.teamId}</span>
                  <span><span className="pm-strip-lbl">{isMine ? "Asking" : "Est. Value"}</span> {fmtFee(isMine ? getAskingPrice(player, state) : val)}</span>
                  <span><span className="pm-strip-lbl">Status</span> {status}</span>
                  {isMine && <span><span className="pm-strip-lbl">Your Budget</span> {fmtFee(getTransferBudget(state, state.userTeamId).balance)}</span>}
                  {intel && <span><span className="pm-strip-lbl">Club Stance</span> {intel.clubStance}</span>}
                  {intel && <span><span className="pm-strip-lbl">Player Interest</span> {intel.playerInterest}</span>}
                  {intel && <span><span className="pm-strip-lbl">Difficulty</span> {intel.dealDifficulty}</span>}
                  {intel && <span><span className="pm-strip-lbl">Expected Role</span> {intel.expectedRole}</span>}
                  {intel && <span><span className="pm-strip-lbl">Expected Salary</span> {fmtFee(intel.expectedSalary)}</span>}
                </div>
                {isMine ? (
                  <div className="pm-transfer-actions">
                    <button className="btn-secondary tr-btn" disabled={status === "Recently Signed"} onClick={() => dispatch({ type: "SET_TRANSFER_STATUS", playerId: player.id, status: "Transfer Listed" })}>Transfer List</button>
                    <button className="btn-secondary tr-btn" disabled={status === "Recently Signed"} onClick={() => dispatch({ type: "SET_TRANSFER_STATUS", playerId: player.id, status: "Open to Offers" })}>Open to Offers</button>
                    <button className="btn-danger-sm" disabled={status === "Recently Signed"} onClick={() => dispatch({ type: "SET_TRANSFER_STATUS", playerId: player.id, status: "Not For Sale" })}>Not For Sale</button>
                  </div>
                ) : (
                  <div className="pm-transfer-actions">
                    <input className="slot-select tr-fee-input" type="number" placeholder={`${(val / 1000).toFixed(0)}k`} value={offerK} onChange={e => setOfferK(e.target.value)} disabled={!windowOpen} />
                    <button className="btn-primary-sm" disabled={!windowOpen || !(Number(offerK) > 0)} onClick={() => { dispatch({ type: "MAKE_TRANSFER_OFFER", playerId: player.id, fee: Number(offerK) * 1000 }); setOfferK(""); }}>Make Offer</button>
                    {!windowOpen && <span className="muted" style={{ fontSize: ".75rem" }}>Window closed during live events</span>}
                  </div>
                )}
              </div>
            );
          })()}

          {player && (() => {
            const onUserTeam = (player.teamId && player.teamId === state.userTeamId)
              || (isChallengerMode(state) && player.challengerTeamId === state.userTeamId);
            // Morale is most meaningful for the user's own squad; show it there.
            if (!onUserTeam) return null;
            const m = getMorale(state, player.id);
            const activePromises = (m.promises || []).filter(p => p.status === "active");
            const lastEvent = m.recentEvents?.[m.recentEvents.length - 1];
            const traits = derivePersonality(player);
            const talkCtx = buildConversationContext(state, player);
            const lastMeeting = (m.conversationHistory || []).at(-1);
            return (
              <div className="pm-section pm-morale-section">
                <div className="pm-section-title">Morale & Dynamics</div>
                <div className="pm-info-strip">
                  <span><span className="pm-strip-lbl">Mood</span> <b style={{ color: moraleColor(m.level) }}>{m.level} {moodForLevel(m.level)}</b></span>
                  <span><span className="pm-strip-lbl">Trust</span> {m.trust}</span>
                  <span><span className="pm-strip-lbl">Personality</span> {traits.join(", ")}</span>
                  <span><span className="pm-strip-lbl">Stance</span> {talkCtx.transferStance}</span>
                  <span><span className="pm-strip-lbl">Main Concern</span> {talkCtx.mainConcern}</span>
                  {lastMeeting && <span><span className="pm-strip-lbl">Last Talk</span> {lastMeeting.date} · {lastMeeting.topic}</span>}
                  {lastEvent && <span><span className="pm-strip-lbl">Last Event</span> {lastEvent.label}{lastEvent.delta ? ` (${lastEvent.delta > 0 ? "+" : ""}${lastEvent.delta})` : ""}</span>}
                </div>
                {m.concerns?.length > 0 && (
                  <div className="pm-morale-chips">
                    {m.concerns.map(c => <span key={c.key} className="trait-chip concern-chip">{c.label}</span>)}
                  </div>
                )}
                {activePromises.length > 0 && (
                  <div className="pm-morale-chips">
                    {activePromises.map(p => <span key={p.id} className="trait-chip promise-chip">{p.label} · {getPromiseRiskLabel(p, state, player)}</span>)}
                  </div>
                )}

                {(m.conversationHistory || []).length > 0 && (
                  <div className="pm-conversation-history">
                    <div className="pm-strip-lbl">Recent meetings</div>
                    {(m.conversationHistory || []).slice(-3).map((h, idx) => (
                      <div key={`${h.date}-${idx}`} className="pm-history-row">
                        <b>{h.date} · {h.topic}</b> — {h.response}. {h.promise ? `Promise: ${h.promise}.` : "No promise."}
                      </div>
                    ))}
                  </div>
                )}
                <div className="pm-transfer-actions">
                  <button className="btn-primary-sm" onClick={() => setShowTalk(true)}>Talk to {player.name}</button>
                </div>
              </div>
            );
          })()}

          <div className="pm-section">
            <div className="pm-section-title">Season {season.season}</div>
            <div className="pm-info-strip profile-season-meta">
              <span><span className="pm-strip-lbl">Team(s)</span> {[...(season.teams || [])].map(tid => resolveTeamDisplay(tid, state.schedule).tag).join(", ") || status.label}</span>
              <span><span className="pm-strip-lbl">Role(s)</span> {[...(season.roles || [])].join(", ") || player?.primary || "—"}</span>
              <span><span className="pm-strip-lbl">Matches</span> {season.matches || 0}</span>
              <span><span className="pm-strip-lbl">Maps</span> {season.maps || "Not tracked yet"}</span>
              <span><span className="pm-strip-lbl">K/D</span> {kdText(season.kills, season.deaths)}</span>
              <span><span className="pm-strip-lbl">HP K/D</span> Not tracked yet</span>
              <span><span className="pm-strip-lbl">S&D K/D</span> Not tracked yet</span>
              <span><span className="pm-strip-lbl">Overload K/D</span> Not tracked yet</span>
            </div>
          </div>


          {season.awards?.length > 0 && (
            <div className="pm-section">
              <div className="pm-section-title">Awards</div>
              <div className="profile-awards-list">
                {season.awards.map(award => (
                  <div key={award.id || award.awardName} className="profile-award-pill">
                    <strong>{award.awardName}</strong>
                    {award.teamName && <span>{award.teamName}</span>}
                    {award.context && <em>{award.context}</em>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pm-section">
            <div className="pm-section-title">Event Breakdown</div>
            {!season.events?.length ? <p className="muted">No tracked event history for this season yet.</p> : (
              <table className="kd-history-table profile-event-table">
                <thead><tr><th>Event</th><th>Team</th><th>Maps</th><th>K</th><th>D</th><th>K/D</th><th>Result</th></tr></thead>
                <tbody>{season.events.map((e, i) => {
                  const team = e.teamId ? resolveTeamDisplay(e.teamId, state.schedule) : null;
                  return <tr key={`${e.eventName}_${i}`}><td>{e.eventName}</td><td>{team?.tag ?? e.teamName ?? "—"}</td><td>{statText(e.maps, "—")}</td><td>{statText(e.kills, "—")}</td><td>{statText(e.deaths, "—")}</td><td>{e.kd != null ? e.kd.toFixed(2) : e.kills != null ? kdText(e.kills, e.deaths) : "—"}</td><td>{e.result ?? e.placement ?? "Not tracked yet"}</td></tr>;
                })}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {showTalk && player && <ConversationModal player={player} onClose={() => setShowTalk(false)} />}
    </div>
  );
}

function ProfileStat({ label, value }) {
  return <div className="profile-stat"><span>{label}</span><strong>{value}</strong></div>;
}
