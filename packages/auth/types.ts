/**
 * Supabase auth token shapes we consume in the gateway.
 * Only the fields the Veyrnox gateway actually reads are declared.
 */

export interface SupabaseJwtClaims {
    /** Supabase user id — becomes users.auth_id in our schema. */
    sub: string;
    /** Email from the verified identity. May be absent for anonymous users. */
    email?: string;
    /** Role — 'authenticated' | 'anon' | 'service_role'. */
    role: "authenticated" | "anon" | "service_role" | string;
    /** Auth session id — useful for revocation checks. */
    session_id?: string;
    /** Standard JWT fields. */
    iss: string;
    aud: string;
    exp: number;
    iat: number;
    /** app_metadata / user_metadata pass-through for provider-specific claims. */
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
}

export interface VerifiedAuth {
    /** Supabase user id — use as users.auth_id. */
    authId: string;
    email?: string;
    role: string;
    claims: SupabaseJwtClaims;
}

export type VerifyResult =
    | { ok: true; auth: VerifiedAuth }
    | { ok: false; reason: "missing" | "malformed" | "expired" | "signature" | "issuer" | "audience" };
