import { TTS_SCRIPT_LIMIT, TTS_VOICES } from '../../../lib/minimaxSpeechVoices.js';
export { TTS_SCRIPT_LIMIT, TTS_VOICES };
import { speechContractFor } from '../../../lib/speechInputs.js';
export { speechContractFor };

const VOICE_GENDER_ORDER = ['female', 'male', 'neutral'];

/** The genders the given voices actually have, in a fixed order, so the filter never offers an empty choice. */
export function voiceGenderOptions(voices = TTS_VOICES) {
  const present = new Set(voices.map((voice) => voice.gender));
  return VOICE_GENDER_ORDER.filter((gender) => present.has(gender));
}

export const TTS_LANGUAGES = [
  'auto', 'English', 'Chinese', 'Chinese,Yue', 'Japanese', 'Korean', 'Spanish', 'Portuguese',
  'French', 'Indonesian', 'German', 'Russian', 'Italian', 'Dutch', 'Vietnamese', 'Arabic',
  'Turkish', 'Ukrainian',
];

export const TTS_EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'];
export const TTS_PAUSES = [0.25, 0.5, 1, 1.5];
export const TTS_INTERJECTIONS = [
  ['Laughter', '(laughs)'], ['Chuckle', '(chuckle)'], ['Cough', '(coughs)'], ['Clear throat', '(clear-throat)'],
  ['Groan', '(groans)'], ['Normal breath', '(breath)'], ['Pant', '(pant)'], ['Inhale', '(inhale)'],
  ['Exhale', '(exhale)'], ['Gasp', '(gasps)'], ['Sniff', '(sniffs)'], ['Sigh', '(sighs)'],
  ['Snort', '(snorts)'], ['Burp', '(burps)'], ['Lip smack', '(lip-smacking)'], ['Hum', '(humming)'],
  ['Hiss', '(hissing)'], ['Um', '(emm)'], ['Sneeze', '(sneezes)'],
];

export const DEFAULT_TTS_SETTINGS = Object.freeze({
  voice: 'Wise_Woman',
  emotion: 'neutral',
  speed: 1,
  volume: 1,
  pitch: 0,
  language: 'auto',
});

export const TTS_EXAMPLES = [
  { title: 'A small discovery', text: 'Every idea deserves a voice. Give it room to breathe, and the right words can carry much further.' },
  { title: 'Morning routine', text: 'Start small. Drink some water, open the curtains, and choose the one thing that matters most today.' },
  { title: 'Product introduction', text: 'Meet the simpler way to turn a finished script into a clear, expressive voiceover.' },
];

export const TTS_VOICE_AUDITION = 'Every idea deserves a clear voice. Listen for pacing, warmth, and emphasis before choosing the final performance.';

export function voiceAuditionScript(limit = TTS_SCRIPT_LIMIT) {
  return TTS_VOICE_AUDITION.slice(0, Math.max(1, Number(limit) || TTS_SCRIPT_LIMIT));
}

export function appendSpeechCue(script, cue, limit = TTS_SCRIPT_LIMIT) {
  const current = String(script || '').trimEnd();
  const next = current ? `${current} ${cue}` : cue;
  return next.slice(0, Math.max(1, Number(limit) || TTS_SCRIPT_LIMIT));
}

export function pauseCue(seconds) {
  const value = Math.min(99.99, Math.max(0.01, Number(seconds) || 1));
  return `<#${Number(value.toFixed(2))}#>`;
}

export function ttsGenerationInputs(settings = DEFAULT_TTS_SETTINGS, modelId = 'minimax-speech-2.6-hd') {
  if (modelId === 'qwen3-tts') return { tts_voice: settings.voice, tts_language: settings.language };
  return {
    tts_voice: settings.voice,
    tts_emotion: settings.emotion,
    tts_speed: Number(settings.speed),
    tts_volume: Number(settings.volume),
    tts_pitch: Number(settings.pitch),
    tts_language: settings.language,
  };
}

export function defaultSpeechSettings(modelId) {
  return modelId === 'qwen3-tts' ? { voice: 'Cherry', language: 'auto' } : { ...DEFAULT_TTS_SETTINGS };
}
