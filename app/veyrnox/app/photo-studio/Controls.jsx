import { EFFECTS, LOOK_IDS } from '../../../../packages/live-edit/effects.js';
import { STICKERS } from '../../../../packages/live-edit/stickers.js';
export const control = 'min-h-11 rounded-xl border border-vx-border bg-vx-panel px-4 py-2 text-sm text-vx-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vx-accent disabled:opacity-40';
const TONE_CURVES = ['none', 'film', 'print'];
const range = 'block min-h-11 w-full accent-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent';
export function Controls({ t, settings, update, disabled, faceReady, addSticker }) {
    return <fieldset disabled={disabled} className="space-y-6">
        <legend className="mb-4 text-xl font-vx">{t('app.photoStudio.adjustments')}</legend>
        <label className="block text-sm">{t('app.photoStudio.look')}<select className={`${control} mt-2 w-full`} value={settings.look} onChange={e => update({ look: e.target.value })}>{LOOK_IDS.map(id => <option key={id} value={id}>{t(`app.photoStudio.${id}`)}</option>)}</select></label>
        <label className="block text-sm">{t('app.photoStudio.strength')}<input className={range} type="range" min="0" max="1" step="0.01" value={settings.strength} disabled={settings.look === 'original'} onChange={e => update({ strength: Number(e.target.value) })} /></label>
        <div className="space-y-4 border-t border-vx-border pt-6">{EFFECTS.map(effect => <label key={effect.id} className="block text-sm">
            <span className="flex justify-between gap-4"><span>{t(`app.photoStudio.${effect.id}`)}</span><output className="font-vx-mono text-vx-fg-muted">{Math.round(settings[effect.id] * 100)}</output></span>
            <input className={range} type="range" min={effect.min} max={effect.max} step={effect.step} value={settings[effect.id]} disabled={effect.face && !faceReady} onChange={e => update({ [effect.id]: Number(e.target.value) })} />
        </label>)}</div>
        <label className="block text-sm">{t('app.photoStudio.lut')}<select className={`${control} mt-2 w-full`} value={settings.lut} onChange={e => update({ lut: e.target.value })}>{TONE_CURVES.map(id => <option key={id} value={id}>{t(`app.photoStudio.${id}`)}</option>)}</select></label>
        <label className="block text-sm">{t('app.photoStudio.lutStrength')}<input className={range} type="range" min="0" max="1" step="0.01" value={settings.lutStrength} disabled={settings.lut === 'none'} onChange={e => update({ lutStrength: Number(e.target.value) })} /></label>
        <fieldset disabled={!faceReady || settings.stickers.length >= 8} className="border-t border-vx-border pt-6"><legend className="text-sm">{t('app.photoStudio.stickers')}</legend><div className="flex flex-wrap gap-2">{Object.keys(STICKERS).map(kind => <button key={kind} type="button" className={control} onClick={() => addSticker(kind)}>{t(`app.photoStudio.${kind}`)}</button>)}</div><p className="mt-3 text-xs leading-relaxed text-vx-fg-muted">{t('app.photoStudio.stickerHelp')}</p></fieldset>
    </fieldset>;
}
