'use client';
import { generationSlotKind, generationMimeTypes } from '../../../../lib/generationSourceSlots.mjs';
import { ERROR_COPY } from '../../_lib/createErrors';
import { mediaPromptIsMissing, outputDurationLabel, resolutionLabel, videoAudioLabel } from '../../_lib/chatMedia';
import { sourceDurationLimit } from '../../_lib/modelPricing';
import { SourcePickers } from '../SourcePickers';
import { LibraryPicker } from '../LibraryPicker';

const control = 'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-vx-border bg-vx-base px-3 text-xs font-semibold text-vx-fg-muted transition-colors hover:border-vx-accent hover:text-vx-fg focus-within:border-vx-accent focus-within:outline-solid focus-within:outline-2 focus-within:outline-vx-accent disabled:opacity-50';
const credits = (number) => `${number} Credit${number === 1 ? '' : 's'}`;

function Chevron() {
  return <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>;
}

function SelectControl({ label, ariaLabel, value, onChange, disabled, children }) {
  return (
    <label className={`${control} ${disabled ? 'opacity-50' : ''}`}>
      <span className="max-w-40 truncate text-vx-fg">{label}</span><Chevron />
      <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed">
        {children}
      </select>
    </label>
  );
}

function OutputFact({ children, title }) {
  return <span title={title} className={`${control} cursor-default hover:border-vx-border hover:text-vx-fg-muted`}>{children}</span>;
}

