// Mirrors the deterministic matcher in app/veyrnox/_lib/editorIntentRouter.mjs.
export function matchEditorIntent(value: string) {
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
export function mobileEditorAction(prompt: string): string | null {
    const intent = matchEditorIntent(prompt);
    const actions: Partial<Record<ReturnType<typeof matchEditorIntent>, string>> = {
        add_captions: 'captions', cut_silence_or_speech: 'smart-cut',
        generate_video: 'make-clip', generate_voiceover: 'make-audio',
    };
    return actions[intent] ?? null;
}
