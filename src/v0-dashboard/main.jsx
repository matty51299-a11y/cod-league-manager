// Entry point for the isolated /v0-dashboard-test page. Deliberately its own
// Vite HTML entry (see v0-dashboard-test.html) with its own CSS module graph
// (theme.css) — never imports src/index.css and is never imported by it, so
// neither stylesheet can leak into the other's document.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import Page from './Page.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
