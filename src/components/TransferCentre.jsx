// src/components/TransferCentre.jsx
// In-contract transfer / buyout negotiation hub.
// Sections: Incoming Offers, Outgoing Offers, Transfer-Listed (league),
// My Squad transfer status. FM-style compact tables.

import { useEffect, useState } from "react";
import { useGame } from "../store/gameStore.jsx";
import { CDL_TEAMS } from "../data/teams.js";
import { isInactivePlayer } from "../utils/playerIdentity.js";
import { usePlayerProfile } from "../store/playerProfileContext.jsx";
import {
  isTransferWindowOpen, transferWindowLabel, getWindowKey, getTransferBudget,
  getPlayerValuation, getAskingPrice, getTransferStatus, getIncomingOffers,
  getOutgoingOffers, getLeagueTransferListed, fmtFee, teamTag,
  teamName, getAcceptedOutgoingTermsOffers, getTransferTermsPreview, evaluatePlayerTerms, getTransferIntel, estimateTransferAcceptanceChance, getInterestedTeamsForPlayer, getProtectedPlayerInfo,
} from "../engine/transferEngine.js";
import { EmptyState, PageHeader, Pill, SectionCard, StatCard } from "./ui.jsx";
import { isChallengerMode, getChallengerRosterPlayers, getUserChallengerTeam } from "../utils/userTeam.js";
import { isChallengerMarketOpen } from "../engine/challengerMarket.js";
import { getSigningCost } from "../engine/rosterAI.js";

const SETTABLE_STATUSES = ["Open to Offers", "Transfer Listed", "Not For Sale", "Unsettled"];

const k = (n) => `$${Math.round((n || 0) / 1000)}k`;

// Estimated buyout interest for a developing Challenger player (display only —
// the real fee is computed in the reducer when an offer is generated).
function devValue(player) {
  const base = getSigningCost(player);
  const pot = player.potential ?? player.overall ?? 70;
  const ageMod = (player.age ?? 24) <= 21 ? 1.35 : (player.age ?? 24) <= 24 ? 1.15 : 1.0;
  const potMod = 1 + Math.max(0, pot - (player.overall ?? 70)) * 0.03;
  return Math.round((base * 1.8 * ageMod * potMod) / 1000) * 1000;
}

function buyoutRisk(player) {
  const ovr = player.overall ?? 0;
  const pot = player.potential ?? ovr;
  if (pot >= 86 || ovr >= 76) return { label: "High", tone: "danger" };
  if (ovr >= 70 || pot >= 82) return { label: "Medium", tone: "warning" };
  return { label: "Low", tone: "neutral" };
}

