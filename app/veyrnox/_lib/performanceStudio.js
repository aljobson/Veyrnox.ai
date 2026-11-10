export const PERFORMANCE_WORKFLOWS = [
  {
    id: 'talking-photo',
    label: 'Talking photo',
    eyebrow: 'IMAGE + SPEECH',
    description: 'Make one portrait deliver a script or recording.',
    modelId: 'kling-avatar-v2',
    modelIds: ['kling-avatar-v2', 'sync-lipsync-v3'],
    sourceKind: 'image',
    maxSeconds: 10,
    scriptLimit: 1000,
    speechSources: ['script', 'upload', 'record'],
    defaultSpeechSource: 'script',
    status: 'available',
  },
  {
    id: 'product-presenter',
    label: 'Product presenter',
    eyebrow: 'PRODUCT COMPOSITE + SPEECH',
    description: 'Animate one approved presenter-and-product composite with a script or recording.',
    modelId: 'kling-avatar-v2',
    sourceKind: 'image',
    maxSeconds: 10,
    scriptLimit: 600,
    speechSources: ['script', 'upload', 'record'],
    defaultSpeechSource: 'script',
    status: 'available',
  },
  {
    id: 'talking-cartoon',
    label: 'Talking illustration',
    eyebrow: 'ARTWORK + SPEECH',
    description: 'Animate one original illustration with a script or recording.',
    modelId: 'kling-avatar-v2',
    sourceKind: 'image',
    maxSeconds: 10,
    scriptLimit: 600,
    speechSources: ['script', 'upload', 'record'],
    defaultSpeechSource: 'script',
    status: 'available',
  },
  {
    id: 'talking-animal',
    label: 'Talking animal',
    eyebrow: 'ANIMAL + SPEECH',
    description: 'Animate one permitted animal image with a script or recording.',
    modelId: 'kling-avatar-v2',
    sourceKind: 'image',
    maxSeconds: 10,
    scriptLimit: 600,
    speechSources: ['script', 'upload', 'record'],
    defaultSpeechSource: 'script',
    status: 'available',
  },
  {
    id: 'baby-podcast',
    label: 'Synthetic baby podcast',
    eyebrow: 'SYNTHETIC BABY + SPEECH',
    description: 'Make an original synthetic baby character deliver a short podcast line.',
    modelId: 'kling-avatar-v2',
    sourceKind: 'image',
    maxSeconds: 10,
    scriptLimit: 600,
    speechSources: ['script', 'upload', 'record'],
    defaultSpeechSource: 'script',
    status: 'available',
  },
  {
    id: 'talking-object',
    label: 'Talking object',
    eyebrow: 'OBJECT + SPEECH',
    description: 'Animate one original object character with a script or recording.',
    modelId: 'kling-avatar-v2',
    sourceKind: 'image',
    maxSeconds: 10,
    scriptLimit: 600,
    speechSources: ['script', 'upload', 'record'],
    defaultSpeechSource: 'script',
    status: 'available',
  },
  {
    id: 'video-lip-sync',
    label: 'Video lip sync',
    eyebrow: 'VIDEO + SPEECH',
    description: 'Replace the speech in a short clip while keeping the performance.',
    modelId: 'latentsync',
    modelIds: ['latentsync', 'sync-lipsync-1.9-long'],
    sourceKind: 'video',
    maxSeconds: 40,
    scriptLimit: 1000,
    speechSources: ['script', 'upload', 'record'],
    defaultSpeechSource: 'script',
    status: 'available',
  },
  {
    id: 'singing-photo',
    label: 'Singing photo',
    eyebrow: 'IMAGE + SONG',
    description: 'Sync one permitted portrait to a cleared song clip.',
    modelId: 'kling-avatar-v2',
    sourceKind: 'image',
    maxSeconds: 10,
    scriptLimit: 0,
    speechSources: ['upload', 'record'],
    defaultSpeechSource: 'upload',
    status: 'available',
  },
  { id: 'dialogue', label: 'Dialogue', eyebrow: '2–4 SPEAKERS', description: 'Stage ordered turns, distinct stock voices and reusable audio.', status: 'tool', href: '/app/dialogue' },
  {
    id: 'video-dubbing',
    label: 'Video dubbing',
    eyebrow: 'REVIEWED LOCALISE',
    description: 'Turn an approved translation or dubbed track into a lip-synced locale version.',
    modelId: 'latentsync',
    modelIds: ['latentsync', 'sync-lipsync-1.9-long'],
    sourceKind: 'video',
    maxSeconds: 40,
    scriptLimit: 360,
    speechSources: ['script', 'upload', 'record'],
    defaultSpeechSource: 'script',
    defaultLanguage: 'English',
    status: 'available',
  },
  { id: 'motion', label: 'Motion control', eyebrow: 'REFERENCE', description: 'Transfer cleared movement to an original character.', status: 'planned' },
];

