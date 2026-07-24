// src/main.jsx
// Entry point – wraps everything in the GameProvider context.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Scoped Tailwind + v0 theme (only ever applies inside a .v0-root wrapper —
// see the file header). Lets the v0 dashboard render as the real home screen.
import './v0-dashboard/theme-main.css'
import App from './App.jsx'
import { GameProvider } from './store/gameStore.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GameProvider>
      <App />
    </GameProvider>
  </StrictMode>,
)
