// Ported verbatim from the v0 project's components/manager/team-header.tsx (TS types stripped only).
import { Play } from 'lucide-react'
import { stats } from '../data.js'
import { cn } from '../utils.js'

const toneMap = {
  good: 'text-brand',
  warn: 'text-gold',
  bad: 'text-destructive',
  neutral: 'text-foreground',
}

export function TeamHeader() {
  return (
    <div className="overflow-hidden rounded-sm border border-border">
      {/* Banner */}
      <div className="relative">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/arena-bg.png)' }}
          aria-hidden
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(13,18,32,0.96) 0%, rgba(13,18,32,0.82) 45%, rgba(13,18,32,0.55) 100%)',
          }}
          aria-hidden
        />
        <div className="relative flex items-center gap-4 px-5 py-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-brand bg-arena/80 font-condensed text-xl font-bold tracking-wider text-brand">
            OPT
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
              Historical Dynasty · Open Circuit
            </div>
            <h1 className="font-condensed text-3xl font-bold uppercase leading-tight tracking-wide text-foreground">
              OpTic Gaming
            </h1>
            <p className="max-w-xl text-pretty text-[12px] leading-relaxed text-foreground/70">
              Call of Duty: Ghosts · 2013/14 — play through online 2K/5K cups, open LANs, league play
              and the Championship. Pro Points decide seeding.
            </p>
          </div>
          <button className="hidden shrink-0 items-center gap-2 rounded-sm bg-gold px-4 py-2.5 font-condensed text-sm font-bold uppercase tracking-wide text-gold-foreground transition-colors hover:brightness-105 sm:flex">
            <Play className="size-4 fill-current" />
            Play Next Event
          </button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 divide-x divide-y divide-border border-t border-border bg-panel sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-2.5">
            <div className="font-condensed text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {s.label}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className={cn('font-condensed text-2xl font-bold leading-none', toneMap[s.tone])}>
                {s.value}
              </span>
              {s.sub ? <span className="text-[12px] text-muted-foreground">{s.sub}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
