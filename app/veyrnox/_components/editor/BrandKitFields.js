'use client';
import { useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
import { BRAND_SWATCHES, brandKitProblem, emptyBrandKit } from '../../../../lib/editorShared';
import { TEXT_FONTS } from '../../_lib/editorTextStyle.mjs';
export const brandField = 'min-h-11 w-full rounded-xl border border-vx-border bg-vx-base p-2 text-xs focus-visible:outline focus-visible:outline-vx-accent';
export function BrandFieldError({ kit, name }) {
  const { t } = useI18n();
  const candidate = { ...emptyBrandKit(), [name]: kit[name] };
  if (name === 'logo') candidate.assets = kit.assets;
  return brandKitProblem(candidate) ? <p role="alert" className="text-xs text-vx-danger">{t(`app.editor.brand.invalid.${name}`)}</p> : null;
}
export function BrandKitFields({ kit, set }) {
  const { t } = useI18n();
  const [tag, setTag] = useState('');
  const tagInvalid = tag !== '' && !/^#?[\p{L}\p{N}_]{1,60}$/u.test(tag);
  return <>
    <p className="text-xs font-bold">{t('app.editor.brand.fonts')}</p>
    {TEXT_FONTS.map(font => <label key={font} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" aria-label={t('app.editor.brand.font', { name: font })} checked={kit.fonts.includes(font)} onChange={e => set('fonts', e.target.checked ? [...kit.fonts, font] : kit.fonts.filter(v => v !== font))} />{font}</label>)}
    <BrandFieldError kit={kit} name="fonts" />
    <label className="block text-xs">{t('app.editor.brand.voice')}<textarea aria-label={t('app.editor.brand.voice')} className={brandField} rows={3} maxLength={500} value={kit.voice} onChange={e => set('voice', e.target.value)} /></label>
    <p className="text-xs text-vx-fg-muted">{kit.voice.length} / 500</p><BrandFieldError kit={kit} name="voice" />
    <div role="group" aria-label={t('app.editor.brand.hashtags')} className="space-y-2">
      <ul className="flex flex-wrap gap-2">{kit.hashtags.map((value, index) => <li key={index} className="flex items-center gap-1 rounded-xl border border-vx-border ps-2 text-xs">#{value}<Button type="button" className="min-h-11" size="sm" aria-label={t('app.editor.brand.removeHashtag', { tag: value })} onClick={() => set('hashtags', kit.hashtags.filter((_, i) => i !== index))}>×</Button></li>)}</ul>
      <label className="block text-xs">{t('app.editor.brand.hashtags')}<input aria-label={t('app.editor.brand.hashtags')} className={brandField} value={tag} onChange={e => setTag(e.target.value)} /></label>
      {tagInvalid && <p role="alert" className="text-xs text-vx-danger">{t('app.editor.brand.invalid.hashtags')}</p>}
      <Button type="button" className="min-h-11" size="sm" disabled={!tag || tagInvalid || kit.hashtags.length >= 30} onClick={() => { const value = tag.replace(/^#/, ''); if (!kit.hashtags.includes(value)) set('hashtags', [...kit.hashtags, value]); setTag(''); }}>{t('app.editor.brand.addHashtag')}</Button>
      <BrandFieldError kit={kit} name="hashtags" />
    </div>
  </>;
}

export function BrandPaletteFields({ kit, set }) {
  const { t } = useI18n();
  const known = new Set(BRAND_SWATCHES.map(s => s.hex));
  const has = hex => kit.palette.some(c => c.toLowerCase() === hex);
  // Colours saved before the swatch list (any hex) stay selectable, so nothing in a saved kit is lost.
  const options = [...BRAND_SWATCHES, ...kit.palette.filter(c => !known.has(c.toLowerCase())).map(hex => ({ id: 'custom', hex: hex.toLowerCase() }))];
  const toggle = hex => set('palette', has(hex) ? kit.palette.filter(c => c.toLowerCase() !== hex) : [...kit.palette, hex]);
  return <>
      <p className="text-xs font-bold">{t('app.editor.brand.palette')}</p>
      <p className="text-xs text-vx-fg-muted">{t('app.editor.brand.paletteHint', { max: 12 })}</p>
      <div role="group" aria-label={t('app.editor.brand.paletteLabel')} className="flex flex-wrap gap-2">
        {options.map(({ id, hex }) => {
          const on = has(hex);
          const name = id === 'custom' ? t('app.editor.brand.swatch.custom') : t(`app.editor.brand.swatch.${id}`);
          return <button key={hex} type="button" aria-pressed={on} aria-label={name} title={name}
            disabled={on && kit.palette.length <= 1 || !on && kit.palette.length >= 12}
            className={`grid size-11 place-items-center rounded-full border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-50 ${on ? 'border-vx-accent ring-2 ring-vx-accent' : 'border-vx-border'}`}
            style={{ background: hex }} onClick={() => toggle(hex)}>
            {on && <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" stroke={['#ffffff', '#facc15', '#32d6c5', '#22c55e'].includes(hex) ? '#000' : '#fff'}><path d="m5 12 5 5 9-10" /></svg>}
          </button>;
        })}
      </div>
      <BrandFieldError kit={kit} name="palette" />
  </>;
}
