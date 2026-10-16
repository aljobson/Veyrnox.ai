export function estimatedCredits(model, durationSeconds) {
    if (!model || !Number.isFinite(Number(model.credits))) return null;
    const isVideo = typeof model.modality === 'string' && model.modality.endsWith('video');
    if (!isVideo) return Number(model.credits);
    const seconds = durationSeconds || 5;
    if (Array.isArray(model.durations) && model.durations.length > 0 && !model.durations.includes(seconds)) return null;
    return Number(model.credits) * Math.ceil(seconds / 5);
}
