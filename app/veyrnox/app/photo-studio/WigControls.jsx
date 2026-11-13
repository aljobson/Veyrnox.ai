import { WIGS } from '../../../../packages/live-edit/wigs.js';
import { HAIR_SHADES } from '../../../../packages/live-edit/hair.js';
export function WigControls({ t, wig, hair, update, state, faceReady, retry, control, range }) {
    const names = { pixie: t('app.photoStudio.wig.pixie'), bob: t('app.photoStudio.wig.bob'), waves: t('app.photoStudio.wig.waves'), curls: t('app.photoStudio.wig.curls'), long: t('app.photoStudio.wig.long'), braids: t('app.photoStudio.wig.braids') };
    const shades = { copper: t('app.photoStudio.hair.copper'), plum: t('app.photoStudio.hair.plum'), teal: t('app.photoStudio.hair.teal'), blonde: t('app.photoStudio.hair.blonde') };
    const statuses = {
        off: t('app.photoStudio.wig.off'), 'face-required': t('app.photoStudio.wig.faceRequired'),
        loading: t('app.photoStudio.wig.loading'), unavailable: t('app.photoStudio.wig.unavailable'),
        ready: t('app.photoStudio.wig.ready'), angle: t('app.photoStudio.wig.angle'),
        'coverage-unknown': t('app.photoStudio.wig.coverageUnknown'), uncovered: t('app.photoStudio.wig.uncovered'),
        'angle-uncovered': `${t('app.photoStudio.wig.angle')} ${t('app.photoStudio.wig.uncovered')}`,
    };
    const change = patch => update({ wig: { ...wig, ...patch } });
    const sliders = [
        { id: 'size', label: t('app.photoStudio.wig.size'), min: .75, max: 1.3 },
        { id: 'offset', label: t('app.photoStudio.wig.offset'), min: -.15, max: .15 },
        { id: 'strength', label: t('app.photoStudio.wig.strength'), min: 0, max: 1 },
    ];
    return <section className="border-t border-vx-border pt-6" aria-label={t('app.photoStudio.wig.title')}>
        <h2 className="font-vx text-xl">{t('app.photoStudio.wig.title')}</h2>
        <p className="mt-3 text-sm text-vx-fg-muted">{t('app.photoStudio.wig.help')}</p>
        <p role="status" className="mt-3 text-sm text-vx-fg-muted">{statuses[state]}</p>
        {state === 'unavailable' && <button type="button" className={`${control} mt-3`} onClick={retry}>{t('app.photoStudio.retry')}</button>}
        <fieldset disabled={!faceReady} className="mt-4">
            <legend className="text-sm">{t('app.photoStudio.wig.style')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={control} aria-pressed={wig.style === 'none'} onClick={() => change({ style: 'none' })}>{t('app.photoStudio.none')}</button>
                {WIGS.map(item => <button key={item.id} type="button" className={`${control} ${wig.style === item.id ? 'border-vx-accent' : ''}`} aria-pressed={wig.style === item.id} onClick={() => change({ style: item.id })}>{names[item.id]}</button>)}
            </div>
            {sliders.map(({ id, label, min, max }) => <label key={id} className="mt-4 block text-sm"><span className="flex justify-between gap-4"><span>{label}</span><output className="font-vx-mono text-vx-fg-muted">{Math.round(wig[id] * 100)}%</output></span>
                <input className={range} type="range" min={min} max={max} step="0.01" value={wig[id]} onChange={e => change({ [id]: Number(e.target.value) })} />
            </label>)}
            <label className="mt-4 block text-sm">{t('app.photoStudio.wig.tint')}<select className={`${control} mt-2 w-full`} value={hair.shade} onChange={e => update({ hair: { ...hair, shade: e.target.value } })}>{Object.keys(HAIR_SHADES).map(id => <option key={id} value={id}>{shades[id]}</option>)}</select></label>
            <label className="mt-4 block text-sm">{t('app.photoStudio.wig.tintStrength')}<input className={range} type="range" min="0" max="1" step="0.01" value={hair.strength} onChange={e => update({ hair: { ...hair, strength: Number(e.target.value) } })} /></label>
        </fieldset>
        <p className="mt-3 text-xs leading-relaxed text-vx-fg-muted">{t('app.photoStudio.wig.tintHelp')}</p>
    </section>;
}
