'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
const field = 'w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs';
export function NumberControl({ label, value, min, max, step = 0.01, disabled = false, onChange }) {
    const commit = input => { const n = Number(input.value); if (input.value !== '' && Number.isFinite(n) && n !== value) onChange(n); };
    return <label className="block text-xs">{label}<input aria-label={label} key={`${label}:${value}`} className={field} type="number" disabled={disabled} defaultValue={value} min={min} max={max} step={step} onBlur={e => commit(e.currentTarget)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget); } }} /></label>;
}
export function SelectControl({ label, value, options, optionLabel, onChange }) {
  const { t } = useI18n(); return <label className="block text-xs">{label}<select aria-label={label} className={field} value={value} onChange={e => onChange(e.target.value)}>{options.map(v => <option key={v} value={v}>{optionLabel ? optionLabel(v) : v === 'source-over' ? t("app.publish.inbox.priority.normal") : tOr(t,`app.editor.option.${v}`,v)}</option>)}</select></label>; }
export function ColorControl({ label, value, onChange }) { return <label className="flex items-center justify-between text-xs">{label}<input aria-label={label} type="color" value={value} onChange={e => onChange(e.target.value)} /></label>; }
