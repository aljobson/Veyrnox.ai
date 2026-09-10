/**
 * Unit tests for the Supabase JWT verifier. Uses `jose` to mint test
 * tokens signed with a known secret so we don't need a live Supabase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { verifyToken, verifyRequest } from "./verify.ts";

const SECRET = "test-secret-do-not-use-in-prod-please";
const encoder = new TextEncoder();
const ISSUER = "https://project-ref.supabase.co/auth/v1";

async function mint(payload: Record<string, unknown>, opts: { expiresIn?: string; issuer?: string; audience?: string } = {}) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setIssuer(opts.issuer ?? ISSUER)
        .setAudience(opts.audience ?? "authenticated")
        .setExpirationTime(opts.expiresIn ?? "1h")
        .sign(encoder.encode(SECRET));
}

test("verifyToken: happy path returns claims", async () => {
    const jwt = await mint({ sub: "user-abc", role: "authenticated", email: "a@b.co" });
    const res = await verifyToken(jwt, { jwtSecret: SECRET, issuer: ISSUER });
    assert.equal(res.ok, true);
    if (res.ok) {
        assert.equal(res.auth.authId, "user-abc");
        assert.equal(res.auth.email, "a@b.co");
        assert.equal(res.auth.role, "authenticated");
    }
});

test("verifyToken: missing token → missing", async () => {
    const res = await verifyToken("", { jwtSecret: SECRET, issuer: ISSUER });
    assert.deepEqual(res, { ok: false, reason: "missing" });
});

test("verifyToken: malformed token → malformed", async () => {
    const res = await verifyToken("not.a.jwt.at.all", { jwtSecret: SECRET, issuer: ISSUER });
    assert.equal(res.ok, false);
});

test("verifyToken: wrong secret → signature", async () => {
    const jwt = await mint({ sub: "u1", role: "authenticated" });
    const res = await verifyToken(jwt, { jwtSecret: "different-secret", issuer: ISSUER });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "signature");
});

test("verifyToken: wrong issuer → issuer", async () => {
    const jwt = await mint({ sub: "u1", role: "authenticated" }, { issuer: "https://evil.example.com/auth/v1" });
    const res = await verifyToken(jwt, { jwtSecret: SECRET, issuer: ISSUER });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "issuer");
});

test("verifyToken: expired → expired", async () => {
    const jwt = await mint({ sub: "u1", role: "authenticated" }, { expiresIn: "-1h" });
    const res = await verifyToken(jwt, { jwtSecret: SECRET, issuer: ISSUER, clockToleranceSec: 0 });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "expired");
});

test("verifyRequest: Bearer header path", async () => {
    const jwt = await mint({ sub: "u2", role: "authenticated" });
    const req = new Request("https://x", { headers: { authorization: `Bearer ${jwt}` } });
    const res = await verifyRequest(req, { jwtSecret: SECRET, issuer: ISSUER });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.auth.authId, "u2");
});

test("verifyRequest: cookie fallback (raw token)", async () => {
    const jwt = await mint({ sub: "u3", role: "authenticated" });
    const req = new Request("https://x", { headers: { cookie: `sb-abc-auth-token=${encodeURIComponent(jwt)}` } });
    const res = await verifyRequest(req, { jwtSecret: SECRET, issuer: ISSUER, cookieName: "sb-abc-auth-token" });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.auth.authId, "u3");
});

test("verifyRequest: cookie fallback (Supabase SSR JSON-array shape)", async () => {
    const jwt = await mint({ sub: "u4", role: "authenticated" });
    const stored = JSON.stringify([jwt, "refresh-token"]);
    const req = new Request("https://x", {
        headers: { cookie: `sb-abc-auth-token=${encodeURIComponent(stored)}` },
    });
    const res = await verifyRequest(req, { jwtSecret: SECRET, issuer: ISSUER, cookieName: "sb-abc-auth-token" });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.auth.authId, "u4");
});

test("verifyRequest: neither header nor cookie → missing", async () => {
    const req = new Request("https://x");
    const res = await verifyRequest(req, { jwtSecret: SECRET, issuer: ISSUER, cookieName: "sb-abc-auth-token" });
    assert.deepEqual(res, { ok: false, reason: "missing" });
});
