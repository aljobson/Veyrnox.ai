import { t } from './i18n';
const families = {
    speed: ['rate', 'reverse', 'speedCurve', 'freezeFrame'],
    audio: ['fadeIn', 'fadeOut', 'pan', 'eq', 'preservePitch', 'audioProcessing', 'audioEffects'],
    motion: ['transform', 'keyframes', 'parameterKeyframes', 'text.keyframes'],
    animation: ['animation', 'text.animation'], colour: ['filter', 'colourAdjustment'],
    crop: ['crop', 'fit'], effects: ['effect'], blend: ['blend'], background: ['background'],
    masks: ['mask', 'maskSettings', 'maskKeyframes'], smart: ['smartPicture'], transitions: ['transitionType'],
    text: ['text.style'], captions: ['text.caption', 'text.words', 'text.wordStyle', 'text.wordsEstimated'],
    position: ['text.x'], fonts: ['fonts'], images: ['media.image', 'media.graphic'],
    originalAudio: ['media.originalAudio'], assets: ['media.assetSource'], groups: ['groupId', 'text.groupId'],
} as const;
export function exportRefusal(feature: unknown): string {
    const family = (Object.keys(families) as (keyof typeof families)[])
        .find(key => (families[key] as readonly unknown[]).includes(feature));
    return t(`editorExportRefusal.${family ?? 'unknown'}`);
}
