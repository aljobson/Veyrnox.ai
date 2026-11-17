export const LATENCY_KEY = 'veyrnox.beat.latency.v1';
export const CALIBRATION_INTERVALS = [700, 950, 800, 1100, 750, 1000, 850];
export const CALIBRATION_UNCLEAR = 'Calibration was unclear — try again in a quieter room, or with the volume up.';
const median = values => { const a = [...values].sort((x, y) => x - y); return (a[Math.floor(a.length / 2)] + a[Math.floor((a.length - 1) / 2)]) / 2; };
export function calibrationFrames(sr, start = 0) {
  const times = [start + 0.3]; for (const interval of CALIBRATION_INTERVALS) times.push(times.at(-1) + interval / 1000);
  return times.map(t => t * sr);
}
export function detectClickOnsets(samples, sr, firstClickFrame = 0.3 * sr) {
  const floorStart = Math.max(0, Math.floor(firstClickFrame - 0.05 * sr)), floorEnd = Math.min(samples.length, Math.floor(firstClickFrame));
  let energy = 0; for (let i = floorStart; i < floorEnd; i++) energy += samples[i] ** 2;
  const threshold = Math.max(0.02, 6 * Math.sqrt(energy / Math.max(1, floorEnd - floorStart))), onsets = [];
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) <= threshold) continue;
    let peak = 0;
    const end = Math.min(samples.length, i + Math.ceil(0.01 * sr));
    for (let n = i; n < end; n++) peak = Math.max(peak, Math.abs(samples[n]));
    let frame = i;
    while (frame > 0 && Math.abs(samples[frame - 1]) > peak * 0.3) frame--;
    // Interpolate the threshold crossing: useful for a fractional-frame loopback.
    const low = Math.abs(samples[Math.max(0, frame - 1)]), high = Math.abs(samples[frame]);
    const refined = high > low && low < peak * 0.3 ? frame - 1 + (peak * 0.3 - low) / (high - low) : frame;
    onsets.push({ frame: refined, peak });
    i += Math.ceil(0.1 * sr);
  }
  return onsets;
}
export const detectOnsets = detectClickOnsets;
export function matchCalibration(onsets, scheduledFrames, sr) {
  const points = onsets.map(o => typeof o === 'number' ? { frame: o, peak: 1 } : o), tolerance = sr / 1000;
  const clusters = [];
  for (const onset of points) for (const scheduled of scheduledFrames) {
    const candidate = onset.frame - scheduled;
    if (candidate < -tolerance || candidate > sr * 0.4 + tolerance) continue;
    const matches = [], used = new Set();
    for (const frame of scheduledFrames) {
      const index = points.reduce((best, p, i) => !used.has(i) && Math.abs(p.frame - frame - candidate) <= tolerance && (best < 0 || Math.abs(p.frame - frame - candidate) < Math.abs(points[best].frame - frame - candidate)) ? i : best, -1);
      if (index >= 0) { used.add(index); matches.push({ delay: points[index].frame - frame, peak: points[index].peak }); }
    }
    if (matches.length < 6) continue;
    const delays = matches.map(m => m.delay), delay = Math.max(0, median(delays));
    if (delay < 0 || delay > 0.4 * sr || Math.max(...delays) - Math.min(...delays) > tolerance * 2) continue;
    if (points.some((p, i) => !used.has(i) && p.peak > median(matches.map(m => m.peak)) * 0.5)) continue;
    if (!clusters.some(c => Math.abs(c.delay - delay) <= tolerance * 2)) clusters.push({ delay, detected: matches.length });
  }
  if (clusters.length !== 1) {
    // Only diagnose over-range when the same irregular train matches out of range.
    const over = points.length >= 6 && scheduledFrames.some(s => points.some(p => p.frame - s > sr * 0.4 && scheduledFrames.filter(f => points.some(o => Math.abs(o.frame - f - (p.frame - s)) <= tolerance)).length >= 6));
    return { ok: false, error: over ? 'Latency over 400 ms — check the audio device' : CALIBRATION_UNCLEAR };
  }
  return { ok: true, ms: clusters[0].delay / sr * 1000, detected: clusters[0].detected };
}
export function readLatency(deviceId = 'default', storage, now = Date.now()) {
  try {
    const row = JSON.parse((storage || globalThis.localStorage).getItem(LATENCY_KEY) || '{}')[deviceId || 'default'];
    return row && Number.isFinite(row.ms) && row.ms >= 0 && row.ms <= 400 && Number.isFinite(row.measuredAt) && now - row.measuredAt < 90 * 86400000 && now >= row.measuredAt ? row : null;
  } catch { return null; }
}
export function writeLatency(deviceId, ms, storage, now = Date.now()) {
  try {
    if (!Number.isFinite(ms) || ms < 0 || ms > 400) return false;
    const target = storage || globalThis.localStorage, previous = JSON.parse(target.getItem(LATENCY_KEY) || '{}');
    target.setItem(LATENCY_KEY, JSON.stringify({ ...previous, [deviceId || 'default']: { ms, measuredAt: now } })); return true;
  } catch { return false; }
}
