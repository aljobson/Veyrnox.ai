import { HAIR_SHADES, HAIR_PRESETS } from '../../../../packages/live-edit/hair.js';
export function HairControls({ t, hair, update, state, retry, control, range }) {
    const shades = { copper: t('app.photoStudio.hair.copper'), plum: t('app.photoStudio.hair.plum'), teal: t('app.photoStudio.hair.teal'), blonde: t('app.photoStudio.hair.blonde') };
    const modes = { solid: t('app.photoStudio.hair.solid'), ombre: t('app.photoStudio.hair.ombre'), highlights: t('app.photoStudio.hair.highlights') };
    const presets = { copperGlow: t('app.photoStudio.hair.copperGlow'), goldenOmbre: t('app.photoStudio.hair.goldenOmbre'), plumLights: t('app.photoStudio.hair.plumLights') };
    const statuses = {
        waiting: t('app.photoStudio.hair.waiting'), detecting: t('app.photoStudio.hair.detecting'), ready: t('app.photoStudio.hair.ready'),
        'no-hair': t('app.photoStudio.hair.noHair'), 'face-required': t('app.photoStudio.hair.faceRequired'), unavailable: t('app.photoStudio.hair.unavailable'),
        invalid: t('app.photoStudio.hair.invalid'),
    };
    const shadeField = { id: 'shade', label: t('app.photoStudio.hair.shade') };
    const tipField = { id: 'shade2', label: t('app.photoStudio.hair.shade2') };
    const change = patch => update({ hair: { ...hair, ...patch } });
    const swatches = ({ id: field, label }) => <fieldset className="mt-4"><legend className="text-sm">{label}</legend>
        <div className="mt-2 flex flex-wrap gap-2">{Object.entries(HAIR_SHADES).map(([id, colour]) => <button key={id} type="button" className={`${control} flex items-center gap-2 ${hair[field] === id ? 'border-vx-accent' : ''}`}
            aria-label={`${label}: ${shades[id]}`} aria-pressed={hair[field] === id} onClick={() => change({ [field]: id })}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill={colour} /></svg>{shades[id]}
        </button>)}</div>
    </fieldset>;
    return <section className="border-t border-vx-border pt-6" aria-label={t('app.photoStudio.hair.title')}>
        <h2 className="text-xl font-vx">{t('app.photoStudio.hair.title')}</h2>
        <p role="status" className="mt-3 text-sm text-vx-fg-muted">{statuses[state]}</p>
        {state === 'unavailable' && <button type="button" className={`${control} mt-3`} onClick={retry}>{t('app.photoStudio.retry')}</button>}
        <fieldset disabled={state !== 'ready'} className="mt-4">
            <legend className="text-sm">{t('app.photoStudio.hair.presets')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">{Object.entries(HAIR_PRESETS).map(([id, preset]) => <button key={id} type="button" className={control} onClick={() => change(preset)}>{presets[id]}</button>)}</div>
            <label className="mt-4 block text-sm">{t('app.photoStudio.hair.mode')}<select className={`${control} mt-2 w-full`} value={hair.mode} onChange={e => change({ mode: e.target.value })}>{Object.entries(modes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            {swatches(shadeField)}
            {hair.mode === 'ombre' && swatches(tipField)}
            <label className="mt-4 block text-sm"><span className="flex justify-between gap-4"><span>{t('app.photoStudio.hair.strength')}</span><output className="font-vx-mono text-vx-fg-muted">{Math.round(hair.strength * 100)}</output></span>
                <input className={range} type="range" min="0" max="1" step="0.01" value={hair.strength} onChange={e => change({ strength: Number(e.target.value) })} />
            </label>
        </fieldset>
        <p className="mt-3 text-xs leading-relaxed text-vx-fg-muted">{t('app.photoStudio.hair.help')}</p>
    </section>;
}
