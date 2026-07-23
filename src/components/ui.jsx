// src/components/ui.jsx
// Small shared presentation primitives for the sports-management UI shell.

export function PageHeader({ eyebrow, title, subtitle, meta, action, accent, logo }) {
  return (
    <header className="ui-page-header" style={accent ? { "--page-accent": accent } : undefined}>
      <div className="ui-page-header-main">
        {logo && <div className="ui-page-header-logo">{logo}</div>}
        <div>
          {eyebrow && <div className="ui-eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {(meta || action) && (
        <div className="ui-page-header-side">
          {meta}
          {action}
        </div>
      )}
    </header>
  );
}

export function StatCard({ label, value, hint, tone = "neutral" }) {
  return (
    <div className={`ui-stat-card ui-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <em>{hint}</em>}
    </div>
  );
}

export function SectionCard({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`ui-section-card ${className}`.trim()}>
      {(title || subtitle || action) && (
        <div className="ui-section-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Pill({ children, tone = "neutral", className = "" }) {
  return <span className={`ui-pill ui-pill-${tone} ${className}`.trim()}>{children}</span>;
}

export function EmptyState({ title, detail }) {
  return (
    <div className="ui-empty-state">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export function TeamAccentBorder({ children, className = "", as: Component = "div" }) {
  return <Component className={`ui-team-accent-border ${className}`.trim()}>{children}</Component>;
}

export function TeamBadge({ children, className = "" }) {
  return <span className={`ui-team-badge ${className}`.trim()}>{children}</span>;
}

export function ActionButton({ children, className = "", tone = "primary", ...props }) {
  return <button className={`ui-action-btn ui-action-${tone} ${className}`.trim()} {...props}>{children}</button>;
}
