import test from "node:test";
import assert from "node:assert/strict";
import { creatorAnalyticsHandler } from "../lib/cinema/creatorAnalyticsApi.js";
const A = "11111111-1111-4111-8111-111111111111",
  T = "22222222-2222-4222-8222-222222222222";
const flags = {
  CREATOR_CONTENT_ENABLED: "true",
  CINEMA_ENABLED: "true",
  SOCIAL_CINEMA_PROFILES_ENABLED: "true",
  CINEMA_VIEWING_ENABLED: "true",
  CINEMA_AUDIENCE_ENABLED: "true",
  CINEMA_CREATOR_ANALYTICS_ENABLED: "true",
};
const end = new Date(
  new Date().toISOString().slice(0, 10) + "T00:00:00Z",
).getTime();
const good = {
  content_id: T,
  period_start: new Date(end - 28 * 86400000).toISOString(),
  period_end: new Date(end).toISOString(),
  minimum_viewers: 5,
  suppressed: false,
  metrics: { viewers: 8, completions: 6, voters: 3, sharers: 2, commenters: 1 },
};
const request = (query = `content_id=${T}`, auth = A) =>
  new Request(`https://example.test/api/v1/cinema/creator-analytics?${query}`, {
    headers: auth ? { "x-veyrnox-auth-id": auth } : {},
  });
async function env(fn, changes = {}) {
  const old = Object.fromEntries(
    Object.keys(flags).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, flags, changes);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const handler = (data = good, calls = []) =>
  creatorAnalyticsHandler({
    rpcCall: async (name, args) => {
      calls.push({ name, args });
      return name === "consume_account_read_request" ? { ok: true } : data;
    },
  });
test("analytics requires verified auth before closed gates", () =>
  env(
    async () => {
      let r = await handler()(request("", null));
      assert.equal(r.status, 401);
      r = await handler()(request());
      assert.equal(r.status, 503);
    },
    { CINEMA_CREATOR_ANALYTICS_ENABLED: "false" },
  ));
test("analytics prerequisites fail closed", () =>
  env(async () => {
    for (const key of Object.keys(flags)) {
      process.env[key] = "false";
      assert.equal((await handler()(request())).status, 503);
      process.env[key] = "true";
    }
  }));
test("analytics refuses caller-supplied owners, repeated IDs and malformed inputs", () =>
  env(async () => {
    for (const query of [
      "",
      `content_id=${T}&owner_id=${A}`,
      `content_id=${T}&content_id=${T}`,
      "content_id=bad",
    ]) {
      const calls = [];
      assert.equal((await handler(good, calls)(request(query))).status, 400);
      assert.equal(calls.length, 0);
    }
  }));
test("analytics passes only authenticated subject and title; whitelists results", () =>
  env(async () => {
    const calls = [],
      r = await handler(
        {
          ...good,
          email: "secret@example.invalid",
          metrics: { ...good.metrics, actors: [A] },
        },
        calls,
      )(request());
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls[1].args, { p_auth_id: A, p_content_id: T });
    const data = await r.json();
    assert.equal(data.email, undefined);
    assert.deepEqual(data.metrics, good.metrics);
    assert.ok(data.request_id);
  }));
test("small audiences return no individual metrics", () =>
  env(async () => {
    const r = await handler({ ...good, suppressed: true, metrics: null })(
      request(),
    );
    assert.equal(r.status, 200);
    assert.equal((await r.json()).metrics, null);
  }));
test("analytics rejects inconsistent privacy, counts and periods", () =>
  env(async () => {
    for (const data of [
      { ...good, suppressed: true },
      { ...good, metrics: { ...good.metrics, viewers: 4 } },
      { ...good, metrics: { ...good.metrics, sharers: 9 } },
      { ...good, period_end: new Date(end + 28 * 86400000).toISOString() },
      { ...good, content_id: A },
      { ...good, metrics: { ...good.metrics, completions: -1 } },
    ])
      assert.equal((await handler(data)(request())).status, 503);
  }));
test("analytics ownership denials remain typed and safe", () =>
  env(async () => {
    for (const [error, status] of [
      ["creator_required", 403],
      ["content_not_found", 404],
    ]) {
      const r = await handler({ error, sql: "private payload" })(request());
      assert.equal(r.status, status);
      assert.equal((await r.json()).sql, undefined);
    }
  }));
test("analytics rate and provider failures cannot become success", () =>
  env(async () => {
    let r = await creatorAnalyticsHandler({
      rpcCall: async () => ({ code: "RATE_LIMITED" }),
    })(request());
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "60");
    r = await creatorAnalyticsHandler({
      rpcCall: async () => {
        throw Error("secret");
      },
    })(request());
    assert.equal(r.status, 503);
    assert.equal(JSON.stringify(await r.json()).includes("secret"), false);
  }));