export const LIP_SYNC_ENGINE_CONTRACTS = Object.freeze([
  Object.freeze({
    workflowId: 'video-lip-sync',
    modelId: 'latentsync',
    modelLabel: 'LatentSync',
    sourceLabel: 'MP4 + speech',
    maxSeconds: 40,
    badge: 'Existing video',
    summary: 'Preserves the source performance while replacing its speech.',
    boundary: 'Best when the clip already has the movement you want.',
  }),
  Object.freeze({
    workflowId: 'talking-photo',
    modelId: 'kling-avatar-v2',
    modelLabel: 'Kling AI Avatar',
    sourceLabel: 'Portrait + speech',
    maxSeconds: 10,
    badge: 'Still portrait',
    summary: 'Creates a new short speaking performance from one image.',
    boundary: 'Best when you have a portrait rather than existing footage.',
  }),
]);

export const TALKING_PHOTO_MODEL_CONTRACTS = Object.freeze([
  Object.freeze({
    id: 'kling-avatar-v2',
    label: 'Kling AI Avatar',
    badge: 'Balanced',
    maxSeconds: 10,
    summary: 'The lower-cost default for a clear portrait and short speech.',
    sourceFit: 'People, animals, cartoons and stylised characters.',
  }),
  Object.freeze({
    id: 'sync-lipsync-v3',
    label: 'Sync 3 Talking Photo',
    badge: 'Expressive',
    maxSeconds: 10,
    summary: 'A higher-cost alternative when illustration and animated-frame fidelity matter.',
    sourceFit: 'Portraits, illustrations and animated frames.',
  }),
]);

export const VIDEO_LIP_SYNC_MODEL_CONTRACTS = Object.freeze([
  Object.freeze({
    id: 'latentsync',
    label: 'LatentSync',
    badge: 'Quick clip',
    maxSeconds: 40,
    summary: 'The lower-cost default for short presenter clips and social edits.',
    sourceFit: 'One continuous speaking performance up to 40 seconds.',
  }),
  Object.freeze({
    id: 'sync-lipsync-1.9-long',
    label: 'Sync 1.9 Long-form',
    badge: 'Up to 3 minutes',
    maxSeconds: 180,
    summary: 'A duration-flexible render for explainers, lessons and longer localisation.',
    sourceFit: 'Owned video and speech up to 180 seconds, with an explicit mismatch policy.',
  }),
]);

export const LONG_FORM_SYNC_MODES = Object.freeze([
  Object.freeze({ id: 'cut_off', label: 'Use shorter input', description: 'Stop when the shorter source ends.' }),
  Object.freeze({ id: 'loop', label: 'Loop video', description: 'Repeat a shorter video to cover longer audio.' }),
  Object.freeze({ id: 'bounce', label: 'Bounce video', description: 'Play forward and backward to cover longer audio.' }),
  Object.freeze({ id: 'silence', label: 'Preserve video', description: 'Keep the full video and pad shorter audio with silence.' }),
  Object.freeze({ id: 'remap', label: 'Retiming', description: 'Adjust playback speed so both inputs finish together.' }),
]);

export const SPEECH_SOURCES = [
  { id: 'script', label: 'Write a script', description: 'Veyrnox creates speech, then lip-syncs it.' },
  { id: 'upload', label: 'Upload audio', description: 'Use an MP3 or WAV you already own.' },
  { id: 'record', label: 'Record', description: 'Capture speech here and review it first.' },
];

export const DEFAULT_TTS_MODEL_ID = 'minimax-speech-2.6-hd';

