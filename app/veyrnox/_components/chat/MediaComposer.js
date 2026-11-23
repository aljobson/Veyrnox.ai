'use client';
import { generationSourceState } from '../../../../lib/generationSourceSlots.mjs';
import { Icon } from '../Icon';
import BindingText, { BindingPolicyLink } from '../../../../components/BindingText';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { generationSlotKind, generationMimeTypes } from '../../../../lib/generationSourceSlots.mjs';
import { ERROR_COPY } from '../../_lib/createErrors';
import { mediaPromptIsMissing, outputDurationLabel, resolutionLabel, videoAudioLabelDiagnostic as videoAudioLabel } from '../../_lib/chatMedia';
import { sourceDurationLimit } from '../../_lib/modelPricing';
import { attachAccept } from '../../../../lib/createAttach.mjs';
import { DictateButton, EnhanceButton, appendSpoken } from '../PromptTools';
import { SourcePickers } from '../SourcePickers';
import { LibraryPicker } from '../LibraryPicker';
import { GENERATION_PROMPT_MAX } from '../../../../lib/generationPromptLimits.js';
import { SpeechSongNudge } from '../SpeechSongNudge';
import { MusicSunoControls } from '../music/MusicSunoControls';
import { capSunoText, sunoLimit } from '../music/musicSunoForm';
import { useState } from 'react';

const control = 'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-vx-border bg-vx-base px-3 text-xs font-semibold text-vx-fg-muted transition-colors hover:border-vx-accent hover:text-vx-fg focus-within:border-vx-accent focus-within:outline-solid focus-within:outline-2 focus-within:outline-vx-accent disabled:opacity-50';
function credits(t, locale, number) { return t(pluralKey(t, locale, 'app.chat.settings.credits', number), { count: locale === 'en' ? String(number) : number.toLocaleString(localeTag(locale)) }); }

function Chevron() {
  return <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>;
}

function SelectControl({ label, ariaLabel, testId, value, onChange, disabled, children }) {
  return (
    <label className={`${control} ${disabled ? 'opacity-50' : ''}`}>
      <span className="max-w-40 truncate text-vx-fg">{label}</span><Chevron />
      <select data-testid={testId} aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed">
        {children}
      </select>
    </label>
  );
}

function OutputFact({ children, title }) {
  return <span title={title} className={`${control} cursor-default hover:border-vx-border hover:text-vx-fg-muted`}>{children}</span>;
}