export function MediaComposer({ kind, media, prompt, onPrompt }) {
  const {
    availableModels, model, selectModel, duration, setDuration, aspect, setAspect, count, setCount,
    audioDuration, setAudioDuration, audioDurationControl, invalidAudioDuration,
    resolution, setResolution, audio, setAudio,
    voice, setVoice, sources, pickSource, libraryFor, setLibraryFor, consent, setConsent,
    balance, cost, freeLeft, error, jobs, generating, sending, missingSource, missingConsent, missingVoice,
    generate, catalogLive,
  } = media;
  const busy = sending || generating;
  const durations = model?.durations?.length ? model.durations : [5];
  const aspects = model?.aspects || [];
  const hasSource = Object.values(sources).some(Boolean);
  const missingPrompt = mediaPromptIsMissing(model, prompt);
  const canGenerate = catalogLive && model && !model.gated && !busy && !missingPrompt && !missingSource && !missingConsent
    && !missingVoice && !invalidAudioDuration && balance != null && cost <= balance;
  const resultReady = jobs.some((job) => job.state === 'succeeded');
  const errorCopy = error ? (ERROR_COPY[error.code] || 'This generation could not start. Nothing was charged.') : '';
  const sourceDurationMax = sourceDurationLimit(model);
  const actualLength = sourceDurationMax ? `Source up to ${sourceDurationMax}s`
    : model?.kind === 'video' ? outputDurationLabel(model, duration) : model?.presentation?.fixedDurationLabel;
  const placeholder = model?.isSpeech ? 'Type the words you want spoken…'
    : kind === 'audio' ? 'Describe the sound, music, or speech…'
      : kind === 'image' ? 'Describe the image you want to create…' : 'Describe the shot you want to create…';

  return (
    <>
      <fieldset disabled={busy} className="min-w-0">
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto border-b border-vx-border px-3 py-2" role="group" aria-label={`${kind} generation setup`}>
          {model ? (
            <SelectControl label={`${model.name} · ${model.credits} cr`} ariaLabel={`${kind} model`} value={model.id} disabled={busy} onChange={selectModel}>
              {availableModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {credits(item.credits)}</option>)}
            </SelectControl>
          ) : <OutputFact>No {kind} models</OutputFact>}

          {model?.kind === 'video' && !sourceDurationMax && (
            <SelectControl label={actualLength} ariaLabel="Video duration" value={String(duration)} onChange={(value) => setDuration(Number(value))} disabled={busy || durations.length < 2}>
              {durations.map((seconds) => <option key={seconds} value={seconds}>{outputDurationLabel(model, seconds)}</option>)}
            </SelectControl>
          )}
          {sourceDurationMax && <OutputFact title="Follows your uploaded source at the displayed price">{actualLength}</OutputFact>}
          {model?.kind === 'audio' && audioDurationControl && (
            <label className={`${control} ${invalidAudioDuration ? 'border-vx-danger' : ''}`} title={`${audioDurationControl.min}–${audioDurationControl.max} seconds`}>
              <input aria-label="Audio duration in seconds" type="number" inputMode="numeric" step="1"
                min={audioDurationControl.min} max={audioDurationControl.max} value={audioDuration}
                aria-invalid={invalidAudioDuration} onChange={(event) => setAudioDuration(event.target.value)}
                className="w-8 bg-transparent text-right font-vx-mono text-vx-fg outline-hidden" />
              <span>seconds</span>
            </label>
          )}
          {aspects.length > 0 && (
            <SelectControl label={aspect} ariaLabel="Aspect ratio" value={aspect || aspects[0]} onChange={setAspect} disabled={busy}>
              {aspects.map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectControl>
          )}
          {model?.kind === 'image' && (
            <SelectControl label={`${count} image${count === 1 ? '' : 's'}`} ariaLabel="Number of images" value={String(count)} onChange={(value) => setCount(Number(value))} disabled={busy}>
              {[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectControl>
          )}
          {model?.resolutions?.length > 1 ? (
            <SelectControl label={resolutionLabel(model, resolution)} ariaLabel="Output resolution" value={resolution} onChange={setResolution} disabled={busy}>
              {model.resolutions.map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectControl>
          ) : model && model.kind !== 'audio' && <OutputFact title="This model offers one resolution at its displayed price.">{resolutionLabel(model)} fixed</OutputFact>}
          {model?.kind === 'video' && (model.audioOptions?.length > 1 ? (
            <button type="button" role="switch" aria-label="Generate video audio" aria-checked={audio} disabled={busy}
              onClick={() => setAudio(!audio)} className={`${control} aria-checked:border-vx-accent aria-checked:text-vx-accent`}>
              <span className={`h-2 w-2 rounded-full ${audio ? 'bg-vx-accent' : 'bg-vx-fg-faint'}`} aria-hidden="true" />{videoAudioLabel(model, audio)}
            </button>
          ) : <OutputFact title="Audio cannot be changed on this model at its displayed price.">{videoAudioLabel(model)}</OutputFact>)}
          {model?.kind === 'audio' && actualLength && !sourceDurationMax && <OutputFact>{actualLength} output</OutputFact>}
        </div>

        {model?.kind === 'video' && (model.resolutions?.length || model.audioOptions?.length) > 0 && (
          <p className="px-4 py-2 text-xs text-vx-fg-muted">These output choices are included at the same price.</p>
        )}
        {model?.kind === 'video' && !model.audioOptions?.length && availableModels.some((item) => !item.gated && item.audioOptions?.length > 1 && item.resolutions?.length > 1) && (
          <button type="button" disabled={busy} onClick={() => selectModel(availableModels.find((item) => !item.gated && item.audioOptions?.length > 1 && item.resolutions?.length > 1).id)}
            className="px-4 py-2 text-left text-xs text-vx-accent underline disabled:opacity-50">Choose a model with resolution and audio controls</button>
        )}

        {model && Object.keys(model.media || {}).length > 0 && (
          <div className="border-b border-vx-border px-3 pb-3">
            <SourcePickers media={model.media} sources={sources} onPick={pickSource} onDraw={null} onLibrary={setLibraryFor} />
            {hasSource && (
              <label className="mt-2 flex items-start gap-2 text-xs text-vx-fg-muted">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 accent-vx-accent" />
                <span>I own these files or have permission to use every identifiable person, voice, brand, artwork, and recording under the <a href="/legal/aup" target="_blank" rel="noreferrer" className="text-vx-accent underline">Acceptable Use Policy</a>.</span>
              </label>
            )}
          </div>
        )}

        {model?.takesVoice && (
          <div className="border-b border-vx-border px-3 py-2">
            <label htmlFor="chat-media-voice" className="sr-only">Voice description</label>
            <input id="chat-media-voice" value={voice} maxLength={500} onChange={(event) => setVoice(event.target.value)}
              placeholder="Describe the voice: age, accent, pace, tone…"
              className="w-full bg-transparent px-2 py-1.5 text-sm text-vx-fg outline-hidden placeholder:text-vx-fg-faint" />
          </div>
        )}

        <div className="flex items-end gap-2 px-2 pb-2">
          <label className="sr-only" htmlFor="chat-media-prompt">Generation prompt</label>
          <textarea id="chat-media-prompt" rows={1} value={prompt} maxLength={model?.promptMax || 2000} placeholder={placeholder}
            onChange={(event) => onPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canGenerate) generate(prompt); } }}
            className="max-h-48 min-h-14 min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-[15px] text-vx-fg outline-hidden placeholder:text-vx-fg-faint" />
          <button type="button" onClick={() => generate(prompt)} disabled={!canGenerate}
            className="mb-1 min-w-32 rounded-xl bg-vx-accent px-4 py-2.5 text-sm font-semibold text-vx-accent-ink transition-colors hover:bg-vx-accent-hover disabled:opacity-50">
            {sending ? 'Starting…' : generating ? 'Generating…' : freeLeft > 0 && cost === 0 ? 'Generate free' : `Generate · ${cost} cr`}
          </button>
        </div>
      </fieldset>

      <div className="border-t border-vx-border px-3 py-2 text-xs text-vx-fg-muted">
        {!catalogLive ? 'Live model pricing is unavailable, so generation is paused.'
          : !model ? `No ${kind} model is currently available.`
            : <><span className="font-vx-mono text-vx-money vx-num">{freeLeft > 0 && cost === 0 ? 'Free' : credits(cost)}</span> · {actualLength ? `${actualLength} · ` : ''}{aspect ? `${aspect} · ` : ''}{model.kind === 'audio' ? 'Audio output' : resolutionLabel(model, resolution)}{model.kind === 'video' ? ` · ${videoAudioLabel(model, audio)}` : ''}. Failed jobs return their Credits; finished media is saved to Library{resultReady ? ' and shown above' : ''}.</>}
      </div>

      {error && <p role="alert" className="border-t border-vx-danger/30 bg-vx-danger/[0.06] px-3 py-2 text-sm text-vx-danger">{errorCopy}{error.note ? ` ${error.note}` : ''}</p>}
      {libraryFor && (
        <LibraryPicker kind={generationSlotKind(libraryFor)} mimeTypes={generationMimeTypes(generationSlotKind(libraryFor))}
          onClose={() => setLibraryFor(null)} onPick={(item) => { pickSource(libraryFor, null, item); setLibraryFor(null); }} />
      )}
    </>
  );
}
