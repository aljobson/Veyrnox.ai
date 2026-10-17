import * as Crypto from 'expo-crypto';

export function toBase64Url(base64: string): string {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength: number): string {
    const bytes = Crypto.getRandomBytes(byteLength);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return toBase64Url(btoa(binary));
}

export interface Pkce {
    readonly verifier: string;
    readonly challenge: string;
}

export async function createPkce(): Promise<Pkce> {
    const verifier = randomString(48);
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
        encoding: Crypto.CryptoEncoding.BASE64,
    });
    return { verifier, challenge: toBase64Url(digest) };
}

export interface AppleNonce {
    readonly raw: string;
    readonly hashed: string;
}

// Apple receives the SHA-256 hex of the nonce; Supabase receives the raw one.
export async function createAppleNonce(): Promise<AppleNonce> {
    const raw = randomString(32);
    const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
    return { raw, hashed };
}