function ChatSunoComposer({ media, prompt, onPrompt }) {
  const { t, locale } = useI18n();
  const { model, availableModels, offerId, selectOffer, customMode, setCustom, custom, controls, updateControl, updateDraft, quote, busy, error, action, canAct, promptMax, loading, reload } = media;
  const [controlsOpen, setControlsOpen] = useState(false);
  if (loading) return <div aria-busy="true" className="space-y-3 px-3 py-4"><div className="vx-shimmer h-11 rounded-xl bg-vx-base"/><p className="text-sm text-vx-fg-muted">{t('app.music.suno.loadingPolicy')}</p></div>;
  if (error && !model) return <section role="alert" className="border-t border-vx-danger/30 bg-vx-danger/[0.06] px-3 py-3 text-sm text-vx-danger"><p>{tOr(t, `app.music.suno.err.${media.errorCode}`, error)}</p><button type="button" onClick={reload} className="mt-3 min-h-11 rounded-full border border-vx-danger px-4 font-bold">{t('app.music.suno.retry')}</button></section>;
  const titleMax = sunoLimit(model, 'title');
  const lyricsMax = sunoLimit(model, 'lyrics');
  const briefMax = customMode ? sunoLimit(model, 'styles') : promptMax;
  const brief = customMode && custom.loaded ? custom.draft.styles : prompt;
  const updateBrief = (value) => customMode ? updateDraft('styles', value) : onPrompt(value);
  const disabled = Boolean(busy);
  const errorCopy = error ? tOr(t, `app.music.suno.err.${media.errorCode}`, error) : '';
  const sendHintId = media.blockReason ? 'chat-music-send-hint' : undefined;

  return (
    <fieldset disabled={disabled} className="min-w-0">
      {customMode && custom.loaded ? <div className="space-y-3 border-b border-vx-border px-3 py-3">
        <label className="block text-sm font-bold text-vx-fg-body">
          <span className="flex items-center justify-between gap-3"><span>{t('app.music.suno.title')}</span><span aria-live="polite" className="font-vx-mono text-xs font-normal text-vx-fg-faint">{Array.from(custom.draft.title).length}/{titleMax}</span></span>
          <input value={custom.draft.title} onChange={(event) => updateDraft('title', capSunoText(event.target.value, titleMax))} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 focus-visible:ring-2 focus-visible:ring-vx-accent" />
        </label>
        {!controls.instrumental ? <label className="block text-sm font-bold text-vx-fg-body">
          <span className="flex items-center justify-between gap-3"><span>{t('app.music.suno.lyrics')}</span><span aria-live="polite" className="font-vx-mono text-xs font-normal text-vx-fg-faint">{Array.from(custom.draft.lyrics).length}/{lyricsMax}</span></span>
          <textarea value={custom.draft.lyrics} onChange={(event) => updateDraft('lyrics', capSunoText(event.target.value, lyricsMax))} rows={4} className="mt-2 w-full resize-y rounded-xl border border-vx-border bg-vx-base px-3 py-2 font-vx-mono text-sm focus-visible:ring-2 focus-visible:ring-vx-accent" />
        </label> : null}
        {!controls.instrumental ? <label className="flex min-h-11 items-start gap-3 text-sm text-vx-fg-body">
          <input type="checkbox" checked={controls.rightsConfirmed} onChange={(event) => updateControl('rightsConfirmed', event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-vx-accent" />
          <span>{t('app.music.suno.rights')}</span>
        </label> : null}
      </div> : null}

      {customMode && controlsOpen ? <div className="border-b border-vx-border bg-vx-panel px-3 py-4"><MusicSunoControls model={model} draft={custom.draft} updateDraft={updateDraft} controls={controls} updateControl={updateControl} compact showTextFields={false} showRights={false} /></div> : null}

      <div className="flex min-w-0 items-end gap-2 overflow-x-auto px-3 pt-3">
        <SelectControl label={model?.name || t('app.music.suno.offer')} ariaLabel={t('app.music.suno.offer')} value={offerId} onChange={selectOffer} disabled={customMode || disabled}>
          {availableModels.map((item) => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}</option>)}
        </SelectControl>
        <button type="button" role="switch" aria-checked={customMode} disabled={!availableModels.some((item) => item.generation_modes?.includes('custom'))} onClick={() => setCustom(!customMode)} className={`${control} min-h-11 aria-checked:border-vx-accent aria-checked:text-vx-accent`}>{t('app.music.suno.custom')}</button>
        <button type="button" role="switch" aria-checked={controls.instrumental} disabled={model?.instrumental_only} onClick={() => updateControl('instrumental', !controls.instrumental)} className={`${control} min-h-11 aria-checked:border-vx-accent aria-checked:text-vx-accent`}>{t('app.music.suno.instrumental')}</button>
        {customMode ? <button type="button" aria-expanded={controlsOpen} onClick={() => setControlsOpen((value) => !value)} className={`${control} min-h-11 text-vx-fg`}>{t('app.music.suno.controls')} <Chevron /></button> : null}
      </div>

      {customMode && !custom.loaded ? <div aria-busy={!custom.loadFailed} className="border-t border-vx-border px-3 py-3 text-sm text-vx-fg-muted">{custom.loadFailed ? <><p role="alert">{tOr(t, `app.music.suno.err.${custom.error}`, t('app.music.suno.err.unknown'))}</p><button type="button" onClick={custom.retry} className="mt-3 min-h-11 rounded-full border border-vx-border px-4 font-bold text-vx-fg">{t('app.music.suno.retry')}</button></> : t('app.music.suno.loadingDraft')}</div> : null}
      <div className="flex min-w-0 items-end gap-2 px-3 py-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t(customMode ? 'app.music.suno.style' : 'app.music.suno.brief')}</span>
          <textarea disabled={customMode && !custom.loaded} value={brief} onChange={(event) => updateBrief(capSunoText(event.target.value, briefMax))} rows={2} placeholder={t(customMode ? 'app.music.suno.stylePlaceholder' : 'app.music.suno.briefPlaceholder')} className="min-h-12 w-full resize-none rounded-2xl border border-vx-border-boost bg-vx-base px-4 py-3 text-sm text-vx-fg placeholder:text-vx-fg-faint focus-visible:ring-2 focus-visible:ring-vx-accent disabled:opacity-50" />
          <span aria-live="polite" className="mt-1 block text-end font-vx-mono text-xs text-vx-fg-faint">{Array.from(brief).length}/{briefMax}</span>
        </label>
        <DictateButton disabled={disabled} onText={(spoken) => updateBrief(capSunoText(appendSpoken(brief, spoken), briefMax))} />
        <button data-testid="chat-music-send" type="button" onClick={action} disabled={!canAct || disabled || !media.hasSharedSlot} aria-describedby={sendHintId} className="min-h-11 shrink-0 rounded-full bg-vx-accent px-4 text-sm font-semibold text-vx-accent-ink hover:bg-vx-accent-hover disabled:opacity-50">
          {busy === 'quoting' ? t('app.music.suno.quoting') : busy === 'confirming' ? t('app.music.suno.sending') : quote ? t('app.chat.workspace.send', { price: credits(t, locale, quote.total_credits) }) : t('app.music.suno.reviewPrice')}
        </button>
      </div>
      {media.blockReason ? <p id={sendHintId} role="status" className="border-t border-vx-border px-3 py-2 text-xs text-vx-fg-muted">{t(`app.music.suno.hint.${media.blockReason}`)}</p> : null}
      {custom.notice ? <p role="status" className="border-t border-vx-border px-3 py-2 text-xs text-vx-fg-muted">{t(`app.music.suno.${custom.notice}`)}</p> : null}
      {custom.previousText ? <div className="border-t border-vx-border px-3 py-2"><button type="button" onClick={custom.copyPreviousText} className="min-h-10 rounded-full border border-vx-accent px-4 text-xs font-bold">{t('app.music.suno.copyPreviousText')}</button></div> : null}
      {error ? <p role="alert" className="border-t border-vx-danger/30 bg-vx-danger/[0.06] px-3 py-2 text-sm text-vx-danger">{errorCopy}</p> : null}
    </fieldset>
  );
}

export function MediaComposer({ kind, media, prompt, onPrompt }) {
  const i18n = useI18n();
  if (media.suno) return <ChatSunoComposer media={media} prompt={prompt} onPrompt={onPrompt} />;
  const { t, locale } = i18n;
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
  const kindLabel = tOr(t, `app.editor.media.kind.${kind}`, kind);
  const {
    availableModels, model, selectModel, duration, setDuration, aspect, setAspect, count, setCount,
    audioDuration, setAudioDuration, audioDurationControl, invalidAudioDuration,
    resolution, setResolution, audio, setAudio,
    voice, setVoice, sources, pickSource, reorderSources, attachFromDevice, attachNotice, converting, attachConverting, sourceEpoch, setSourcesConverting, libraryFor, setLibraryFor, consent, setConsent,
    balance, cost, freeLeft, error, jobs, generating, sending, missingSource, missingConsent, missingVoice,
    generate, catalogLive,
  } = media;
  const busy = sending || generating;
  const durations = model?.durations?.length ? model.durations : [5];
  const aspects = model?.aspects || [];
  const { hasSource } = generationSourceState(model?.media, sources);
  const missingPrompt = mediaPromptIsMissing(model, prompt);
  const promptLimit = model?.promptMax || GENERATION_PROMPT_MAX;
  const promptLimitKey = promptLimit < GENERATION_PROMPT_MAX ? 'public.TemplateRecipe.promptTooLong' : 'public.TemplateRecipe.productPromptTooLong';
  const promptTooLong = prompt.trim().length > promptLimit;
  const canGenerate = catalogLive && model && !model.gated && !busy && !converting && !missingPrompt && !missingSource && !missingConsent
    && !promptTooLong && !missingVoice && !invalidAudioDuration && balance != null && cost <= balance;
  const resultReady = jobs.some((job) => job.state === 'succeeded');
  const errorCopy = error ? error.code === 'source_reattach_required' ? t('app.create.reattach') : tOr(t, `app.create.error.${error.code}`, ERROR_COPY[error.code] || t('app.chat.media.failed')) : '';
  const sourceDurationMax = sourceDurationLimit(model);
  const actualLength = sourceDurationMax ? t('app.chat.media.sourceLimit', { seconds: number(sourceDurationMax) })
    : model?.kind === 'video' ? outputDurationLabel(model, duration) : model?.presentation?.fixedDurationLabel;
  const placeholder = model?.isSpeech ? t("app.chat.media.speechPrompt")
    : kind === 'audio' ? t("app.chat.media.audioPrompt")
      : kind === 'image' ? t("app.chat.media.imagePrompt") : t("app.chat.media.videoPrompt");

  return (
    <>
      <fieldset disabled={busy} className="min-w-0">
        {model?.takesVoice && (
          <div className="px-3 pt-3">
            <label htmlFor="chat-media-voice" className="sr-only">{t("app.editor.generation.voiceDescription")}</label>
            <input id="chat-media-voice" value={voice} maxLength={500} onChange={(event) => setVoice(event.target.value)}
              placeholder={t("app.chat.media.voiceExample")}
              className="w-full rounded-lg bg-vx-base/60 px-3 py-2 text-sm text-vx-fg outline-hidden placeholder:text-vx-fg-faint" />
          </div>
        )}
        <div className="px-3 pt-3">
          <label className="sr-only" htmlFor="chat-media-prompt">{t("app.editor.generation.prompt")}</label>
          <textarea id="chat-media-prompt" rows={3} value={prompt} placeholder={placeholder}
            onChange={(event) => onPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canGenerate) generate(prompt); } }}
            className="max-h-56 min-h-[4.5rem] w-full resize-none bg-transparent px-1 py-1 text-[15px] text-vx-fg outline-hidden placeholder:text-vx-fg-faint" />
        </div>
        <SpeechSongNudge model={model} prompt={prompt} className="px-4 pb-2" />
        {promptTooLong && <p role="alert" className="px-4 pb-2 text-xs text-vx-danger">{t(promptLimitKey, { count: number(prompt.trim().length), max: number(promptLimit) })}</p>}
        <div className="flex items-center gap-2 border-t border-vx-border/60 bg-vx-base/40 px-2 py-2">
          {model && (
            <label className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-vx-fg-muted hover:text-vx-fg has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-vx-accent" title={t('app.create.attach.hint')}>
              <Icon name="paperclip" size={20} /><span className="sr-only">{t('app.create.attach.button')}</span>
              <input data-testid="chat-media-attach" type="file" multiple accept={attachAccept()} disabled={busy || converting} className="sr-only"
                onChange={(e) => { attachFromDevice(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1.5 overflow-x-auto" role="group" aria-label={t('app.chat.media.setup', { kind: kindLabel })}>
          {model ? (
            <SelectControl label={t('app.chat.media.modelPrice', { name: model.name, count: number(model.credits) })} ariaLabel={t('app.chat.media.model', { kind: kindLabel })} value={model.id} disabled={busy} onChange={selectModel}>
              {availableModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {credits(t, locale, item.credits)}</option>)}
            </SelectControl>
          ) : <OutputFact>{t('app.chat.media.noModels', { kind: kindLabel })}</OutputFact>}

          {model?.kind === 'video' && !sourceDurationMax && (
            <SelectControl label={actualLength} testId="chat-media-duration" ariaLabel={t("app.chat.media.videoDuration")} value={String(duration)} onChange={(value) => setDuration(Number(value))} disabled={busy || durations.length < 2}>
              {durations.map((seconds) => <option key={seconds} value={seconds}>{outputDurationLabel(model, seconds)}</option>)}
            </SelectControl>
          )}
          {sourceDurationMax && <OutputFact title={t("app.chat.media.sourceHelp")}>{actualLength}</OutputFact>}
          {model?.kind === 'audio' && audioDurationControl && (
            <label className={`${control} ${invalidAudioDuration ? 'border-vx-danger' : ''}`} title={t('app.chat.media.audioRange', { min: number(audioDurationControl.min), max: number(audioDurationControl.max) })}>
              <input data-testid="chat-media-audio-duration" aria-label={t("app.create.audioDuration")} type="number" inputMode="numeric" step="1"
                min={audioDurationControl.min} max={audioDurationControl.max} value={audioDuration}
                aria-invalid={invalidAudioDuration} onChange={(event) => setAudioDuration(event.target.value)}
                className="w-8 bg-transparent text-end font-vx-mono text-vx-fg outline-hidden" />
              <span>{t("app.create.seconds")}</span>
            </label>
          )}
          {aspects.length > 0 && (
            <SelectControl label={aspect} ariaLabel={t("label.Aspect ratio")} value={aspect || aspects[0]} onChange={setAspect} disabled={busy}>
              {aspects.map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectControl>
          )}
          {model?.kind === 'image' && (
            <SelectControl label={t(pluralKey(t, locale, 'app.chat.media.images', count), { count: number(count) })} ariaLabel={t("app.chat.media.imageCount")} value={String(count)} onChange={(value) => setCount(Number(value))} disabled={busy}>
              {[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectControl>
          )}
          {model?.resolutions?.length > 1 ? (
            <SelectControl label={resolutionLabel(model, resolution)} ariaLabel={t("app.chat.media.resolution")} value={resolution} onChange={setResolution} disabled={busy}>
              {model.resolutions.map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectControl>
          ) : model && model.kind !== 'audio' && <OutputFact title={t("app.chat.media.fixedResolution")}>{resolutionLabel(model)} {' '}{t("app.chat.media.fixed")}</OutputFact>}
          {model?.kind === 'video' && (model.audioOptions?.length > 1 ? (
            <button type="button" role="switch" aria-label={t("app.chat.media.generateAudio")} aria-checked={audio} disabled={busy}
              onClick={() => setAudio(!audio)} className={`${control} aria-checked:border-vx-accent aria-checked:text-vx-accent`}>
              <span className={`h-2 w-2 rounded-full ${audio ? 'bg-vx-accent' : 'bg-vx-fg-faint'}`} aria-hidden="true" />{helperCopy(t, locale, videoAudioLabel(model, audio))}
            </button>
          ) : <OutputFact title={t("app.chat.media.fixedAudio")}>{helperCopy(t, locale, videoAudioLabel(model))}</OutputFact>)}
          {model?.kind === 'audio' && actualLength && !sourceDurationMax && <OutputFact>{actualLength} {' '}{t("app.chat.media.output")}</OutputFact>}
        </div>
          <DictateButton disabled={busy} onText={(spoken) => onPrompt(appendSpoken(prompt, spoken))} />
          <EnhanceButton disabled={busy} text={prompt} />
          <button data-testid="chat-media-generate" type="button" onClick={() => generate(prompt)} disabled={!canGenerate}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-vx-accent px-4 text-sm font-semibold text-vx-accent-ink transition-colors hover:bg-vx-accent-hover disabled:opacity-50">
            {sending ? t("app.editor.sheet.starting") : generating ? t("app.chat.media.generating") : freeLeft > 0 && cost === 0 ? t("app.chat.media.free") : t('app.chat.media.generate', { cost: number(cost) })}
          </button>
        </div>

        {model?.kind === 'video' && (model.resolutions?.length || model.audioOptions?.length) > 0 && (
          <p className="px-4 py-2 text-xs text-vx-fg-muted">{t("app.chat.media.samePrice")}</p>
        )}
        {model?.kind === 'video' && !model.audioOptions?.length && availableModels.some((item) => !item.gated && item.audioOptions?.length > 1 && item.resolutions?.length > 1) && (
          <button type="button" disabled={busy} onClick={() => selectModel(availableModels.find((item) => !item.gated && item.audioOptions?.length > 1 && item.resolutions?.length > 1).id)}
            className="px-4 py-2 text-start text-xs text-vx-accent underline disabled:opacity-50">{t("app.chat.media.chooseControls")}</button>
        )}

        {attachNotice && (
          <p role="status" className="border-b border-vx-border px-4 py-2 text-xs text-vx-fg-muted">
            {attachNotice.converting ? t('app.create.convert.working') : attachNotice.unsupported ? t('app.create.attach.unsupported') : [
              attachNotice.failed && t(`app.create.convert.${attachNotice.failed}`),
              attachNotice.switched && t('app.create.attach.switched', { name: attachNotice.switched }),
              attachNotice.unused > 0 && t('app.create.attach.unused', { count: number(attachNotice.unused) }),
            ].filter(Boolean).join(' ')}
          </p>
        )}

        {model && Object.keys(model.media || {}).length > 0 && (
          <div className="border-b border-vx-border px-3 pb-3">
            <SourcePickers tokens={/@(Image|Video|Audio)\d/i.test(prompt)} media={model.media} sources={sources} onPick={pickSource} onConvertingChange={setSourcesConverting} resetKey={model.id} epochRef={sourceEpoch} locked={attachConverting} onReorder={reorderSources} onDraw={null} onLibrary={setLibraryFor} />
            {hasSource && (
              <BindingText id="mediaRights"  slots={{ policy: <BindingPolicyLink policy="aup" /> }}><label lang="en" dir="ltr" className="mt-2 flex items-start gap-2 text-xs text-vx-fg-muted">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 accent-vx-accent" />
                <span>I own these files or have permission to use every identifiable person, voice, brand, artwork, and recording under the <a href="/legal/aup" target="_blank" rel="noreferrer" className="text-vx-accent underline">Acceptable Use Policy</a>.</span>
              </label></BindingText>
            )}
          </div>
        )}

      </fieldset>

      <div className="border-t border-vx-border px-3 py-2 text-xs text-vx-fg-muted">
        {!catalogLive ? t("app.chat.media.noPricing")
          : !model ? t('app.chat.media.unavailable', { kind: kindLabel })
            : <><span className="font-vx-mono text-vx-money vx-num">{freeLeft > 0 && cost === 0 ? t("publish.plan.colFree") : credits(t, locale, cost)}</span> · {actualLength ? `${actualLength} · ` : ''}{aspect ? `${aspect} · ` : ''}{model.kind === 'audio' ? t("app.chat.media.audioOutput") : resolutionLabel(model, resolution)}{model.kind === 'video' ? ` · ${helperCopy(t, locale, videoAudioLabel(model, audio))}` : ''}{t("app.chat.media.refundHelp")}{resultReady ? t("app.chat.media.shownAbove") : ''}.</>}
      </div>

      {error && <p role="alert" className="border-t border-vx-danger/30 bg-vx-danger/[0.06] px-3 py-2 text-sm text-vx-danger">{errorCopy}{error.note ? ` ${error.note}` : ''}</p>}
      {libraryFor && (
        <LibraryPicker kind={generationSlotKind(libraryFor)} mimeTypes={generationMimeTypes(generationSlotKind(libraryFor))}
          onClose={() => setLibraryFor(null)} onPick={(item) => { pickSource(libraryFor, null, item); setLibraryFor(null); }} />
      )}
    </>
  );
}
