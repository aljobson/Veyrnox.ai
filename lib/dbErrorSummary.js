// A short, safe description of a failed database call for server logs: HTTP status, the PostgREST/Postgres error code and message, or the
// start of a plain-text body (a gateway block page looks different from a database refusal, and that difference is what is needed).
// Anything that looks like a credential is masked and the text is capped, so this is safe to log.
const SECRET_LIKE = /(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|sb_(?:secret|publishable)_[A-Za-z0-9_-]+|Bearer\s+\S+)/g;
const clip = (value, max) => String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(SECRET_LIKE, '[masked]').trim().slice(0, max);

export function dbErrorSummary(err) {
    const status = err && Number.isInteger(err.status) ? err.status : null;
    const body = err ? err.body : undefined;
    const parts = [`status=${status ?? 'none'}`];
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        if (typeof body.code === 'string' || typeof body.code === 'number') parts.push(`code=${clip(body.code, 20)}`);
        if (typeof body.message === 'string') parts.push(`message=${clip(body.message, 200)}`);
        if (typeof body.hint === 'string') parts.push(`hint=${clip(body.hint, 120)}`);
    } else if (typeof body === 'string' && body.trim()) {
        parts.push(`text=${clip(body, 160)}`);
    } else {
        parts.push('body=none');
    }
    return parts.join(' ');
}
