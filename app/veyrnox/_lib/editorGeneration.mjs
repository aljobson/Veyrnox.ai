export function generationQuote(model, duration) {
    if (!model || !Number.isInteger(model.credits) || model.credits < 0) return null;
    if (model.kind === 'video' && (!Number.isFinite(duration) || duration <= 0 || !model.durations?.includes(duration))) return null;
    return model.credits * (model.kind === 'video' ? Math.ceil(duration / 5) : 1);
}
export function generationInputs(model, { prompt, duration, aspect, voice }) {
    if (!model || model.isEdit || model.takesPlan || model.takesTopic || !model.takesPrompt) return { error: 'Choose a supported generation model.' };
    if (!prompt.trim() || prompt.trim().length > model.promptMax) return { error: 'Enter a prompt within this model’s limit.' };
    if (model.kind === 'video' && !model.durations.includes(duration)) return { error: 'Choose a supported duration.' };
    if (model.takesVoice && (!voice.trim() || voice.trim().length > 500)) return { error: 'Describe the voice in up to 500 characters.' };
    const inputs = { prompt: prompt.trim() };
    if (model.kind === 'video') inputs.duration_seconds = duration;
    if (model.aspects?.length) { if (!model.aspects.includes(aspect)) return { error: 'Choose a supported shape.' }; inputs.aspect_ratio = aspect; }
    if (model.takesVoice) inputs.voice_description = voice.trim();
    return { inputs };
}
