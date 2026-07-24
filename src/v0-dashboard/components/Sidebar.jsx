// Adapted from the v0 project's components/manager/sidebar.tsx — markup and
// classes unchanged. Nav items now navigate to the real app's screens (this
// isolated bundle has no other screens of its own to route to), and the
// Inbox badge reflects the real unread count when available (Phase 3).
import { navItems } from '../data.js'
import { cn } from '../utils.js'

// v0's nav labels mapped to the real app's Sidebar.jsx screen ids.
const SCREEN_ID = {
  Home: null, // already "here" — no navigation
  Inbox: 'inbox',
  Standings: 'standings',
  Schedule: 'schedule',
  'K/D Leaders': 'kdleaders',
  Roster: 'roster',
  Dynamics: 'dynamics',
  Board: 'board',
  Scouting: 'scouting',
  Transfers: 'transfers',
  Circuit: 'circuit',
  'Dev Report': 'devreport',
  Staff: 'staff',
  'Match Log': 'log',
  Feed: null, // opens an overlay in the real app, not a screen — handled separately
}

export function Sidebar({ team, unreadInbox, onNavigate, onOpenFeed, seasonLabel }) {
  // Integrated into the main app, onNavigate/onOpenFeed switch screens
  // client-side (seamless, no reload). In the standalone /v0-dashboard-test
  // bundle they're absent, so fall back to a URL hand-off to the main app.
  function navigate(item) {
    const screenId = SCREEN_ID[item.label]
    if (item.label === 'Feed') {
      if (onOpenFeed) onOpenFeed()
      else window.location.assign('/?screen=home&feed=1')
      return
    }
    if (!screenId) return
    if (onNavigate) onNavigate(screenId)
    else window.location.assign(`/?screen=${screenId}`)
  }

  return (
    <aside className="flex w-[208px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar backdrop-blur-md">
      {/* Club identity */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex size-10 items-center justify-center rounded-full border-2 border-brand bg-arena font-condensed text-sm font-bold tracking-wider text-brand">
          {team?.tag ?? '—'}
        </div>
        <div className="min-w-0">
          <div className="truncate font-condensed text-sm font-semibold uppercase tracking-wide text-foreground">
            {team?.name ?? 'Your Organisation'}
          </div>
          <div className="text-[11px] text-muted-foreground">Open Circuit · {seasonLabel ?? 'S1'}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((item) => {
          const badge = item.label === 'Inbox' && unreadInbox ? unreadInbox : item.badge
          return (
            <button
              key={item.label}
              onClick={() => navigate(item)}
              className={cn(
                'group flex w-full items-center gap-3 border-l-2 px-4 py-2 text-left text-[13px] font-medium transition-colors',
                item.active
                  ? 'border-brand bg-brand/15 font-semibold text-brand [text-shadow:0_0_12px_var(--color-brand)]'
                  : 'border-transparent text-foreground/90 hover:border-brand/60 hover:bg-brand/10 hover:text-brand',
              )}
            >
              <item.icon
                className={cn(
                  'size-4 shrink-0 transition-colors',
                  item.active ? 'text-brand' : 'text-foreground/80 group-hover:text-brand',
                )}
                strokeWidth={2.25}
              />
              <span className="flex-1 truncate">{item.label}</span>
              {badge ? (
                <span className="flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                  {badge > 99 ? '99+' : badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-border px-4 py-2 text-center font-condensed text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        openCircuit
      </div>
    </aside>
  )
}
