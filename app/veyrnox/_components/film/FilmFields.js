'use client';
import { useId } from 'react';
export const fieldClass = 'mt-2 w-full rounded-xl border border-vx-field bg-vx-panel px-3 py-2 text-sm text-vx-fg focus:border-vx-accent focus:outline-none';
export function FilmField({ label, value, onChange, multiline = false, hint, ...props }) {
  const Tag = multiline ? 'textarea' : 'input';
  const hintId=useId();
  return <label className="block text-sm font-semibold">{label}
    {hint && <span id={hintId} className="mt-1 block text-xs font-normal text-vx-fg-muted">{hint}</span>}
    <Tag aria-label={label} aria-describedby={hint?hintId:undefined} className={fieldClass} value={value} onChange={e => onChange(e.target.value)} rows={multiline ? 4 : undefined} maxLength={multiline ? 24000 : 2000} {...props} />
  </label>;
}
export function FilmSelect({ label, value, onChange, options, ...props }) {
  return <label className="block text-sm font-semibold">{label}<select aria-label={label} className={fieldClass} value={value} onChange={e => onChange(e.target.value)} {...props}>
    {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select></label>;
}
export function FilmIssues({ issues }) {
  if (!issues.length) return <p role="status" className="mt-5 text-sm text-vx-accent">This stage is ready.</p>;
  return <div className="mt-5 rounded-xl border border-vx-border p-4 text-sm" role="status"><p className="font-semibold">Before the next stage</p><ul className="mt-2 list-disc space-y-1 pl-5">{issues.slice(0, 12).map((s,i) => <li key={i}>{s}</li>)}</ul>{issues.length > 12 && <p className="mt-2">{issues.length - 12} more items need attention.</p>}</div>;
}
