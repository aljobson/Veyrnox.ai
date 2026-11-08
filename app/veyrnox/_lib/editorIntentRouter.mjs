// Deterministic tool selection only. No provider, network, debit or timeline mutation.
// Timeline instructions are previewed and checked by editorAgentPlan in AgentPanel.
export const EDITOR_INTENTS = Object.freeze({
    add_captions: { panel: 'Captions', media: 'audio', feature: 'captions', paid: false },
    cut_silence_or_speech: { panel: 'Transcript', media: 'audio', feature: 'localInference', paid: false, analysisOnly: true },
    find_clips: { panel: 'Clips', media: 'video', feature: 'clipper', paid: false },
    generate_video: { panel: 'Generate', media: null, feature: 'video', paid: true },
    generate_voiceover: { panel: 'Audio', media: null, feature: 'voiceover', paid: true },
    generate_avatar: { panel: 'Elements', media: null, feature: 'avatar', paid: true },
    timeline_edit: { panel: 'Assistant', media: 'timeline', feature: 'agent', paid: false },
});
export const EDITOR_INTENT_EXAMPLES = Object.freeze({
    add_captions: 'add captions', cut_silence_or_speech: 'smart cut', find_clips: 'find clips',
    generate_video: 'generate video', generate_voiceover: 'generate voiceover', generate_avatar: 'generate avatar',
    timeline_edit: 'split the first clip at 2 seconds',
});
export function matchEditorIntent(value) {
    const text = String(value || '').trim().toLowerCase().replace(/^please\s+/, '');
    // Specific free operations precede generation. An attached description of a
    // video does not make captions, speech analysis or extraction a paid request.
    if (/^(?:(?:add|generate|create|make)\s+(?:(?:a|an|the|some)\s+)?(?:captions?|subtitles?)\b|(?:captions?|subtitles?)\b)/.test(text)) return 'add_captions';
    if (/^(?:(?:remove|cut|trim|delete)\s+(?:the\s+)?(?:silences?|pauses?|ums?|filler words)\b|(?:smart|speech)\s+cut\b)/.test(text)) return 'cut_silence_or_speech';
    if (/^(?:find|pick|extract)\b.*\b(clips?|highlights?)\b/.test(text)
        || /^(?:make|create)\s+(?:(?:a|the|some)\s+)?clips?\s+from\b/.test(text)) return 'find_clips';
    if (/\b(remove|delete|hide|turn\s+off)\b/.test(text)) {
        return /^remove (?:the )?(first|last) (?:video )?clip$/.test(text) ? 'timeline_edit' : 'unsupported';
    }
    // Changing existing audio is not voice generation. The free planner only
    // accepts its own explicit volume syntax; other requests fail closed.
    if (/\b(?:louder|quieter|softer|volume)\b/.test(text) && !/^set (?:the )?volume /.test(text)) return 'unsupported';
    // The verb's direct object is required; only known modifiers may intervene.
    const object = text.match(/^(?:generate|make|create)\s+(?:(?:a|an|the|some)\s+)?(?:(?:new|short|long|cinematic|animated|realistic|natural)\s+){0,2}(avatar|video|clip|voiceover|voice|audio|music|narration)\b/)?.[1];
    if (object === 'avatar') return 'generate_avatar';
    if (object === 'video' || object === 'clip') return 'generate_video';
    if (object) return 'generate_voiceover';
    if (/^(split |set (the )?volume |add (the )?title ")/.test(text)) return 'timeline_edit';
    return 'unsupported';
}
export function editorIntentAvailability(id, context = {}) {
    const spec = EDITOR_INTENTS[id];
    if (!spec) return { id: 'unsupported', available: false, reason: 'unsupported' };
    const available = context.features?.[spec.feature] === true;
    const hasMedia = spec.media === null || context.media?.[spec.media] === true;
    return { id, ...spec, available, ready: available && hasMedia, reason: !available ? 'unavailable' : !hasMedia ? 'missingMedia' : null, dispatch: 'open-panel', confirm: spec.paid ? 'catalog-price' : 'panel-preview' };
}
export function routeEditorIntent(prompt, context) {
    return { ...editorIntentAvailability(matchEditorIntent(prompt), context), prompt: String(prompt || '').trim().slice(0, 500) };
}
export function dispatchEditorIntent(intent, openPanel) {
    if (!intent.ready) return false;
    openPanel(intent.panel, { intent: intent.id, prompt: intent.prompt });
    return true;
}
export function editorTimelineMedia(timeline) {
    const video = (timeline.video || []).filter(clip => timeline.media?.[clip.mediaId]?.kind === 'video');
    return { video: video.length > 0, audio: (timeline.audio || []).length > 0 || video.some(clip => timeline.media[clip.mediaId]?.hasAudio), timeline: ['video', 'audio', 'text'].some(kind => timeline[kind]?.length > 0) };
}
