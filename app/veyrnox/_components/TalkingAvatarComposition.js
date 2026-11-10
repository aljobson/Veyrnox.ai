'use client';

import {
  TALKING_AVATAR_BACKGROUND_MAX_BYTES,
  TALKING_AVATAR_POSITIONS,
  TALKING_AVATAR_SHAPES,
  validateTalkingAvatarBackground,
} from '../_lib/talkingAvatarComposition';

const card = 'rounded-2xl border border-vx-border bg-vx-panel';
const CAPTION_PRESETS = ['simple', 'plain', 'glass', 'whisper', 'backdrop', 'corpo', 'handwritten', 'terminal'];

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-left disabled:opacity-40">
      <span className="text-sm font-bold">{label}</span>
      <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-vx-accent' : 'bg-vx-border'}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

export function TalkingAvatarComposition({
  settings,
  onSettings,
  background,
  onBackground,
  disabled,
  subtitlesAvailable,
  showPictureInPicture = true,
  eyebrow = 'LAYOUT & ACCESSIBILITY',
  title = 'Plan subtitles and picture-in-picture',
  description = 'Burned subtitles use a separately refunded render. Picture-in-picture is composed locally after the performance succeeds, with no additional credit charge or upload.',
}) {
  function pickBackground(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    onBackground(file, validateTalkingAvatarBackground(file));
  }

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="talking-avatar-composition-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{eyebrow}</p>
          <h2 id="talking-avatar-composition-title" className="mt-1 text-lg font-black">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-vx-fg-muted">{description}</p>
        </div>
        <span className="rounded-full border border-vx-money/40 bg-vx-money/[0.06] px-3 py-1.5 font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-money">{showPictureInPicture ? 'Subtitles + local PIP' : 'Burned subtitles'}</span>
      </div>

      {settings.subtitles && (
        <label className="mt-3 block rounded-xl border border-vx-border bg-vx-base p-4 text-xs font-extrabold">Subtitle style
          <select value={settings.captionPreset || 'simple'} disabled={disabled || !subtitlesAvailable} onChange={(event) => onSettings({ ...settings, captionPreset: event.target.value })} className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm text-vx-fg">
            {CAPTION_PRESETS.map((preset) => <option key={preset} value={preset}>{preset[0].toUpperCase() + preset.slice(1)}</option>)}
          </select>
          {!subtitlesAvailable && <span className="mt-2 block font-normal text-vx-fg-muted">The live caption renderer is unavailable in this environment.</span>}
        </label>
      )}

      <div className={`mt-4 grid gap-3 ${showPictureInPicture ? 'sm:grid-cols-2' : ''}`}>
        <Toggle label="Enable subtitles" checked={settings.subtitles} disabled={disabled} onChange={(subtitles) => onSettings({ ...settings, subtitles })} />
        {showPictureInPicture && <Toggle label="Picture-in-picture" checked={settings.pictureInPicture} disabled={disabled} onChange={(pictureInPicture) => onSettings({ ...settings, pictureInPicture })} />}
      </div>

      {showPictureInPicture && settings.pictureInPicture && (
        <div className="mt-4 space-y-4 rounded-xl border border-vx-border bg-vx-base p-4">
          <div>
            <p className="text-xs font-extrabold">Background video <span className="text-vx-danger">*</span></p>
            <label className={`mt-2 flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-vx-border px-4 py-3 text-center transition-colors hover:border-vx-accent ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
              <span className="text-sm font-bold">{background?.name || 'Upload a background video'}</span>
              <span className="mt-1 text-[11px] text-vx-fg-muted">MP4, MOV or WebM · Max {Math.round(TALKING_AVATAR_BACKGROUND_MAX_BYTES / 1024 / 1024)} MB</span>
              <input type="file" className="sr-only" accept="video/mp4,video/quicktime,video/webm" disabled={disabled} onChange={pickBackground} />
            </label>
          </div>

          <fieldset>
            <legend className="text-xs font-extrabold">Narration source</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[
                { id: 'background', label: 'Background video audio', description: 'Use its original sound' },
                { id: 'speech', label: 'Content entered above', description: 'Script, audio or recording' },
              ].map((item) => (
                <button key={item.id} type="button" disabled={disabled} aria-pressed={settings.narration === item.id} onClick={() => onSettings({ ...settings, narration: item.id })} className="rounded-xl border border-vx-border p-3 text-left aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07] disabled:opacity-40">
                  <span className="block text-xs font-black">{item.label}</span>
                  <span className="mt-1 block text-[11px] text-vx-fg-muted">{item.description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-extrabold">Position</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TALKING_AVATAR_POSITIONS.map((item) => <button key={item.id} type="button" disabled={disabled} aria-pressed={settings.position === item.id} onClick={() => onSettings({ ...settings, position: item.id })} className="rounded-xl border border-vx-border px-3 py-2 text-xs font-bold aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07] disabled:opacity-40">{item.label}</button>)}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-extrabold">Shape</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {TALKING_AVATAR_SHAPES.map((item) => <button key={item.id} type="button" disabled={disabled} aria-pressed={settings.shape === item.id} onClick={() => onSettings({ ...settings, shape: item.id })} className="rounded-xl border border-vx-border p-3 text-left aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07] disabled:opacity-40"><span className="block text-xs font-black">{item.label}</span><span className="mt-1 block text-[11px] text-vx-fg-muted">{item.description}</span></button>)}
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}

const positionClass = {
  'top-left': 'left-4 top-4',
  'top-right': 'right-4 top-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'bottom-4 right-4',
};

export function TalkingAvatarCompositionPreview({ settings, background, visual, script }) {
  if (!settings.subtitles && !settings.pictureInPicture) return null;
  const previewText = String(script || '').trim() || 'Your subtitle preview appears here.';
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Talking avatar composition preview">
      {settings.pictureInPicture && background?.previewUrl && <video src={background.previewUrl} muted loop autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />}
      {settings.pictureInPicture && (
        <div className={`absolute ${positionClass[settings.position]} ${settings.shape === 'circle' ? 'h-24 w-24 overflow-hidden rounded-full' : 'h-28 w-20 overflow-hidden rounded-xl'} border-2 border-white/80 bg-vx-panel shadow-2xl`}>
          {visual ? <img src={visual.previewUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center px-2 text-center text-[9px] font-bold text-white/65">AVATAR</span>}
        </div>
      )}
      {settings.subtitles && <div className="absolute inset-x-5 bottom-4 flex justify-center"><span className="max-w-[90%] rounded-lg bg-black/80 px-3 py-2 text-center text-xs font-bold leading-5 text-white shadow-xl">{previewText.slice(0, 110)}</span></div>}
    </div>
  );
}
