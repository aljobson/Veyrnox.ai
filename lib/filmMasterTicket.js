const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const keyFor = secret => crypto.subtle.importKey('raw', new TextEncoder().encode(`film-master-upload:v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function signFilmMasterTicket(payload, secret) {
    const message = encode(new TextEncoder().encode(JSON.stringify(payload)));
    return `${message}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), new TextEncoder().encode(message))))}`;
}
export async function readFilmMasterTicket(ticket, secret, authId, now = Date.now()) {
    try {
        if (typeof ticket !== 'string' || ticket.length > 3000) return null;
        const parts = ticket.split('.');
        if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
        if (!await crypto.subtle.verify('HMAC', await keyFor(secret), decode(parts[1]), new TextEncoder().encode(parts[0]))) return null;
        const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
        return payload.auth_id === authId && Number.isFinite(payload.expires_at)
            && payload.expires_at > now && payload.expires_at <= now + 16 * 60 * 1000 ? payload : null;
    } catch { return null; }
}
