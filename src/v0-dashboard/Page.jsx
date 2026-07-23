// Ported verbatim from the v0 project's app/page.tsx (TS types stripped only).
import { Sidebar } from './components/Sidebar.jsx'
import { TopBar } from './components/TopBar.jsx'
import { TeamHeader } from './components/TeamHeader.jsx'
import {
  NextEventPanel,
  ResultsPanel,
  FixturesPanel,
  ProPointsPanel,
  SquadPanel,
  TeamNewsPanel,
} from './components/HomePanels.jsx'

export default function Page() {
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Stadium backdrop for the whole app */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/stadium-bg.png)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-background/70 via-background/85 to-background"
      />
      {/* Neon green glow accents */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,var(--color-brand)/18%,transparent_70%)]"
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="w-full min-w-0 space-y-3 p-3">
              <TeamHeader />

              {/* FM-style dense panel grid */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                <div className="space-y-3 lg:col-span-4">
                  <NextEventPanel />
                  <SquadPanel />
                </div>
                <div className="space-y-3 lg:col-span-5">
                  <ResultsPanel />
                  <FixturesPanel />
                </div>
                <div className="space-y-3 lg:col-span-3">
                  <ProPointsPanel />
                  <TeamNewsPanel />
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
