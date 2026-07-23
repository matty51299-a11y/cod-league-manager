// src/data/teams.js
// The 12 CDL franchises for the 2026 season.
// Each team has a unique id, display name, short tag, and primary color.

import atlantaFazeLogo from "../assets/logos/Atlanta_FaZe_logo.png";
import bostonBreachLogo from "../assets/logos/Boston_Breach_logo.png";
import carolinaRoyalRavensLogo from "../assets/logos/Carolina_Royal_Ravens_logo.png";
import cloud9NewYorkLogo from "../assets/logos/C9_New_York.png";
import g2MinnesotaLogo from "../assets/logos/G2_Minnesota_logo.png";
import laThievesLogo from "../assets/logos/Cdl_la_thieves-red_la.png";
import miamiHereticsLogo from "../assets/logos/Miami_Heretics_logo.png";
import opticTexasLogo from "../assets/logos/Optic-Texas.png";
import parisGentleMatesLogo from "../assets/logos/Paris_Gentle_Mates_logo.png";
import riyadhFalconsLogo from "../assets/logos/Riyadh_Falcons_logo.png";
import torontoKoiLogo from "../assets/logos/Toronto_KOI_logo.png";
import vancouverSurgeLogo from "../assets/logos/Vancouver_Surge_logo.png";

// budgetTier: 2–6 franchise spending capacity.
//   6 = Riyadh Falcons only — highest budget in the CDL
//   5 = top spenders (OpTic, FaZe, Paris) — can build star-heavy rosters
//   4 = upper-mid orgs (LAT, Toronto, Miami, G2) — one star + solid depth
//   3 = (fallback default — no teams currently here)
//   2 = budget orgs (Boston, Carolina, Cloud9, VAN) — challenger/value path
//
// owner: board personality used by the Owner Expectations / Board Objectives
//   system (src/engine/boardEngine.js). Read-only flavour + light objective
//   modifiers — it never overrides the OVR-rank hard caps.
//     ambition  0–100: how aggressively the board sets targets
//     patience  0–100: how forgiving the board is when targets are missed
export const CDL_TEAMS = [
  { id: "boston",    name: "Boston Breach",          tag: "BOS",  color: "#C8102E", budgetTier: 2, logo: bostonBreachLogo,           owner: { name: "Huntsmen Gaming Group", ambition: 55, patience: 65 } },
  { id: "carolina",  name: "Carolina Royal Ravens",  tag: "CAR",  color: "#7B2D8B", budgetTier: 2, logo: carolinaRoyalRavensLogo,    owner: { name: "Pittsburgh Knights Group", ambition: 45, patience: 70 } },
  { id: "cloud9",    name: "Cloud9 New York",        tag: "C9",   color: "#1B94DB", budgetTier: 2, logo: cloud9NewYorkLogo,          owner: { name: "Cloud9 Ownership", ambition: 70, patience: 45 } },
  { id: "faze",      name: "FaZe Vegas",             tag: "FaZe", color: "#CC0000", budgetTier: 5, logo: atlantaFazeLogo,            owner: { name: "FaZe Holdings Board", ambition: 90, patience: 50 } },
  { id: "g2",        name: "G2 Minnesota",           tag: "G2",   color: "#56BE5A", budgetTier: 4, logo: g2MinnesotaLogo,            owner: { name: "G2 Esports Board", ambition: 65, patience: 55 } },
  { id: "lat",       name: "Los Angeles Thieves",    tag: "LAT",  color: "#FF4500", budgetTier: 4, logo: laThievesLogo,             owner: { name: "100 Thieves Board", ambition: 80, patience: 45 } },
  { id: "miami",     name: "Miami Heretics",         tag: "MIA",  color: "#00B2A9", budgetTier: 4, logo: miamiHereticsLogo,          owner: { name: "Heretics Ownership", ambition: 60, patience: 60 } },
  { id: "optic",     name: "OpTic Texas",            tag: "OTX",  color: "#3BA03A", budgetTier: 5, logo: opticTexasLogo,             owner: { name: "Envy / OpTic Board", ambition: 88, patience: 40 } },
  { id: "paris",     name: "Paris Gentle Mates",     tag: "PGM",  color: "#0055A4", budgetTier: 5, logo: parisGentleMatesLogo,       owner: { name: "Gentle Mates Board", ambition: 75, patience: 55 } },
  { id: "riyadh",    name: "Riyadh Falcons",         tag: "RFL",  color: "#006C35", budgetTier: 6, logo: riyadhFalconsLogo,          owner: { name: "Falcons Esports Board", ambition: 95, patience: 35 } },
  { id: "toronto",   name: "Toronto KOI",            tag: "TOR",  color: "#9B1CDB", budgetTier: 4, logo: torontoKoiLogo,             owner: { name: "OverActive Media", ambition: 70, patience: 50 } },
  { id: "vancouver", name: "Vancouver Surge",        tag: "VAN",  color: "#00AEEF", budgetTier: 2, logo: vancouverSurgeLogo,         owner: { name: "Surge Ownership Group", ambition: 50, patience: 65 } },
];

// ── Runtime team branding (Historical Dynasty) ────────────────────────────────
// The engine keys everything to the stable ids above. A historical dynasty
// re-skins the DISPLAY fields (name/tag/color/logo) of these same slots to the
// real organisations of the active era, without changing ids, budgets, owners or
// any simulation behaviour. Because every consumer reads these fields live from
// the shared CDL_TEAMS objects, applying branding in place propagates everywhere.
const DEFAULT_TEAM_BRANDS = Object.fromEntries(
  CDL_TEAMS.map(t => [t.id, { name: t.name, tag: t.tag, color: t.color, logo: t.logo }])
);

// Apply a brand map { [id]: { name, tag, color, org? } }. Slots missing from the
// map are reset to their default (modern CDL franchise) identity. Historical
// brands have no bundled logo, so they fall back to a coloured tag box.
export function applyTeamBranding(brandMap) {
  for (const team of CDL_TEAMS) {
    const def = DEFAULT_TEAM_BRANDS[team.id];
    const b = brandMap?.[team.id];
    if (b) {
      team.name = b.name ?? def.name;
      team.tag = b.tag ?? def.tag;
      team.color = b.color ?? def.color;
      team.logo = b.logo ?? null;
      team.orgName = b.org ?? b.name ?? def.name;
    } else {
      team.name = def.name;
      team.tag = def.tag;
      team.color = def.color;
      team.logo = def.logo;
      team.orgName = def.name;
    }
  }
}

export function resetTeamBranding() {
  applyTeamBranding(null);
}
