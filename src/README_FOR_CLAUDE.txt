FILES FOR COD DYNASTY IMPLEMENTATION

1. cod_dynasty_rosters.corrected.json
   Historical season-by-season team and player roster targets.
   Includes separate permanent identities for:
   - vortex-uk: English Vortex, FAB Games / Epsilon
   - vortex-fr: French Vortex, Supremacy

2. seasonRosterEngine.ts
   Reference implementation for historical roster reconciliation.
   Claude Code should adapt this to the existing game's architecture and types.
   It is not expected to be copied blindly if the project already has equivalent systems.

IMPORTANT:
- The user's team must never be reset.
- Existing user players remain protected.
- If a historical signing is due to join the user's full roster, that player becomes a free agent.
- Historical player IDs must be used instead of matching only by displayed gamertag.
- Tournament formats must be historical and season/event-specific.
- Remove the modern Challengers system from historical seasons.
