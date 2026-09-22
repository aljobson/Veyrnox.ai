'use client';
import { CAMERAS, LENSES, FOCAL_LENGTHS, APERTURES } from '../_lib/cinema';

const FIELDS = [
  { key: 'camera', label: 'Camera', options: Object.keys(CAMERAS) },
  { key: 'lens', label: 'Lens', options: Object.keys(LENSES) },
  { key: 'focal', label: 'Focal length', options: Object.keys(FOCAL_LENGTHS).map(Number), suffix: 'mm' },
  { key: 'aperture', label: 'Aperture', options: Object.keys(APERTURES) },
];

// Cinema controls for the create page. Off by default; when on, the page
// appends cinemaSuffix(settings) to the prompt it sends.
export function CameraPanel({ enabled, onToggle, settings, onChange }) {
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex items-center justify-between">
        <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">CINEMA CAMERA</span>
        <button
          onClick={() => onToggle(!enabled)}
          aria-pressed={enabled}
          className={`font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border ${
            enabled ? 'border-vx-accent text-vx-accent bg-vx-accent/[0.07]' : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
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
                className="bg-vx-base border border-vx-border rounded-lg px-2 py-1.5 text-xs text-vx-fg focus:outline-none focus:border-vx-accent"
              >
                {f.options.map((o) => <option key={o} value={o}>{o}{f.suffix || ''}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