export function workflowById(id) {
  return PERFORMANCE_WORKFLOWS.find((workflow) => workflow.id === id) || PERFORMANCE_WORKFLOWS[0];
}

export function lipSyncEngineContract(workflow) {
  const workflowId = typeof workflow === 'string' ? workflow : workflow?.id;
  return LIP_SYNC_ENGINE_CONTRACTS.find((contract) => contract.workflowId === workflowId) || null;
}

export function speechSourcesFor(workflow) {
  const selected = workflowById(workflow?.id || workflow);
  return SPEECH_SOURCES.filter((source) => selected.speechSources.includes(source.id));
}

export function availablePerformanceModels(models, workflow) {
  const selected = workflowById(workflow?.id || workflow);
  const wanted = selected.modelIds || [selected.modelId];
  return (Array.isArray(models) ? models : []).filter((model) => wanted.includes(model.id) && !model.gated);
}

export function estimatedSpeechSeconds(text, wordsPerSecond = 2.35) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.ceil(words / wordsPerSecond)) : 0;
}

export function knownAudioTooLong(duration, maxSeconds) {
  const seconds = Number(duration);
  const limit = Number(maxSeconds);
  return Number.isFinite(seconds) && seconds > 0 && Number.isFinite(limit) && limit > 0 && seconds > limit;
}

export function performanceQuote({ lipSyncCredits = 0, speechSource = 'upload', ttsCredits = 0, captionsCredits = 0 } = {}) {
  const lip = Number.isFinite(lipSyncCredits) ? Math.max(0, Math.trunc(lipSyncCredits)) : 0;
  const speech = speechSource === 'script' && Number.isFinite(ttsCredits)
    ? Math.max(0, Math.trunc(ttsCredits))
    : 0;
  const captions = Number.isFinite(captionsCredits) ? Math.max(0, Math.trunc(captionsCredits)) : 0;
  return { lipSyncCredits: lip, speechCredits: speech, captionsCredits: captions, totalCredits: lip + speech + captions };
}

export function sourceAccept(workflow) {
  return workflowById(workflow?.id || workflow).sourceKind === 'video'
    ? 'video/mp4'
    : 'image/png,image/jpeg,image/webp';
}

export function sourceHint(workflow) {
  const base = workflowById(workflow?.id || workflow);
  const selected = workflow && typeof workflow === 'object'
    ? { ...base, ...workflow }
    : base;
  return selected.sourceKind === 'video'
    ? `MP4, visible face, up to 100 MB and ${selected.maxSeconds}s`
    : selected.id === 'product-presenter'
      ? 'PNG, JPEG or WebP, one approved presenter-and-product composite with a clear unobstructed mouth, up to 20 MB'
    : selected.id === 'baby-podcast'
      ? 'PNG, JPEG or WebP, one fully synthetic baby character with a clear unobstructed mouth, up to 20 MB'
    : selected.id === 'talking-animal'
      ? 'PNG, JPEG or WebP, one animal with a clear front-facing head, up to 20 MB'
    : selected.id === 'talking-object'
      ? 'PNG, JPEG or WebP, one original object character with a clear designed face and mouth, up to 20 MB'
    : selected.id === 'talking-cartoon'
      ? 'PNG, JPEG or WebP, one original or licensed character with a clear face, up to 20 MB'
    : selected.id === 'singing-photo'
      ? 'PNG, JPEG or WebP, one clear performer, up to 20 MB'
      : 'PNG, JPEG or WebP, one clear face, up to 20 MB';
}

// MediaRecorder containers vary by browser. Decode the browser's own output
// with Web Audio, then hand the gateway a WAV it already validates and times.
export function encodeAudioBufferAsWav(buffer) {
  const channels = Math.max(1, Number(buffer?.numberOfChannels) || 0);
  const frames = Math.max(0, Number(buffer?.length) || 0);
  const sampleRate = Math.max(1, Number(buffer?.sampleRate) || 0);
  if (!frames || !sampleRate || typeof buffer?.getChannelData !== 'function') {
    throw new TypeError('invalid_audio_buffer');
  }

  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);
  const write = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);

  const source = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, source[channel][frame] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(output);
}
