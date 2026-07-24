// Adapted from the v0 project's app/page.tsx — overall layout/markup is
// unchanged (Phase 2). Phase 3 wires it to real game state: same store,
// same engine actions the main app uses.
import { useEffect, useState } from 'react'
import { useGame, saveGame } from '../store/gameStore.jsx'
import { useDashboardData } from './useDashboardData.js'
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

function goto(screen) {
  window.location.href = `/?screen=${screen}`
}

function NoCareerPrompt() {
  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 rounded-sm border border-border bg-panel p-10 text-center">
      <div className="font-condensed text-xl font-bold uppercase tracking-wide text-foreground">
        No Active Career
      </div>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        Start or load a game in the main app to see your real dashboard here.
      </p>
      <button
        onClick={() => goto('home')}
        className="mt-1 rounded-sm bg-gold px-4 py-2 font-condensed text-sm font-bold uppercase tracking-wide text-gold-foreground transition-colors hover:brightness-105"
      >
        Go to Team Select
      </button>
    </div>
  )
}

export default function Page() {
  const { state, dispatch } = useGame()
  const data = useDashboardData(state)
  // Set when an action needs the main app's overlays (e.g. starting an
  // interactive tournament — see main.jsx for why those aren't mounted
  // here). The effect below waits for the dispatch to actually land in
  // `state` before saving + navigating, so the hand-off never races ahead
  // of the state update.
  const [handoffAfterDispatch, setHandoffAfterDispatch] = useState(false)

  useEffect(() => {
    if (!handoffAfterDispatch || !state) return
    saveGame(state)
    goto('home')
  }, [handoffAfterDispatch, state])

  function playOrAdvance() {
    if (!data) return
    if (data.nextEvent) {
      if (data.nextEvent.interactive) {
        dispatch({ type: 'START_CIRCUIT_EVENT' })
        setHandoffAfterDispatch(true)
      } else {
        dispatch({ type: 'SIM_NEXT_CIRCUIT_EVENT' })
      }
    } else if (data.seasonComplete) {
      dispatch({ type: 'ADVANCE_OFFSEASON' })
    }
  }

  const playDisabled = !data?.hasOpenCircuit
  const playLabel = !data
    ? 'Play Next Event'
    : data.nextEvent
      ? `Play ${data.nextEvent.typeLabel}`
      : data.seasonComplete
        ? 'Advance to Next Season'
        : 'Play Next Event'

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
        <TopBar
          season={state?.season}
          nextEventName={data?.nextEvent?.name}
          onContinue={playOrAdvance}
          continueDisabled={playDisabled}
          onSave={() => state && saveGame(state)}
        />
        <div className="flex min-h-0 flex-1">
          <Sidebar team={data?.team} unreadInbox={data?.unreadInbox} />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="w-full min-w-0 space-y-3 p-3">
              {!data ? (
                <NoCareerPrompt />
              ) : (
                <>
                  <TeamHeader
                    team={data.team}
                    eyebrow={`Historical Dynasty · Open Circuit`}
                    description={`${data.era?.gameTitle || 'Open circuit'} · ${data.era?.seasonLabel || `Season ${state.season}`} — play through online 2K/5K cups, open LANs, league play and the Championship. Pro Points decide seeding.`}
                    stats={data.stats}
                    onPlayNext={playOrAdvance}
                    playLabel={playLabel}
                    playDisabled={playDisabled}
                  />

                  {/* FM-style dense panel grid */}
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                    <div className="space-y-3 lg:col-span-4">
                      <NextEventPanel
                        event={data.nextEvent}
                        onPlay={playOrAdvance}
                        playLabel={`Play ${data.nextEvent?.typeLabel ?? ''}`}
                        onManageSquad={() => goto('roster')}
                        onProPointsTable={() => goto('standings')}
                        onTransferCentre={() => goto('transfers')}
                      />
                      <SquadPanel
                        roster={data.squad}
                        onPlayer={() => goto('roster')}
                        onManageRoster={() => goto('roster')}
                      />
                    </div>
                    <div className="space-y-3 lg:col-span-5">
                      <ResultsPanel teamName={data.team?.name} results={data.seasonResults} />
                      <FixturesPanel fixtures={data.fixtures} />
                    </div>
                    <div className="space-y-3 lg:col-span-3">
                      <ProPointsPanel rows={data.proPoints} onFullTable={() => goto('standings')} />
                      <TeamNewsPanel news={data.teamNews} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
