import { MAKEUP, MAKEUP_PRESETS, SHADES } from '../../../../packages/live-edit/makeup.js';
export function MakeupControls({ t, makeup, update, faceReady, control, range }) {
    const labels = {
        natural: t('app.photoStudio.makeup.natural'),
        glam: t('app.photoStudio.makeup.glam'),
        boldLip: t('app.photoStudio.makeup.boldLip'),
        lips: t('app.photoStudio.makeup.lips'),
        blush: t('app.photoStudio.makeup.blush'),
        eyeshadow: t('app.photoStudio.makeup.eyeshadow'),
        eyeliner: t('app.photoStudio.makeup.eyeliner'),
        brows: t('app.photoStudio.makeup.brows'),
        lashes: t('app.photoStudio.makeup.lashes'),
        foundation: t('app.photoStudio.makeup.foundation'),
        rose: t('app.photoStudio.makeup.rose'),
        coral: t('app.photoStudio.makeup.coral'),
        berry: t('app.photoStudio.makeup.berry'),
        nude: t('app.photoStudio.makeup.nude'),
        plum: t('app.photoStudio.makeup.plum'),
        bronze: t('app.photoStudio.makeup.bronze'),
        champagne: t('app.photoStudio.makeup.champagne'),
        cocoa: t('app.photoStudio.makeup.cocoa'),
        ink: t('app.photoStudio.makeup.ink'),
        porcelain: t('app.photoStudio.makeup.porcelain'),
        sand: t('app.photoStudio.makeup.sand'),
        deep: t('app.photoStudio.makeup.deep'),
    };
    const shadeField = { id: 'shade', label: t('app.photoStudio.makeup.shade') };
    const shade2Field = { id: 'shade2', label: t('app.photoStudio.makeup.shade2') };
    const strengthField = { id: 'strength', label: t('app.photoStudio.makeup.strength') };
    const wingField = { id: 'wing', label: t('app.photoStudio.makeup.wing') };
    const volumeField = { id: 'volume', label: t('app.photoStudio.makeup.volume') };
    const finishes = [
        { id: 'matte', label: t('app.photoStudio.makeup.matte') },
        { id: 'gloss', label: t('app.photoStudio.makeup.gloss') },
        { id: 'tint', label: t('app.photoStudio.makeup.tint') },
    ];
    function change(id, patch) { update({ makeup: { ...makeup, [id]: { ...makeup[id], ...patch } } }); }
    function swatches(effect, field) {
        return <fieldset className="mt-3"><legend className="text-xs text-vx-fg-muted">{field.label}</legend>
            <div className="mt-2 flex flex-wrap gap-2">{effect.shades.map(shade => <button key={shade} type="button" className={`${control} flex min-w-11 items-center justify-center gap-2 ${makeup[effect.id][field.id] === shade ? 'border-vx-accent' : ''}`}
                aria-label={`${labels[effect.id]}: ${field.label}, ${labels[shade]}`} aria-pressed={makeup[effect.id][field.id] === shade} onClick={() => change(effect.id, { [field.id]: shade })}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill={SHADES[shade]} /></svg><span>{labels[shade]}</span>
            </button>)}</div>
        </fieldset>;
    }
    function slider(id, field) {
        return <label className="mt-3 block text-sm"><span className="flex justify-between gap-4"><span>{field.label}</span><output className="font-vx-mono text-vx-fg-muted">{Math.round(makeup[id][field.id] * 100)}</output></span>
            <input className={range} aria-label={`${labels[id]}: ${field.label}`} type="range" min="0" max="1" step="0.01" value={makeup[id][field.id]} onChange={e => change(id, { [field.id]: Number(e.target.value) })} />
        </label>;
    }
    return <fieldset disabled={!faceReady} className="space-y-4 border-t border-vx-border pt-6">
        <legend className="text-xl font-vx">{t('app.photoStudio.makeup.title')}</legend>
        <fieldset><legend className="mb-2 text-sm">{t('app.photoStudio.makeup.presets')}</legend><div className="flex flex-wrap gap-2">{Object.entries(MAKEUP_PRESETS).map(([id, preset]) => <button key={id} type="button" className={control} onClick={() => update({ makeup: preset })}>{labels[id]}</button>)}</div></fieldset>
        {MAKEUP.map(effect => <fieldset key={effect.id} className="rounded-xl border border-vx-border p-4">
            <legend className="px-2 text-sm">{labels[effect.id]}</legend>
            {swatches(effect, shadeField)}
            {effect.id === 'eyeshadow' && swatches(effect, shade2Field)}
            {effect.id === 'lips' && <label className="mt-3 block text-sm">{t('app.photoStudio.makeup.finish')}<select className={`${control} mt-2 w-full`} value={makeup.lips.finish} onChange={e => change('lips', { finish: e.target.value })}>{finishes.map(finish => <option key={finish.id} value={finish.id}>{finish.label}</option>)}</select></label>}
            {slider(effect.id, strengthField)}
            {effect.id === 'eyeliner' && slider(effect.id, wingField)}
            {effect.id === 'lashes' && slider(effect.id, volumeField)}
        </fieldset>)}
    </fieldset>;
}
