'use client';
import { useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { speechContractFor, voiceGenderOptions } from '../_lib/textToSpeech';

export function QwenSpeechControls({ settings, onSettings, disabled }) {
  const { t } = useI18n();
  const [gender, setGender] = useState('all');
  const contract = speechContractFor('qwen3-tts');
  return <section className="mt-4 rounded-2xl border border-vx-border bg-vx-panel p-4">
    <label className="block text-sm text-vx-fg">
      {t('app.audio.qwen.voices', { count: contract.voices.length })}
      <select aria-label={t('app.audio.qwen.filter')} disabled={disabled} value={gender} onChange={event => setGender(event.target.value)} className="mx-4 min-h-11 rounded-xl border border-vx-border bg-vx-base px-3 focus-visible:outline-vx-accent">
        <option value="all">{t('app.audio.qwen.all')}</option>
        {voiceGenderOptions(contract.voices).map(value => <option key={value} value={value}>{t(`app.audio.voice.gender.${value}`)}</option>)}
      </select>
    </label>
    <div role="group" aria-label={t('app.audio.qwen.voices', { count: contract.voices.length })} className="mt-4 flex flex-wrap gap-2">
      {contract.voices.filter(voice => gender === 'all' || voice.gender === gender).map(voice => <button key={voice.id} type="button" disabled={disabled} aria-pressed={settings.voice === voice.id} onClick={() => onSettings({ ...settings, voice: voice.id })} className="min-h-11 rounded-xl border border-vx-border px-3 text-sm text-vx-fg aria-pressed:border-vx-accent aria-pressed:text-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent disabled:opacity-50">
        {voice.label} · {t(`app.audio.voice.gender.${voice.gender}`)}
      </button>)}
    </div>
  </section>;
}
