import { useGame } from "../store/gameStore.jsx";
import { getJobSecurityStatus } from "../engine/modernCdlCareer.js";

export default function CareerBoardReviewOverlay() {
  const { state, dispatch } = useGame();
  const r = state?.pendingCareerBoardReview;
  // Event placements remain first: the tournament overlay owns enteredMajorIdx.
  if (!r || state.enteredMajorIdx != null) return null;
  return <div className="career-review-backdrop" role="dialog" aria-modal="true"><div className="career-review-modal">
    <div className="career-kicker">Board Review</div><h2>{r.eventName}: {r.actualPlacement}{r.actualPlacement === 1 ? "st" : r.actualPlacement === 2 ? "nd" : r.actualPlacement === 3 ? "rd" : "th"}</h2>
    <div className={`career-grade grade-${r.performanceGrade}`}>{r.performanceGrade}</div>
    <p>Board target: top {r.expectedPlacement} · Status: {getJobSecurityStatus(r.confidenceAfter)}</p>
    <div className="career-review-deltas"><span>Job Security <b>{r.confidenceBefore} → {r.confidenceAfter}</b></span><span>Reputation <b>{r.reputationBefore} → {r.reputationAfter}</b></span></div>
    <p className="career-board-quote">“{r.explanation}”</p>
    <div className="career-reasons">{r.reasons.map((x,i) => <div key={i}>{x}</div>)}</div>
    {r.warningLevel !== "none" && <div className="career-alert">Board pressure level: <b>{r.warningLevel}</b>. Review the Career screen for the recovery target.</div>}
    <button className="btn-primary" onClick={() => dispatch({ type: "DISMISS_CAREER_BOARD_REVIEW" })}>Acknowledge Review</button>
  </div></div>;
}
