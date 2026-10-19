'use client';
import { useI18n } from '../../../components/I18nProvider';

import { VOICE_MAX } from '../_lib/generationSettings';

// The voice, in words, for speech models whose capability record declares
// `voice_description` (catalog `capabilities.inputs`); it is required there.
// The gateway checks it again against the same record, so this is a form, not
// a guard. Words only, never a recording: the Acceptable Use page forbids
// copying a real person's voice.

export function VoiceDescription({ value, onChange }) {
  const { t } = useI18n();
  return (
    <div className="mt-3">
      <label htmlFor="vx-voice" className="block font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">
        {t("app.oddlings.voice")}<span aria-hidden="true">{t("app.create.voice.required")}</span>
      </label>
      <textarea
        id="vx-voice"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={VOICE_MAX}
        rows={2}
        aria-required="true"
        aria-describedby="vx-voice-help"
        className="mt-1.5 w-full bg-vx-panel border border-vx-field rounded-lg p-3.5 text-sm text-vx-fg placeholder:text-vx-fg-faint resize-none focus:outline-hidden focus:border-vx-accent"
        placeholder={t("app.create.voice.example")}
      />
      <p id="vx-voice-help" className="mt-1.5 text-xs text-vx-fg-muted">
        {t("app.create.voice.help")}</p>
    </div>
  );
}
