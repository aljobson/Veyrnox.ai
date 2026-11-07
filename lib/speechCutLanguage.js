// Speech analysis uses a bounded language vocabulary; unknown speech remains timed.
export const SPEECH_CUT_LANGUAGES = Object.freeze(['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko']);
const ISO3 = { eng: 'en', spa: 'es', zho: 'zh', cmn: 'zh', chi: 'zh', hin: 'hi', ara: 'ar', fra: 'fr', fre: 'fr', por: 'pt', rus: 'ru', jpn: 'ja', deu: 'de', ger: 'de', kor: 'ko' };
export function speechCutLanguage(value) {
    const code = typeof value === 'string' ? value.toLowerCase() : '';
    return SPEECH_CUT_LANGUAGES.includes(code) ? code : ISO3[code] || 'und';
}
