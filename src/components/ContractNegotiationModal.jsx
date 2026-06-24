import { useMemo, useState } from "react";
import { buildContractDemand, evaluateContractOffer, CONTRACT_ROLES, fmtSalary } from "../engine/contractNegotiation.js";
import { getSigningCost } from "../engine/rosterAI.js";

export default function ContractNegotiationModal({ player, state, mode = "resign", slot = "starter", onClose, onSubmit }) {
  const demand = useMemo(() => buildContractDemand(player, state, { type: mode === "sign" ? "signing" : "resign", teamId: state.userTeamId, asSub: slot === "sub" }), [player, state, mode, slot]);
  const [years, setYears] = useState(demand.years);
  const [salary, setSalary] = useState(demand.salary);
  const [rolePromise, setRolePromise] = useState(demand.wantedRole);
  const [starterStatus, setStarterStatus] = useState(slot);
  const [transferReviewPromise, setTransferReviewPromise] = useState(false);
  const [developmentPromise, setDevelopmentPromise] = useState(demand.wantedRole === "Prospect");
  const preview = evaluateContractOffer(player, state, { years, salary, rolePromise, starterStatus, transferReviewPromise, developmentPromise }, { type: mode === "sign" ? "signing" : "resign", teamId: state.userTeamId, asSub: starterStatus === "sub" });
  const cur = player.salary ?? getSigningCost(player);
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal-card contract-negotiation-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-header"><div><h2>Contract Negotiation — {player.name}</h2><p>{demand.message}</p></div><button className="btn-ghost" onClick={onClose}>✕</button></div>
      <div className="ui-stat-grid compact">
        <div className="stat-card"><span>Current Salary</span><strong>{fmtSalary(cur)}</strong></div>
        <div className="stat-card"><span>Player Demand</span><strong>{fmtSalary(demand.salary)}</strong><small>Bonus ask {fmtSalary(demand.signingBonus)}</small></div>
        <div className="stat-card"><span>Wanted Role</span><strong>{demand.wantedRole}</strong><small>{demand.years} yrs wanted</small></div>
        <div className="stat-card"><span>Morale Stance</span><strong>{demand.moraleStance}</strong></div>
        <div className="stat-card"><span>Other Interest</span><strong>{demand.interest.level}</strong><small>{demand.interest.label}</small></div>
        <div className="stat-card"><span>Difficulty</span><strong>{demand.difficulty}</strong></div>
      </div>
      <div className="ui-warning-banner"><strong>Agent message:</strong> {preview.message} Predicted acceptance: <strong>{preview.chance}%</strong></div>
      <div className="filters">
        <label>Years <input type="number" min="1" max="4" value={years} onChange={e => setYears(Number(e.target.value))} /></label>
        <label>Salary <input type="number" step="5000" min="15000" value={salary} onChange={e => setSalary(Number(e.target.value))} /></label>
        <label>Role promise <select value={rolePromise} onChange={e => setRolePromise(e.target.value)}>{CONTRACT_ROLES.map(r => <option key={r}>{r}</option>)}</select></label>
        <label>Status <select value={starterStatus} onChange={e => setStarterStatus(e.target.value)}><option value="starter">Starter</option><option value="sub">Sub</option></select></label>
        <label><input type="checkbox" checked={transferReviewPromise} onChange={e => setTransferReviewPromise(e.target.checked)} /> Future transfer review</label>
        <label><input type="checkbox" checked={developmentPromise} onChange={e => setDevelopmentPromise(e.target.checked)} /> Development promise</label>
      </div>
      <div className="modal-actions"><button className="btn-secondary" onClick={onClose}>Walk away</button><button className="btn-primary" onClick={() => onSubmit({ years, salary, rolePromise, starterStatus, transferReviewPromise, developmentPromise })}>Submit Offer</button></div>
    </div>
  </div>;
}
