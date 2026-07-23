// Ported verbatim from the v0 project's components/manager/top-bar.tsx (TS types stripped only).
import { ChevronLeft, ChevronRight, Save, Settings, HelpCircle, Play } from 'lucide-react'

export function TopBar() {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-arena px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-white/5 hover:text-foreground">
            <ChevronLeft className="size-4" />
          </button>
          <button className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-white/5 hover:text-foreground">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <span className="font-condensed text-sm font-bold uppercase tracking-[0.16em] text-foreground">
          Dynasty Manager
        </span>
        <span className="rounded-sm bg-brand/15 px-1.5 py-0.5 font-condensed text-[11px] font-bold text-brand">
          S1
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-sm border border-border bg-panel px-3 py-1 md:flex">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Next Event</span>
          <span className="text-[13px] font-medium text-foreground">Astro CoD: Ghosts Cup</span>
        </div>
        <button className="flex items-center gap-1.5 rounded-sm bg-gold px-3 py-1.5 font-condensed text-[13px] font-bold uppercase tracking-wide text-gold-foreground transition-colors hover:brightness-105">
          <Play className="size-3.5 fill-current" />
          Continue
        </button>
        <div className="ml-1 flex items-center gap-0.5">
          {[Save, Settings, HelpCircle].map((Icon, i) => (
            <button
              key={i}
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}
