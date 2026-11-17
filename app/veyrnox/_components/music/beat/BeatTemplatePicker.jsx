'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import { BEAT_TEMPLATES } from '../../../_lib/music/beat/beatTemplates.mjs';
import { button } from './beatStyles';
export default function BeatTemplatePicker({ choose, disabled, focusBlank = false }) {
  const { t } = useI18n();
  return <div role="group" aria-label={t('app.music.beat.templates')} className="mt-4 grid gap-3 sm:grid-cols-2">
    {BEAT_TEMPLATES.map(item => <button key={item.id} autoFocus={focusBlank && item.id === 'blank'} className={`${button} min-w-0 text-start`} disabled={disabled} onClick={() => choose(item.id)}>
      <span className="block">{t(item.nameKey)}</span><span className="mt-1 block font-normal">{t(item.descriptionKey)}</span>
    </button>)}
  </div>;
}
