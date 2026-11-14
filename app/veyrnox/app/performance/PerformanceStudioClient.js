'use client';

import { PromptBox } from '../../_components/PromptBox';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppNav } from '../../_components/NavBar';
import { Button } from '../../_components/Button';
import { Chip } from '../../_components/Chip';
import { JobAssetPreview } from '../../_components/JobAssetPreview';
import { DownloadAsset } from '../../_components/DownloadAsset';
import { OutputFileDisclosure } from '../../_components/OutputFileDisclosure';
import { SavePerformanceProject } from '../../_components/SavePerformanceProject';
import { takePerformanceProjectHandoff } from '../../../../lib/performanceProjectSnapshot';
import { LibraryPicker } from '../../_components/LibraryPicker';
import { AudioReferenceShelf } from '../../_components/AudioReferenceShelf';
import { TextToSpeechControls } from '../../_components/TextToSpeechControls';
import { VoiceRecipeLibrary } from '../../_components/VoiceRecipeLibrary';
import { voiceRecipesMatch } from '../../_lib/voicePalettes';
import { TalkingAvatarComposition, TalkingAvatarCompositionPreview } from '../../_components/TalkingAvatarComposition';
import { LocalPipExport } from '../../_components/LocalPipExport';
import { SubtitleTranscriptEditor } from '../../_components/SubtitleTranscriptEditor';
import { DubbingLocalePlanner } from '../../_components/DubbingLocalePlanner';
import { useCatalog } from '../../_lib/useCatalog';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import { ERROR_COPY, failedJobCopy } from '../../_lib/createErrors';
import { gatewayFetch, GatewayError, makeIdempotencyKey, notifyBalanceChanged } from '../../_lib/gateway';
import { pushJobHistory } from '../../_lib/jobHistory';
import { jobStateUi } from '../../_lib/studioStates';
import {
  DEFAULT_TTS_MODEL_ID,
  LIP_SYNC_ENGINE_CONTRACTS,
  LONG_FORM_SYNC_MODES,
  PERFORMANCE_WORKFLOWS,
  TALKING_PHOTO_MODEL_CONTRACTS,
  VIDEO_LIP_SYNC_MODEL_CONTRACTS,
  availablePerformanceModels,
  encodeAudioBufferAsWav,
  estimatedSpeechSeconds,
  knownAudioTooLong,
  performanceQuote,
  lipSyncEngineContract,
  sourceAccept,
  sourceHint,
  speechSourcesFor,
  workflowById,
} from '../../_lib/performanceStudio';
import { enablePerformancePreview, usePerformancePreview } from '../../_lib/usePerformancePreview';
import { recipeForDestination } from '../../_lib/creationRecipes';
import { readAvatarProfiles } from '../../_lib/avatarProfiles';
import { DEFAULT_TTS_SETTINGS, TTS_LANGUAGES, TTS_VOICES, ttsGenerationInputs } from '../../_lib/textToSpeech';
import { DEFAULT_TALKING_AVATAR_COMPOSITION, talkingAvatarCompositionStatus } from '../../_lib/talkingAvatarComposition';
import { readPerformanceDraft } from '../../_lib/performanceDraft';
import { readDubbingDraft } from '../../_lib/dubbingDraft';
import { dubbingBatchQuote, dubbingLocaleRetryQuote, normalizeDubbingBatch } from '../../_lib/dubbingBatch';
import { TALKING_PHOTO_SAMPLES, talkingPhotoSampleById } from '../../_lib/talkingPhotoSamples';
import { readDialogueDubbingHandoff } from '../../_lib/dialogueDubbingHandoff';

const card = 'rounded-2xl border border-vx-border bg-vx-panel';
const input = 'w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden';

function gatewayError(error) {
  if (error instanceof GatewayError) {
    return { code: error.code || 'gateway_error', retryAfter: error.retryAfter };
  }
  return { code: 'internal' };
}

function FilePreview({ source, kind }) {
  if (!source) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-vx-border bg-vx-base px-6 text-center text-sm text-vx-fg-muted">
        Your source preview appears here.
      </div>
    );
  }
  if (kind === 'video') {
    return <video src={source.previewUrl} controls playsInline className="aspect-video w-full rounded-xl bg-black object-contain" />;
  }
  return <img src={source.previewUrl} alt={source.alt || 'Source artwork preview'} className="aspect-video w-full rounded-xl bg-black object-contain" />;
}

