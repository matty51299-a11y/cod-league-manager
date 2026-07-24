// Adapted from the v0 project's components/manager/home-panels.tsx — markup,
// classes and structure are unchanged; panels now take real data via props
// (Phase 3) instead of importing the static placeholder arrays. Where v0
// only ever designed an empty state (Results) or no state at all for "no
// data" (Fixtures/Pro Points/Squad/News), a populated row style consistent
// with v0's own list/table patterns elsewhere in this file was added, and an
// empty state matching ResultsPanel's visual language was added where none
// existed, per the "use an empty state matching the v0 design" instruction.
import { Play, MapPin, ChevronRight, Inbox } from 'lucide-react'
import { Panel } from './Panel.jsx'
import { cn } from '../utils.js'

const tierColor = {
  S: 'bg-destructive/20 text-destructive border-destructive/40',
  A: 'bg-gold/20 text-gold border-gold/40',
  B: 'bg-brand/20 text-brand border-brand/40',
  C: 'bg-white/10 text-muted-foreground border-border',
}

const formColor = {
  good: 'bg-brand',
  ok: 'bg-gold',
  bad: 'bg-destructive',
}

const rankTierColor = {
  1: 'bg-gold/20 text-gold border-gold/40',
  2: 'bg-white/10 text-foreground border-border',
  3: 'bg-white/10 text-muted-foreground border-border',
}

function EmptyPanelState({ title, detail }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <Inbox className="mb-1 size-7 text-muted-foreground/60" />
      <div className="font-condensed text-sm font-semibold uppercase tracking-wide text-foreground">
        {title}
      </div>
      <p className="max-w-xs text-[12px] text-muted-foreground">{detail}</p>
    </div>
  )
}

