'use client';
import { Button } from '../Button';

/** A short, readable "what to do next" card. Renders nothing when there is no hint. */
export function GuidanceCard({ hint, onAction, className = '' }) {
    if (!hint) return null;
    return <section role="status" aria-label={hint.title} className={`rounded-xl border border-vx-accent/50 bg-vx-accent/10 p-3 text-sm ${className}`}>
        <p className="font-bold text-vx-fg">{hint.title}</p>
        <p className="mt-1 text-vx-fg-body">{hint.body}</p>
        {hint.action && onAction && <Button size="sm" className="mt-3" onClick={onAction}>{hint.action}</Button>}
    </section>;
}