function TalkingPhotoSamples({ selectedId, loadingId, onSelect, disabled }) {
  return (
    <div className="mt-4 border-t border-vx-border pt-4" aria-labelledby="talking-photo-samples-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-accent">FICTIONAL STARTERS</p>
          <h3 id="talking-photo-samples-title" className="mt-1 text-sm font-black">Choose a Veyrnox.ai-original portrait</h3>
        </div>
        <p className="max-w-sm text-[10px] leading-4 text-vx-fg-muted">Original fictional adults · no competitor media · selecting costs nothing</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" role="list" aria-label="Fictional talking-photo portraits">
        {TALKING_PHOTO_SAMPLES.map((sample) => {
          const selected = sample.id === selectedId;
          const loading = sample.id === loadingId;
          return (
            <div key={sample.id} role="listitem">
              <button type="button" disabled={disabled} aria-pressed={selected} onClick={() => onSelect(sample.id)} className="group h-full w-full overflow-hidden rounded-xl border border-vx-border bg-vx-base text-left transition-colors hover:border-vx-accent disabled:opacity-45 aria-pressed:border-vx-accent aria-pressed:ring-2 aria-pressed:ring-vx-accent/25">
                <img src={sample.src} alt={sample.alt} width="1254" height="1254" className="aspect-square w-full object-cover" />
                <span className="block px-3 py-2.5">
                  <span className="flex items-center justify-between gap-2 text-xs font-black"><span>{sample.name}</span><span className="font-vx-mono text-[9px] text-vx-accent">{loading ? 'LOADING' : selected ? 'SELECTED' : 'USE'}</span></span>
                  <span className="mt-0.5 block text-[10px] text-vx-fg-muted">{sample.role}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceCard({ workflow, source, onPick, onLibrary, onSample, sampleLoadingId, disabled }) {
  const isCartoon = workflow.id === 'talking-cartoon';
  const isAnimal = workflow.id === 'talking-animal';
  const isBabyPodcast = workflow.id === 'baby-podcast';
  const isObject = workflow.id === 'talking-object';
  const isProductPresenter = workflow.id === 'product-presenter';
  const portraitCreatorHref = isProductPresenter
    ? '/app/create?recipe=product-presenter'
    : (isBabyPodcast || isObject || isAnimal || isCartoon)
      ? '/app/oddlings?recipe=synthetic-avatar'
      : '/app/create?recipe=synthetic-avatar';
  const title = workflow.sourceKind === 'video' ? 'Source video' : workflow.id === 'singing-photo' ? 'Performer portrait' : isProductPresenter ? 'Approved product composite' : isBabyPodcast ? 'Synthetic baby character' : isObject ? 'Object character' : isCartoon ? 'Character artwork' : isAnimal ? 'Pet or animal image' : 'Portrait';
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="performance-source-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">STEP 1</p>
          <h2 id="performance-source-title" className="mt-1 text-lg font-black">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-vx-fg-muted">{sourceHint(workflow)}</p>
        </div>
        {source && <Chip tone="accent">Ready</Chip>}
      </div>
      <div className="mt-4">
        <FilePreview source={source} kind={workflow.sourceKind} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <label className={`inline-flex min-h-10 cursor-pointer items-center rounded-full border border-vx-border px-4 py-2 text-xs font-bold transition-colors hover:border-vx-accent ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
          {source ? 'Upload another' : `Upload ${workflow.sourceKind}`}
          <input
            type="file"
            className="sr-only"
            accept={sourceAccept(workflow)}
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.target.value = '';
              if (file) onPick(file);
            }}
          />
        </label>
        <button type="button" disabled={disabled} onClick={onLibrary} className="min-h-10 rounded-full border border-vx-border px-4 py-2 text-xs font-bold transition-colors hover:border-vx-accent disabled:opacity-40">From Library</button>
        {workflow.sourceKind === 'image' && (
          <>
            <Link href={portraitCreatorHref} className="inline-flex min-h-10 items-center rounded-full border border-vx-border px-4 py-2 text-xs font-bold transition-colors hover:border-vx-accent">{isBabyPodcast ? 'Create synthetic character' : isProductPresenter ? 'Create product composite' : isObject ? 'Create object character' : isAnimal ? 'Create animal character' : isCartoon ? 'Create character' : 'Create portrait'}</Link>
          </>
        )}
      </div>
      {workflow.id === 'talking-photo' && (
        <TalkingPhotoSamples selectedId={source?.sampleId || null} loadingId={sampleLoadingId} onSelect={onSample} disabled={disabled} />
      )}
      {workflow.id === 'singing-photo' && (
        <p className="mt-3 text-xs leading-5 text-vx-fg-muted">Current Veyrnox.ai rendering supports one portrait and one cleared song clip up to 10 seconds. Multi-scene and full-song rendering are not offered yet.</p>
      )}
      {workflow.id === 'video-dubbing' && (
        <p className="mt-3 text-xs leading-5 text-vx-fg-muted">This workflow accepts one MP4 with a visible speaker, up to {workflow.maxSeconds} seconds with the selected engine. It creates one reviewed locale version per render.</p>
      )}
      {isProductPresenter && (
        <div className="mt-3 rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-xs leading-5 text-vx-fg-muted">
          <p className="font-bold text-vx-fg-body">Approved composite only</p>
          <p className="mt-1">Use the finished presenter-and-product image—not the two separate references. This renderer adds speech for up to 10 seconds; it does not recomposite the product or guarantee hand motion.</p>
        </div>
      )}
      {isCartoon && (
        <div className="mt-3 rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-xs leading-5 text-vx-fg-muted">
          <p className="font-bold text-vx-fg-body">Experimental artwork compatibility</p>
          <p className="mt-1">Use one front-facing character with a clearly drawn mouth. The current renderer supports a 10-second talking-character clip; subtitles, picture-in-picture, multi-character scenes and guaranteed body motion are not offered here.</p>
        </div>
      )}
      {isAnimal && (
        <div className="mt-3 rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-xs leading-5 text-vx-fg-muted">
          <p className="font-bold text-vx-fg-body">Experimental animal compatibility</p>
          <p className="mt-1">Use one animal with a clearly visible, front-facing head and mouth. The current renderer supports a 10-second talking-animal clip; video input, subtitles, picture-in-picture and guaranteed full-body motion are not offered here.</p>
        </div>
      )}
      {isObject && (
        <div className="mt-3 rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-xs leading-5 text-vx-fg-muted">
          <p className="font-bold text-vx-fg-body">Experimental object compatibility</p>
          <p className="mt-1">Use one product, food item, toy, package or everyday object with a clearly designed face and visible mouth. The current renderer supports a 10-second talking-object clip; subtitles, picture-in-picture, guaranteed full-body motion and object physics are not offered here.</p>
        </div>
      )}
      {isBabyPodcast && (
        <div className="mt-3 rounded-xl border border-vx-danger/35 bg-vx-danger/[0.05] px-4 py-3 text-xs leading-5 text-vx-fg-muted">
          <p className="font-bold text-vx-fg-body">Synthetic-only child safety boundary</p>
          <p className="mt-1">Use a fully generated or illustrated baby character—not a photograph, scan or likeness of a real child. Do not upload a child&apos;s voice. The current renderer supports one 10-second clip; captions and picture-in-picture are not offered here.</p>
        </div>
      )}
    </section>
  );
}

function AvatarPassportPicker({ profiles, selectedId, requestedMissing, onSelect, disabled }) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const visibleProfiles = normalized
    ? profiles.filter((profile) => [profile.name, profile.role, profile.canon].some((value) => String(value || '').toLowerCase().includes(normalized)))
    : profiles;

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="avatar-passports-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">SAVED AVATAR</p>
          <h2 id="avatar-passports-title" className="mt-1 text-lg font-black">Reuse an identity passport</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-vx-fg-muted">Bring the avatar&apos;s name, role, identity canon, latest-look brief, stock voice and linked owned portrait into this performance. The passport stores only the portrait&apos;s Library job ID—never pixels or a temporary signed URL. If no portrait is linked, choose one from Library or upload it below.</p>
        </div>
        <Link href="/app/create?recipe=synthetic-avatar" className="text-xs font-black text-vx-accent underline underline-offset-4">Create avatar</Link>
      </div>

      {requestedMissing && <p role="status" className="mt-4 rounded-xl border border-vx-money/35 bg-vx-money/[0.06] px-4 py-3 text-xs leading-5 text-vx-fg-muted">That avatar passport is not available in this browser. Choose another saved identity or create a new one.</p>}

      {profiles.length ? (
        <>
          <label htmlFor="avatar-passport-search" className="mt-4 block font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-fg-muted">SEARCH SAVED AVATARS</label>
          <input id="avatar-passport-search" type="search" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, role, or canon" className={`${input} mt-2`} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2" role="list" aria-label="Saved avatar passports">
            {visibleProfiles.map((profile) => {
              const look = profile.looks[profile.looks.length - 1];
              const voice = TTS_VOICES.find((item) => item.id === profile.voiceId);
              const selected = selectedId === profile.id;
              return (
                <div key={profile.id} role="listitem">
                <button type="button" disabled={disabled} aria-pressed={selected} onClick={() => onSelect(profile)} className="h-full w-full rounded-xl border border-vx-border bg-vx-base p-4 text-left transition-colors hover:border-vx-accent disabled:opacity-40 aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07]">
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block text-sm font-black">{profile.name}</span>
                      <span className="mt-1 block text-[11px] text-vx-fg-muted">{profile.role || 'Reusable avatar'} · {voice?.label || 'Stock voice'}</span>
                    </span>
                    <span className={`font-vx-mono text-[9px] font-bold tracking-[0.1em] ${selected ? 'text-vx-accent' : 'text-vx-fg-faint'}`}>{selected ? '● ACTIVE' : '○ SELECT'}</span>
                  </span>
                  <span className="mt-3 block text-xs font-bold text-vx-fg-body">Latest look · {look.label}</span>
                  <span className={`mt-1 block font-vx-mono text-[9px] font-bold tracking-[0.08em] ${look.assetJobId ? 'text-vx-accent' : 'text-vx-fg-faint'}`}>{look.assetJobId ? '● OWNED PORTRAIT LINKED' : '○ PORTRAIT NOT LINKED'}</span>
                  <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-vx-fg-muted">{look.appearance}</span>
                  {profile.canon && <span className="mt-2 line-clamp-2 block text-[11px] leading-4 text-vx-fg-faint">Canon: {profile.canon}</span>}
                </button>
                </div>
              );
            })}
          </div>
          {!visibleProfiles.length && <p className="mt-3 rounded-xl border border-dashed border-vx-border px-4 py-5 text-center text-xs text-vx-fg-muted">No saved avatar matches that search.</p>}
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-vx-border bg-vx-base px-4 py-5 text-sm text-vx-fg-muted">No avatar passports are saved in this browser yet. Create one, save its identity, then return here.</div>
      )}
    </section>
  );
}

function DubbingBrief({ settings, onSettings, disabled, importedSpeakerCount = 1, hasSpeakerTranscript = false, importedCast = [] }) {
  const targetLanguage = settings.language === 'auto' ? 'English' : settings.language;
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="dubbing-brief-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">LOCALISATION CONTRACT</p>
          <h2 id="dubbing-brief-title" className="mt-1 text-lg font-black">Reviewed translation, single locale or batch</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-vx-fg-muted">Choose the language of your approved translation. Veyrnox.ai creates stock-voice speech first, then lip-syncs that reusable audio to the source video.</p>
        </div>
        <Chip tone="accent">Manual review path</Chip>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="rounded-xl border border-vx-border bg-vx-base p-4 text-xs font-extrabold">Target language
          <select aria-label="Dubbing target language" value={targetLanguage} disabled={disabled}
            onChange={(event) => onSettings({ ...settings, language: event.target.value })}
            className={`${input} mt-3 min-h-11 py-2.5`}>
            {TTS_LANGUAGES.filter((language) => language !== 'auto').map((language) => <option key={language} value={language}>{language}</option>)}
          </select>
        </label>
        <div className="rounded-xl border border-vx-border bg-vx-base p-4">
          <p className="text-xs font-extrabold">Processing mode</p>
          <p className="mt-3 text-sm font-black text-vx-accent">Stock voice + lip sync</p>
          <p className="mt-1 text-[11px] leading-4 text-vx-fg-muted">A separate speech asset is made before the video job.</p>
        </div>
        <div className="rounded-xl border border-vx-border bg-vx-base p-4">
          <p className="text-xs font-extrabold">Current coverage</p>
          <p className="mt-3 text-sm font-black">{importedSpeakerCount > 1 ? `${importedSpeakerCount} reviewed stock voices` : 'One voice'} · editable SRT / VTT</p>
          <p className="mt-1 text-[11px] leading-4 text-vx-fg-muted">{importedSpeakerCount > 1 ? `Sequential named turns are carried by one owned Library audio file.${hasSpeakerTranscript ? ' The speaker-labelled transcript is ready for local cue review.' : ''}` : 'Review timed subtitle files locally, or add burned subtitles as a separately priced finishing render.'} Automatic speaker matching remains unavailable.</p>
          {importedCast.length > 0 && <p className="mt-2 rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-[10px] leading-4 text-vx-fg-muted"><strong className="text-vx-fg">Imported Project Cast:</strong> {importedCast.map((member) => `${member.speaker} · ${member.voice}`).join(' / ')}. These labels describe the owned source dialogue; they do not clone or remap voices in another language.</p>}
          <Link href="/app/dialogue" className="mt-3 inline-flex text-[11px] font-extrabold text-vx-accent underline underline-offset-4">Prepare 2–4-speaker dub audio</Link>
        </div>
      </div>
      <p className="mt-4 rounded-xl border border-vx-border bg-vx-base/60 px-4 py-3 text-xs leading-5 text-vx-fg-muted"><strong className="text-vx-fg">Review boundary:</strong> automatic transcription, translation, diarization, original-voice preservation and face-to-speaker mapping do not run in this workflow. Paste a translation you have reviewed, create ordered stock-voice dialogue, or upload/record a dubbed track you are allowed to use.</p>
    </section>
  );
}

function SpeechCard({
  mode,
  onMode,
  script,
  onScript,
  scriptLimit,
  ttsSettings,
  onTtsSettings,
  estimate,
  maxSeconds,
  audio,
  onAudio,
  onAudioLibrary,
  onAudioReference,
  recording,
  recordSeconds,
  onStartRecording,
  onStopRecording,
  disabled,
  workflow,
}) {
  const [voiceRecipeNotice, setVoiceRecipeNotice] = useState(null);
  const tooLong = mode === 'script' && estimate > maxSeconds;
  const audioTooLong = mode !== 'script' && knownAudioTooLong(audio?.duration, maxSeconds);
  const isSong = workflow.id === 'singing-photo';
  const isDubbing = workflow.id === 'video-dubbing';
  const isCartoon = workflow.id === 'talking-cartoon';
  const isAnimal = workflow.id === 'talking-animal';
  const isBabyPodcast = workflow.id === 'baby-podcast';
  const isObject = workflow.id === 'talking-object';
  const sources = speechSourcesFor(workflow);
  const voiceRecipeMatches = Boolean(voiceRecipeNotice && voiceRecipesMatch(ttsSettings, voiceRecipeNotice.settings));
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="performance-speech-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">STEP 2</p>
          <h2 id="performance-speech-title" className="mt-1 text-lg font-black">{isSong ? 'Song' : isDubbing ? 'Target-language audio' : 'Speech'}</h2>
          <p className="mt-1 text-xs leading-5 text-vx-fg-muted">{isSong ? 'Upload or record a song clip you are allowed to use. Nothing is submitted until you approve the quote.' : isDubbing ? 'Paste a reviewed translation, upload an owned dub, or record one here. Nothing is submitted until you approve the quote.' : isBabyPodcast ? 'Write the synthetic character’s line, upload cleared adult audio, or record an adult performance. Never use a real child’s voice.' : isObject ? 'Write the object character’s line, upload owned audio, or record it here. Nothing is submitted until you approve the quote.' : isAnimal ? 'Write the animal’s line, upload owned audio, or record it here. Nothing is submitted until you approve the quote.' : isCartoon ? 'Write the character’s line, upload owned audio, or record it here. Nothing is submitted until you approve the quote.' : 'Choose one source. Nothing is submitted until you approve the quote.'}</p>
        </div>
        {((mode === 'script' && script.trim() && !tooLong) || (mode !== 'script' && audio && !audioTooLong)) && <Chip tone="accent">Ready</Chip>}
      </div>
      <div className={`mt-4 grid gap-2 ${sources.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`} role="group" aria-label={isSong ? 'Song source' : 'Speech source'}>
        {sources.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={disabled || recording}
            aria-pressed={mode === item.id}
            onClick={() => onMode(item.id)}
            className="rounded-xl border border-vx-border px-3 py-3 text-left transition-colors hover:border-vx-accent disabled:opacity-40 aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07]"
          >
            <span className="block text-sm font-bold">{isSong && item.id === 'upload' ? 'Upload song' : isSong && item.id === 'record' ? 'Record song' : isDubbing && item.id === 'script' ? 'Paste translation' : isDubbing && item.id === 'upload' ? 'Upload dub' : isDubbing && item.id === 'record' ? 'Record dub' : item.label}</span>
            <span className="mt-1 block text-[11px] leading-4 text-vx-fg-muted">{isSong && item.id === 'upload' ? 'Use an MP3 or WAV song clip you are licensed to use.' : isSong && item.id === 'record' ? 'Record a cleared vocal or musical performance here.' : isDubbing && item.id === 'script' ? 'Create target-language speech from text you have reviewed.' : isDubbing && item.id === 'upload' ? 'Use an MP3 or WAV dub you own or license.' : isDubbing && item.id === 'record' ? 'Capture an approved target-language performance.' : item.description}</span>
          </button>
        ))}
      </div>

      {mode === 'script' && (
        <div className="mt-4">
          <label htmlFor="performance-script" className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">{isDubbing ? 'REVIEWED TRANSLATION' : 'SCRIPT'}</label>
          <PromptBox
            id="performance-script"
            value={script}
            maxLength={scriptLimit}
            rows={5}
            disabled={disabled}
            onChange={(event) => onScript(event.target.value)}
            placeholder={isDubbing ? 'Paste the exact approved translation the speaker should deliver…' : isBabyPodcast ? 'Write the short podcast line your synthetic character should deliver…' : isObject ? 'Write the exact words your object character should say…' : isAnimal ? 'Write the exact words your animal should say…' : isCartoon ? 'Write the exact words your character should say…' : 'Write the exact words your subject should say…'}
          />
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
            <span className={tooLong ? 'text-vx-danger' : 'text-vx-fg-muted'}>
              Estimated speech: {estimate || 0}s · model limit {maxSeconds}s
            </span>
            <span className="font-vx-mono text-vx-fg-faint">{script.length}/{scriptLimit}</span>
          </div>
          {tooLong && <p role="alert" className="mt-2 text-xs text-vx-danger">Shorten the script before spending credits. The estimate is conservative, but the generated audio must fit the model limit.</p>}
          <TextToSpeechControls
            recipeId="stock-voice"
            script={script}
            settings={ttsSettings}
            onSettings={onTtsSettings}
            onScript={onScript}
            scriptLimit={scriptLimit}
            showExamples={false}
          />
          <VoiceRecipeLibrary title="Signature voices for this performance" onApply={(recipe, name) => { onTtsSettings(recipe); setVoiceRecipeNotice({ name, settings: recipe }); }} />
          {voiceRecipeNotice&&<div role="status" className={`mt-3 rounded-xl border px-4 py-3 text-xs leading-5 ${voiceRecipeMatches?'border-vx-accent/30 bg-vx-accent/[0.06] text-vx-fg-muted':'border-vx-danger/30 bg-vx-danger/[0.05] text-vx-danger'}`}><strong>{voiceRecipeMatches?'Voice Recipe applied:':'Voice Recipe modified:'}</strong> {voiceRecipeNotice.name}. {voiceRecipeMatches?'Review this script, duration estimate and current quote before generating.':'Current voice controls no longer match this saved recipe.'}{!voiceRecipeMatches&&<button type="button" onClick={()=>onTtsSettings(voiceRecipeNotice.settings)} className="ml-2 font-extrabold underline">Restore recipe</button>}</div>}
        </div>
      )}

      {mode === 'upload' && (
        <div className="mt-4 rounded-xl border border-vx-border bg-vx-base p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold">{audio?.file?.name || audio?.name || 'MP3 or WAV'}</p>
              <p className="mt-1 text-xs text-vx-fg-muted">{isSong ? 'Cleared song clip. ' : ''}Up to 20 MB and {maxSeconds}s. The server checks the real container and duration.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={disabled} onClick={onAudioLibrary} className="rounded-full border border-vx-border px-4 py-2 text-xs font-bold hover:border-vx-accent disabled:opacity-40">From Library</button>
              <label className={`cursor-pointer rounded-full border border-vx-border px-4 py-2 text-xs font-bold hover:border-vx-accent ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
                {audio ? 'Replace upload' : 'Choose audio'}
                <input type="file" accept="audio/mpeg,audio/wav" className="sr-only" disabled={disabled}
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    event.target.value = '';
                    if (file) onAudio(file);
                  }} />
              </label>
            </div>
          </div>
          {audio && <audio className="mt-4 w-full" controls src={audio.previewUrl} />}
          {audioTooLong && <p role="alert" className="mt-3 rounded-lg border border-vx-danger/35 bg-vx-danger/[0.05] px-3 py-2 text-xs leading-5 text-vx-danger">This measured {Math.round(audio.duration * 10) / 10}s reference is too long for the current {maxSeconds}s engine. Choose a compatible engine or use shorter audio before generating.</p>}
          <AudioReferenceShelf audio={audio} disabled={disabled} onUse={onAudioReference}/>
        </div>
      )}

      {mode === 'record' && (
        <div className="mt-4 rounded-xl border border-vx-border bg-vx-base p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">{recording ? `Recording · ${recordSeconds}s` : audio ? 'Recording ready' : 'Record in this browser'}</p>
              <p className="mt-1 text-xs text-vx-fg-muted">Maximum {maxSeconds}s. Your browser capture is converted locally to WAV before upload.{isSong ? ' Confirm music and performance rights before rendering.' : ''}</p>
            </div>
            <Button
              size="sm"
              variant={recording ? 'danger' : 'ghost'}
              disabled={disabled}
              onClick={recording ? onStopRecording : onStartRecording}
            >
              {recording ? 'Stop recording' : audio ? 'Record again' : 'Start recording'}
            </Button>
          </div>
          {audio && !recording && <audio className="mt-4 w-full" controls src={audio.previewUrl} />}
        </div>
      )}
    </section>
  );
}

function PreviewGate() {
  return (
    <div className="min-h-dvh">
      <AppNav active="performance" />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8 sm:py-16">
        <section className={`${card} p-8 sm:p-10`}>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">CLEAN-ROOM PREVIEW</p>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Performance Studio is behind a browser preview flag.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-vx-fg-muted">
            This first slice uses Veyrnox.ai&apos;s existing model catalog, consent record, upload validation, credit ledger and refund path. It does not copy competitor media, code or private behavior.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button onClick={() => enablePerformancePreview()}>Enable this preview</Button>
            <Link href="/app/create" className="text-sm font-bold text-vx-accent underline underline-offset-4">Review all 22 recipes</Link>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function PerformanceStudio({ initialWorkflowId = null, initialRecipeId = null } = {}) {
  const pathname = usePathname();
  const dedicatedLipSync = pathname === '/app/lip-sync';
  const dedicatedDubbing = pathname === '/app/video-dubbing';
  const dedicatedSingingPhoto = pathname === '/app/singing-photo';
  const dedicatedTalkingAvatar = pathname === '/app/talking-avatar';
  const dedicatedProductPresenter = pathname === '/app/product-avatar/animate';
  const dedicatedCharacterWorkflow = pathname === '/app/talking-cartoon'
    ? 'talking-cartoon'
    : pathname === '/app/talking-animals'
      ? 'talking-animal'
      : pathname === '/app/talking-objects'
        ? 'talking-object'
        : pathname === '/app/baby-podcast'
          ? 'baby-podcast'
        : null;
  const dedicatedCharacterRecipe = dedicatedCharacterWorkflow === 'baby-podcast' ? 'minor-podcast' : dedicatedCharacterWorkflow;
  const previewEnabled = usePerformancePreview();
  const { models, live, loading: catalogLoading } = useCatalog();
  const [workflowId, setWorkflowId] = useState(initialWorkflowId || (dedicatedProductPresenter ? 'product-presenter' : dedicatedDubbing ? 'video-dubbing' : dedicatedLipSync ? 'video-lip-sync' : 'talking-photo'));
  const [performanceModelId, setPerformanceModelId] = useState(null);
  const [longFormSyncMode, setLongFormSyncMode] = useState('cut_off');
  const [recipeId, setRecipeId] = useState(initialRecipeId);
  const enabled = previewEnabled || dedicatedLipSync || dedicatedDubbing || dedicatedSingingPhoto || dedicatedTalkingAvatar || dedicatedProductPresenter || Boolean(dedicatedCharacterWorkflow) || recipeId === 'talking-avatar';
  const [speechSource, setSpeechSource] = useState('script');
  const [script, setScript] = useState('');
  const [ttsSettings, setTtsSettings] = useState(DEFAULT_TTS_SETTINGS);
  const [avatarProfiles, setAvatarProfiles] = useState([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState(null);
  const [avatarRequestMissing, setAvatarRequestMissing] = useState(false);
  const [composition, setComposition] = useState(DEFAULT_TALKING_AVATAR_COMPOSITION);
  const [background, setBackground] = useState(null);
  const [compositionError, setCompositionError] = useState('');
  const [visual, setVisual] = useState(null);
  const [sampleLoadingId, setSampleLoadingId] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(null);
  const [audio, setAudio] = useState(null);
  const [dubbingSpeakerCount, setDubbingSpeakerCount] = useState(1);
  const [dubbingSpeakerTranscript, setDubbingSpeakerTranscript] = useState(false);
  const [dubbingCast, setDubbingCast] = useState([]);
  const [consent, setConsent] = useState(false);
  const [balance, setBalance] = useState(null);
  const [stage, setStage] = useState('idle');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [baseResult, setBaseResult] = useState(null);
  const [projectJobs, setProjectJobs] = useState([]);
  const [projectRestoreNotice, setProjectRestoreNotice] = useState('');
  const [dubbingBatchRun, setDubbingBatchRun] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const inFlight = useRef(false);
  const chain = useRef(null);
  const dubbingBatchChain = useRef(null);
  const captionPlan = useRef(null);
  const recorder = useRef(null);
  const stream = useRef(null);
  const chunks = useRef([]);
  const recordTimer = useRef(null);
  const recordStop = useRef(null);
  const visualRef = useRef(null);
  const audioRef = useRef(null);
  const backgroundRef = useRef(null);
  const avatarPortraitRequest = useRef('');
  const projectCastPortraitRequest = useRef('');
  const importedAudio = useRef(false);
  const pendingPerformanceDraft = useRef(undefined);
  const pendingDubbingDraft = useRef(undefined);
  const pendingDialogueDubbingHandoff = useRef(undefined);
  const restoredProjectHandoff = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('workflow') || params.get('recipe') || initialWorkflowId || dedicatedCharacterWorkflow || (dedicatedProductPresenter ? 'product-presenter' : dedicatedDubbing ? 'video-dubbing' : dedicatedSingingPhoto ? 'singing-photo' : dedicatedTalkingAvatar ? 'talking-photo' : null);
    const requestedAvatar = params.get('avatar');
    if (pendingPerformanceDraft.current === undefined) pendingPerformanceDraft.current = (dedicatedLipSync || ['baby-podcast', 'singing-photo', 'talking-cartoon', 'talking-animal', 'talking-object'].includes(requested)) ? readPerformanceDraft(window.sessionStorage) : null;
    if (pendingDubbingDraft.current === undefined) pendingDubbingDraft.current = requested === 'video-dubbing' ? readDubbingDraft(window.sessionStorage) : null;
    if (pendingDialogueDubbingHandoff.current === undefined) pendingDialogueDubbingHandoff.current = requested === 'video-dubbing' ? readDialogueDubbingHandoff(window.sessionStorage, params.get('audio')) : null;
    const importedDraft = pendingPerformanceDraft.current;
    const importedDubbingDraft = pendingDubbingDraft.current;
    const storedAvatars = readAvatarProfiles(window.localStorage);
    const selectedAvatar = requestedAvatar ? storedAvatars.find((profile) => profile.id === requestedAvatar) : null;
    setRecipeId(params.get('recipe') || initialRecipeId || dedicatedCharacterRecipe || (dedicatedProductPresenter ? 'product-presenter' : dedicatedDubbing ? 'video-dubbing' : dedicatedSingingPhoto ? 'singing-photo' : dedicatedTalkingAvatar ? 'talking-avatar' : null));
    setAvatarProfiles(storedAvatars);
    setSelectedAvatarId(selectedAvatar?.id || null);
    setAvatarRequestMissing(Boolean(requestedAvatar && !selectedAvatar));
    if (selectedAvatar) setTtsSettings((current) => ({ ...current, voice: selectedAvatar.voiceId }));
    if (importedDraft) {
      const timer = setTimeout(() => {
        setWorkflowId(importedDraft.workflow);
        setSpeechSource(importedDraft.speechSource);
        setScript(importedDraft.script);
      }, 0);
      return () => clearTimeout(timer);
    }
    if (importedDubbingDraft) {
      const timer = setTimeout(() => {
        setWorkflowId('video-dubbing');
        setSpeechSource(importedDubbingDraft.speechSource);
        setScript(importedDubbingDraft.script);
        setTtsSettings((current) => ({ ...current, language: importedDubbingDraft.targetLanguage }));
      }, 0);
      return () => clearTimeout(timer);
    }
    if (dedicatedLipSync && !requested) {
      const timer = setTimeout(() => {
        setWorkflowId('video-lip-sync');
        setSpeechSource('script');
      }, 0);
      return () => clearTimeout(timer);
    }
    if (dedicatedDubbing && requested === 'video-dubbing' && !importedDubbingDraft) {
      const timer = setTimeout(() => {
        setWorkflowId('video-dubbing');
        setSpeechSource('script');
        setTtsSettings((current) => ({ ...current, language: 'English' }));
      }, 0);
      return () => clearTimeout(timer);
    }
    const available = PERFORMANCE_WORKFLOWS.find((item) => item.id === requested && item.status === 'available');
    if (!available) return undefined;
    const timer = setTimeout(() => {
      setWorkflowId(available.id);
      setSpeechSource(available.defaultSpeechSource);
      if (available.defaultLanguage) setTtsSettings((current) => ({ ...current, language: available.defaultLanguage }));
    }, 0);
    return () => clearTimeout(timer);
  }, [dedicatedCharacterRecipe, dedicatedCharacterWorkflow, dedicatedDubbing, dedicatedLipSync, dedicatedProductPresenter, dedicatedSingingPhoto, dedicatedTalkingAvatar, initialRecipeId, initialWorkflowId]);

  const workflow = workflowById(workflowId);
  const activeRecipe = recipeForDestination(recipeId, dedicatedCharacterWorkflow ? pathname : dedicatedProductPresenter ? '/app/product-avatar/animate' : dedicatedDubbing ? '/app/video-dubbing' : dedicatedSingingPhoto ? '/app/singing-photo' : dedicatedTalkingAvatar ? '/app/talking-avatar' : dedicatedLipSync ? '/app/lip-sync' : '/app/performance');
  const selectedAvatar = avatarProfiles.find((profile) => profile.id === selectedAvatarId) || null;
  const visibleWorkflows = dedicatedDubbing
    ? PERFORMANCE_WORKFLOWS.filter((item) => item.id === 'video-dubbing')
    : dedicatedSingingPhoto
    ? PERFORMANCE_WORKFLOWS.filter((item) => item.id === 'singing-photo')
    : dedicatedTalkingAvatar
    ? PERFORMANCE_WORKFLOWS.filter((item) => item.id === 'talking-photo')
    : dedicatedProductPresenter
    ? PERFORMANCE_WORKFLOWS.filter((item) => item.id === 'product-presenter')
    : dedicatedCharacterWorkflow
    ? PERFORMANCE_WORKFLOWS.filter((item) => item.id === dedicatedCharacterWorkflow)
    : dedicatedLipSync
    ? PERFORMANCE_WORKFLOWS.filter((item) => ['video-lip-sync', 'talking-photo'].includes(item.id))
    : PERFORMANCE_WORKFLOWS;
  const performanceModels = useMemo(() => availablePerformanceModels(models, workflowId), [models, workflowId]);
  const defaultPerformanceModelId = workflow.modelId;
  const lipModel = useMemo(() => performanceModels.find((model) => model.id === performanceModelId)
    || performanceModels.find((model) => model.id === defaultPerformanceModelId)
    || null, [defaultPerformanceModelId, performanceModelId, performanceModels]);
  const performanceModelContract = (['video-lip-sync', 'video-dubbing'].includes(workflow.id) ? VIDEO_LIP_SYNC_MODEL_CONTRACTS : TALKING_PHOTO_MODEL_CONTRACTS)
    .find((contract) => contract.id === lipModel?.id);
  const activeMaxSeconds = performanceModelContract?.maxSeconds || workflow.maxSeconds;
  const activeWorkflow = useMemo(() => ({ ...workflow, maxSeconds: activeMaxSeconds }), [activeMaxSeconds, workflow]);
  const localizedBatchEnabled = ['video-dubbing', 'product-presenter'].includes(workflow.id);
  const workflowLabel = workflow.label;
  const ttsModel = models.find((model) => model.id === DEFAULT_TTS_MODEL_ID) || null;
  const clipEditModel = models.find((model) => model.id === 'clip-edit') || null;
  const captionRendererAvailable = Number.isFinite(clipEditModel?.credits);
  const captionsCredits = composition.subtitles && captionRendererAvailable ? clipEditModel.credits * 7 : 0;
  const quote = useMemo(() => performanceQuote({
    lipSyncCredits: lipModel?.credits,
    speechSource,
    ttsCredits: ttsModel?.credits,
    captionsCredits,
  }), [captionsCredits, lipModel?.credits, speechSource, ttsModel?.credits]);
  const dubbingBatchUnitCredits = useMemo(() => performanceQuote({
    lipSyncCredits: lipModel?.credits,
    speechSource: 'script',
    ttsCredits: ttsModel?.credits,
    captionsCredits,
  }).totalCredits, [captionsCredits, lipModel?.credits, ttsModel?.credits]);
  const speechEstimate = estimatedSpeechSeconds(script);
  const scriptTooLong = speechSource === 'script' && speechEstimate > activeMaxSeconds;
  const onUnreachable = useCallback(() => setError({ code: 'poll_unreachable' }), []);
  const { jobs, generating, startJobs, addJob, clearJobs } = useStudioJobs({ onUnreachable });
  const job = jobs[0] || null;
  const busy = sending || generating || ['uploading', 'speech', 'rendering', 'captioning', 'batch-speech', 'batch-rendering', 'batch-captioning'].includes(stage);
  const compositionStatus = talkingAvatarCompositionStatus(composition, background, { subtitlesAvailable: captionRendererAvailable });

  const setVisualFile = useCallback((file) => {
    if (visualRef.current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(visualRef.current.previewUrl);
    const next = file ? { file, previewUrl: URL.createObjectURL(file) } : null;
    visualRef.current = next;
    setVisual(next);
    setError(null);
  }, []);
  const setVisualSample = useCallback(async (sampleId) => {
    const sample = talkingPhotoSampleById(sampleId);
    if (!sample || sampleLoadingId) return;
    setSampleLoadingId(sample.id);
    setError(null);
    try {
      const response = await fetch(sample.src, { cache: 'force-cache' });
      if (!response.ok) throw new Error('sample_unavailable');
      const blob = await response.blob();
      const file = new File([blob], sample.filename, { type: blob.type || 'image/png' });
      if (visualRef.current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(visualRef.current.previewUrl);
      const next = { file, previewUrl: sample.src, sampleId: sample.id, label: `${sample.name} · ${sample.role}`, alt: sample.alt };
      visualRef.current = next;
      setVisual(next);
      setConsent(false);
    } catch {
      setError({ message: 'That fictional portrait could not be prepared. Choose another sample or upload a portrait.' });
    } finally {
      setSampleLoadingId(null);
    }
  }, [sampleLoadingId]);
  const setVisualLibrary = useCallback((item) => {
    if (visualRef.current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(visualRef.current.previewUrl);
    const next = item ? { jobId: item.id, previewUrl: item.url, label: item.label } : null;
    visualRef.current = next;
    setVisual(next);
    setLibraryOpen(null);
    setError(null);
  }, []);
  const loadAvatarPortrait = useCallback(async (profile) => {
    const look = profile?.looks?.at(-1);
    const jobId = look?.assetJobId;
    if (!jobId) return false;
    const requestKey = `${profile.id}:${jobId}`;
    if (visualRef.current?.jobId === jobId) return true;
    if (avatarPortraitRequest.current === requestKey) return false;
    avatarPortraitRequest.current = requestKey;
    try {
      const [sourceJob, asset] = await Promise.all([
        gatewayFetch(`/jobs/${jobId}`),
        gatewayFetch(`/jobs/${jobId}/asset`),
      ]);
      if (avatarPortraitRequest.current !== requestKey) return false;
      if (sourceJob.state !== 'succeeded' || !String(asset.mime_type || '').startsWith('image/')) throw new Error('avatar_portrait_unavailable');
      if (visualRef.current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(visualRef.current.previewUrl);
      const next = { jobId, previewUrl: asset.url, label: `${profile.name} · saved portrait` };
      visualRef.current = next;
      setVisual(next);
      setConsent(false);
      setError(null);
      return true;
    } catch {
      if (avatarPortraitRequest.current === requestKey) setError({ message: 'That avatar portrait is no longer available in your Library. Choose another owned image or upload a portrait.' });
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !selectedAvatar?.looks?.at(-1)?.assetJobId || new URLSearchParams(window.location.search).get('portrait')) return;
    const timer = setTimeout(() => loadAvatarPortrait(selectedAvatar), 0);
    return () => clearTimeout(timer);
  }, [enabled, loadAvatarPortrait, selectedAvatar]);

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('portrait') || '';
    if (!jobId) return;
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(jobId)) {
      const timer = window.setTimeout(() => setError({ message: 'That Project Cast portrait reference is invalid. Choose another owned image from Library.' }), 0);
      return () => window.clearTimeout(timer);
    }
    const castMember = (params.get('castMember') || '').trim().slice(0, 30);
    const requestKey = `${jobId}:${castMember}`;
    if (visualRef.current?.jobId === jobId || projectCastPortraitRequest.current === requestKey) return;
    projectCastPortraitRequest.current = requestKey;
    (async () => {
      try {
        const [sourceJob, asset] = await Promise.all([
          gatewayFetch(`/jobs/${jobId}`),
          gatewayFetch(`/jobs/${jobId}/asset`),
        ]);
        if (projectCastPortraitRequest.current !== requestKey) return;
        if (sourceJob.state !== 'succeeded' || !String(asset.mime_type || '').startsWith('image/')) throw new Error('project_cast_portrait_unavailable');
        if (visualRef.current?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(visualRef.current.previewUrl);
        const next = { jobId, previewUrl: asset.url, label: castMember ? `${castMember} · Project Cast portrait` : 'Project Cast portrait' };
        visualRef.current = next;
        setVisual(next);
        setConsent(false);
        setError(null);
      } catch {
        if (projectCastPortraitRequest.current === requestKey) setError({ message: 'That Project Cast portrait is no longer available in your Library. Choose another owned image or upload a portrait.' });
      }
    })();
  }, [enabled]);
  const setAudioLibrary = useCallback((item) => {
    if (audioRef.current?.previewUrl && audioRef.current?.file) URL.revokeObjectURL(audioRef.current.previewUrl);
    const next = item ? { jobId: item.id, previewUrl: item.url, name: item.label || 'Audio from Library', ...(Number.isFinite(item.duration) ? { duration: item.duration } : {}) } : null;
    audioRef.current = next;
    setAudio(next);
    setDubbingSpeakerCount(1);
    setDubbingSpeakerTranscript(false);
    setDubbingCast([]);
    setLibraryOpen(null);
    setError(null);
  }, []);
  const setAudioFile = useCallback((file) => {
    if (audioRef.current?.previewUrl) URL.revokeObjectURL(audioRef.current.previewUrl);
    const next = file ? { file, previewUrl: URL.createObjectURL(file) } : null;
    audioRef.current = next;
    setAudio(next);
    setDubbingSpeakerCount(1);
    setDubbingSpeakerTranscript(false);
    setDubbingCast([]);
    setError(null);
  }, []);

  const setBackgroundFile = useCallback((file, validation) => {
    if (!validation.ok) {
      setCompositionError(validation.code === 'background_type' ? 'Choose an MP4, MOV or WebM background video.' : validation.code === 'background_size' ? 'The background video must be between 1 byte and 500 MB.' : 'Choose a background video.');
      return;
    }
    if (backgroundRef.current?.previewUrl) URL.revokeObjectURL(backgroundRef.current.previewUrl);
    const next = { file, name: file.name, previewUrl: URL.createObjectURL(file) };
    backgroundRef.current = next;
    setBackground(next);
    setCompositionError('');
  }, []);

  const loadBalance = useCallback(async () => {
    try {
      const result = await gatewayFetch('/balance');
      setBalance(result.balance);
    } catch (next) {
      if (!(next instanceof GatewayError && next.status === 401)) setBalance(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const initialRead = setTimeout(loadBalance, 0);
    window.addEventListener('veyrnox:balance-changed', loadBalance);
    return () => {
      clearTimeout(initialRead);
      window.removeEventListener('veyrnox:balance-changed', loadBalance);
    };
  }, [enabled, loadBalance]);

  useEffect(() => {
    if (!enabled || importedAudio.current) return;
    importedAudio.current = true;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('audio');
    const requestedSpeakers = Number.parseInt(params.get('speakers') || '', 10);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId || '')) return;
    (async () => {
      try {
        const [sourceJob, asset] = await Promise.all([
          gatewayFetch(`/jobs/${jobId}`),
          gatewayFetch(`/jobs/${jobId}/asset`),
        ]);
        if (sourceJob.state !== 'succeeded' || !String(asset.mime_type || '').startsWith('audio/')) return;
        const next = { jobId, previewUrl: asset.url, name: 'Dialogue from Library' };
        audioRef.current = next;
        setAudio(next);
        setSpeechSource('upload');
        const dialogueHandoff = pendingDialogueDubbingHandoff.current;
        const verifiedDialogue = sourceJob.model_id === 'elevenlabs-dialogue';
        const verifiedSpeakers = verifiedDialogue
          ? dialogueHandoff?.speakerCount || (requestedSpeakers >= 2 && requestedSpeakers <= 4 ? requestedSpeakers : 1)
          : 1;
        setDubbingSpeakerCount(verifiedSpeakers);
        if (verifiedDialogue && dialogueHandoff?.jobId === jobId) {
          setScript(dialogueHandoff.subtitleScript);
          setDubbingSpeakerTranscript(true);
          setDubbingCast(dialogueHandoff.cast || []);
        }
      } catch {
        setError({ message: 'That Library audio could not be opened. Choose an MP3 or WAV instead.' });
      }
    })();
  }, [enabled]);

  useEffect(() => () => {
    if (visualRef.current?.previewUrl && visualRef.current?.file) URL.revokeObjectURL(visualRef.current.previewUrl);
    if (audioRef.current?.previewUrl && audioRef.current?.file) URL.revokeObjectURL(audioRef.current.previewUrl);
    if (backgroundRef.current?.previewUrl) URL.revokeObjectURL(backgroundRef.current.previewUrl);
    if (recordTimer.current) clearInterval(recordTimer.current);
    if (recordStop.current) clearTimeout(recordStop.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopRecording() {
    if (recordTimer.current) clearInterval(recordTimer.current);
    if (recordStop.current) clearTimeout(recordStop.current);
    recordTimer.current = null;
    recordStop.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }

  async function startRecording() {
    setError(null);
    setAudioFile(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError({ message: 'This browser cannot record audio here. Upload an MP3 or WAV instead.' });
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const choices = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = choices.find((type) => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      next.ondataavailable = (event) => { if (event.data?.size) chunks.current.push(event.data); };
      next.onstop = async () => {
        try {
          const blob = new Blob(chunks.current, { type: next.mimeType || mimeType || 'audio/webm' });
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) throw new Error('audio_context_unavailable');
          const context = new AudioContext();
          const decoded = await context.decodeAudioData(await blob.arrayBuffer());
          const wav = encodeAudioBufferAsWav(decoded);
          await context.close();
          setAudioFile(new File([wav], 'veyrnox-recording.wav', { type: 'audio/wav' }));
        } catch {
          setError({ message: 'This recording could not be prepared. Try again or upload an MP3 or WAV.' });
        }
      };
      recorder.current = next;
      setRecordSeconds(0);
      setRecording(true);
      const started = Date.now();
      recordTimer.current = setInterval(() => setRecordSeconds(Math.min(activeMaxSeconds, Math.ceil((Date.now() - started) / 1000))), 250);
      recordStop.current = setTimeout(stopRecording, activeMaxSeconds * 1000);
      next.start(250);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      setRecording(false);
      setError({ message: 'Microphone access was not available. Allow it in your browser, or upload an MP3 or WAV.' });
    }
  }

  const uploadSource = useCallback(async (file) => {
    const reservation = await gatewayFetch('/uploads', {
      method: 'POST',
      body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
    });
    let result;
    try {
      result = await fetch(reservation.upload_url, {
        method: 'PUT',
        headers: reservation.headers || { 'Content-Type': reservation.content_type },
        body: file,
      });
    } catch {
      throw new GatewayError('upload_failed', { code: 'upload_failed' });
    }
    if (!result.ok) throw new GatewayError('upload_failed', { status: result.status, code: 'upload_failed' });
    return reservation.key;
  }, []);

  const submitCaptionRender = useCallback((baseJobId, preset) => gatewayFetch('/generations', {
    method: 'POST',
    body: JSON.stringify({
      model_id: 'clip-edit',
      idempotency_key: makeIdempotencyKey(),
      inputs: { clips: [{ asset_id: baseJobId, whole: true }], captions: { preset } },
    }),
  }), []);

  const submitLipSync = useCallback(async ({ visualKey, visualAssetId, audioKey, audioJobId }) => {
    if (!lipModel) throw new GatewayError('model_not_found', { code: 'model_not_found' });
    const submitted = await gatewayFetch('/generations', {
      method: 'POST',
      body: JSON.stringify({
        model_id: lipModel.id,
        idempotency_key: makeIdempotencyKey(),
        confirmed_credits: lipModel.credits,
        inputs: lipModel.id === 'sync-lipsync-1.9-long' ? { sync_mode: longFormSyncMode } : {},
        source_keys: [visualKey, audioKey].filter(Boolean),
        source_assets: [visualAssetId, audioJobId].filter(Boolean),
        consent: true,
      }),
    });
    setProjectJobs((current) => [
      ...current.map((item) => audioJobId && item.job_id === audioJobId ? { ...item, state: 'succeeded' } : item),
      { role: 'performance', job_id: submitted.job_id, state: 'queued', credits: lipModel.credits, model_id: lipModel.id },
    ]);
    startJobs({ job_id: submitted.job_id, state: 'queued', credits: lipModel.credits, model_id: lipModel.id });
    pushJobHistory({
      job_id: submitted.job_id,
      model_id: lipModel.id,
      credits: lipModel.credits,
      prompt: script.trim().slice(0, 60) || 'Performance Studio',
      name: selectedAvatar ? `${workflowLabel} · ${selectedAvatar.name}` : workflowLabel,
    });
    if (submitted.balance_after != null) setBalance(submitted.balance_after);
    notifyBalanceChanged();
    captionPlan.current = composition.subtitles
      ? { baseJobId: submitted.job_id, preset: composition.captionPreset || 'simple', submitting: false }
      : null;
    setStage('rendering');
  }, [composition.captionPreset, composition.subtitles, lipModel, longFormSyncMode, script, selectedAvatar, startJobs, workflowLabel]);

  useEffect(() => {
    if (stage !== 'speech' || !chain.current || !job) return;
    if (job.state === 'failed') {
      chain.current = null;
      queueMicrotask(() => setStage('failed'));
      return;
    }
    if (job.state !== 'succeeded' || chain.current.submitting) return;
    chain.current.submitting = true;
    const visualKey = chain.current.visualKey;
    const audioJobId = job.job_id;
    (async () => {
      try {
        await submitLipSync({ visualKey, visualAssetId: chain.current.visualAssetId, audioJobId });
        chain.current = null;
      } catch (next) {
        chain.current = null;
        setError(gatewayError(next));
        setStage('failed');
      }
    })();
  }, [job, stage, submitLipSync]);

  useEffect(() => {
    if (!job || job.model_id !== lipModel?.id) return;
    if (job.state === 'succeeded' && captionPlan.current?.baseJobId === job.job_id) {
      if (!captionPlan.current.submitting) {
        captionPlan.current.submitting = true;
        queueMicrotask(() => setBaseResult(job));
        const preset = captionPlan.current.preset;
        (async () => {
          try {
            const submitted = await submitCaptionRender(job.job_id, preset);
            setProjectJobs((current) => [
              ...current.map((item) => item.job_id === job.job_id ? { ...item, state: 'succeeded' } : item),
              { role: 'finishing', job_id: submitted.job_id, state: 'queued', credits: captionsCredits, model_id: 'clip-edit' },
            ]);
            captionPlan.current = null;
            startJobs({ job_id: submitted.job_id, state: 'queued', credits: captionsCredits, model_id: 'clip-edit' });
            pushJobHistory({ job_id: submitted.job_id, model_id: 'clip-edit', credits: captionsCredits, prompt: 'Burned subtitles', name: `${workflow.label} · subtitles` });
            if (submitted.balance_after != null) setBalance(submitted.balance_after);
            notifyBalanceChanged();
            setStage('captioning');
          } catch (next) {
            captionPlan.current = null;
            setError(gatewayError(next));
            setStage('failed');
          }
        })();
      }
      return;
    }
    if (job.state === 'succeeded') queueMicrotask(() => setStage('done'));
    if (job.state === 'failed') queueMicrotask(() => setStage('failed'));
  }, [captionsCredits, job, lipModel?.id, startJobs, submitCaptionRender, workflow.label]);

  useEffect(() => {
    if (job?.model_id !== 'clip-edit') return;
    if (job.state === 'succeeded') queueMicrotask(() => setStage('done'));
    if (job.state === 'failed') queueMicrotask(() => setStage('failed'));
  }, [job]);

  useEffect(() => {
    const run = dubbingBatchChain.current;
    if (!run) return;

    for (const item of run.items) {
      const speechJob = jobs.find((candidate) => candidate.job_id === item.speechJobId);
      const performanceJob = item.performanceJobId
        ? jobs.find((candidate) => candidate.job_id === item.performanceJobId)
        : null;
      const captionJob = item.captionJobId
        ? jobs.find((candidate) => candidate.job_id === item.captionJobId)
        : null;

      if (item.state === 'speech' && speechJob?.state === 'failed') {
        item.state = 'failed';
        item.failureStage = 'speech';
        item.failure = 'Speech generation failed and was refunded.';
        setDubbingBatchRun((current) => current ? {
          ...current,
          items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: item.state, failureStage: item.failureStage, failure: item.failure } : candidate),
        } : current);
        continue;
      }

      if (item.state === 'speech' && speechJob?.state === 'succeeded') {
        item.state = 'uploading';
        setDubbingBatchRun((current) => current ? {
          ...current,
          items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'uploading' } : candidate),
        } : current);
        (async () => {
          try {
            const visualKey = run.visual.file ? await uploadSource(run.visual.file) : undefined;
            const submitted = await gatewayFetch('/generations', {
              method: 'POST',
              body: JSON.stringify({
                model_id: run.lipModel.id,
                idempotency_key: makeIdempotencyKey(),
                confirmed_credits: run.lipModel.credits,
                inputs: run.lipModel.id === 'sync-lipsync-1.9-long' ? { sync_mode: run.longFormSyncMode } : {},
                source_keys: [visualKey].filter(Boolean),
                source_assets: [run.visual.jobId, item.speechJobId].filter(Boolean),
                consent: true,
              }),
            });
            item.performanceJobId = submitted.job_id;
            item.state = 'rendering';
            addJob({ job_id: submitted.job_id, state: 'queued', credits: run.lipModel.credits, model_id: run.lipModel.id });
            setProjectJobs((current) => [...current, {
              role: 'performance',
              locale: item.targetLanguage,
              job_id: submitted.job_id,
              state: 'queued',
              credits: run.lipModel.credits,
              model_id: run.lipModel.id,
            }]);
            setDubbingBatchRun((current) => current ? {
              ...current,
              items: current.items.map((candidate) => candidate.id === item.id ? {
                ...candidate,
                state: 'rendering',
                performanceJobId: submitted.job_id,
              } : candidate),
            } : current);
            pushJobHistory({
              job_id: submitted.job_id,
              model_id: run.lipModel.id,
              credits: run.lipModel.credits,
              prompt: item.script.slice(0, 60),
              name: `${run.projectName} · ${item.targetLanguage}`,
            });
            notifyBalanceChanged();
            setStage('batch-rendering');
          } catch (next) {
            item.state = 'failed';
            item.failureStage = 'performance';
            item.failure = 'The speech is in Library, but this locale could not start lip sync.';
            setError(gatewayError(next));
            setDubbingBatchRun((current) => current ? {
              ...current,
              items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: item.state, failureStage: item.failureStage, failure: item.failure } : candidate),
            } : current);
          }
        })();
        continue;
      }

      if (item.state === 'rendering' && performanceJob?.state === 'failed') {
        item.state = 'failed';
        item.failureStage = 'performance';
        item.failure = 'Lip sync failed and was refunded.';
        setDubbingBatchRun((current) => current ? {
          ...current,
          items: current.items.map((candidate) => candidate.id === item.id ? {
            ...candidate,
            state: item.state,
            failureStage: item.failureStage,
            failure: item.failure,
          } : candidate),
        } : current);
        continue;
      }

      if (item.state === 'rendering' && performanceJob?.state === 'succeeded') {
        if (!run.caption.enabled) {
          item.state = 'succeeded';
          setDubbingBatchRun((current) => current ? {
            ...current,
            items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'succeeded' } : candidate),
          } : current);
          continue;
        }

        item.state = 'captioning';
        setDubbingBatchRun((current) => current ? {
          ...current,
          items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: 'captioning' } : candidate),
        } : current);
        (async () => {
          try {
            const submitted = await submitCaptionRender(item.performanceJobId, run.caption.preset);
            item.captionJobId = submitted.job_id;
            addJob({ job_id: submitted.job_id, state: 'queued', credits: run.caption.credits, model_id: 'clip-edit' });
            setProjectJobs((current) => [
              ...current.map((candidate) => candidate.job_id === item.performanceJobId ? { ...candidate, state: 'succeeded' } : candidate),
              {
                role: 'finishing',
                locale: item.targetLanguage,
                job_id: submitted.job_id,
                state: 'queued',
                credits: run.caption.credits,
                model_id: 'clip-edit',
              },
            ]);
            setDubbingBatchRun((current) => current ? {
              ...current,
              items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, captionJobId: submitted.job_id } : candidate),
            } : current);
            pushJobHistory({
              job_id: submitted.job_id,
              model_id: 'clip-edit',
              credits: run.caption.credits,
              prompt: `${item.targetLanguage} burned subtitles`,
              name: `${run.projectName} · ${item.targetLanguage} subtitles`,
            });
            notifyBalanceChanged();
            setStage('batch-captioning');
          } catch (next) {
            item.state = 'partial';
            item.failureStage = 'caption';
            item.failure = 'The dubbed video is ready in Library, but burned subtitles could not start.';
            setError(gatewayError(next));
            setDubbingBatchRun((current) => current ? {
              ...current,
              items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: item.state, failureStage: item.failureStage, failure: item.failure } : candidate),
            } : current);
          }
        })();
        continue;
      }

      if (item.state === 'captioning' && captionJob && ['succeeded', 'failed'].includes(captionJob.state)) {
        item.state = captionJob.state === 'succeeded' ? 'succeeded' : 'partial';
        item.failureStage = captionJob.state === 'failed' ? 'caption' : null;
        item.failure = captionJob.state === 'failed' ? 'Burned subtitles failed and were refunded; the base dubbed video remains ready.' : '';
        setDubbingBatchRun((current) => current ? {
          ...current,
          items: current.items.map((candidate) => candidate.id === item.id ? {
            ...candidate,
            state: item.state,
            failureStage: item.failureStage,
            failure: item.failure,
          } : candidate),
        } : current);
      }
    }
  }, [addJob, jobs, submitCaptionRender, uploadSource]);

  useEffect(() => {
    if (!dubbingBatchRun?.items.length) return;
    const terminal = dubbingBatchRun.items.every((item) => ['succeeded', 'partial', 'failed'].includes(item.state));
    if (!terminal) return;
    dubbingBatchChain.current = null;
    const succeeded = dubbingBatchRun.items.filter((item) => ['succeeded', 'partial'].includes(item.state)).length;
    queueMicrotask(() => setStage(succeeded ? 'done' : 'failed'));
  }, [dubbingBatchRun]);

  async function retryDubbingLocale(itemId) {
    const sourceRun = dubbingBatchRun;
    const sourceItem = sourceRun?.items.find((item) => item.id === itemId);
    const retryQuote = dubbingLocaleRetryQuote(sourceItem, {
      ttsCredits: sourceRun?.ttsModel?.credits,
      performanceCredits: sourceRun?.lipModel?.credits,
      captionCredits: sourceRun?.caption?.enabled ? sourceRun.caption.credits : 0,
    });
    if (inFlight.current || busy || !sourceRun || !sourceItem || !retryQuote || !consent) return;
    if (balance == null || retryQuote.totalCredits > balance) {
      setError({ message: `This retry needs ${retryQuote.totalCredits} credits.` });
      return;
    }

    const run = {
      ...sourceRun,
      items: sourceRun.items.map((item) => ({ ...item })),
    };
    const item = run.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    dubbingBatchChain.current = run;
    inFlight.current = true;
    setSending(true);
    setError(null);

    try {
      if (retryQuote.stage === 'speech') {
        item.state = 'speech';
        item.failure = '';
        item.failureStage = null;
        item.speechJobId = null;
        item.performanceJobId = null;
        item.captionJobId = null;
        setDubbingBatchRun({ ...run, items: run.items.map((candidate) => ({ ...candidate })) });
        const submitted = await gatewayFetch('/generations', {
          method: 'POST',
          body: JSON.stringify({
            model_id: run.ttsModel.id,
            idempotency_key: makeIdempotencyKey(),
            confirmed_credits: run.ttsModel.credits,
            inputs: {
              prompt: item.script,
              ...ttsGenerationInputs({ ...run.ttsSettings, language: item.targetLanguage }),
            },
          }),
        });
        item.speechJobId = submitted.job_id;
        const queued = { job_id: submitted.job_id, state: 'queued', credits: run.ttsModel.credits, model_id: run.ttsModel.id };
        addJob(queued);
        setProjectJobs((current) => [...current, { ...queued, role: 'speech', locale: item.targetLanguage }]);
        pushJobHistory({ job_id: submitted.job_id, model_id: run.ttsModel.id, credits: run.ttsModel.credits, prompt: item.script.slice(0, 60), name: `${run.projectName} · ${item.targetLanguage} speech retry` });
        setStage('batch-speech');
      } else if (retryQuote.stage === 'performance') {
        item.state = 'uploading';
        item.failure = '';
        item.failureStage = null;
        item.performanceJobId = null;
        item.captionJobId = null;
        setDubbingBatchRun({ ...run, items: run.items.map((candidate) => ({ ...candidate })) });
        const visualKey = run.visual.file ? await uploadSource(run.visual.file) : undefined;
        const submitted = await gatewayFetch('/generations', {
          method: 'POST',
          body: JSON.stringify({
            model_id: run.lipModel.id,
            idempotency_key: makeIdempotencyKey(),
            confirmed_credits: run.lipModel.credits,
            inputs: run.lipModel.id === 'sync-lipsync-1.9-long' ? { sync_mode: run.longFormSyncMode } : {},
            source_keys: [visualKey].filter(Boolean),
            source_assets: [run.visual.jobId, item.speechJobId].filter(Boolean),
            consent: true,
          }),
        });
        item.performanceJobId = submitted.job_id;
        item.state = 'rendering';
        const queued = { job_id: submitted.job_id, state: 'queued', credits: run.lipModel.credits, model_id: run.lipModel.id };
        addJob(queued);
        setProjectJobs((current) => [...current, { ...queued, role: 'performance', locale: item.targetLanguage }]);
        pushJobHistory({ job_id: submitted.job_id, model_id: run.lipModel.id, credits: run.lipModel.credits, prompt: item.script.slice(0, 60), name: `${run.projectName} · ${item.targetLanguage} retry` });
        setStage('batch-rendering');
      } else {
        item.state = 'captioning';
        item.failure = '';
        item.failureStage = null;
        item.captionJobId = null;
        setDubbingBatchRun({ ...run, items: run.items.map((candidate) => ({ ...candidate })) });
        const submitted = await submitCaptionRender(item.performanceJobId, run.caption.preset);
        item.captionJobId = submitted.job_id;
        const queued = { job_id: submitted.job_id, state: 'queued', credits: run.caption.credits, model_id: 'clip-edit' };
        addJob(queued);
        setProjectJobs((current) => [...current, { ...queued, role: 'finishing', locale: item.targetLanguage }]);
        pushJobHistory({ job_id: submitted.job_id, model_id: 'clip-edit', credits: run.caption.credits, prompt: `${item.targetLanguage} burned subtitles retry`, name: `${run.projectName} · ${item.targetLanguage} subtitles retry` });
        setStage('batch-captioning');
      }
      setDubbingBatchRun({ ...run, items: run.items.map((candidate) => ({ ...candidate })) });
      notifyBalanceChanged();
    } catch (next) {
      const failedItem = {
        ...item,
        state: retryQuote.stage === 'caption' ? 'partial' : 'failed',
        failureStage: retryQuote.stage,
        failure: retryQuote.stage === 'speech'
          ? 'Speech retry could not start and was not charged.'
          : retryQuote.stage === 'performance'
            ? 'Lip-sync retry could not start; the speech remains in Library.'
            : 'Subtitle retry could not start; the base dubbed video remains ready.',
      };
      setError(gatewayError(next));
      dubbingBatchChain.current = { ...run, items: run.items.map((candidate) => candidate.id === item.id ? failedItem : candidate) };
      setDubbingBatchRun({ ...dubbingBatchChain.current, items: dubbingBatchChain.current.items.map((candidate) => ({ ...candidate })) });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  async function submitDubbingBatch(value) {
    const plan = normalizeDubbingBatch(value);
    const batchQuote = dubbingBatchQuote(plan, dubbingBatchUnitCredits);
    if (inFlight.current || busy || !localizedBatchEnabled || !plan || !batchQuote) return;
    if (!visual || !consent || !lipModel || !ttsModel || !compositionStatus.ready || balance == null || batchQuote.totalCredits > balance) return;
    if (plan.locales.some((locale) => estimatedSpeechSeconds(locale.script) > activeMaxSeconds)) {
      setError({ message: `Every reviewed translation must fit the ${activeMaxSeconds}-second speech limit.` });
      return;
    }

    inFlight.current = true;
    setSending(true);
    setError(null);
    clearJobs();
    setBaseResult(null);
    setProjectJobs([]);
    const run = {
      projectName: plan.projectName,
      workflowId: workflow.id,
      quote: batchQuote,
      visual: { file: visual.file, jobId: visual.jobId },
      lipModel: { id: lipModel.id, credits: lipModel.credits },
      ttsModel: { id: ttsModel.id, credits: ttsModel.credits },
      ttsSettings: { ...ttsSettings },
      caption: {
        enabled: composition.subtitles,
        preset: composition.captionPreset || 'simple',
        credits: captionsCredits,
      },
      longFormSyncMode,
      items: plan.locales.map((locale, index) => ({
        id: `${index + 1}-${locale.targetLanguage}`,
        ...locale,
        state: 'queued',
        speechJobId: null,
        performanceJobId: null,
        captionJobId: null,
        failureStage: null,
        failure: '',
      })),
    };
    dubbingBatchChain.current = run;
    setDubbingBatchRun({ ...run, items: run.items.map((item) => ({ ...item })) });
    setStage('batch-speech');

    let accepted = 0;
    try {
      for (const item of run.items) {
        try {
          const submitted = await gatewayFetch('/generations', {
            method: 'POST',
            body: JSON.stringify({
              model_id: ttsModel.id,
              idempotency_key: makeIdempotencyKey(),
              confirmed_credits: ttsModel.credits,
              inputs: {
                prompt: item.script,
                ...ttsGenerationInputs({ ...ttsSettings, language: item.targetLanguage }),
              },
            }),
          });
          item.speechJobId = submitted.job_id;
          item.state = 'speech';
          const queued = { job_id: submitted.job_id, state: 'queued', credits: ttsModel.credits, model_id: ttsModel.id };
          if (accepted === 0) startJobs(queued);
          else addJob(queued);
          accepted += 1;
          setProjectJobs((current) => [...current, {
            role: 'speech',
            locale: item.targetLanguage,
            job_id: submitted.job_id,
            state: 'queued',
            credits: ttsModel.credits,
            model_id: ttsModel.id,
          }]);
          setDubbingBatchRun((current) => current ? {
            ...current,
            items: current.items.map((candidate) => candidate.id === item.id ? {
              ...candidate,
              state: 'speech',
              speechJobId: submitted.job_id,
            } : candidate),
          } : current);
          pushJobHistory({
            job_id: submitted.job_id,
            model_id: ttsModel.id,
            credits: ttsModel.credits,
            prompt: item.script.slice(0, 60),
            name: `${plan.projectName} · ${item.targetLanguage} speech`,
          });
          notifyBalanceChanged();
        } catch (next) {
          item.state = 'failed';
          item.failureStage = 'speech';
          item.failure = 'This locale could not queue speech and was not charged.';
          setError(gatewayError(next));
          setDubbingBatchRun((current) => current ? {
            ...current,
            items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: item.state, failureStage: item.failureStage, failure: item.failure } : candidate),
          } : current);
          const remaining = run.items.slice(run.items.indexOf(item) + 1);
          for (const skipped of remaining) {
            skipped.state = 'failed';
            skipped.failureStage = 'speech';
            skipped.failure = 'Not submitted after the batch stopped.';
          }
          setDubbingBatchRun((current) => current ? {
            ...current,
            items: current.items.map((candidate) => {
              const skipped = remaining.find((entry) => entry.id === candidate.id);
              return skipped ? { ...candidate, state: skipped.state, failureStage: skipped.failureStage, failure: skipped.failure } : candidate;
            }),
          } : current);
          break;
        }
      }
      if (!accepted) {
        dubbingBatchChain.current = null;
        setStage('failed');
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  async function submit() {
    if (inFlight.current || busy || !visual || !consent || !lipModel) return;
    if (speechSource === 'script' && (!script.trim() || scriptTooLong || !ttsModel)) return;
    if (speechSource !== 'script' && (!audio || knownAudioTooLong(audio?.duration, activeMaxSeconds))) return;
    if (balance == null || quote.totalCredits > balance) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    clearJobs();
    setBaseResult(null);
    setDubbingBatchRun(null);
    dubbingBatchChain.current = null;
    setProjectJobs([]);
    setStage('uploading');
    try {
      const visualKey = visual.file ? await uploadSource(visual.file) : undefined;
      const visualAssetId = visual.jobId;
      if (speechSource === 'script') {
        const submitted = await gatewayFetch('/generations', {
          method: 'POST',
          body: JSON.stringify({
            model_id: ttsModel.id,
            idempotency_key: makeIdempotencyKey(),
            confirmed_credits: ttsModel.credits,
            inputs: { prompt: script.trim(), ...ttsGenerationInputs(ttsSettings) },
          }),
        });
        setProjectJobs([{ role: 'speech', job_id: submitted.job_id, state: 'queued', credits: ttsModel.credits, model_id: ttsModel.id }]);
        chain.current = { visualKey, visualAssetId, submitting: false };
        startJobs({ job_id: submitted.job_id, state: 'queued', credits: ttsModel.credits, model_id: ttsModel.id });
        pushJobHistory({
          job_id: submitted.job_id,
          model_id: ttsModel.id,
          credits: ttsModel.credits,
          prompt: script.trim().slice(0, 60),
          name: `Speech for ${workflow.label}`,
        });
        if (submitted.balance_after != null) setBalance(submitted.balance_after);
        notifyBalanceChanged();
        setStage('speech');
      } else {
        if (audio.jobId) await submitLipSync({ visualKey, visualAssetId, audioJobId: audio.jobId });
        else {
          const audioKey = await uploadSource(audio.file);
          await submitLipSync({ visualKey, visualAssetId, audioKey });
        }
      }
    } catch (next) {
      chain.current = null;
      setError(gatewayError(next));
      setStage('failed');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function chooseWorkflow(id) {
    if (busy) return;
    const next = workflowById(id);
    if (next.status !== 'available') return;
    if (next.sourceKind !== workflow.sourceKind) setVisualFile(null);
    if (!next.speechSources.includes(speechSource)) setSpeechSource(next.defaultSpeechSource);
    if (next.defaultLanguage) setTtsSettings((current) => ({ ...current, language: next.defaultLanguage }));
    if (next.id !== 'talking-photo') setComposition(DEFAULT_TALKING_AVATAR_COMPOSITION);
    setWorkflowId(id);
    setPerformanceModelId(null);
    setConsent(false);
    setError(null);
    setStage('idle');
    clearJobs();
    setProjectJobs([]);
    setDubbingBatchRun(null);
    dubbingBatchChain.current = null;
  }

  function chooseAvatar(profile) {
    setSelectedAvatarId(profile.id);
    setAvatarRequestMissing(false);
    setTtsSettings((current) => ({ ...current, voice: profile.voiceId }));
    setConsent(false);
    setError(null);
    avatarPortraitRequest.current = '';
    loadAvatarPortrait(profile);
    const url = new URL(window.location.href);
    url.searchParams.set('avatar', profile.id);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }

  function startAgain() {
    chain.current = null;
    dubbingBatchChain.current = null;
    captionPlan.current = null;
    setBaseResult(null);
    setDubbingBatchRun(null);
    clearJobs();
    setStage('idle');
    setError(null);
  }

  function selectDubbingLocale(draft) {
    if (busy || !draft) return;
    startAgain();
    setSpeechSource('script');
    setScript(draft.script);
    setTtsSettings((current) => ({ ...current, language: draft.targetLanguage }));
    setConsent(false);
  }

  function importProject(draft) {
    const nextWorkflow = workflowById(draft.workflowId);
    if (nextWorkflow.status !== 'available' || busy) return;
    setVisualFile(null);
    setAudioFile(null);
    if (backgroundRef.current?.previewUrl) URL.revokeObjectURL(backgroundRef.current.previewUrl);
    backgroundRef.current = null;
    setBackground(null);
    setWorkflowId(nextWorkflow.id);
    setRecipeId(draft.recipeId);
    setSpeechSource(nextWorkflow.speechSources.includes(draft.speechSource) ? draft.speechSource : nextWorkflow.defaultSpeechSource);
    setScript(draft.script.slice(0, nextWorkflow.scriptLimit || 0));
    setTtsSettings((current) => ({ ...current, ...draft.ttsSettings, voice: draft.ttsSettings.voice || current.voice }));
    setComposition({ ...DEFAULT_TALKING_AVATAR_COMPOSITION, ...draft.composition });
    const importedAvatar = draft.avatarId ? avatarProfiles.find((profile) => profile.id === draft.avatarId) : null;
    setSelectedAvatarId(importedAvatar?.id || null);
    setAvatarRequestMissing(Boolean(draft.avatarId && !importedAvatar));
    setConsent(false);
    setCompositionError('');
    setError(null);
    setStage('idle');
    setBaseResult(null);
    setProjectJobs([]);
    clearJobs();
    chain.current = null;
    dubbingBatchChain.current = null;
    setDubbingBatchRun(null);
    captionPlan.current = null;
    const url = new URL(window.location.href);
    url.searchParams.set('workflow', nextWorkflow.id);
    if (draft.recipeId) url.searchParams.set('recipe', draft.recipeId);
    else url.searchParams.delete('recipe');
    if (importedAvatar) url.searchParams.set('avatar', importedAvatar.id);
    else url.searchParams.delete('avatar');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }

  useEffect(() => {
    if (!enabled || restoredProjectHandoff.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('from') !== 'project') return;
    restoredProjectHandoff.current = true;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const snapshot = takePerformanceProjectHandoff(window.sessionStorage);
      if (!snapshot) {
        setProjectRestoreNotice('The saved workflow handoff expired or was invalid. No settings were changed.');
        return;
      }
      importProject(snapshot.draft);
      const reusable = snapshot.draft.requiredSources.filter((source) => source.libraryJobId && ['visual', 'audio'].includes(source.role));
      const manual = snapshot.draft.requiredSources.filter((source) => !reusable.includes(source));
      setProjectRestoreNotice(`Project settings reopened.${reusable.length ? ' Rechecking owned Library sources…' : ''}${manual.length ? ` Reselect ${manual.map((source) => source.name).join(', ')}.` : ''} Rights, consent and the live price must be approved again.`);
      if (reusable.length) {
        (async () => {
          const restored = [];
          const unavailable = [];
          const restoredWorkflow = workflowById(snapshot.draft.workflowId);
          for (const source of reusable) {
            try {
              const [sourceJob, asset] = await Promise.all([
                gatewayFetch(`/jobs/${source.libraryJobId}`),
                gatewayFetch(`/jobs/${source.libraryJobId}/asset`),
              ]);
              if (cancelled) return;
              const mime = String(asset.mime_type || '');
              const expected = source.role === 'audio' ? 'audio/' : `${restoredWorkflow.sourceKind}/`;
              if (sourceJob.state !== 'succeeded' || !mime.startsWith(expected)) throw new Error('project_source_unavailable');
              if (source.role === 'audio') setAudioLibrary({ id: source.libraryJobId, url: asset.url, label: source.name });
              else setVisualLibrary({ id: source.libraryJobId, url: asset.url, label: source.name });
              restored.push(source.name);
            } catch {
              unavailable.push(source.name);
            }
          }
          if (!cancelled) setProjectRestoreNotice(`Project settings reopened.${restored.length ? ` Restored owned Library ${restored.join(', ')}.` : ''}${[...manual.map((source) => source.name), ...unavailable].length ? ` Reselect ${[...manual.map((source) => source.name), ...unavailable].join(', ')}.` : ''} Rights, consent and the live price must be approved again.`);
        })();
      }
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // One-time session handoff; importProject intentionally resets authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return <PreviewGate />;

  const speechReady = speechSource === 'script'
    ? Boolean(script.trim()) && !scriptTooLong && Boolean(ttsModel)
    : Boolean(audio) && !knownAudioTooLong(audio?.duration, activeMaxSeconds);
  const blocked = busy || catalogLoading || !visual || !speechReady || !consent || !lipModel || !compositionStatus.ready
    || balance == null || quote.totalCredits > balance;
  const dubbingBatchBlockedReason = catalogLoading
    ? 'Checking live model prices…'
    : !visual
      ? `Add one permitted ${workflow.id === 'product-presenter' ? 'presenter-product composite' : 'source video'} before generating the batch.`
      : !consent
        ? 'Accept the rights and consent statement below before generating the batch.'
        : !lipModel || !ttsModel
          ? 'The required speech or lip-sync model is not currently available.'
          : !compositionStatus.ready
            ? 'Turn off burned subtitles because the live caption renderer is unavailable.'
          : balance == null
            ? 'Sign in and load your credit balance before generating the batch.'
            : '';
  const errorCopy = error?.message || ERROR_COPY[error?.code] || (error ? 'Something went wrong. Check Library before trying again.' : '');
  const outputJob = (job?.model_id === lipModel?.id || (job?.model_id === 'clip-edit' && job.state === 'succeeded'))
    ? job
    : baseResult;
  const projectExport = {
    workflow,
    recipeId,
    visual,
    audio,
    background,
    speechSource,
    script,
    ttsSettings,
    composition,
    quote,
    models: { speech: ttsModel?.id, performance: lipModel?.id, finishing: composition.subtitles ? clipEditModel?.id : null },
    consent,
    avatar: selectedAvatar,
    jobs: projectJobs.map((item) => {
      const liveJob = [job, baseResult, outputJob].find((candidate) => candidate?.job_id === item.job_id);
      return liveJob ? { ...item, state: liveJob.state } : item;
    }),
    catalogLive: live,
  };

  function useResultAsVideoInput() {
    if (!outputJob?.job_id || !outputJob?.asset_url) return;
    const next = { jobId: outputJob.job_id, previewUrl: outputJob.asset_url, label: 'Previous performance' };
    visualRef.current = next;
    setVisual(next);
    setWorkflowId('video-lip-sync');
    chain.current = null;
    captionPlan.current = null;
    setBaseResult(null);
    clearJobs();
    setStage('idle');
    setError(null);
    setConsent(false);
    const url = new URL(window.location.href);
    url.searchParams.set('workflow', 'video-lip-sync');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }

  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav balance={balance} active="performance" />
      <div className="mx-auto w-full max-w-[1380px] px-4 pb-20 pt-8 sm:px-8 sm:pt-12">
        <header className="flex flex-col gap-6 border-b border-vx-border pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">{dedicatedCharacterWorkflow === 'talking-cartoon' ? 'TALKING ILLUSTRATION STUDIO' : dedicatedCharacterWorkflow === 'talking-animal' ? 'TALKING ANIMALS STUDIO' : dedicatedCharacterWorkflow === 'talking-object' ? 'TALKING OBJECTS STUDIO' : dedicatedCharacterWorkflow === 'baby-podcast' ? 'SYNTHETIC BABY PODCAST STUDIO' : dedicatedProductPresenter ? 'PRODUCT AVATAR ANIMATION STUDIO' : dedicatedDubbing ? 'VIDEO DUBBING STUDIO' : dedicatedSingingPhoto ? 'SINGING PHOTO STUDIO' : dedicatedTalkingAvatar ? 'TALKING AVATAR STUDIO' : dedicatedLipSync ? 'LIP SYNC STUDIO' : 'PERFORMANCE STUDIO · PREVIEW'}</p>
              <Chip tone="neutral">{live ? 'Live catalog' : 'Cached catalog'}</Chip>
            </div>
            <h1 className="vx-display mt-3 text-[40px] leading-[0.95] sm:text-[58px]">{dedicatedTalkingAvatar ? 'Reuse the face. Change the message.' : dedicatedLipSync ? (workflow.id === 'video-lip-sync' ? 'Keep the performance. Change the words.' : 'Turn one portrait into a speaker.') : workflow.id === 'singing-photo' ? 'Turn a portrait into a performance.' : workflow.id === 'video-dubbing' ? 'Localise the voice. Keep the performance.' : workflow.id === 'product-presenter' ? 'Make the product pitch feel human.' : workflow.id === 'baby-podcast' ? 'Host a tiny podcast—synthetically.' : workflow.id === 'talking-object' ? 'Give an object a point of view.' : workflow.id === 'talking-animal' ? 'Give an animal a voice.' : workflow.id === 'talking-cartoon' ? 'Make an illustration speak.' : 'Give a face the right words.'}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-vx-fg-muted sm:text-base">
              {dedicatedTalkingAvatar ? 'Choose a saved avatar passport, an approved portrait, an owned Library image, or a Veyrnox.ai-original starter. Then write a script, upload owned audio, or record in the browser. The ten-second model limit, consent gate, exact staged quote, refunds, download and provenance stay visible.' : dedicatedLipSync ? 'Start with a permitted video or portrait, then write a script, upload owned audio, or record in the browser. Source limits, the two-stage speech charge, consent, and the final quote stay visible before anything runs.' : workflow.id === 'singing-photo' ? 'Start with one permitted portrait, then upload or record a cleared song clip. Veyrnox.ai shows the real model limit and price before anything runs.' : workflow.id === 'video-dubbing' ? 'Start with a short source video and a reviewed translation or owned dub. Veyrnox.ai shows the stock-voice and lip-sync charges before either job runs.' : workflow.id === 'product-presenter' ? 'Start with an approved presenter-and-product composite, then write, upload or record the pitch. Veyrnox.ai shows the separate speech and animation charges before either job runs.' : workflow.id === 'baby-podcast' ? 'Start with a fully synthetic baby character, then add a short script, cleared adult audio or an adult recording. Real child identities and voices are outside this workflow.' : workflow.id === 'talking-object' ? 'Start with one original object character—a product, food item, toy, package or everyday object—then write, upload or record its line. The experimental 10-second contract and full credit path stay visible.' : workflow.id === 'talking-animal' ? 'Start with one permitted pet, wildlife or mascot image, then write, upload or record the speech. Veyrnox.ai keeps the experimental 10-second model contract and full credit path visible.' : workflow.id === 'talking-cartoon' ? 'Start with one original or licensed character, then write, upload or record the speech. Veyrnox.ai keeps the renderer’s 10-second compatibility limit and full credit path visible.' : 'Start with a portrait or video, then write, upload or record the speech. Veyrnox.ai shows the whole credit path before anything runs.'}
            </p>
          </div>
          <div className="max-w-xs lg:text-right">
            <p className="text-xs leading-5 text-vx-fg-muted">{dedicatedProductPresenter ? 'Dedicated live product-presenter route. No competitor code, media or avatar library is used.' : 'Clean-room feature map recorded with this preview. No competitor code or media is used.'}</p>
            <Link href="/app/create" className="mt-3 inline-block text-xs font-black text-vx-accent underline underline-offset-4">Explore all 24 creation recipes</Link>
          </div>
        </header>

        {activeRecipe && (
          <section aria-label={`${activeRecipe.title} recipe`} className="mt-6 rounded-2xl border border-vx-accent/35 bg-vx-accent/[0.06] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">Selected recipe</p>
                <h2 className="mt-1 text-xl font-black">{activeRecipe.title}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-vx-fg-muted">{activeRecipe.description}</p>
              </div>
              <span className="rounded-full border border-vx-border bg-vx-panel px-3 py-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.1em] text-vx-fg-muted">{activeRecipe.status}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {activeRecipe.sourceSlots.map((slot) => <span key={slot} className="rounded-full border border-vx-border bg-vx-panel px-3 py-1.5 text-xs text-vx-fg-body">{slot}</span>)}
            </div>
            <p className="mt-3 text-xs text-vx-fg-faint">Rights gate: {activeRecipe.rights.join(' · ')}</p>
          </section>
        )}

        {dedicatedLipSync && (
          <section aria-labelledby="lip-sync-engine-title" className="mt-6 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
            <div className="border-b border-vx-border px-4 py-4 sm:px-5">
              <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">Live model contracts</p>
              <h2 id="lip-sync-engine-title" className="mt-1 text-xl font-black">Choose the source—not a vague quality toggle.</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-vx-fg-muted">These are separate live engines. Video Lip Sync preserves an existing performance; Talking Photo creates a new one from a still portrait. The selected engine fixes the accepted source, model and duration limit.</p>
            </div>
            <div className="grid sm:grid-cols-2" role="list" aria-label="Live lip-sync engine contracts">
              {LIP_SYNC_ENGINE_CONTRACTS.map((contract) => {
                const selected = contract.workflowId === workflow.id;
                return (
                  <div key={contract.workflowId} role="listitem" className="border-b border-vx-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:p-5">
                    <button type="button" aria-pressed={selected} disabled={busy} onClick={() => chooseWorkflow(contract.workflowId)} className="w-full rounded-xl border border-vx-border bg-vx-base p-4 text-left transition-colors hover:border-vx-accent disabled:opacity-55 aria-pressed:border-vx-accent aria-pressed:ring-2 aria-pressed:ring-vx-accent/20">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-base font-black">{workflowById(contract.workflowId).label}</span>
                        <span className={`rounded-full px-2.5 py-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] ${selected ? 'bg-vx-accent text-vx-accent-ink' : 'border border-vx-border text-vx-fg-muted'}`}>{selected ? 'Selected' : contract.badge}</span>
                      </span>
                      <span className="mt-3 block text-sm leading-5 text-vx-fg-body">{contract.summary}</span>
                      <span className="mt-4 grid grid-cols-3 gap-2 border-y border-vx-border py-3">
                        <span><span className="block font-vx-mono text-[8px] font-bold uppercase tracking-[0.1em] text-vx-fg-faint">Model</span><span className="mt-1 block text-[11px] font-bold">{contract.modelLabel}</span></span>
                        <span><span className="block font-vx-mono text-[8px] font-bold uppercase tracking-[0.1em] text-vx-fg-faint">Source</span><span className="mt-1 block text-[11px] font-bold">{contract.sourceLabel}</span></span>
                        <span><span className="block font-vx-mono text-[8px] font-bold uppercase tracking-[0.1em] text-vx-fg-faint">Maximum</span><span className="mt-1 block text-[11px] font-bold">{contract.maxSeconds}s</span></span>
                      </span>
                      <span className="mt-3 block text-[11px] leading-4 text-vx-fg-muted">{contract.boundary}</span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-vx-border bg-vx-base/60 px-4 py-3 text-[11px] leading-5 text-vx-fg-muted sm:px-5">Price comes from the live catalog after the source and speech path are known. Veyrnox.ai shows the exact staged quote before any paid job runs.</div>
          </section>
        )}

        <section className="mt-8" aria-labelledby="performance-workflow-title">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">WORKFLOWS</p>
              <h2 id="performance-workflow-title" className="mt-2 text-2xl font-black">{dedicatedLipSync ? 'Configure the selected workflow' : 'Choose the performance'}</h2>
            </div>
            <p className="hidden text-xs text-vx-fg-muted sm:block">{dedicatedCharacterWorkflow === 'baby-podcast' ? 'One fully synthetic character and one adult-provided or stock speech source per render.' : dedicatedCharacterWorkflow ? 'One approved character image and one reviewed speech source per render.' : dedicatedProductPresenter ? 'One approved presenter-product composite and one reviewed speech source per render.' : dedicatedDubbing ? 'One reviewed locale per paid render.' : dedicatedSingingPhoto ? 'One permitted portrait and one cleared song clip per render.' : dedicatedTalkingAvatar ? 'One approved avatar and one reviewed speech source per render.' : dedicatedLipSync ? 'Choose video preservation or portrait animation.' : 'Available workflows run today. Planned ones are honest placeholders.'}</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {visibleWorkflows.map((item) => {
              const engineContract = dedicatedLipSync ? lipSyncEngineContract(item) : null;
              const content = (
                <>
                  <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-faint">{item.eyebrow}</span>
                  <span className="mt-2 block text-sm font-black">{item.label}</span>
                  <span className="mt-2 block text-[11px] leading-4 text-vx-fg-muted">{item.description}</span>
                  {engineContract && <span className="mt-2 block font-vx-mono text-[9px] font-bold uppercase tracking-[0.08em] text-vx-fg-faint">{engineContract.modelLabel} · {engineContract.maxSeconds}s max</span>}
                  <span className={`mt-3 block font-vx-mono text-[9px] font-bold tracking-[0.1em] ${item.status === 'planned' ? 'text-vx-fg-faint' : 'text-vx-accent'}`}>
                    {item.status === 'available' ? '● AVAILABLE' : item.href ? '↗ OPEN TOOL' : '○ PLANNED'}
                  </span>
                </>
              );
              const className = 'min-h-36 rounded-2xl border border-vx-border bg-vx-panel p-4 text-left transition-colors hover:border-vx-accent disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07]';
              if (item.href) return <Link key={item.id} href={item.href} className={className}>{content}</Link>;
              return <button key={item.id} type="button" disabled={item.status !== 'available' || busy} aria-pressed={workflowId === item.id} onClick={() => chooseWorkflow(item.id)} className={className}>{content}</button>;
            })}
          </div>
        </section>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            {dedicatedLipSync && workflow.id === 'talking-photo' && (
              <section className={`${card} p-4 sm:p-5`} aria-labelledby="talking-photo-model-title">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">Talking Photo model</p>
                    <h2 id="talking-photo-model-title" className="mt-1 text-lg font-black">Choose speed, fidelity and price</h2>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted">Both models accept one permitted image and speech up to ten seconds. Each card uses its own live catalog price.</p>
                  </div>
                  <span className="rounded-full border border-vx-border px-3 py-1.5 font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-fg-muted">2 live models</span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2" role="list" aria-label="Talking Photo models">
                  {TALKING_PHOTO_MODEL_CONTRACTS.map((contract) => {
                    const model = performanceModels.find((item) => item.id === contract.id);
                    const selected = lipModel?.id === contract.id;
                    return (
                      <div key={contract.id} role="listitem">
                        <button type="button" aria-pressed={selected} disabled={busy || !model} onClick={() => { setPerformanceModelId(contract.id); setConsent(false); setError(null); startAgain(); }} className="h-full w-full rounded-xl border border-vx-border bg-vx-base p-4 text-left transition-colors hover:border-vx-accent disabled:opacity-45 aria-pressed:border-vx-accent aria-pressed:ring-2 aria-pressed:ring-vx-accent/20">
                          <span className="flex items-center justify-between gap-3"><span className="text-sm font-black">{contract.label}</span><span className="font-vx-mono text-[10px] font-bold text-vx-money">{model ? `${model.credits} cr` : 'Unavailable'}</span></span>
                          <span className="mt-1 block font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-accent">{contract.badge} · {contract.maxSeconds}s max</span>
                          <span className="mt-3 block text-xs leading-5 text-vx-fg-body">{contract.summary}</span>
                          <span className="mt-2 block text-[10px] leading-4 text-vx-fg-muted">Best fit: {contract.sourceFit}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            {((dedicatedLipSync && workflow.id === 'video-lip-sync') || dedicatedDubbing) && (
              <section className={`${card} p-4 sm:p-5`} aria-labelledby="video-lip-sync-model-title">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{dedicatedDubbing ? 'Video Dubbing engine' : 'Video Lip Sync model'}</p>
                    <h2 id="video-lip-sync-model-title" className="mt-1 text-lg font-black">Choose duration, cost and mismatch handling</h2>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted">{dedicatedDubbing ? 'Quick clip is the lower-cost 40-second path. Long-form accepts an owned video and speech track up to three minutes; reviewed text remains bounded by the editor’s script limit.' : 'Both models preserve an existing performance. Long-form expands the server-enforced source limit from 40 seconds to three minutes.'}</p>
                  </div>
                  <span className="rounded-full border border-vx-border px-3 py-1.5 font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-fg-muted">2 live models</span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2" role="list" aria-label={dedicatedDubbing ? 'Video Dubbing engines' : 'Video Lip Sync models'}>
                  {VIDEO_LIP_SYNC_MODEL_CONTRACTS.map((contract) => {
                    const model = performanceModels.find((item) => item.id === contract.id);
                    const selected = lipModel?.id === contract.id;
                    return (
                      <div key={contract.id} role="listitem">
                        <button type="button" aria-pressed={selected} disabled={busy || !model} onClick={() => { setPerformanceModelId(contract.id); setConsent(false); setError(null); startAgain(); }} className="h-full w-full rounded-xl border border-vx-border bg-vx-base p-4 text-left transition-colors hover:border-vx-accent disabled:opacity-45 aria-pressed:border-vx-accent aria-pressed:ring-2 aria-pressed:ring-vx-accent/20">
                          <span className="flex items-center justify-between gap-3"><span className="text-sm font-black">{contract.label}</span><span className="font-vx-mono text-[10px] font-bold text-vx-money">{model ? `${model.credits} cr` : 'Unavailable'}</span></span>
                          <span className="mt-1 block font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-accent">{contract.badge} · {contract.maxSeconds}s max</span>
                          <span className="mt-3 block text-xs leading-5 text-vx-fg-body">{contract.summary}</span>
                          <span className="mt-2 block text-[10px] leading-4 text-vx-fg-muted">Best fit: {contract.sourceFit}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                {lipModel?.id === 'sync-lipsync-1.9-long' && (
                  <label className="mt-4 block rounded-xl border border-vx-border bg-vx-base p-4 text-xs font-bold text-vx-fg-body">
                    When video and speech have different lengths
                    <select value={longFormSyncMode} onChange={(event) => { setLongFormSyncMode(event.target.value); setConsent(false); setError(null); startAgain(); }} disabled={busy} className={`${input} mt-2`} aria-label="Long-form duration mismatch handling">
                      {LONG_FORM_SYNC_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label} — {mode.description}</option>)}
                    </select>
                  </label>
                )}
              </section>
            )}
            {workflow.id === 'talking-photo' && (recipeId === 'talking-avatar' || avatarProfiles.length > 0 || avatarRequestMissing) && (
              <AvatarPassportPicker profiles={avatarProfiles} selectedId={selectedAvatarId} requestedMissing={avatarRequestMissing} onSelect={chooseAvatar} disabled={busy} />
            )}
            <SourceCard workflow={activeWorkflow} source={visual} onPick={setVisualFile} onLibrary={() => setLibraryOpen('visual')} onSample={setVisualSample} sampleLoadingId={sampleLoadingId} disabled={busy || Boolean(sampleLoadingId)} />
            {workflow.id === 'video-dubbing' && <DubbingBrief settings={ttsSettings} onSettings={setTtsSettings} disabled={busy} importedSpeakerCount={dubbingSpeakerCount} hasSpeakerTranscript={dubbingSpeakerTranscript} importedCast={dubbingCast} />}
            {localizedBatchEnabled && (
              <DubbingLocalePlanner
                unitCredits={dubbingBatchUnitCredits}
                balance={balance}
                onUseLocale={selectDubbingLocale}
                onGenerateBatch={submitDubbingBatch}
                generationBlockedReason={dubbingBatchBlockedReason}
                disabled={busy}
                mode={workflow.id}
              />
            )}
            {localizedBatchEnabled && dubbingBatchRun && (
              <section className={`${card} p-4 sm:p-5`} aria-labelledby="dubbing-batch-progress-title">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">LOCALIZED OUTPUTS</p>
                    <h2 id="dubbing-batch-progress-title" className="mt-1 text-lg font-black">{dubbingBatchRun.projectName}</h2>
                    <p className="mt-1 text-xs leading-5 text-vx-fg-muted">One {dubbingBatchRun.workflowId === 'product-presenter' ? 'approved composite' : 'source'} · {dubbingBatchRun.items.length} reviewed languages · separately tracked speech, {dubbingBatchRun.workflowId === 'product-presenter' ? 'presenter-animation' : 'lip-sync'}{dubbingBatchRun.caption?.enabled ? ' and subtitle' : ''} jobs.</p>
                  </div>
                  <span className="rounded-full border border-vx-border px-3 py-1 font-vx-mono text-[10px] font-bold text-vx-money">{dubbingBatchRun.quote.totalCredits} CR APPROVED</span>
                </div>
                <ol className="mt-4 space-y-3" aria-label="Dubbing batch job status">
                  {dubbingBatchRun.items.map((item, index) => {
                    const speechJob = jobs.find((candidate) => candidate.job_id === item.speechJobId);
                    const performanceJob = jobs.find((candidate) => candidate.job_id === item.performanceJobId);
                    const captionJob = jobs.find((candidate) => candidate.job_id === item.captionJobId);
                    const downloadJob = captionJob?.state === 'succeeded' ? captionJob : performanceJob?.state === 'succeeded' ? performanceJob : null;
                    const retryQuote = dubbingLocaleRetryQuote(item, {
                      ttsCredits: dubbingBatchRun.ttsModel?.credits,
                      performanceCredits: dubbingBatchRun.lipModel?.credits,
                      captionCredits: dubbingBatchRun.caption?.enabled ? dubbingBatchRun.caption.credits : 0,
                    });
                    const downloadLabel = dubbingBatchRun.caption?.enabled && captionJob?.state !== 'succeeded' ? `Download ${item.targetLanguage} base` : `Download ${item.targetLanguage}`;
                    const label = item.state === 'queued' ? 'Waiting' : item.state === 'speech' ? 'Creating speech' : item.state === 'uploading' ? 'Checking source' : item.state === 'rendering' ? (dubbingBatchRun.workflowId === 'product-presenter' ? 'Animating presenter' : 'Syncing video') : item.state === 'captioning' ? 'Burning subtitles' : item.state === 'partial' ? 'Base ready · subtitles stopped' : item.state === 'succeeded' ? 'Ready' : 'Stopped';
                    return (
                      <li key={item.id} className="rounded-xl border border-vx-border bg-vx-base p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-vx-accent/40 font-vx-mono text-[9px] font-bold text-vx-accent">{String(index + 1).padStart(2, '0')}</span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black">{item.targetLanguage}</p>
                              <p className="mt-0.5 font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-fg-muted">{label}</p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {downloadJob?.asset_url && (
                              <>
                                <DownloadAsset row={downloadJob} label={downloadLabel} className="inline-flex min-h-9 items-center rounded-full bg-vx-accent px-3 text-[11px] font-extrabold text-vx-accent-ink disabled:opacity-50" errorClassName="basis-full text-xs text-vx-danger" />
                              </>
                            )}
                            {retryQuote && (
                              <button
                                type="button"
                                onClick={() => retryDubbingLocale(item.id)}
                                disabled={busy || !consent || balance == null || retryQuote.totalCredits > balance}
                                className="inline-flex min-h-9 items-center rounded-full border border-vx-accent px-3 text-[11px] font-extrabold text-vx-accent disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                {retryQuote.label} · {retryQuote.totalCredits} CR
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-vx-fg-body">{item.script}</p>
                        {item.failure && <p className="mt-2 text-[11px] text-vx-danger">{item.failure}</p>}
                        {retryQuote && <p className="mt-2 text-[10px] leading-4 text-vx-fg-muted">Only the stopped stage and its remaining dependants will run. Successful earlier jobs stay charged and are reused. The button shows the complete new maximum charge.</p>}
                        {speechJob?.state === 'succeeded' && item.state === 'failed' && !performanceJob && <p className="mt-2 text-[11px] text-vx-fg-muted">The reusable speech asset remains in Library.</p>}
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
            <SpeechCard
              mode={speechSource}
              onMode={(mode) => { setSpeechSource(mode); setError(null); }}
              script={script}
              onScript={setScript}
              scriptLimit={workflow.scriptLimit}
              ttsSettings={ttsSettings}
              onTtsSettings={setTtsSettings}
              estimate={speechEstimate}
              maxSeconds={activeMaxSeconds}
              audio={audio}
              onAudio={setAudioFile}
              onAudioLibrary={() => setLibraryOpen('audio')}
              onAudioReference={setAudioLibrary}
              recording={recording}
              recordSeconds={recordSeconds}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              disabled={busy}
              workflow={workflow}
            />
            {workflow.id === 'video-dubbing' && (
              <SubtitleTranscriptEditor
                script={speechSource === 'script' ? script : ''}
                language={ttsSettings.language === 'auto' ? 'English' : ttsSettings.language}
                maxSeconds={activeMaxSeconds}
                disabled={busy}
              />
            )}
            {(dedicatedLipSync || workflow.id === 'video-dubbing' || (workflow.id === 'talking-photo' && recipeId === 'talking-avatar')) && (
              <TalkingAvatarComposition
                settings={composition}
                onSettings={(next) => { setComposition(next); setCompositionError(''); }}
                background={background}
                onBackground={setBackgroundFile}
                disabled={busy}
                subtitlesAvailable={captionRendererAvailable}
                showPictureInPicture={!dedicatedLipSync && workflow.id !== 'video-dubbing'}
                eyebrow={(dedicatedLipSync || workflow.id === 'video-dubbing') ? 'FINISHING' : undefined}
                title={workflow.id === 'video-dubbing' ? 'Add burned subtitles to every dub' : dedicatedLipSync ? 'Finish the exported video' : undefined}
                description={workflow.id === 'video-dubbing' ? 'Optional burned subtitles run after each locale’s lip sync as a separately priced and refunded finishing job.' : dedicatedLipSync ? 'Add burned subtitles as a separate finishing render. Its price, progress and refund stay separate from speech and lip sync.' : undefined}
              />
            )}
            {compositionError && <p role="alert" className="rounded-xl border border-vx-danger/35 bg-vx-danger/[0.05] px-4 py-3 text-xs text-vx-danger">{compositionError}</p>}

            <section className={`${card} p-4 sm:p-5`} aria-labelledby="performance-rights-title">
              <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">STEP 3</p>
              <h2 id="performance-rights-title" className="mt-1 text-lg font-black">Rights and consent</h2>
              <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-6 text-vx-fg-body">
                <input type="checkbox" className="mt-1 accent-vx-accent" checked={consent} disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)} />
                <span>
                  {visual?.sampleId
                    ? 'I am using this Veyrnox.ai-original fictional portrait only for an authorized synthetic performance. I own or may use the speech and will disclose synthetic media where required.'
                    : workflow.id === 'singing-photo'
                    ? 'I own or license the composition, master recording and performance, and I have permission from everyone identifiable in the portrait or audio.'
                    : workflow.id === 'video-dubbing'
                      ? 'I own or license the source video and translated script or dubbed audio, and I have permission from every identifiable speaker. The translation has been reviewed for the intended audience.'
                      : workflow.id === 'product-presenter'
                        ? 'I own or may use this presenter likeness, product, packaging, branding and speech. Every product claim and implied endorsement is accurate and approved, and I will disclose synthetic media where required.'
                      : workflow.id === 'baby-podcast'
                        ? 'I confirm this character is fully synthetic and does not depict a real child. The speech is stock-generated or performed by a consenting adult; no child voice, private information, sexual content, exploitation or deceptive claim is included.'
                      : workflow.id === 'talking-object'
                        ? 'I own or license this object design and speech. I have permission for every identifiable person, voice, logo and brand represented; product claims are accurate, no endorsement is implied, and I am not presenting the result as authentic footage.'
                      : workflow.id === 'talking-animal'
                        ? 'I own or license this animal image and speech. I have permission for every identifiable person, voice, logo and brand represented, and the source was created without harming or distressing an animal.'
                      : workflow.id === 'talking-cartoon'
                        ? 'I own or license this character artwork and speech. I have permission for every identifiable likeness, voice, logo and brand represented, and I am not presenting the result as authentic footage.'
                      : 'I own these files, or I have the permission of everyone identifiable in them. No real person\'s face, body or voice is used without consent, and I hold the rights to any recording, artwork or brand.'}
                  {' '}<Link href="/legal/aup" target="_blank" className="text-vx-accent underline">Acceptable Use</Link>
                </span>
              </label>
            </section>

            {error && (
              <div role="alert" className="rounded-2xl border border-vx-danger/40 bg-vx-danger/[0.07] p-4 text-sm text-vx-danger">
                <strong className="block">This performance did not continue.</strong>
                <span className="mt-1 block">{errorCopy}{error.retryAfter ? ` Retry in ${error.retryAfter}s.` : ''}</span>
                {stage === 'failed' && speechSource === 'script' && job?.model_id === ttsModel?.id && job?.state === 'succeeded' && (
                  <span className="mt-2 block text-vx-fg-body">The speech file succeeded and remains in Library; the lip-sync job was not charged.</span>
                )}
              </div>
            )}
          </div>

          <aside className="space-y-5 lg:sticky lg:top-24">
            <section className={`${card} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-vx-border px-5 py-4">
                <div>
                  <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">RESULT</p>
                  <h2 className="mt-1 font-black">{workflow.label}</h2>
                </div>
                {job && <Chip tone={job.state === 'failed' ? 'danger' : 'accent'}>{jobStateUi(job).label}</Chip>}
              </div>
              <div className="relative aspect-video bg-black">
                {outputJob?.asset_url ? <JobAssetPreview job={outputJob} /> : visual ? (
                  <>
                    <FilePreview source={visual} kind={workflow.sourceKind} />
                    {(sending || generating) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/72 px-6 text-center">
                        <span className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">● {stage === 'speech' ? 'CREATING SPEECH' : stage === 'uploading' ? 'CHECKING SOURCES' : stage === 'captioning' ? 'BURNING SUBTITLES' : 'SYNCING PERFORMANCE'}</span>
                        <span className="mt-3 text-xs leading-5 text-white/70">You can leave this page after the paid job is queued. Library keeps the result and refund state.</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-white/50">Add a source to begin.</div>
                )}
                {workflow.id === 'talking-photo' && recipeId === 'talking-avatar' && <TalkingAvatarCompositionPreview settings={composition} background={background} visual={visual} script={script} />}
              </div>
              <p className="border-t border-vx-border px-5 py-3 text-[11px] leading-5 text-vx-fg-muted">
                Veyrnox.ai does not embed a content credential in the generated file.
              </p>
              <OutputFileDisclosure className="mx-5 my-4" />
              <div className="flex flex-wrap gap-2 border-t border-vx-border px-5 py-4">
                <SavePerformanceProject project={projectExport} allowedWorkflowIds={visibleWorkflows.filter((item) => item.status === 'available').map((item) => item.id)} className="inline-flex min-h-10 items-center rounded-full border border-vx-border px-4 text-xs font-extrabold text-vx-fg hover:border-vx-accent" />
                {projectRestoreNotice && <p role="status" className="basis-full rounded-lg border border-vx-accent/30 bg-vx-accent/[0.06] px-3 py-2 text-[11px] leading-5 text-vx-fg-muted">{projectRestoreNotice}</p>}
                <p className="basis-full text-[11px] leading-4 text-vx-fg-muted">Saves workflow settings, safe source descriptors, quote components and job lineage. Opening a saved project restores editable settings only: media, consent, job authority and the live price are never trusted from a file. An authenticated project can recheck owned Library job IDs; local files still need re-selection, and consent and live pricing always reset.</p>
              </div>
              {job?.state === 'failed' && <p className="border-t border-vx-border px-5 py-4 text-sm text-vx-danger">{failedJobCopy(job)}</p>}
              {stage === 'done' && outputJob && (
                <div className="flex flex-wrap gap-2 border-t border-vx-border px-5 py-4">
                  <DownloadAsset row={outputJob} label="Download video" className="inline-flex min-h-10 items-center rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:opacity-50" errorClassName="basis-full text-xs text-vx-danger" />
                  {composition.pictureInPicture && background?.file && <LocalPipExport jobId={outputJob.job_id} background={background} settings={composition} />}
                  <Button size="sm" variant="ghost" onClick={useResultAsVideoInput}>Use as video input</Button>
                  <Button size="sm" variant="ghost" onClick={startAgain}>Adjust and make another</Button>
                  <Link href="/app/library" className="inline-flex min-h-10 items-center px-2 text-sm font-bold text-vx-accent underline">Open Library</Link>
                </div>
              )}
              {stage === 'failed' && (
                <div className="flex flex-wrap gap-2 border-t border-vx-border px-5 py-4">
                  {baseResult && <DownloadAsset row={baseResult} label="Download base video" className="inline-flex min-h-10 items-center rounded-full border border-vx-border px-4 text-xs font-extrabold text-vx-fg disabled:opacity-50" errorClassName="basis-full text-xs text-vx-danger" />}
                  <Button size="sm" variant="ghost" onClick={startAgain}>Review and retry</Button>
                  <Link href="/app/library" className="inline-flex min-h-10 items-center px-2 text-sm font-bold text-vx-accent underline">Open Library</Link>
                  <p className="basis-full text-[11px] leading-4 text-vx-fg-muted">Retry returns to the same sources and settings. Nothing is submitted or charged until you approve the quote again.</p>
                </div>
              )}
            </section>

            <section className={`${card} p-5`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">MODEL</p>
                  <p className="mt-2 text-sm font-black">{lipModel?.name || 'Model unavailable'}</p>
                  <p className="mt-1 text-xs leading-5 text-vx-fg-muted">{activeMaxSeconds}s maximum · {workflow.id === 'product-presenter' ? 'product composite' : workflow.id === 'baby-podcast' ? 'synthetic baby character' : workflow.id === 'talking-object' ? 'object character' : workflow.id === 'talking-animal' ? 'animal image' : workflow.id === 'talking-cartoon' ? 'illustration' : workflow.sourceKind === 'image' ? 'portrait' : 'video'} + {workflow.id === 'singing-photo' ? 'cleared song' : 'speech'}</p>
                </div>
                {lipModel && <span className="font-vx-mono text-sm font-bold text-vx-money">{lipModel.credits} cr</span>}
              </div>
              {speechSource === 'script' && (
                <div className="mt-4 border-t border-vx-border pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold">{ttsModel?.name || 'Speech model unavailable'}</p>
                      <p className="mt-1 text-xs text-vx-fg-muted">Creates a separate reusable {workflow.id === 'video-dubbing' ? `${ttsSettings.language === 'auto' ? 'English' : ttsSettings.language} dub` : 'audio asset'} first.</p>
                    </div>
                    {ttsModel && <span className="font-vx-mono text-sm font-bold text-vx-money">{ttsModel.credits} cr</span>}
                  </div>
                </div>
              )}
              {composition.subtitles && clipEditModel && (
                <div className="mt-4 border-t border-vx-border pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div><p className="text-sm font-bold">Burned subtitles</p><p className="mt-1 text-xs text-vx-fg-muted">Runs after lip sync as a separately refunded render.</p></div>
                    <span className="font-vx-mono text-sm font-bold text-vx-money">{captionsCredits} cr</span>
                  </div>
                </div>
              )}
            </section>

            <section className={`${card} p-5`}>
              <div className="flex items-baseline justify-between">
                <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">APPROVE TOTAL</p>
                <p className="font-vx-mono text-[11px] text-vx-fg-muted">balance {balance ?? '—'} cr</p>
              </div>
              <p className="mt-2 font-vx-mono text-[38px] font-black text-vx-money">−{quote.totalCredits} cr</p>
              {speechSource === 'script' && (
                <p className="mt-2 text-xs leading-5 text-vx-fg-muted">
                  {quote.speechCredits} credits for speech, then {quote.lipSyncCredits} for {workflow.id === 'product-presenter' ? 'presenter animation' : 'lip sync'}. If speech succeeds but {workflow.id === 'product-presenter' ? 'animation' : 'lip sync'} cannot start, the speech stays in Library and only its charge stands.
                </p>
              )}
              {composition.subtitles && <p className="mt-2 text-xs leading-5 text-vx-fg-muted">The base performance is created first, then {captionsCredits} credits are charged for burned subtitles. If captioning fails, that second job is refunded and the base video remains in Library.</p>}
              {composition.pictureInPicture && <p className="mt-2 text-xs leading-5 text-vx-fg-muted">Picture-in-picture adds no credits. After the performance succeeds, this browser combines it with the selected background and prepares a local WebM download.</p>}
              <Button className="mt-5 w-full justify-between" cost={quote.totalCredits} disabled={blocked} onClick={submit}>
                {sending ? 'Preparing…' : generating ? 'Generation running' : workflow.id === 'video-dubbing' ? 'Create dubbed video' : workflow.id === 'product-presenter' ? 'Create product presenter' : workflow.id === 'baby-podcast' ? 'Create synthetic baby podcast' : workflow.id === 'talking-object' ? 'Create talking object' : workflow.id === 'talking-animal' ? 'Create talking animal' : workflow.id === 'talking-cartoon' ? 'Create talking illustration' : 'Create performance'}
              </Button>
              {!visual && <p className="mt-3 text-xs text-vx-fg-muted">Add the required source.</p>}
              {visual && !speechReady && <p className="mt-3 text-xs text-vx-fg-muted">Add {workflow.id === 'singing-photo' ? 'a cleared song clip' : 'speech'} that fits the {activeMaxSeconds}s model limit.</p>}
              {visual && speechReady && !consent && <p className="mt-3 text-xs text-vx-fg-muted">Confirm the rights statement to continue.</p>}
              {!compositionStatus.ready && <p className="mt-3 rounded-xl border border-vx-money/35 bg-vx-money/[0.05] px-3 py-2 text-xs leading-5 text-vx-fg-muted">{compositionStatus.code === 'background_required' ? 'Add the required background video before picture-in-picture can be composed.' : 'The live caption renderer is unavailable in this environment.'}</p>}
              {balance != null && quote.totalCredits > balance && <p className="mt-3 text-xs text-vx-danger">You need {quote.totalCredits - balance} more credits. <Link href="/app/credits" className="underline">Add credits</Link>.</p>}
              <p className="mt-3 text-center font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-faint">PRICE PINNED PER JOB · REFUND ON FAILED JOBS</p>
            </section>
          </aside>
        </div>
      </div>
      {libraryOpen && (
        <LibraryPicker
          mediaKind={libraryOpen === 'audio' ? 'audio' : workflow.sourceKind}
          onPick={libraryOpen === 'audio' ? setAudioLibrary : setVisualLibrary}
          onClose={() => setLibraryOpen(null)}
        />
      )}
    </div>
  );
}
