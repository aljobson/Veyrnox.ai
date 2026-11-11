const encoder = new TextEncoder();

export async function hashMusicShareToken(token) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
