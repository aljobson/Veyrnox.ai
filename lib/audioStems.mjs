export const AUDIO_STEMS = Object.freeze(['vocals','drums','bass','other','guitar','piano']);
export const isAudioStem = value => AUDIO_STEMS.includes(value);
export const isDemucsModel = id => id === 'demucs-stems';
/** Only the declared six MP3 outputs are accepted; no arbitrary vendor field is served. */
export function demucsOutputs(event) {
    const payload = event?.payload || event?.output;
    if (!payload || typeof payload !== 'object') return null;
    const outputs = AUDIO_STEMS.map(label => ({label,url:payload[label]?.url}));
    if (outputs.some(({label,url}) => typeof url !== 'string' || (payload[label]?.content_type != null && !['audio/mpeg','audio/mp3'].includes(payload[label].content_type)) || url.length > 2048)) return null;
    try { if (outputs.some(({url}) => new URL(url).protocol !== 'https:') || new Set(outputs.map(o=>o.url)).size !== outputs.length) return null; } catch { return null; }
    return outputs;
}
