'use client';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../components/I18nProvider';

import { CAMERAS, LENSES, FOCAL_LENGTHS, APERTURES } from '../_lib/cinema';


// Cinema controls for the create page. Off by default; when on, the page
// appends cinemaSuffix(settings) to the prompt it sends.
export function CameraPanel({ enabled, onToggle, settings, onChange }) {
  const { t, locale } = useI18n();
  const FIELDS = [
    { key: 'camera', label: t("app.create.camera.camera"), options: Object.keys(CAMERAS) },
    { key: 'lens', label: t("app.create.camera.lens"), options: Object.keys(LENSES) },
    { key: 'focal', label: t("app.create.camera.focal"), options: Object.keys(FOCAL_LENGTHS).map(Number), suffix: 'mm' },
    { key: 'aperture', label: t("app.create.camera.aperture"), options: Object.keys(APERTURES) },
  ];

  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex items-center justify-between">
        <span id="vx-camera-title" className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.camera.title")}</span>
        {/* Named "Cinema camera ON", not just "ON": the heading is part of the name. */}
        <button
          id="vx-camera-switch"
          aria-labelledby="vx-camera-title vx-camera-switch"
          onClick={() => onToggle(!enabled)}
          aria-pressed={enabled}
          className={`font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border ${
            enabled ? 'border-vx-accent text-vx-accent bg-vx-accent/[0.07]' : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'
          }`}
        >
          {enabled ? t("app.create.character.on") : t("app.create.camera.off")}
        </button>
      </div>
      {enabled && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-fg-faint uppercase">{f.label}</span>
              <select
                value={settings[f.key]}
                onChange={(e) => onChange({ ...settings, [f.key]: f.key === 'focal' ? Number(e.target.value) : e.target.value })}
                className="bg-vx-base border border-vx-field rounded-lg px-2 py-1.5 text-xs text-vx-fg focus:outline-hidden focus:border-vx-accent"
              >
                {f.options.map((o) => <option key={o} value={o}>{locale === 'en' || typeof o !== 'number' ? o : o.toLocaleString(localeTag(locale))}{f.suffix || ''}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
