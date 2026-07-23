// Ported verbatim from the v0 project's components/manager/sidebar.tsx (TS types stripped only).
import { navItems } from '../data.js'
import { cn } from '../utils.js'

export function Sidebar() {
  return (
    <aside className="flex w-[208px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar backdrop-blur-md">
      {/* Club identity */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex size-10 items-center justify-center rounded-full border-2 border-brand bg-arena font-condensed text-sm font-bold tracking-wider text-brand">
          OPT
        </div>
        <div className="min-w-0">
          <div className="truncate font-condensed text-sm font-semibold uppercase tracking-wide text-foreground">
            OpTic Gaming
          </div>
          <div className="text-[11px] text-muted-foreground">Open Circuit · S1</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((item) => (
          <button
            key={item.label}
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
            {item.badge ? (
              <span className="flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="border-t border-border px-4 py-2 text-center font-condensed text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        openCircuit
      </div>
    </aside>
  )
}
