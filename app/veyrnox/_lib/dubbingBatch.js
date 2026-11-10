import { TTS_LANGUAGES } from './textToSpeech.js';

export const MIN_DUBBING_LOCALES = 2;
export const MAX_DUBBING_LOCALES = 5;
export const MAX_DUBBING_PROJECT_NAME = 100;
export const MAX_DUBBING_TRANSLATION = 360;

export const DUBBING_BATCH_EXAMPLE = Object.freeze({
  projectName: 'Harbour update — reviewed example',
  locales: Object.freeze([
    Object.freeze({ targetLanguage: 'Spanish', script: 'El informe final estará listo el viernes. Revisa las cifras antes de compartirlo.' }),
    Object.freeze({ targetLanguage: 'French', script: 'Le rapport final sera prêt vendredi. Vérifiez les chiffres avant de le partager.' }),
  ]),
});

const bounded = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const supportedLanguages = new Set(TTS_LANGUAGES.filter((language) => language !== 'auto'));

export function normalizeDubbingBatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const projectName = bounded(value.projectName, MAX_DUBBING_PROJECT_NAME);
  if (!projectName || !Array.isArray(value.locales)) return null;
  if (value.locales.length < MIN_DUBBING_LOCALES || value.locales.length > MAX_DUBBING_LOCALES) return null;
  const locales = value.locales.map((locale) => ({
    targetLanguage: supportedLanguages.has(locale?.targetLanguage) ? locale.targetLanguage : null,
    script: bounded(locale?.script, MAX_DUBBING_TRANSLATION),
  }));
  if (locales.some((locale) => !locale.targetLanguage || !locale.script)) return null;
  if (new Set(locales.map((locale) => locale.targetLanguage)).size !== locales.length) return null;
  return { projectName, locales };
}

export function dubbingBatchQuote(value, unitCredits) {
  const plan = normalizeDubbingBatch(value);
  const credits = Number(unitCredits);
  if (!plan || !Number.isFinite(credits) || credits < 0) return null;
  return {
    locales: plan.locales.length,
    unitCredits: credits,
    totalCredits: credits * plan.locales.length,
  };
}

export function dubbingLocaleHandoff(value, index) {
  const plan = normalizeDubbingBatch(value);
  const locale = plan?.locales[index];
  if (!plan || !locale) return null;
  return {
    projectName: plan.projectName,
    targetLanguage: locale.targetLanguage,
    speechSource: 'script',
    script: locale.script,
    localeNumber: index + 1,
  };
}

export function dubbingLocaleRetryQuote(item, pricing) {
  if (!item || !pricing || !['speech', 'performance', 'caption'].includes(item.failureStage)) return null;
  const ttsCredits = Number(pricing.ttsCredits);
  const performanceCredits = Number(pricing.performanceCredits);
  const captionCredits = Number(pricing.captionCredits || 0);
  if (![ttsCredits, performanceCredits, captionCredits].every((credits) => Number.isFinite(credits) && credits >= 0)) return null;

  if (item.failureStage === 'speech') {
    return {
      stage: 'speech',
      label: 'Retry speech, lip sync and subtitles',
      totalCredits: ttsCredits + performanceCredits + captionCredits,
    };
  }
  if (item.failureStage === 'performance') {
    return {
      stage: 'performance',
      label: 'Retry lip sync and subtitles',
      totalCredits: performanceCredits + captionCredits,
    };
  }
  return {
    stage: 'caption',
    label: 'Retry burned subtitles',
    totalCredits: captionCredits,
  };
}
