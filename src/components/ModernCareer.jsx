import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import { getJobSecurityStatus } from "../engine/modernCdlCareer.js";

const team = id => CDL_TEAMS.find(t => t.id === id);
const pct = n => ({ width: `${Math.max(0, Math.min(100, n || 0))}%` });

export default function ModernCareer() {
  const { state, dispatch } = useGame();
  const p = state?.managerCareer;
  if (!p) return <div className="career-page"><div className="career-card">Career data is only available in Modern CDL mode.</div></div>;
  const current = team(p.currentTeamId);
  const recent = p.eventReviews.slice(-5).reverse();
  const offers = p.jobOffers.filter(o => o.status === "pending");
  return <div className="career-page">
    <header className="career-hero">
      <div><span className="career-kicker">Modern CDL Manager Career</span><h1>{p.managerName}</h1><p>{p.employmentStatus === "unemployed" ? "Unemployed — the career world remains active" : current?.name}</p></div>
      <div className="career-hero-stats"><b>{p.reputation}<small>{p.reputationTier} reputation</small></b><b>{p.jobSecurity}<small>{getJobSecurityStatus(p.jobSecurity)} security</small></b><b>{p.seasonsManaged}<small>Seasons managed</small></b></div>
    </header>
    <div className="career-grid">
      <section className="career-card"><h2>Board Confidence</h2><div className="career-meter"><span style={pct(p.jobSecurity)} /></div><strong>{getJobSecurityStatus(p.jobSecurity)}</strong>
        <p>{p.warningLevel === "none" ? "No active board warning." : `Active pressure: ${p.warningLevel.replaceAll("_", " ")}`}</p>
        {p.activeUltimatum && <div className="career-alert"><b>Ultimatum</b>{p.activeUltimatum.title} — target top {p.activeUltimatum.targetValue} at the next event.</div>}
        {p.boardMessages.slice(-3).reverse().map(m => <div className="career-note" key={m.id}>{m.explanation || m.text || m.reason}</div>)}
      </section>
      <section className="career-card"><h2>Current Expectations</h2><p>{p.currentEventExpectation ? <><b>{p.currentEventExpectation.eventName}</b><br/>Minimum top {p.currentEventExpectation.minimumAcceptable} · Target top {p.currentEventExpectation.expectedPlacement} · Stretch top {p.currentEventExpectation.stretchPlacement}<br/><small>{p.currentEventExpectation.basis}</small></> : "No remaining event target."}</p>
        <div className="career-objectives">{p.currentObjectives.map(o => <div key={o.objectiveId}><span className={`career-badge ${o.mandatory ? "mandatory" : ""}`}>{o.mandatory ? "Mandatory" : o.weight}</span><b>{o.title}</b><em>{o.status}</em></div>)}</div>
      </section>
      <section className="career-card"><h2>Career Record</h2><div className="career-record"><span><b>{p.careerSeriesWins}–{p.careerSeriesLosses}</b>Series</span><span><b>{p.majorWins}</b>Majors</span><span><b>{p.champsWins}</b>Champs</span><span><b>{p.eventFinals}</b>Finals</span><span><b>{p.topFourFinishes}</b>Top fours</span><span><b>{p.teamsManaged.length}</b>Teams</span></div>
        <h3>Achievements</h3><div className="career-chips">{p.achievements.length ? p.achievements.map(a => <span key={a.id}>★ {a.title}</span>) : <small>No achievements unlocked yet.</small>}</div>
      </section>
      <section className="career-card"><h2>Recent Event Reviews</h2>{recent.length ? recent.map(r => <div className="career-review-row" key={r.eventId}><b className={`grade grade-${r.performanceGrade}`}>{r.performanceGrade}</b><span>{r.eventName}<small>{r.actualPlacement} vs top-{r.expectedPlacement} target</small></span><em>{r.confidenceChange >= 0 ? "+" : ""}{r.confidenceChange} security · {r.reputationChange >= 0 ? "+" : ""}{r.reputationChange} rep</em></div>) : <p>No completed event reviews.</p>}</section>
      <section className="career-card career-wide"><h2>Job Market</h2>{offers.length ? offers.map(o => <div className="career-offer" key={o.id}><div><b>{o.organisation}</b><span>OVR {o.teamStrength} · {o.currentStanding ? `${o.currentStanding}th` : "Unseeded"} · {o.contractLength} seasons</span><p>{o.reason}</p><small>{o.boardExpectation} Starting security: {o.startingJobSecurity}. Deadline: {o.responseDeadline}.</small></div><div><button className="btn-primary-sm" onClick={() => dispatch({ type: "ACCEPT_MANAGER_JOB_OFFER", offerId: o.id })}>Accept</button><button className="btn-secondary-sm" onClick={() => dispatch({ type: "REJECT_MANAGER_JOB_OFFER", offerId: o.id })}>Reject</button></div></div>) : <p>No active offers. Interest depends on reputation, overperformance and realistic vacancies.</p>}
      </section>
      <section className="career-card career-wide"><h2>Career History</h2>{p.careerHistory.map((h,i) => <div className="career-history" key={`${h.teamId}_${i}`}><b>{h.organisation}</b><span>Season {h.startSeason} — {h.endSeason || "Present"}</span><em>{h.reasonForLeaving || "Current appointment"}</em></div>)}</section>
    </div>
  </div>;
}
