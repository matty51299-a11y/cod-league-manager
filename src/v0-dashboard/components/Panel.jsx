// Ported verbatim from the v0 project's components/manager/panel.tsx (TS types stripped only).
import { cn } from '../utils.js'

export function Panel({ title, action, children, className }) {
  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-sm border border-border bg-panel shadow-[0_1px_0_0_rgba(0,0,0,0.4)]',
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border bg-panel-header px-3 py-1.5">
        <h2 className="font-condensed text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/90">
          {title}
        </h2>
        {action ? <div className="text-[11px] text-muted-foreground">{action}</div> : null}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  )
}
