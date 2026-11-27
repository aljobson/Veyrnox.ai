import { useRef, useState } from 'react';
import { TABS, nextTab } from '../../_lib/liveEdit/tabs.js';
import { HairControls } from './HairControls';
import { MakeupControls } from './MakeupControls';
import { EFFECTS, LOOK_IDS } from '../../../../packages/live-edit/effects.js';
import { STICKERS } from '../../../../packages/live-edit/stickers.js';
export const control = 'min-h-11 rounded-xl border border-vx-border bg-vx-panel px-4 py-2 text-sm text-vx-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vx-accent disabled:opacity-40';
const TONE_CURVES = ['none', 'film', 'print'];
const range = 'block min-h-11 w-full accent-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent';
const tab = 'min-h-11 rounded-lg border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent';
// One tool at a time, like the Photos editor: a tab row on top and only the chosen tool's controls below it.
export function Controls({ t, settings, update, disabled, faceReady, hairState, stickersDisabled = false, retry, addSticker, initial = 'adjust' }) {
    const [current, setCurrent] = useState(initial), refs = useRef({});
    const names = { adjust: t('app.photoStudio.adjustments'), makeup: t('app.photoStudio.makeup.title'), hair: t('app.photoStudio.hair.title'), stickers: t('app.photoStudio.stickers') };
    const move = (event) => {
        const next = nextTab(current, event.key);
        if (!next) return;
        event.preventDefault(); setCurrent(next); refs.current[next]?.focus();
    };
    // The tab row follows the width of its own panel, not the screen: one column when narrow, two, then four.
    return <div className="@container space-y-6">
        <div role="tablist" aria-label={names.adjust} onKeyDown={move} className="grid grid-cols-1 gap-1 rounded-xl border border-vx-border p-1 @[13rem]:grid-cols-2 @[28rem]:grid-cols-4">
            {TABS.map(id => <button key={id} ref={node => { refs.current[id] = node; }} type="button" role="tab" id={`studio-tab-${id}`} aria-controls="studio-panel" aria-selected={current === id} tabIndex={current === id ? 0 : -1}
                className={`${tab} ${current === id ? 'border-vx-accent bg-vx-panel text-vx-fg' : 'border-transparent text-vx-fg-muted'}`} onClick={() => setCurrent(id)}>{names[id]}</button>)}
        </div>
        <fieldset disabled={disabled} id="studio-panel" role="tabpanel" aria-labelledby={`studio-tab-${current}`} className="space-y-6">
            <legend className="sr-only">{names[current]}</legend>
            {current === 'adjust' && <>
            <label className="block text-sm">{t('app.photoStudio.look')}<select className={`${control} mt-2 w-full`} value={settings.look} onChange={e => update({ look: e.target.value })}>{LOOK_IDS.map(id => <option key={id} value={id}>{t(`app.photoStudio.${id}`)}</option>)}</select></label>
        <label className="block text-sm">{t('app.photoStudio.strength')}<input className={range} type="range" min="0" max="1" step="0.01" value={settings.strength} disabled={settings.look === 'original'} onChange={e => update({ strength: Number(e.target.value) })} /></label>
        <div className="space-y-4 border-t border-vx-border pt-6">{EFFECTS.map(effect => <label key={effect.id} className="block text-sm">
            <span className="flex justify-between gap-4"><span>{t(`app.photoStudio.${effect.id}`)}</span><output className="font-vx-mono text-vx-fg-muted">{Math.round(settings[effect.id] * 100)}</output></span>
            <input className={range} type="range" min={effect.min} max={effect.max} step={effect.step} value={settings[effect.id]} disabled={effect.face && !faceReady} onChange={e => update({ [effect.id]: Number(e.target.value) })} />
        </label>)}</div>
        <label className="block text-sm">{t('app.photoStudio.lut')}<select className={`${control} mt-2 w-full`} value={settings.lut} onChange={e => update({ lut: e.target.value })}>{TONE_CURVES.map(id => <option key={id} value={id}>{t(`app.photoStudio.${id}`)}</option>)}</select></label>
        <label className="block text-sm">{t('app.photoStudio.lutStrength')}<input className={range} type="range" min="0" max="1" step="0.01" value={settings.lutStrength} disabled={settings.lut === 'none'} onChange={e => update({ lutStrength: Number(e.target.value) })} /></label>
            </>}
            {current === 'makeup' && <MakeupControls t={t} makeup={settings.makeup} update={update} faceReady={faceReady} control={control} range={range} />}
            {current === 'hair' && <HairControls t={t} hair={settings.hair} update={update} state={hairState} retry={retry} control={control} range={range} />}
            {current === 'stickers' && <>
            <fieldset disabled={!faceReady || stickersDisabled || settings.stickers.length >= 8} className=""><legend className="text-sm">{t('app.photoStudio.stickers')}</legend>{stickersDisabled && <p role="status" className="mb-2 text-xs text-vx-fg-muted">{t('app.photoStudio.stickersLive')}</p>}<div className="flex flex-wrap gap-2">{Object.keys(STICKERS).map(kind => <button key={kind} type="button" className={control} onClick={() => addSticker(kind)}>{t(`app.photoStudio.${kind}`)}</button>)}</div><p className="mt-3 text-xs leading-relaxed text-vx-fg-muted">{t('app.photoStudio.stickerHelp')}</p></fieldset>
            </>}
        </fieldset>
    </div>;
}