// ── Challenger Transfer Centre ────────────────────────────────────────────────
// Reuses the existing challenger buyout flow (state.challengerOffers /
// RESPOND_CHALLENGER_OFFER) and the Challenger roster. No engine changes.
function ChallengerTransferCentre() {
  const { state, dispatch } = useGame();
  const { openPlayerProfile } = usePlayerProfile();
  const [tab, setTab] = useState("interest");
  if (!state) return null;

  const team = getUserChallengerTeam(state);
  const roster = getChallengerRosterPlayers(state).sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  const offers = state.challengerOffers || [];
  const pending = offers.filter(o => o.status === "pending");
  const resolved = offers.filter(o => o.status !== "pending").slice(-6).reverse();
  const windowOpen = isChallengerMarketOpen(state);
  const offerByPlayer = new Set(pending.map(o => o.playerId));

  const TABS = [
    ["interest", `CDL Interest (${pending.length})`],
    ["squad", "My Challenger Squad"],
  ];

  return (
    <div className="transfer-centre">
      <PageHeader
        eyebrow="Recruitment — Road to CDL"
        title="Transfer Centre"
        subtitle="CDL teams buy out your best Challenger talent. Sell for transfer income, or hold on and keep developing. Develop players, but bigger teams will come calling."
        accent={team?.color}
        meta={(
          <div className="ui-stat-grid compact">
            <StatCard label="Transfer Funds" value={k(state.challengerFunds)} tone={state.challengerFunds ? "success" : "neutral"} />
            <StatCard label="Open Offers" value={pending.length} tone={pending.length ? "warning" : "neutral"} />
            <StatCard label="Window" value={windowOpen ? "Open" : "Closed"} tone={windowOpen ? "success" : "warning"} hint={windowOpen ? "CDL teams can make offers" : "Closed during live events"} />
          </div>
        )}
      />

      <div className="cm-tabs ui-tabs">
        {TABS.map(([key, label]) => <button key={key} className={`filter-btn ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>)}
      </div>

      {tab === "interest" && (
        <SectionCard title="CDL Interest" subtitle="Buyout offers from CDL teams for your players. Accept for transfer income, or reject to keep developing them.">
          {pending.length === 0 ? (
            <EmptyState title="No live offers" detail="Transfer activity will appear here when CDL teams make offers for your players. Strong qualifier and Major runs attract more interest." />
          ) : (
            <div className="ui-table-wrap"><table className="roster-table data-table">
              <thead><tr><th>CDL Team</th><th>Player</th><th>Buyout Fee</th><th>Actions</th></tr></thead>
              <tbody>
                {pending.map(o => {
                  const buyer = CDL_TEAMS.find(t => t.id === o.fromCdlTeamId);
                  const p = roster.find(x => x.id === o.playerId);
                  return (
                    <tr key={o.id}>
                      <td><span style={{ color: buyer?.color, fontWeight: 600 }}>{buyer?.name ?? o.fromCdlTeamId}</span></td>
                      <td className="player-name">{p ? <button className="link-button player-link" onClick={() => openPlayerProfile(p)}>{o.playerName}</button> : o.playerName}{p && <span className="muted"> {p.primary} · {p.overall}</span>}</td>
                      <td style={{ color: "#34d399", fontWeight: 700 }}>{k(o.fee)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn-primary-sm" onClick={() => dispatch({ type: "RESPOND_CHALLENGER_OFFER", offerId: o.id, decision: "accept" })}>Accept</button>
                        <button className="btn-secondary tr-btn" onClick={() => dispatch({ type: "RESPOND_CHALLENGER_OFFER", offerId: o.id, decision: "reject" })}>Reject</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
          {resolved.length > 0 && (
            <details style={{ marginTop: 10 }}><summary className="muted">Recent decisions</summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: ".82rem" }}>
                {resolved.map(o => <li key={o.id}>{CDL_TEAMS.find(t => t.id === o.fromCdlTeamId)?.tag ?? o.fromCdlTeamId} — {o.playerName} — <span className="muted">{o.status === "accepted" ? `sold ${k(o.fee)}` : "rejected"}</span></li>)}
              </ul>
            </details>
          )}
        </SectionCard>
      )}

      {tab === "squad" && (
        <SectionCard title="My Challenger Squad" subtitle="Your developing roster. Buyout risk rises as players improve — a sale brings transfer income but opens a roster hole to fill.">
          {roster.length === 0 ? (
            <EmptyState title="No players signed" detail="Sign players from the Market screen to build your Challenger roster." />
          ) : (
            <div className="ui-table-wrap"><table className="roster-table data-table">
              <thead><tr><th>Player</th><th>Role</th><th>Age</th><th>OVR</th><th>POT</th><th>Development Value</th><th>Buyout Risk</th><th>CDL Interest</th></tr></thead>
              <tbody>
                {roster.map(p => {
                  const risk = buyoutRisk(p);
                  return (
                    <tr key={p.id}>
                      <td className="player-name"><button className="link-button player-link" onClick={() => openPlayerProfile(p)}>{p.name}</button></td>
                      <td><span className="role-pill ui-pill ui-pill-neutral">{p.primary}</span></td>
                      <td>{p.age}</td>
                      <td style={{ fontWeight: 700 }}>{p.overall}</td>
                      <td>{p.potential}</td>
                      <td style={{ color: "#60a5fa", fontWeight: 600 }}>{k(devValue(p))}</td>
                      <td><Pill tone={risk.tone}>{risk.label}</Pill></td>
                      <td>{offerByPlayer.has(p.id) ? <Pill tone="warning">Offer in</Pill> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </SectionCard>
      )}
    </div>
  );
}

function feeColor(fee, val) {
  if (val <= 0) return "var(--text)";
  if (fee >= val) return "#34d399";
  if (fee >= val * 0.8) return "#fbbf24";
  return "#f87171";
}

function offerStatusTone(status) {
  return { Pending: "neutral", Countered: "warning", Accepted: "warning", Completed: "success", Rejected: "danger", Withdrawn: "danger", Expired: "danger", Cancelled: "danger" }[status] || "neutral";
}

function offerStatusLabel(n) {
  if (n.status === "Accepted" && (!n.nextAction || n.nextAction === "player_terms")) return "Fee Accepted";
  if (n.status === "Countered") return "Counter Received";
  return n.status;
}

function nextStepLabel(n) {
  if (n.status === "Accepted" && (!n.nextAction || n.nextAction === "player_terms")) return "Agree player terms";
  if (n.status === "Countered" && n.counterBy === "seller") return "Respond to counter";
  if (n.status === "Completed") return "Done";
  if (n.status === "Pending") return "Await selling team";
  if (["Rejected", "Withdrawn", "Expired", "Cancelled"].includes(n.status)) return "Closed";
  return "Review offer";
}

function ConfirmSigningModal() {
  const { state, dispatch } = useGame();
  const [role, setRole] = useState("Starter");
  const [salaryK, setSalaryK] = useState("");
  const [years, setYears] = useState(2);
  if (!state?.transferMarket?.activeTermsOfferId) return null;
  const neg = getAcceptedOutgoingTermsOffers(state).find(n => n.id === state.transferMarket.activeTermsOfferId);
  const basePreview = getTransferTermsPreview(state, neg, { promisedRole: role, contractYears: years });
  const salary = Number(salaryK) > 0 ? Number(salaryK) * 1000 : basePreview?.salary;
  const preview = getTransferTermsPreview(state, neg, { promisedRole: role, salary, contractYears: years });
  if (!neg || !preview) return null;
  const capTone = preview.capAfter < 0 ? "tr-impact-bad" : "tr-impact-good";
  const termsResp = evaluatePlayerTerms(preview.player, preview.buyerTeamId, preview.sellerTeamId, state, { promisedRole: role, salary: preview.salary, contractYears: years });

  return (
    <div className="transfer-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-signing-title">
      <div className="transfer-modal transfer-terms-modal">
        <div className="transfer-modal-kicker">Player terms required</div>
        <h2 id="confirm-signing-title">Confirm Signing</h2>
        <p>
          <strong>{preview.player.name}</strong> will join your roster from {teamName(preview.sellerTeamId)} for {fmtFee(preview.transferFee)} if he accepts the role and salary.
        </p>
        <div className="transfer-terms-controls">
          <label><span>Promised Role</span><select className="slot-select" value={role} onChange={e => setRole(e.target.value)}><option>Starter</option><option>Substitute</option><option>Prospect</option></select></label>
          <label><span>Salary Offer (k)</span><input className="slot-select tr-fee-input" type="number" placeholder={`${Math.round((basePreview?.salary || 0) / 1000)}`} value={salaryK} onChange={e => setSalaryK(e.target.value)} /></label>
          <label><span>Contract</span><select className="slot-select" value={years} onChange={e => setYears(Number(e.target.value))}><option value={1}>1 year</option><option value={2}>2 years</option><option value={3}>3 years</option></select></label>
        </div>
        <div className="transfer-terms-grid">
          <span><strong>Player</strong>{preview.player.name}</span>
          <span><strong>From</strong>{teamName(preview.sellerTeamId)}</span>
          <span><strong>To</strong>{teamName(preview.buyerTeamId)}</span>
          <span><strong>Transfer Fee</strong>{fmtFee(preview.transferFee)}</span>
          <span><strong>Salary</strong>{fmtFee(preview.salary)}</span>
          <span><strong>Contract</strong>{preview.contractYears} year{preview.contractYears === 1 ? "" : "s"}</span>
          <span className={capTone}><strong>Cap Space After Deal</strong>{fmtFee(preview.capAfter)}</span>
          <span><strong>Roster Impact</strong>{preview.rosterNote}</span>
          <span><strong>Player Interest</strong>{termsResp.interestLabel}</span>
          <span><strong>Terms Readout</strong>{termsResp.reason}</span>
        </div>
        {preview.capAfter < 0 && (
          <div className="ui-warning-banner tr-modal-warning">
            Cannot complete transfer: this signing would exceed your salary cap by {fmtFee(Math.abs(preview.capAfter))}.
          </div>
        )}
        {!termsResp.accepted && (
          <div className="ui-warning-banner tr-modal-warning">
            Player terms risk: {termsResp.reason}
          </div>
        )}
        <div className="transfer-modal-actions">
          <button className="btn-primary" onClick={() => dispatch({ type: "RESPOND_TRANSFER_OFFER", negotiationId: neg.id, action: "accept", promisedRole: role, salary: preview.salary, contractYears: years })}>Confirm Transfer</button>
          <button className="btn-secondary" onClick={() => dispatch({ type: "RESPOND_TRANSFER_OFFER", negotiationId: neg.id, action: "cancel" })}>Cancel Deal</button>
          <button className="btn-secondary" onClick={() => dispatch({ type: "CLOSE_TRANSFER_TERMS" })}>Later</button>
        </div>
      </div>
    </div>
  );
}

export default function TransferCentre() {
  const { state, dispatch } = useGame();
  const { openPlayerProfile } = usePlayerProfile();
  const [tab, setTab] = useState("incoming");
  const [counterFees, setCounterFees] = useState({});
  const [askInputs, setAskInputs] = useState({});

  // Auto-scan the market once per open transfer window (guarded in the reducer).
  const windowKey = state ? getWindowKey(state) : null;
  useEffect(() => {
    if (state && isTransferWindowOpen(state) && state.transferMarket?.lastWaveKey !== windowKey) {
      dispatch({ type: "RUN_TRANSFER_WAVE" });
    }
  }, [windowKey, state?.transferMarket?.lastWaveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;
  // Challenger manager mode uses a dedicated buyout-focused view.
  if (isChallengerMode(state)) return <ChallengerTransferCentre />;
  const { players, userTeamId } = state;
  const windowOpen = isTransferWindowOpen(state);

  const incoming = getIncomingOffers(state).filter(n => ["Pending", "Countered", "Accepted"].includes(n.status));
  const incomingDone = getIncomingOffers(state).filter(n => ["Rejected", "Withdrawn", "Expired"].includes(n.status)).slice(-5);
  const outgoing = getOutgoingOffers(state);
  const actionRequired = getAcceptedOutgoingTermsOffers(state);
  const listed = getLeagueTransferListed(state).filter(p => p.teamId !== userTeamId);
  const myPlayers = players.filter(p => p.teamId === userTeamId && !isInactivePlayer(p));
  const budget = getTransferBudget(state, userTeamId);

  const pById = id => players.find(p => p.id === id);

  function respond(negotiationId, act, fee) { dispatch({ type: "RESPOND_TRANSFER_OFFER", negotiationId, action: act, fee }); }
  function setStatus(playerId, status) { dispatch({ type: "SET_TRANSFER_STATUS", playerId, status }); }
  function setAsk(playerId) {
    const v = Number(askInputs[playerId]);
    if (v > 0) dispatch({ type: "SET_TRANSFER_STATUS", playerId, askingPrice: v * 1000 });
  }
  function makeOffer(playerId) {
    const v = Number(counterFees["mk_" + playerId]);
    if (v > 0) dispatch({ type: "MAKE_TRANSFER_OFFER", playerId, fee: v * 1000 });
  }
  function openTerms(negotiationId) {
    setTab("outgoing");
    dispatch({ type: "OPEN_TRANSFER_TERMS", negotiationId });
  }

  const TABS = [
    ["incoming", `Incoming (${incoming.length})`],
    ["outgoing", `Outgoing (${outgoing.filter(o => ["Pending", "Countered", "Accepted"].includes(o.status)).length})`],
    ["listed", `Transfer Listed (${listed.length})`],
    ["squad", "My Squad"],
  ];

  return (
    <div className="transfer-centre">
      <PageHeader
        eyebrow="Recruitment"
        title="Transfer Centre"
        subtitle="Buyouts and in-contract moves. Receive and make offers, set asking prices and manage your squad's availability."
        meta={(
          <div className="ui-stat-grid compact">
            <StatCard label="Transfer Budget" value={fmtFee(budget.balance)} tone="success" />
            <StatCard label="Spent" value={fmtFee(budget.spend)} />
            <StatCard label="Income" value={fmtFee(budget.income)} />
            <StatCard label="Window" value={windowOpen ? "Open" : "Closed"} tone={windowOpen ? "success" : "warning"} hint={transferWindowLabel(state)} />
          </div>
        )}
      />

      {!windowOpen && (
        <div className="ui-warning-banner"><strong>Transfer window closed.</strong> In-contract moves resume between stages and in the offseason — not during live events.</div>
      )}

      {actionRequired.length > 0 && (
        <div className="tr-action-banner">
          <div>
            <strong>You have {actionRequired.length} accepted transfer{actionRequired.length === 1 ? "" : "s"} waiting for player terms.</strong>
            <span>Open terms to confirm the signing, or cancel the deal before it gets stuck.</span>
          </div>
          <button className="btn-primary-sm" onClick={() => openTerms(actionRequired[0].id)}>Review Now</button>
        </div>
      )}

      <div className="cm-tabs ui-tabs">
        {TABS.map(([k, label]) => <button key={k} className={`filter-btn ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {/* ── INCOMING OFFERS ─────────────────────────────────────────────────── */}
      {tab === "incoming" && (
        <SectionCard title="Incoming Offers" subtitle="Buyout offers from other clubs for your players. Accept, reject, counter or pull the player off the market.">
          {incoming.length === 0 ? (
            <EmptyState title="No live offers" detail="Rival clubs will table offers between stages and in the offseason. Transfer-listing a player attracts more interest." />
          ) : (
            <div className="ui-table-wrap"><table className="roster-table data-table">
              <thead><tr><th>Buying Team</th><th>Player</th><th>Fee</th><th>Your Value</th><th>Morale Risk</th><th>Importance</th><th>Reason</th><th>Status</th><th>Counter</th><th>Actions</th></tr></thead>
              <tbody>
                {incoming.map(n => {
                  const p = pById(n.playerId); if (!p) return null;
                  const val = getPlayerValuation(p, state);
                  const live = n.counterFee ?? n.fee;
                  const accepted = n.status === "Accepted";
                  const intel = getTransferIntel(p, state, n.fromTeamId);
                  const prot = getProtectedPlayerInfo(p, state, n.fromTeamId);
                  return (
                    <tr key={n.id}>
                      <td><span style={{ color: CDL_TEAMS.find(t => t.id === n.fromTeamId)?.color }}>{teamTag(n.fromTeamId)}</span></td>
                      <td className="player-name"><button className="link-button player-link" onClick={() => openPlayerProfile(p)}>{p.name}</button> <span className="muted">{p.primary} · {p.overall}</span></td>
                      <td style={{ color: feeColor(live, val), fontWeight: 700 }}>{fmtFee(live)}{n.counterBy === "buyer" ? " ↩" : ""}</td>
                      <td>{fmtFee(val)}</td>
                      <td>{intel?.playerWillingness < 0.45 ? "High" : intel?.playerWillingness < 0.62 ? "Medium" : "Low"}</td>
                      <td>{prot.protected ? (prot.level >= 7 ? "Star / Protected" : "Important") : (p.isSub ? "Depth" : "Starter")}</td>
                      <td className="muted" style={{ fontSize: ".78rem" }}>{n.reason}</td>
                      <td><Pill tone={offerStatusTone(n.status)}>{n.status}{n.counterBy ? ` (${n.counterBy})` : ""}</Pill></td>
                      <td>
                        <input className="slot-select tr-fee-input" type="number" placeholder="k" value={counterFees[n.id] ?? ""} onChange={e => setCounterFees({ ...counterFees, [n.id]: e.target.value })} />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {accepted ? (
                          <button className="btn-primary-sm" onClick={() => respond(n.id, "accept")}>Confirm Sale</button>
                        ) : (<>
                          <button className="btn-primary-sm" onClick={() => respond(n.id, "accept")} title={`Sell for ${fmtFee(live)}`}>Accept</button>
                          <button className="btn-secondary tr-btn" onClick={() => { const v = Number(counterFees[n.id]); if (v > 0) respond(n.id, "counter", v * 1000); }} disabled={!(Number(counterFees[n.id]) > 0)}>Counter</button>
                          <button className="btn-secondary tr-btn" onClick={() => respond(n.id, "ask_more")}>Ask More</button>
                          <button className="btn-secondary tr-btn" onClick={() => respond(n.id, "delay")}>Delay</button>
                          <button className="btn-secondary tr-btn" onClick={() => respond(n.id, "promise_review")}>Promise Review</button>
                          <button className="btn-secondary tr-btn" onClick={() => respond(n.id, "reject")}>Reject</button>
                          <button className="btn-danger-sm" onClick={() => respond(n.id, "nfs")} title="Mark Not For Sale">NFS</button>
                        </>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
          {incomingDone.length > 0 && (
            <details style={{ marginTop: 10 }}><summary className="muted">Recent closed offers</summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: ".82rem" }}>
                {incomingDone.slice().reverse().map(n => { const p = pById(n.playerId); return <li key={n.id}>{teamTag(n.fromTeamId)} — {p?.name ?? n.playerId} — <span className="muted">{n.status}</span></li>; })}
              </ul>
            </details>
          )}
        </SectionCard>
      )}

      {/* ── OUTGOING OFFERS ─────────────────────────────────────────────────── */}
      {tab === "outgoing" && (
        <SectionCard title="Outgoing Offers" subtitle="Approaches you've made for other clubs' contracted players.">
          {actionRequired.length > 0 && (
            <div className="tr-action-required">
              <div className="tr-action-required-head">
                <h4>Action Required</h4>
                <span>{actionRequired.length} accepted fee{actionRequired.length === 1 ? "" : "s"} need player terms</span>
              </div>
              <div className="ui-table-wrap"><table className="roster-table data-table">
                <thead><tr><th>Player</th><th>Selling Team</th><th>Accepted Fee</th><th>Next Step</th><th>Actions</th></tr></thead>
                <tbody>
                  {actionRequired.map(n => {
                    const p = pById(n.playerId); if (!p) return null;
                    const fee = n.counterFee ?? n.agreedFee ?? n.fee;
                    return (
                      <tr key={`ar_${n.id}`}>
                        <td className="player-name"><button className="link-button player-link" onClick={() => openPlayerProfile(p)}>{p.name}</button> <span className="muted">{p.primary} · {p.overall}</span></td>
                        <td>{teamTag(n.toTeamId)} accepted {fmtFee(fee)}</td>
                        <td>{fmtFee(fee)}</td>
                        <td><strong>Agree Player Terms</strong></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn-primary-sm" onClick={() => openTerms(n.id)}>Open Terms</button>
                          <button className="btn-secondary tr-btn" onClick={() => respond(n.id, "cancel")}>Cancel Deal</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          )}
          {outgoing.length === 0 ? (
            <EmptyState title="No outgoing offers" detail="Use the Transfer-Listed tab or a player's profile to make an offer for a contracted player." />
          ) : (
            <div className="ui-table-wrap"><table className="roster-table data-table">
              <thead><tr><th>Player</th><th>Selling Team</th><th>Fee</th><th>Status</th><th>Next Step</th><th>Re-counter</th><th>Actions</th></tr></thead>
              <tbody>
                {outgoing.slice().reverse().map(n => {
                  const p = pById(n.playerId); if (!p) return null;
                  const accepted = n.status === "Accepted" && (!n.nextAction || n.nextAction === "player_terms");
                  const countered = n.status === "Countered" && n.counterBy === "seller";
                  const liveFee = n.counterFee ?? n.agreedFee ?? n.fee;
                  return (
                    <tr key={n.id}>
                      <td className="player-name"><button className="link-button player-link" onClick={() => openPlayerProfile(p)}>{p.name}</button> <span className="muted">{p.primary} · {p.overall}</span></td>
                      <td>{teamTag(n.toTeamId)}</td>
                      <td>{fmtFee(liveFee)}</td>
                      <td><Pill tone={offerStatusTone(n.status)}>{offerStatusLabel(n)}</Pill>{accepted && <span className="tr-substatus">Terms Required</span>}{(n.responseReason || n.counterReason || n.playerRejectionReason) && <div className="muted" style={{ fontSize: ".72rem", maxWidth: 260 }}>{n.playerRejectionReason || n.counterReason || n.responseReason}</div>}</td>
                      <td>{nextStepLabel(n)}</td>
                      <td>{(countered) && <input className="slot-select tr-fee-input" type="number" placeholder="k" value={counterFees[n.id] ?? ""} onChange={e => setCounterFees({ ...counterFees, [n.id]: e.target.value })} />}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {accepted && <button className="btn-primary-sm" onClick={() => openTerms(n.id)}>Open Terms</button>}
                        {countered && <>
                          <button className="btn-primary-sm" onClick={() => respond(n.id, "accept")} title={`Pay ${fmtFee(n.counterFee)}`}>Accept Counter</button>
                          <button className="btn-secondary tr-btn" onClick={() => { const v = Number(counterFees[n.id]); if (v > 0) respond(n.id, "counter", v * 1000); }} disabled={!(Number(counterFees[n.id]) > 0)}>Re-counter</button>
                        </>}
                        {accepted && <button className="btn-secondary tr-btn" onClick={() => respond(n.id, "cancel")}>Cancel Deal</button>}
                        {["Pending", "Countered"].includes(n.status) && <button className="btn-secondary tr-btn" onClick={() => respond(n.id, "withdraw")}>Withdraw</button>}
                        {n.status === "Completed" && <button className="btn-secondary tr-btn" onClick={() => openPlayerProfile(p)}>View Player</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </SectionCard>
      )}

      <ConfirmSigningModal />

      {/* ── TRANSFER LISTED (league) ────────────────────────────────────────── */}
      {tab === "listed" && (
        <SectionCard title="Available Around the League" subtitle="Players other clubs have transfer-listed. Make a buyout offer.">
          {listed.length === 0 ? (
            <EmptyState title="No listed players" detail="No rival clubs have transfer-listed players right now." />
          ) : (
            <div className="ui-table-wrap"><table className="roster-table data-table">
              <thead><tr><th>Player</th><th>Team</th><th>Role</th><th>Age</th><th>OVR</th><th>POT</th><th>Club Stance</th><th>Player Interest</th><th>Accept %</th><th>Interested Teams</th><th>Protected</th><th>Asking</th><th>Offer (k)</th><th>Action</th></tr></thead>
              <tbody>
                {listed.map(p => {
                  const ask = getAskingPrice(p, state);
                  const intel = getTransferIntel(p, state, userTeamId);
                  const chance = estimateTransferAcceptanceChance(p, state, userTeamId);
                  const interested = getInterestedTeamsForPlayer(p, state).map(x => teamTag(x.id)).join(", ") || "—";
                  return (
                    <tr key={p.id}>
                      <td className="player-name"><button className="link-button player-link" onClick={() => openPlayerProfile(p)}>{p.name}</button></td>
                      <td>{teamTag(p.teamId)}</td>
                      <td><span className="role-pill ui-pill ui-pill-neutral">{p.primary}</span></td>
                      <td>{p.age}</td><td style={{ fontWeight: 700 }}>{p.overall}</td><td>{p.potential}</td>
                      <td>{intel?.clubStance ?? "—"}</td><td>{intel?.playerInterest ?? "—"}</td><td>{chance}% · {intel?.dealDifficulty ?? "—"}</td><td>{interested}</td><td>{intel?.protectedInfo?.protected ? "Yes" : "No"}</td><td>{fmtFee(ask)}</td>
                      <td><input className="slot-select tr-fee-input" type="number" placeholder="k" value={counterFees["mk_" + p.id] ?? ""} onChange={e => setCounterFees({ ...counterFees, ["mk_" + p.id]: e.target.value })} /></td>
                      <td><button className="btn-primary-sm" disabled={!windowOpen || !(Number(counterFees["mk_" + p.id]) > 0)} onClick={() => makeOffer(p.id)}>Make Offer</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </SectionCard>
      )}

      {/* ── MY SQUAD TRANSFER STATUS ────────────────────────────────────────── */}
      {tab === "squad" && (
        <SectionCard title="My Squad — Transfer Status" subtitle="Set asking prices and availability. Not-for-sale players require a huge bid; transfer-listed players attract more offers.">
          <div className="ui-table-wrap"><table className="roster-table data-table">
            <thead><tr><th>Player</th><th>Role</th><th>Age</th><th>OVR</th><th>Yrs</th><th>Salary</th><th>Valuation</th><th>Asking (k)</th><th>Status</th></tr></thead>
            <tbody>
              {myPlayers.map(p => {
                const val = getPlayerValuation(p, state);
                const status = getTransferStatus(p, state);
                return (
                  <tr key={p.id}>
                    <td className="player-name"><button className="link-button player-link" onClick={() => openPlayerProfile(p)}>{p.name}</button>{p.isSub && <span className="sub-label">SUB</span>}</td>
                    <td><span className="role-pill ui-pill ui-pill-neutral">{p.primary}</span></td>
                    <td>{p.age}</td><td style={{ fontWeight: 700 }}>{p.overall}</td>
                    <td style={{ color: (p.contractYears ?? 2) <= 1 ? "#ff6450" : "var(--text-dim)" }}>{p.contractYears ?? "—"}</td>
                    <td>{fmtFee(p.salary)}</td>
                    <td style={{ color: "#60a5fa", fontWeight: 600 }}>{fmtFee(val)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <input className="slot-select tr-fee-input" type="number" placeholder={(getAskingPrice(p, state) / 1000).toFixed(0)} value={askInputs[p.id] ?? ""} onChange={e => setAskInputs({ ...askInputs, [p.id]: e.target.value })} />
                        <button className="btn-secondary tr-btn" onClick={() => setAsk(p.id)}>Set</button>
                      </div>
                    </td>
                    <td>
                      <select className="slot-select" value={SETTABLE_STATUSES.includes(status) ? status : "Open to Offers"} onChange={e => setStatus(p.id, e.target.value)} disabled={status === "Recently Signed"}>
                        {SETTABLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {status === "Recently Signed" && <span className="muted" style={{ fontSize: ".7rem" }}> protected</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </SectionCard>
      )}
    </div>
  );
}
