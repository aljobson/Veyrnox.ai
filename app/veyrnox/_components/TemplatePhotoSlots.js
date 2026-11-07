'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { TEMPLATE_IMAGE_ACCEPT, templateImageFileError } from '../_lib/templateMediaHandoff';
import { prepareUpload } from '../_lib/uploadConvert.mjs';

// Fixed positions: removing Photo 2 never moves Photo 3 into its place.
export function TemplatePhotoSlots({ count, hints = [], files, onChange, onBusy, locked = false }) {
  const { t } = useI18n();
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState({});
  const runs = useRef({});
  const reportBusy = useRef(onBusy);
  useEffect(() => () => {
    for (const index of Object.keys(runs.current)) reportBusy.current(Number(index), false);
    runs.current = {};
  }, []);
  async function pick(index, file) {
    const run = {};
    runs.current[index] = run;
    const current = () => runs.current[index] === run;
    setErrors(previous => ({ ...previous, [index]: '' }));
    onChange(index, null);
    if (!file) return;
    setBusy(previous => ({ ...previous, [index]: true }));
    onBusy(index, true);
    try {
      if (templateImageFileError(file)) throw new Error('presets.use.photoInvalid');
      const ready = await prepareUpload(file);
      if (!current()) return;
      if (templateImageFileError(ready)) throw new Error('presets.use.photoInvalid');
      let bitmap, small = false;
      try { bitmap = await createImageBitmap(ready); small = Math.min(bitmap.width, bitmap.height) < 256; }
      catch { /* Decode failure: server media inspection decides. */ }
      finally { bitmap?.close(); }
      if (small) throw new Error('presets.fidelity.photoMinimum');
      if (current()) onChange(index, ready);
    } catch (error) {
      if (current()) setErrors(previous => ({ ...previous, [index]: error.message === 'presets.fidelity.photoMinimum' ? error.message : 'presets.use.photoInvalid' }));
    } finally {
      if (current()) { setBusy(previous => ({ ...previous, [index]: false })); onBusy(index, false); }
    }
  }
  return <fieldset className="mt-4 space-y-4 rounded-2xl border border-vx-border p-4">
    <legend className="px-2 font-bold">{t('presets.fidelity.orderedPhotos', { count })}</legend>
    {Array.from({ length: count }, (_, index) => {
      const label = t('presets.fidelity.photoSlot', { number: index + 1 });
      const file = files[index];
      return <div key={index} className="space-y-2 rounded-xl bg-vx-panel p-4">
        <p className="font-bold">{label}</p>
        {hints[index] && <p className="text-sm text-vx-fg-muted" dir="auto">{hints[index]}</p>}
        <p role="status" className="text-sm text-vx-fg-muted">{busy[index] ? t('presets.use.photoPreparing') : file?.name || (file ? t('presets.fidelity.photoReady') : t('presets.use.photoHint'))}</p>
        <div className="flex flex-wrap gap-2">
          <label className="relative inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-vx-accent px-4 text-vx-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-vx-accent">
            {t(file ? 'presets.use.photoReplace' : 'presets.use.photoChoose')}
            <input type="file" aria-required="true" accept={TEMPLATE_IMAGE_ACCEPT} disabled={locked || busy[index]} aria-label={`${label}: ${t(file ? 'presets.use.photoReplace' : 'presets.use.photoChoose')}`} className="absolute inset-0 h-full w-full opacity-0" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void pick(index, selected); }} />
          </label>
          {file && <button type="button" disabled={locked || busy[index]} aria-label={`${label}: ${t('presets.use.photoRemove')}`} className="min-h-11 rounded-xl px-4 text-vx-fg focus-visible:outline-2 focus-visible:outline-vx-accent" onClick={() => void pick(index, null)}>{t('presets.use.photoRemove')}</button>}
        </div>
        {errors[index] && <p role="alert" className="text-sm text-vx-danger">{t(errors[index])}</p>}
      </div>;
    })}
    {Array.from({ length: count }, (_, index) => files[index]).some(file => !file) && <p role="status" className="text-sm text-vx-fg-muted">{t('presets.fidelity.photosRequired', { count })}</p>}
  </fieldset>;
}
