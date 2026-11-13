// Numeric coercion, zero fallback and fractional values match the original clamps.
export function retryAfterSeconds(value, { max, fallback }) {
    return Math.max(1, Math.min(max, Number(value) || fallback));
}