export function NextEventPanel({ event, onPlay, playLabel, onManageSquad, onProPointsTable, onTransferCentre }) {
  if (!event) {
    return (
      <Panel title="Next Event" action={<span>Open Circuit</span>}>
        <EmptyPanelState
          title="Season complete"
          detail="Every event on this season's circuit has been played. Advance to the next season from the main app."
        />
      </Panel>
    )
  }

  return (
    <Panel title="Next Event" action={<span>Open Circuit</span>}>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-condensed text-xl font-bold uppercase tracking-wide text-foreground">
              {event.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {[event.typeLabel, `${event.tier}-Tier`, event.date, event.field ? `Field ${event.field}` : null]
                .filter(Boolean)
                .map((t) => (
                  <span
                    key={t}
                    className="rounded-sm border border-border bg-arena px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              {event.prize && (
                <span className="rounded-sm bg-gold px-1.5 py-0.5 text-[10px] font-bold text-gold-foreground">
                  {event.prize}
                </span>
              )}
            </div>
            {event.location && (
              <div className="mt-1.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                <MapPin className="size-3.5" />
                {event.location}
              </div>
            )}
          </div>
        </div>

        <button
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-sm bg-gold py-2.5 font-condensed text-sm font-bold uppercase tracking-wide text-gold-foreground transition-colors hover:brightness-105"
          onClick={onPlay}
        >
          <Play className="size-4 fill-current" />
          {playLabel}
        </button>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[
            ['Manage Squad', onManageSquad],
            ['Pro Points Table', onProPointsTable],
            ['Transfer Centre', onTransferCentre],
          ].map(([b, handler]) => (
            <button
              key={b}
              onClick={handler}
              className="rounded-sm border border-border bg-arena px-2 py-1.5 text-[11px] font-medium text-foreground/80 transition-colors hover:border-brand/50 hover:text-foreground"
            >
              {b}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  )
}

export function ResultsPanel({ teamName, results }) {
  if (!results?.length) {
    return (
      <Panel title={`${teamName ?? 'Your'} — Results This Season`} action={<span>Most recent first</span>}>
        <EmptyPanelState
          title="No results yet"
          detail="Play your first event to see match logs and brackets here."
        />
      </Panel>
    )
  }

  return (
    <Panel title={`${teamName ?? 'Your'} — Results This Season`} action={<span>Most recent first</span>}>
      <ul className="divide-y divide-border">
        {results.map((r) => (
          <li key={r.id} className="flex items-center gap-2.5 px-3 py-1.5 text-[12px]">
            <span className="w-12 shrink-0 font-condensed font-semibold text-muted-foreground">{r.date}</span>
            <span
              className={cn(
                'flex h-5 shrink-0 items-center justify-center rounded-sm border px-1.5 text-[10px] font-bold',
                rankTierColor[r.rank] || 'bg-white/10 text-muted-foreground border-border',
              )}
            >
              {r.rank === 1 ? '1st' : r.rank === 2 ? '2nd' : r.rank === 3 ? '3rd' : `${r.rank}th`}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{r.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{r.typeLabel}</span>
            {r.prize && <span className="shrink-0 text-[11px] text-gold">{r.prize}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function FixturesPanel({ fixtures }) {
  return (
    <Panel title="Circuit Fixtures" action={<span>View full circuit</span>}>
      {fixtures?.length ? (
        <ul className="divide-y divide-border">
          {fixtures.map((f) => (
            <li
              key={f.id}
              className={cn('flex items-center gap-2.5 px-3 py-1.5 text-[12px]', f.next && 'bg-brand/10')}
            >
              <span className="w-12 shrink-0 font-condensed font-semibold text-muted-foreground">{f.date}</span>
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold',
                  tierColor[f.tier],
                )}
              >
                {f.tier}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{f.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{f.type}</span>
              {f.next ? (
                <span className="shrink-0 rounded-sm bg-brand px-1.5 py-0.5 text-[10px] font-bold text-brand-foreground">
                  NEXT
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyPanelState title="No fixtures" detail="The circuit calendar for this season has no events left to show." />
      )}
    </Panel>
  )
}

export function ProPointsPanel({ rows, onFullTable }) {
  return (
    <Panel
      title="Pro Points — Top 10"
      action={
        <button onClick={onFullTable} className="text-gold">
          Full table ›
        </button>
      }
    >
      {rows?.length ? (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="w-8 px-3 py-1.5 text-left font-semibold">#</th>
              <th className="px-1 py-1.5 text-left font-semibold">Team</th>
              <th className="px-3 py-1.5 text-right font-semibold">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.pos}
                className={cn('border-b border-border/60 last:border-0', r.you ? 'bg-brand/10' : 'hover:bg-white/5')}
              >
                <td className="px-3 py-1 font-condensed font-semibold text-muted-foreground">{r.pos}</td>
                <td className="px-1 py-1">
                  <span className={cn('font-medium', r.you ? 'text-brand' : 'text-foreground')}>{r.team}</span>
                  {r.you ? (
                    <span className="ml-1.5 rounded-sm bg-brand px-1 py-0.5 text-[9px] font-bold text-brand-foreground">
                      YOU
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-1 text-right font-condensed font-semibold text-foreground">{r.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyPanelState title="No standings yet" detail="Pro Points will appear here once the circuit has results." />
      )}
    </Panel>
  )
}

export function SquadPanel({ roster, onPlayer, onManageRoster }) {
  return (
    <Panel
      title="Squad Snapshot"
      action={
        <button onClick={onManageRoster} className="text-foreground/80 hover:text-foreground">
          Manage roster
        </button>
      }
    >
      {roster?.length ? (
        <ul className="divide-y divide-border">
          {roster.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 px-3 py-1.5">
              <span className={cn('size-2 shrink-0 rounded-full', formColor[p.form])} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-foreground">{p.name}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.role}</div>
              </div>
              <div className="text-right">
                <div className="font-condensed text-sm font-bold text-brand">{p.ovr}</div>
                <div className="text-[10px] text-muted-foreground">
                  {p.kd != null ? `${p.kd.toFixed(2)} K/D` : '— K/D'}
                </div>
              </div>
              <button onClick={() => onPlayer?.(p.id)} className="shrink-0">
                <ChevronRight className="size-4 text-muted-foreground/50" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyPanelState title="No starters signed" detail="Sign or promote players to see your squad here." />
      )}
    </Panel>
  )
}

export function TeamNewsPanel({ news }) {
  return (
    <Panel title="Team News">
      {news?.length ? (
        <ul className="divide-y divide-border">
          {news.map((n, i) => (
            <li key={i} className="flex gap-2.5 px-3 py-2">
              <span className="mt-0.5 h-fit rounded-sm bg-arena px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-wide text-gold">
                {n.tag}
              </span>
              <p className="text-[12px] leading-relaxed text-foreground/80">{n.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyPanelState title="No team news yet" detail="Headlines about your organisation will appear here." />
      )}
    </Panel>
  )
}
