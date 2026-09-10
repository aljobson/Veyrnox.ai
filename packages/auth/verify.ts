/**
 * Supabase JWT verification for the Veyrnox gateway.
 *
 * Supabase issues project-scoped HS256 JWTs signed with the project's
 * JWT secret (server-side value, not the anon/publishable key). We
 * verify with `jose`, which works in Cloudflare Workers via Web Crypto.
 *
 * Read the token from either:
 *   - Authorization: Bearer <jwt>  (SDK-driven clients)
 *   - Cookie: sb-<project-ref>-auth-token  (SSR-shared session)
 *
 * The gateway middleware calls verifyRequest(request) and gates every
 * /api/v1/* route on ok:true. Downstream handlers get `authId` and can
 * pass it to Ledger.debit() etc.
 *
 * The JWT_SECRET is a Cloudflare Worker secret, set via:
 *   wrangler secret put SUPABASE_JWT_SECRET
 * Do not commit it.
 */

import { jwtVerify, type JWTPayload } from "jose";
import type { SupabaseJwtClaims, VerifyResult } from "./types.ts";

const encoder = new TextEncoder();

export interface VerifyOptions {
    /** The Supabase project's JWT secret. Required. */
    jwtSecret: string;
    /**
     * Expected issuer — 'https://<project-ref>.supabase.co/auth/v1'. Required.
     * Prevents accepting a token from a different Supabase project.
     */
    issuer: string;
    /** Expected audience. Defaults to 'authenticated'. */
    audience?: string;
    /**
     * Clock skew tolerance in seconds. Defaults to 5 — enough for typical
     * NTP drift, tight enough to catch replayed tokens near expiry.
     */
    clockToleranceSec?: number;
}

/**
 * Verify a raw JWT string against the Supabase project's secret.
 * Returns discriminated result — no throws for expected failures.
 */
export async function verifyToken(
    token: string,
    opts: VerifyOptions
): Promise<VerifyResult> {
    if (!token || typeof token !== "string") {
        return { ok: false, reason: "missing" };
    }
    if (token.split(".").length !== 3) {
        return { ok: false, reason: "malformed" };
    }
    try {
        const { payload } = await jwtVerify(token, encoder.encode(opts.jwtSecret), {
            issuer: opts.issuer,
            audience: opts.audience ?? "authenticated",
            algorithms: ["HS256"],
            clockTolerance: opts.clockToleranceSec ?? 5,
        });
        const claims = payload as JWTPayload & SupabaseJwtClaims;
        if (!claims.sub) return { ok: false, reason: "malformed" };
        return {
            ok: true,
            auth: {
                authId: claims.sub,
                email: claims.email,
                role: claims.role ?? "authenticated",
                claims,
            },
        };
    } catch (err) {
        // jose throws typed errors; map to our reason set. Anything we
        // don't recognise ends up as 'signature' (safest — reject).
        const code = (err as { code?: string })?.code ?? "";
        if (code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };
        if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
            const claim = (err as { claim?: string })?.claim;
            if (claim === "iss") return { ok: false, reason: "issuer" };
            if (claim === "aud") return { ok: false, reason: "audience" };
        }
        return { ok: false, reason: "signature" };
    }
}

/**
 * Convenience: extract token from a Request and verify it.
 * Prefers Authorization header; falls back to the Supabase cookie name.
 */
export async function verifyRequest(
    req: Request,
    opts: VerifyOptions & { cookieName?: string }
): Promise<VerifyResult> {
    // Bearer token
    const authHeader = req.headers.get("authorization");
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
        const token = authHeader.slice(7).trim();
        return verifyToken(token, opts);
    }
    // Cookie fallback — Supabase SSR uses cookieName like `sb-<ref>-auth-token`
    if (opts.cookieName) {
        const cookieHeader = req.headers.get("cookie") ?? "";
        const match = new RegExp(
            `(?:^|;\\s*)${escapeRegex(opts.cookieName)}=([^;]+)`
        ).exec(cookieHeader);
        if (match) {
            const raw = decodeURIComponent(match[1]);
            // Supabase stores as JSON array [accessToken, refreshToken, ...]
            // when using the SSR helper. Accept either shape.
            let token = raw;
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && typeof parsed[0] === "string") {
                    token = parsed[0];
                }
            } catch {
                // Not JSON — assume raw token
            }
            return verifyToken(token, opts);
        }
    }
    return { ok: false, reason: "missing" };
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
