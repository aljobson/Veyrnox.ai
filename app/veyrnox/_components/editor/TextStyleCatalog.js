'use client';
import { useI18n } from '../../../../components/I18nProvider';

import { useState } from 'react';
import { TITLE_STYLES, insertTitlePreset } from '../../_lib/editorPresets.mjs';

function previewStyle(preset) {
    const style = preset.style;
    return {
        color: style.color,
        backgroundColor: style.backgroundOpacity ? style.background : 'transparent',
        fontFamily: style.font,
        fontWeight: style.weight,
        fontStyle: style.italic ? 'italic' : 'normal',
        letterSpacing: `${Math.max(-1, Math.min(4, style.letterSpacing || 0))}px`,
        WebkitTextStroke: style.strokeWidth ? `${Math.min(2, style.strokeWidth / 2)}px ${style.stroke}` : undefined,
        textShadow: style.shadowOpacity ? `${style.shadowX || 0}px ${style.shadowY || 0}px ${Math.min(8, style.shadowBlur || 0)}px ${style.shadowColor}` : undefined,
    };
}

export function TextStyleCatalog({ disabled, frame, apply, onSelect }) {
  const { t } = useI18n();
    const [query, setQuery] = useState('');
    const styles = TITLE_STYLES.filter(preset => preset.name.toLowerCase().includes(query.trim().toLowerCase()));
    return <div className="space-y-3">
        <div><h2 className="text-sm font-bold">{t("app.editor.workspace.text")}</h2><p className="mt-1 text-xs text-vx-fg-muted">{t("app.editor.textStyles.help")}</p></div>
        <input aria-label={t("app.editor.textStyles.search")} placeholder={t("ui.search")} className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs outline-none focus:border-vx-accent" value={query} onChange={event => setQuery(event.target.value)} />
        {!styles.length && <p role="status" className="rounded-lg border border-dashed border-vx-border p-4 text-center text-xs text-vx-fg-muted">{t("app.editor.textStyles.empty",{query})}</p>}
        <div className="grid grid-cols-2 gap-2">{styles.map(preset => <button key={preset.name} aria-label={preset.name} type="button" disabled={disabled} className="group min-h-24 overflow-hidden rounded-xl border border-vx-border bg-vx-base p-1.5 text-start text-xs transition-all hover:-translate-y-0.5 hover:border-vx-accent hover:shadow-lg hover:shadow-black/10 disabled:translate-y-0 disabled:opacity-40" onClick={() => { const next = apply(timeline => insertTitlePreset(timeline, preset.name, frame)); if (next) onSelect({ track: 'text', id: `t${next.seq}` }); }}>
            <span className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-slate-950 to-slate-800 p-2 text-center"><span className="max-w-full truncate px-1 text-xl leading-tight" style={previewStyle(preset)}>{t("app.editor.textStyles.sample")}</span></span>
            <span className="mt-2 block truncate px-0.5 font-bold">{preset.name}</span>
        </button>)}</div>
    </div>;
}
