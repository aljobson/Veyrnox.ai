export const TTS_SCRIPT_LIMIT = 500;

export const TTS_VOICES = [
  { id: 'Wise_Woman', label: 'Wise woman', tone: 'Measured', gender: 'female', age: 'older' },
  { id: 'Friendly_Person', label: 'Friendly person', tone: 'Warm', gender: 'neutral', age: 'middle' },
  { id: 'Inspirational_girl', label: 'Inspirational girl', tone: 'Upbeat', gender: 'female', age: 'young' },
  { id: 'Deep_Voice_Man', label: 'Deep voice man', tone: 'Rich', gender: 'male', age: 'middle' },
  { id: 'Calm_Woman', label: 'Calm woman', tone: 'Relaxed', gender: 'female', age: 'middle' },
  { id: 'Casual_Guy', label: 'Casual guy', tone: 'Conversational', gender: 'male', age: 'young' },
  { id: 'Lively_Girl', label: 'Lively girl', tone: 'Energetic', gender: 'female', age: 'young' },
  { id: 'Patient_Man', label: 'Patient man', tone: 'Clear', gender: 'male', age: 'middle' },
  { id: 'Young_Knight', label: 'Young knight', tone: 'Confident', gender: 'male', age: 'young' },
  { id: 'Determined_Man', label: 'Determined man', tone: 'Assertive', gender: 'male', age: 'middle' },
  { id: 'Lovely_Girl', label: 'Lovely girl', tone: 'Gentle', gender: 'female', age: 'young' },
  { id: 'Decent_Boy', label: 'Decent boy', tone: 'Neutral', gender: 'male', age: 'young' },
  { id: 'Imposing_Manner', label: 'Imposing manner', tone: 'Commanding', gender: 'male', age: 'middle' },
  { id: 'Elegant_Man', label: 'Elegant man', tone: 'Polished', gender: 'male', age: 'middle' },
  { id: 'Abbess', label: 'Abbess', tone: 'Serene', gender: 'female', age: 'older' },
  { id: 'Sweet_Girl_2', label: 'Sweet girl', tone: 'Bright', gender: 'female', age: 'young' },
  { id: 'Exuberant_Girl', label: 'Exuberant girl', tone: 'Expressive', gender: 'female', age: 'young' },
];

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

export function ttsGenerationInputs(settings = DEFAULT_TTS_SETTINGS) {
  return {
    tts_voice: settings.voice,
    tts_emotion: settings.emotion,
    tts_speed: Number(settings.speed),
    tts_volume: Number(settings.volume),
    tts_pitch: Number(settings.pitch),
    tts_language: settings.language,
  };
}
