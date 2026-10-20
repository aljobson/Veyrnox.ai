import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { watchProgressHandler } from "../lib/cinema/watchProgressApi.js";
import { cinemaFeatures } from "../lib/cinema/features.js";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const flags = {
  CINEMA_ENABLED: "true",
  SOCIAL_CINEMA_PROFILES_ENABLED: "true",
  CINEMA_VIEWING_ENABLED: "true",
  CINEMA_WATCH_PROGRESS_ENABLED: "true",
};
async function env(values, fn) {
  const old = {};
  for (const [k, v] of Object.entries(values)) {
    old[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const url = (q = "") => `https://app.test/api/v1/cinema/progress${q ? "?" + q : ""}`;
const get = (q, headers = {}) =>
  new Request(url(q), { headers: { "x-veyrnox-auth-id": A, ...headers } });
const del = (q) =>
  new Request(url(q), { method: "DELETE", headers: { "x-veyrnox-auth-id": A } });
const put = (body, headers = {}) =>
  new Request(url(), {
    method: "PUT",
    headers: { "x-veyrnox-auth-id": A, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const never = () => {
  throw Error("should not run");
};

test("flag is off by default, and neither environment file turns it on", () => {
  assert.equal(cinemaFeatures({ CINEMA_ENABLED: "true" }).watchProgress, false);
  assert.equal(cinemaFeatures({ ...flags, CINEMA_WATCH_PROGRESS_ENABLED: "TRUE" }).watchProgress, false);
  assert.equal(cinemaFeatures({ ...flags, CINEMA_VIEWING_ENABLED: "false" }).watchProgress, false);
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const packed = [...wrangler.matchAll(/"CINEMA_RUNTIME_FLAGS": "((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse(JSON.parse(`"${m[1]}"`)),
  );
  assert.ok(packed.length >= 2);
  for (const p of packed) assert.notEqual(p.watchProgress, "true");
  assert.doesNotMatch(wrangler, /CINEMA_WATCH_PROGRESS_ENABLED"\s*:\s*"true"/);
});

test("authenticates before the flag, and flag off never reaches the database", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const h = watchProgressHandler({ method, rpcCall: never });
    const mk = () =>
      method === "GET" ? get("", { "x-veyrnox-auth-id": "" })
        : method === "PUT" ? put({ content_id: B, position_seconds: 5 }, { "x-veyrnox-auth-id": "" })
        : new Request(url("content_id=" + B), { method, headers: { "x-veyrnox-auth-id": "" } });
    assert.equal((await h(mk())).status, 401);
    await env({ ...flags, CINEMA_WATCH_PROGRESS_ENABLED: "false" }, async () => {
      const req = method === "GET" ? get("") : method === "PUT" ? put({ content_id: B, position_seconds: 5 }) : del("content_id=" + B);
      const r = await h(req);
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error, "watch_progress_not_open");
    });
  }
});

test("strict validation refuses spoofed owners, bad ids, out-of-range positions and extra fields", async () =>
  env(flags, async () => {
    const h = watchProgressHandler({ method: "GET", rpcCall: never });
    for (const q of ["limit=0", "limit=41", "limit=1&limit=2", "before_id=bad", "owner=" + B, "user_id=" + B])
      assert.equal((await h(get(q))).status, 400, q);
    const p = watchProgressHandler({ method: "PUT", rpcCall: never });
    for (const body of [
      { content_id: B },
      { content_id: B, position_seconds: -1 },
      { content_id: B, position_seconds: 601 },
      { content_id: B, position_seconds: 1.5 },
      { content_id: B, position_seconds: "5" },
      { content_id: "bad", position_seconds: 5 },
      { content_id: B, position_seconds: 5, user_id: B },
      [],
      null,
    ])
      assert.equal((await p(put(body))).status, 400, JSON.stringify(body));
    assert.equal((await p(put({ content_id: B, position_seconds: 5 }, { "content-type": "text/plain" }))).status, 415);
    const d = watchProgressHandler({ method: "DELETE", rpcCall: never });
    for (const q of ["", "content_id=bad", `content_id=${B}&content_id=${A}`, `content_id=${B}&user_id=${A}`])
      assert.equal((await d(del(q))).status, 400, q);
  }));

test("own rows only: the verified subject is the only owner sent, and output is whitelisted", async () =>
  env(flags, async () => {
    const calls = [];
    const item = {
      content_id: B, title: "Story", username: "creator", display_name: "Creator",
      position_seconds: 30, duration_seconds: 120, updated_at: "2026-10-20T10:00:00Z",
      email: "never-return", user_id: "never-return",
    };
    const h = watchProgressHandler({
      method: "GET",
      rpcCall: async (name, args) => {
        calls.push({ name, args });
        return name === "consume_account_read_request" ? { ok: true } : { items: [item, item] };
      },
    });
    // A caller-supplied owner is refused before any call; the header subject is what is forwarded.
    assert.equal((await h(get("user_id=" + B))).status, 400);
    assert.equal(calls.length, 0);
    const r = await h(get("limit=1", { "x-veyrnox-auth-id": A }));
    const b = await r.json();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(b.items.length, 1);
    assert.equal(b.next, B);
    assert.ok(!JSON.stringify(b).includes("never-return"));
    assert.equal(calls[1].name, "list_cinema_watch_resume");
    assert.deepEqual(calls[1].args, { p_auth_id: A, p_before_id: null, p_limit: 1 });
  }));

test("PUT forwards one absolute position and returns the stored result; throttled writes are a quiet success", async () =>
  env(flags, async () => {
    let result = { recorded: true, content_id: B, position_seconds: 40, duration_seconds: 100, completed: false };
    const calls = [];
    const p = watchProgressHandler({
      method: "PUT",
      rpcCall: async (name, args) => {
        calls.push({ name, args });
        return name === "consume_account_read_request" ? { ok: true } : result;
      },
    });
    let r = await p(put({ content_id: B.toUpperCase(), position_seconds: 40 }));
    assert.equal(r.status, 200);
    assert.deepEqual(calls[1], { name: "save_cinema_watch_resume", args: { p_auth_id: A, p_content_id: B, p_position: 40 } });
    assert.equal((await r.json()).recorded, true);
    result = { ...result, recorded: false };
    r = await p(put({ content_id: B, position_seconds: 41 }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).recorded, false);
  }));

test("typed errors map to statuses and nothing from the database leaks", async () =>
  env(flags, async () => {
    for (const [code, status] of [["locked", 403], ["content_not_found", 404], ["not_ready", 409], ["rate_limited", 429], ["profile_required", 403]]) {
      const p = watchProgressHandler({
        method: "PUT",
        rpcCall: async (name) => (name === "consume_account_read_request" ? { ok: true } : { error: code, detail: "secret db text" }),
      });
      const r = await p(put({ content_id: B, position_seconds: 5 }));
      assert.equal(r.status, status, code);
      const b = await r.json();
      assert.equal(b.error, code);
      assert.ok(!JSON.stringify(b).includes("secret"));
    }
    const rl = watchProgressHandler({ method: "GET", rpcCall: async () => ({ code: "RATE_LIMITED" }) });
    assert.equal((await rl(get(""))).status, 429);
    const down = watchProgressHandler({ method: "GET", rpcCall: async () => { throw Error("db detail"); } });
    const r = await down(get(""));
    assert.equal(r.status, 503);
    assert.ok(!JSON.stringify(await r.json()).includes("db detail"));
    const bad = watchProgressHandler({
      method: "PUT",
      rpcCall: async (name) => (name === "consume_account_read_request" ? { ok: true } : { recorded: true, content_id: A, position_seconds: 1, duration_seconds: 2, completed: false }),
    });
    assert.equal((await bad(put({ content_id: B, position_seconds: 1 }))).status, 503);
  }));

test("DELETE removes only the named title for the verified subject", async () =>
  env(flags, async () => {
    const calls = [];
    const d = watchProgressHandler({
      method: "DELETE",
      rpcCall: async (name, args) => {
        calls.push({ name, args });
        return name === "consume_account_read_request" ? { ok: true } : { content_id: B, removed: true };
      },
    });
    const r = await d(del("content_id=" + B));
    assert.equal(r.status, 200);
    assert.deepEqual(calls[1], { name: "remove_cinema_watch_resume", args: { p_auth_id: A, p_content_id: B } });
    assert.deepEqual((({ content_id, removed }) => ({ content_id, removed }))(await r.json()), { content_id: B, removed: true });
  }));

test("migration 0355 keeps the table private, forces RLS, pins search_path and revokes before granting", () => {
  const sql = readFileSync(new URL("../packages/db/schema/supabase/0355_cinema_watch_progress.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE public\.cinema_watch_resume FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.cinema_watch_resume FROM PUBLIC, anon, authenticated, service_role/);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/g) || []).length, 5);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.save_cinema_watch_resume\(TEXT, UUID, INTEGER\)/);
  assert.doesNotMatch(sql, /INSERT INTO public\.(ledger_entries|credit_balances)|UPDATE public\.credit_balances/);
  assert.match(sql, /AFTER UPDATE OF deleted_at ON public\.users/);
});
