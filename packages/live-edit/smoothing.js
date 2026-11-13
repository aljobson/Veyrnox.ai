/** One-Euro filter. A gap or lost/multiple face clears state, never predicts a stale face. */
export function createLandmarkFilter({ minCutoff = 1, beta = 0.02, derivativeCutoff = 1 } = {}) {
    let previous, derivative, timestamp;
    const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    return {
        reset() { previous = derivative = timestamp = undefined; },
        update(points, time) {
            if (!points?.length || !Number.isFinite(time)) { this.reset(); return new Float32Array(); }
            if (!previous || points.length !== previous.length || time <= timestamp || time - timestamp > 250) {
                previous = points.slice(); derivative = new Float32Array(points.length); timestamp = time; return points.slice();
            }
            const dt = (time - timestamp) / 1000, da = alpha(derivativeCutoff, dt);
            const out = points.map((value, i) => {
                derivative[i] += da * ((value - previous[i]) / dt - derivative[i]);
                return previous[i] + alpha(minCutoff + beta * Math.abs(derivative[i]), dt) * (value - previous[i]);
            });
            previous = out; timestamp = time; return out.slice();
        },
    };
}
