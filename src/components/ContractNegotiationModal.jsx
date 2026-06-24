import { useMemo, useState } from "react";
import { buildContractDemand, evaluateContractOffer, CONTRACT_ROLES, fmtSalary } from "../engine/contractNegotiation.js";
import { getSigningCost } from "../engine/rosterAI.js";

export default function ContractNegotiationModal({ player, state, mode = "resign", slot = "starter", onClose, onSubmit }) {
  const demand = useMemo(() => buildContractDemand(player, state, { type: mode === "sign" ? "signing" : "resign", teamId: state.userTeamId, asSub: slot === "sub" }), [player, state, mode, slot]);
  const [years, setYears] = useState(demand.years);
  const [salary, setSalary] = useState(player.salary ?? demand.salary);
  const [signingBonus, setSigningBonus] = useState(0);
  const [yearlyRise, setYearlyRise] = useState(0);
  const [rolePromise, setRolePromise] = useState(demand.wantedRole);
  const [starterStatus, setStarterStatus] = useState(slot);
  const [transferReviewPromise, setTransferReviewPromise] = useState(false);
  const [developmentPromise, setDevelopmentPromise] = useState(demand.wantedRole === "Prospect");
  const preview = evaluateContractOffer(player, state, { years, salary, signingBonus, yearlyRise, rolePromise, starterStatus, transferReviewPromise, developmentPromise }, { type: mode === "sign" ? "signing" : "resign", teamId: state.userTeamId, asSub: starterStatus === "sub" });
  const cur = player.salary ?? getSigningCost(player);
  const interest = demand.interest?.level === "None" ? "No clear outside interest" : `${demand.interest.level} outside interest`;
  return <div className="modal-backdrop contract-modal-backdrop" onClick={onClose}>
    <div className="modal-card contract-negotiation-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-header contract-modal-header">
        <div><span className="contract-kicker">Agent negotiation</span><h2>{player.name}</h2><p>{demand.message}</p></div>
        <button className="btn-ghost contract-close" onClick={onClose}>✕</button>
      </div>
      <div className="contract-agent-box"><strong>Agent feedback</strong><span>{preview.qualitative}</span><em>{interest}. No exact acceptance odds are available.</em></div>
      <div className="contract-modal-grid">
        <div className="contract-player-card">
          <div><span>Current salary</span><strong>{fmtSalary(cur)}</strong></div>
          <div><span>Role</span><strong>{player.primary || "Flex"}</strong></div>
          <div><span>OVR / POT</span><strong>{player.overall ?? "?"} / {player.potential ?? "?"}</strong></div>
          <div><span>Morale stance</span><strong>{demand.moraleStance}</strong></div>
        </div>
        <div className="contract-form-card">
          <label><span>Wage / salary</span><input value={salary} type="number" min="15000" step="5000" onChange={e => setSalary(Number(e.target.value))} /></label>
          <label><span>Contract length</span><select value={years} onChange={e => setYears(Number(e.target.value))}><option value={1}>1 year</option><option value={2}>2 years</option><option value={3}>3 years</option><option value={4}>4 years</option></select></label>
          <label><span>Squad status</span><select value={starterStatus} onChange={e => setStarterStatus(e.target.value)}><option value="starter">Starter</option><option value="sub">Sub</option></select></label>
          <label><span>Role promise</span><select value={rolePromise} onChange={e => setRolePromise(e.target.value)}>{CONTRACT_ROLES.map(r => <option key={r}>{r}</option>)}</select></label>
          <label><span>Loyalty / signing bonus</span><input value={signingBonus} type="number" min="0" step="5000" onChange={e => setSigningBonus(Number(e.target.value))} /></label>
          <label><span>Yearly wage rise %</span><input value={yearlyRise} type="number" min="0" max="20" step="1" onChange={e => setYearlyRise(Number(e.target.value))} /></label>
          <label className="contract-check"><input type="checkbox" checked={transferReviewPromise} onChange={e => setTransferReviewPromise(e.target.checked)} /> Future transfer review promise</label>
          <label className="contract-check"><input type="checkbox" checked={developmentPromise} onChange={e => setDevelopmentPromise(e.target.checked)} /> Development promise for prospect</label>
        </div>
      </div>
      <div className="modal-actions contract-actions"><button className="btn-secondary" onClick={onClose}>Walk away</button><button className="btn-primary" onClick={() => onSubmit({ years, salary, signingBonus, yearlyRise, rolePromise, starterStatus, transferReviewPromise, developmentPromise })}>Submit Offer</button></div>
    </div>
  </div>;
}
