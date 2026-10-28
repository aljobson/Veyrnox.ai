// Model instructions are English data, independent of the interface locale.
export const FACELESS_REEL_MODEL = 'wan-2.5-kie';
export const FACELESS_SOUND_MODEL = 'mmaudio-v2-video';
export const FACELESS_SOUND_PROMPT = 'Natural sound design precisely synchronized to the visible motion and setting. Build a clean, restrained ambience with believable object and environmental sounds. No speech, narration, music, branded sonic logo or exaggerated impact.';
export const FACELESS_REEL_FORMATS = ['explainer', 'list', 'micro-story', 'mood'] as const;
export const FACELESS_REEL_PACING = ['measured', 'balanced', 'fast'] as const;
export const FACELESS_REEL_PLATFORMS = [
    { id: 'reels', aspect: '9:16', label: 'Reels / TikTok' },
    { id: 'shorts', aspect: '9:16', label: 'YouTube Shorts' },
    { id: 'web', aspect: '16:9', label: 'Web / YouTube' },
] as const;
export interface FacelessReelValues {
    topic: string; hook?: string; format?: string; pacing?: string; platform?: string;
    duration: number | string; sound?: boolean; originality?: boolean; faceless?: boolean; promptMax?: number;
}
const formats = {
    explainer: ['Visual explainer', 'Clear setup, reveal and resolved final frame.'],
    list: ['List rhythm', 'Three clear beats; no numbers, captions or interface text.'],
    'micro-story': ['Micro-story', 'Immediate setup, one turn, conclusive final image.'],
    mood: ['Mood reel', 'Atmosphere, recurring motif, controlled transitions.'],
};
const pacing = {
    measured: ['Measured', 'Calm motion; hold the readable final frame.'],
    balanced: ['Balanced', 'Clear hook, purposeful middle, stable finish.'],
    fast: ['Fast', 'Brisk readable motion, decisive cuts; no strobing.'],
};
const clean = (value?: string) => String(value || '').trim().replace(/[.!?]+$/, '');
const platformFor = (values: FacelessReelValues) => FACELESS_REEL_PLATFORMS.find(p => p.id === values.platform) ?? FACELESS_REEL_PLATFORMS[0];
export function buildFacelessReelPrompt(values: FacelessReelValues): string {
    const f = formats[FACELESS_REEL_FORMATS.find(id => id === values.format) ?? 'explainer'];
    // The web's pick fallback is the first option, measured (the form defaults to balanced).
    const p = pacing[FACELESS_REEL_PACING.find(id => id === values.pacing) ?? 'measured'];
    const platform = platformFor(values);
    const hook = clean(values.hook);
    return [
        `Original ${Number(values.duration) === 10 ? 10 : 5}-second faceless short-form video about: ${clean(values.topic)}.`,
        hook ? `Hook for later captions: ${hook}. Do not render it as text.` : 'Open on an immediate visual hook; no presenter or baked-in text.',
        `Structure: ${f[0]}. ${f[1]}`,
        `Pacing: ${p[0]}. ${p[1]}`,
        `Delivery: ${platform.label}, ${platform.aspect}; keep action mobile-safe and the lower third clear.`,
        'No identifiable face, presenter, celebrity likeness, copied creator style, private information, platform interface, logos or watermarks.',
        'Stable continuity, lighting and motif; no generated text, subtitles or unsupported claims.',
        'Silent visual master.',
    ].join(' ');
}
// The length the prompt actually uses (trimmed, trailing .!? removed), so the counter matches Open in Create.
export function briefLength(values: FacelessReelValues): number {
    return clean(values.topic).length;
}
export function briefRoom(values: FacelessReelValues, promptMax: number): number {
    return promptMax - buildFacelessReelPrompt({ ...values, topic: '' }).length;
}
export function facelessReelValidation(values: FacelessReelValues) {
    const topic = values.topic.trim();
    const hook = (values.hook ?? '').trim();
    if (topic.length < 20) return 'topicShort';
    if (topic.length > 800) return 'topicLong';
    if (hook.length > 160) return 'hookLong';
    if (![5, 10].includes(Number(values.duration))) return 'duration';
    if (values.sound && Number(values.duration) > 8) return 'soundDuration';
    if (!values.originality || !values.faceless) return 'review';
    if (buildFacelessReelPrompt(values).length > (values.promptMax ?? 800)) return 'promptLong';
    return null;
}
export function facelessReelLaunch(values: FacelessReelValues) {
    return {
        modelId: FACELESS_REEL_MODEL, prompt: buildFacelessReelPrompt(values), aspect: platformFor(values).aspect,
        durationSeconds: Number(values.duration) === 10 ? 10 : 5,
        ...(values.sound ? { followup: 'generated-sound' as const } : {}),
    };
}
