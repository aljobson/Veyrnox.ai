import test from "node:test";
import assert from "node:assert/strict";
import { retentionHandler } from "../lib/cinema/retentionApi.js";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const flags = {
  CINEMA_ENABLED: "true",
  SOCIAL_CINEMA_PROFILES_ENABLED: "true",
  CINEMA_VIEWING_ENABLED: "true",
  CINEMA_RETENTION_ENABLED: "true",
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
const read = (query, headers = {}) =>
  new Request(`https://app.test/api/v1/cinema/retention?${query}`, {
    headers: { "x-veyrnox-auth-id": A, ...headers },
  });
const write = (body, headers = {}) =>
  new Request("https://app.test/api/v1/cinema/retention", {
    method: "POST",
    headers: {
      "x-veyrnox-auth-id": A,
      "content-type": "application/json",
      "idempotency-key": B,
      ...headers,
    },
    body: JSON.stringify(body),
  });
test("private collections authenticate before flags and refuse missing/closed prerequisites without DB access", async () => {
  let calls = 0;
  const h = retentionHandler({
    rpcCall: () => {
      calls++;
      throw Error("should not run");
    },
  });
  assert.equal(
    (await h(read("kind=saved", { "x-veyrnox-auth-id": "" }))).status,
    401,
  );
  await env({ ...flags, CINEMA_VIEWING_ENABLED: "false" }, async () =>
    assert.equal((await h(read("kind=saved"))).status, 503),
  );
  await env({ ...flags, CINEMA_RETENTION_ENABLED: "TRUE" }, async () =>
    assert.equal((await h(read("kind=saved"))).status, 503),
  );
  assert.equal(calls, 0);
});
test("strict queries and writes reject owner spoofing, duplicate parameters, malformed IDs, desired-state coercion and missing idempotency", async () =>
  env(flags, async () => {
    let calls = 0;
    const rpcCall = () => {
      calls++;
      throw Error("unexpected");
    };
    const h = retentionHandler({ rpcCall }),
      w = retentionHandler({ rpcCall, write: true });
    for (const query of [
      "",
      "kind=saved&kind=creator",
      "kind=all",
      "kind=saved&owner=" + B,
      "kind=saved&before_id=bad",
      "kind=saved&limit=41",
      "content_id=" + B + "&kind=saved",
      "content_id=bad",
    ])
      assert.equal((await h(read(query))).status, 400, query);
    for (const body of [
      { kind: "saved", target_id: B, active: 1 },
      { kind: "saved", target_id: B, active: true, owner: B },
      { kind: "episode", target_id: B, active: true },
      { kind: "saved", target_id: "bad", active: true },
      [],
    ])
      assert.equal((await w(write(body))).status, 400);
    assert.equal(
      (
        await w(
          write(
            { kind: "saved", target_id: B, active: true },
            { "idempotency-key": "" },
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await w(
          write(
            { kind: "saved", target_id: B, active: true },
            { "content-type": "text/plain" },
          ),
        )
      ).status,
      415,
    );
    assert.equal(calls, 0);
  }));
test("verified actor is forwarded exclusively; private pages whitelist fields and use an extra row for exact paging", async () =>
  env(flags, async () => {
    const calls = [];
    const item = {
      target_id: B,
      content_id: B,
      title: "Story",
      username: "creator",
      display_name: "Creator",
      email: "never-return",
    };
    const h = retentionHandler({
      rpcCall: async (name, args) => {
        calls.push({ name, args });
        return name === "consume_account_read_request"
          ? { ok: true }
          : { kind: "saved", items: [item, item] };
      },
    });
    const r = await h(read("kind=saved&limit=1"));
    const b = await r.json();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(b.items.length, 1);
    assert.equal(b.next, B);
    assert.ok(!JSON.stringify(b).includes("never-return"));
    assert.equal(calls[1].args.p_auth_id, A);
    assert.equal(calls[1].args.p_limit, 1);
  }));
test("writes bind payload/key and return only a validated acknowledgment; conflict/rate errors remain typed and sanitized", async () =>
  env(flags, async () => {
    let mode = "ok",
      record;
    const h = retentionHandler({
      write: true,
      rpcCall: async (name, args) => {
        if (name === "consume_account_read_request") return { ok: true };
        record = args;
        return mode === "ok"
          ? {
              kind: args.p_kind,
              target_id: args.p_target_id,
              active: args.p_active,
              idempotent: true,
              secret: "never-return",
            }
          : mode === "exception"
            ? Promise.reject(Error("database secret"))
            : { error: mode };
      },
    });
    const body = { kind: "creator", target_id: B, active: true };
    let r = await h(write(body));
    assert.equal(r.status, 200);
    assert.equal(record.p_auth_id, A);
    assert.equal(record.p_key, B);
    assert.ok(!JSON.stringify(await r.json()).includes("never-return"));
    for (const [code, status] of [
      ["idempotency_conflict", 409],
      ["content_not_found", 404],
      ["profile_required", 403],
      ["rate_limited", 429],
      ["exception", 503],
    ]) {
      mode = code;
      r = await h(write(body));
      assert.equal(r.status, status);
      assert.ok(!JSON.stringify(await r.json()).includes("database secret"));
      if (status === 429) assert.equal(r.headers.get("retry-after"), "60");
    }
  }));
test("a stale/invalid RPC projection or acknowledgment is never treated as success", async () =>
  env(flags, async () => {
    for (const result of [
      {},
      {
        kind: "saved",
        items: [
          {
            target_id: B,
            content_id: B,
            title: "",
            username: "x",
            display_name: "x",
          },
        ],
      },
      { kind: "saved", items: Array(22).fill({}) },
    ]) {
      const h = retentionHandler({
        rpcCall: async (name) =>
          name === "consume_account_read_request" ? { ok: true } : result,
      });
      assert.equal((await h(read("kind=saved"))).status, 503);
    }
    const h = retentionHandler({
      write: true,
      rpcCall: async (name) =>
        name === "consume_account_read_request"
          ? { ok: true }
          : { kind: "saved", target_id: B, active: false, idempotent: true },
    });
    assert.equal(
      (await h(write({ kind: "saved", target_id: B, active: true }))).status,
      503,
    );
  }));
