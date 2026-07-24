// Entry point for the isolated /v0-dashboard-test page. Deliberately its own
// Vite HTML entry (see v0-dashboard-test.html) with its own CSS module graph
// (theme.css) — never imports src/index.css and is never imported by it, so
// neither stylesheet can leak into the other's document.
//
// Phase 3: this reuses the exact same store/engine as the main app (src/store,
// src/engine) — nothing here reimplements sim, save, roster, or calendar
// logic. GameProvider reads the same localStorage save the main app writes,
// so this page reflects the real, current career.
//
// It deliberately does NOT mount the main app's overlay components
// (CircuitTournamentOverlay, MatchCenterOverlay, etc.) — they're styled with
// src/index.css's hand-written classes, not Tailwind, so they'd render
// unstyled here without importing that stylesheet, which would undo the CSS
// isolation Phase 1/2 established. Actions that need one of those overlays
// (starting an interactive tournament, viewing a player profile) save state
// and hand off to the main app instead, where they render fully styled.
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import { GameProvider, useGame, loadGame, saveGame } from '../store/gameStore.jsx'
import { isValidGameState } from '../store/gameValidation.js'
import Page from './Page.jsx'

function Root() {
  const { state, dispatch } = useGame()

  // Mirrors App.jsx's own mount effect: hydrate from the same save the main
  // app uses (same localStorage key), so this page shows the real career.
  useEffect(() => {
    if (state) return
    const saved = loadGame()
    if (saved) dispatch({ type: 'LOAD_GAME', state: saved })
  }, [state, dispatch])

  // Mirrors App.jsx's own autosave effect, so actions dispatched from this
  // page (e.g. resolving an online cup) persist the same way they do there.
  useEffect(() => {
    if (isValidGameState(state)) saveGame(state)
  }, [state])

  return <Page />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GameProvider>
      <Root />
    </GameProvider>
  </StrictMode>,
)
