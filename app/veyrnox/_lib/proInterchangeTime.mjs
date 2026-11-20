// FilmCraft tick arithmetic. JSON numbers must also be exact JavaScript integers.
export const TICKS_PER_SECOND = 254016000000;
export const TICKS_PER_FRAME = 8467200000;
export const MAX_SEQUENCE_TICKS = 18000 * TICKS_PER_FRAME;
export class InterchangeError extends Error {
    constructor(code, details = {}) { super(code); this.name = 'InterchangeError'; this.code = code; this.details = details; }
}
export const refuse = (code, details) => { throw new InterchangeError(code, details); };
export function rationalRate(rate = { num: 30, den: 1 }) {
    if (!rate || !Number.isSafeInteger(rate.num) || !Number.isSafeInteger(rate.den) || rate.num < 1 || rate.den < 1 || rate.num > 0xffffffff || rate.den > 0xffffffff || rate.num / rate.den > 1000) refuse('invalid_rate');
    let a = rate.num, b = rate.den;
    while (b) [a, b] = [b, a % b];
    return { num: rate.num / a, den: rate.den / a };
}
export function checkedTicks(value, path = 'ticks', max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 0 || value > max) refuse('invalid_ticks', { path, value, max });
    return value;
}
export function framesToTicks(frames, rate = { num: 30, den: 1 }) {
    const { num, den } = rationalRate(rate);
    if (!Number.isFinite(frames) || frames < 0) refuse('invalid_frames', { frames });
    if (Number.isSafeInteger(frames)) {
        const n = BigInt(frames) * BigInt(TICKS_PER_SECOND) * BigInt(den), d = BigInt(num);
        const ticks = (n + d / 2n) / d;
        if (ticks > BigInt(Number.MAX_SAFE_INTEGER)) refuse('ticks_precision', { frames });
        return Number(ticks);
    }
    return checkedTicks(Math.round(frames * TICKS_PER_SECOND * den / num));
}
export function ticksToFrames(ticks, rate = { num: 30, den: 1 }) {
    checkedTicks(ticks);
    const { num, den } = rationalRate(rate), n = BigInt(ticks) * BigInt(num), d = BigInt(TICKS_PER_SECOND) * BigInt(den);
    const frames = Number((n + d / 2n) / d), remainder = n - BigInt(frames) * d;
    return { frames, remainder: remainder.toString(), errorTicks: Number(remainder) / num, errorFrames: Number(remainder) / Number(d) };
}
export function sourceInTicks(clip) {
    const from = framesToTicks(clip.in);
    const value = clip.reverse ? from - Math.round(framesToTicks(clip.len) * (clip.rate ?? 1)) + 1 : from;
    if (value < 0) refuse('reverse_window_negative', { clip: clip.id, sourceIn: value });
    return checkedTicks(value);
}
export function sourceInClamped(clip) {
    const from = framesToTicks(clip.in);
    const value = clip.reverse ? from - Math.round(framesToTicks(clip.len) * (clip.rate ?? 1)) + 1 : from;
    return { value: checkedTicks(Math.max(0, value)), clamped: value < 0 };
}
export function sourceFirstTick(clip) {
    checkedTicks(clip.source_in, 'source_in');
    const value = clip.reverse ? clip.source_in + Math.round(clip.duration * Math.abs(clip.speed)) - 1 : clip.source_in;
    return checkedTicks(value);
}
export const volumeToDb = volume => volume <= 0 ? -96 : Math.max(-96, Math.min(96, 20 * Math.log10(volume)));
export const dbToVolume = db => db <= -96 ? 0 : 10 ** (db / 20);
export const result = work => {
    try { return { ok: true, ...work() }; }
    catch (e) { return { ok: false, error: { code: e instanceof InterchangeError ? e.code : 'invalid_shape', details: e instanceof InterchangeError ? e.details : {} } }; }
};
export const loss = (report, path, feature, severity = 'dropped', note = feature, details = {}) => report.push({ path, feature, severity, note, ...details });
