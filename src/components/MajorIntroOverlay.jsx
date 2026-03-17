// src/components/MajorIntroOverlay.jsx
// Full-screen overlay shown once when a Major phase begins.
// Announces the event, shows the user's seed and first matchup,
// and offers a primary "Enter Major" CTA.
// Shown only on a fresh phase transition — not on page reload.

import { CDL_TEAMS } from "../data/teams.js";

function teamTag(id)   { return CDL_TEAMS.find(t => t.id === id)?.tag   ?? id; }
function teamColor(id) { return CDL_TEAMS.find(t => t.id === id)?.color ?? "#888"; }

export default function MajorIntroOverlay({ state, onEnter, onDismiss }) {
  const schedule   = state.schedule;
  const majorIdx   = schedule.currentStage;
  const major      = schedule.majors?.[majorIdx];
  const bracket    = major?.bracket;
  const userTeamId = state.userTeamId;

  if (!major) return null;

  // User's seed in this major
  const seeds    = bracket?.seeds ?? [];
  const seedIdx  = seeds.indexOf(userTeamId);
  const userSeed = seedIdx >= 0 ? seedIdx + 1 : null;

  // User's first matchup
  const userMatch = bracket?.rounds?.[0]?.matches?.find(
    m => m.a === userTeamId || m.b === userTeamId
  );
  const oppId    = userMatch ? (userMatch.a === userTeamId ? userMatch.b : userMatch.a) : null;
  const oppSeedN = userMatch ? (userMatch.a === userTeamId ? userMatch.seedB : userMatch.seedA) : null;

  // Team not in this major (e.g. didn't qualify — rare but handle gracefully)
  const userQualified = userSeed !== null;

  return (
    <div className="mio-overlay" onClick={onDismiss}>
      <div className="mio-card" onClick={e => e.stopPropagation()}>

        {/* Live badge */}
        <div className="mio-live-badge">
          <span className="mio-live-pip" />
          LIVE TOURNAMENT
        </div>

        {/* Event name */}
        <h1 className="mio-name">{major.name.toUpperCase()}</h1>
        <div className="mio-season">Season {state.season}</div>

        {/* User seed block */}
        {userQualified ? (
          <div className="mio-seed-block">
            <span className="mio-seed-label">YOUR SEED</span>
            <span className="mio-seed-num" style={{ color: teamColor(userTeamId) }}>
              #{userSeed}
            </span>
            <span className="mio-seed-tag" style={{ color: teamColor(userTeamId) }}>
              {teamTag(userTeamId)}
            </span>
          </div>
        ) : (
          <div className="mio-not-qualified">Your team did not qualify for this event.</div>
        )}

        {/* First matchup */}
        {userMatch && oppId && (
          <div className="mio-matchup-block">
            <div className="mio-matchup-label">QUARTERFINAL MATCHUP</div>
            <div className="mio-matchup-teams">
              <div className="mio-matchup-side">
                <span className="mio-match-seed">#{userSeed}</span>
                <span className="mio-match-tag" style={{ color: teamColor(userTeamId) }}>
                  {teamTag(userTeamId)}
                </span>
                <span className="mio-you-pill">YOU</span>
              </div>
              <span className="mio-vs">vs</span>
              <div className="mio-matchup-side mio-matchup-side-b">
                <span className="mio-match-seed">#{oppSeedN}</span>
                <span className="mio-match-tag" style={{ color: teamColor(oppId) }}>
                  {teamTag(oppId)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* CTA */}
        <button className="mio-enter-btn" onClick={onEnter}>
          Enter {major.name} →
        </button>

        <button className="mio-dismiss-btn" onClick={onDismiss}>
          Skip intro
        </button>

      </div>
    </div>
  );
}
