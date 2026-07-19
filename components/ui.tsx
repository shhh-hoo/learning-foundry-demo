import type { ReactNode } from "react";

export function SurfaceHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="surface-header">
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{description}</p></div>
    {actions ? <div className="header-actions">{actions}</div> : null}
  </header>;
}

export function Card({ title, eyebrow, children, className = "" }: { title?: string; eyebrow?: string; children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}{title ? <h2>{title}</h2> : null}{children}</section>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{hint ? <small>{hint}</small> : null}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Timeline({ items }: { items: Array<{ id: string; label: string; content: string; meta?: string; sourceRefs: Array<Record<string, string>>; evidenceRefs: Array<Record<string, string>> }> }) {
  return <div className="timeline">{items.map((item) => {
    const hasReferences = item.sourceRefs.length > 0 || item.evidenceRefs.length > 0;
    return <article key={item.id} className="timeline-item" data-testid="conversation-event"><div className="timeline-dot"/><div><p className="timeline-label">{item.label}</p><p>{item.content}</p>{item.meta ? <small>{item.meta}</small> : null}<div data-testid="event-evidence-refs">{hasReferences ? <><small>References attached to this event</small><pre>{JSON.stringify({ sourceRefs: item.sourceRefs, evidenceRefs: item.evidenceRefs }, null, 2)}</pre></> : <small>No sourceRefs or evidenceRefs are attached. This event does not claim Evidence grounding.</small>}</div></div></article>;
  })}</div>;
}
