import test from "node:test";
import assert from "node:assert/strict";
import { audienceHandler } from "../lib/cinema/audienceApi.js";
import { winnersHandler, rankingsHandler } from "../lib/cinema/rankingsApi.js";
import { createWatchCoverage } from "../lib/cinema/watchCoverage.js";
const UUID = "11111111-1111-4111-8111-111111111111",
  KEY = "22222222-2222-4222-8222-222222222222";
const enabled = {
  CINEMA_ENABLED: "true",
  SOCIAL_CINEMA_PROFILES_ENABLED: "true",
  CINEMA_VIEWING_ENABLED: "true",
  VOTING_ENABLED: "true",
  CINEMA_AUDIENCE_ENABLED: "true",
  CINEMA_RANKINGS_ENABLED: "true",
  ACCESS_TEAM_DOMAIN: "access.test",
  ACCESS_AUD: "test",
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
const req = (body, headers = {}) =>
  new Request("https://app.test/api/v1/cinema/audience", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-veyrnox-auth-id": UUID,
      "idempotency-key": KEY,
      ...headers,
    },
    body: JSON.stringify(body),
  });
test("fractional media events accumulate conservative coverage; seeks, pauses and repeats are not elapsed watch time", () => {
  let now = 0;
  const m = createWatchCoverage(() => now);
  m.sample(0, true);
  for (let n = 1; n <= 20; n++) {
    now = n * 250;
    m.sample(n / 4, true);
  }
  assert.deepEqual(m.take(), {
    seconds: 5,
    ranges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ],
  });
  now += 250;
  m.sample(80, true);
  now += 250;
  m.sample(81, false);
  assert.equal(m.take(), null);
  m.reset();
  now += 1000;
  m.sample(0, true);
  now += 1000;
  m.sample(1, true);
  assert.deepEqual(m.take(), { seconds: 1, ranges: [[0, 1]] });
});
test("audience rejects anonymous, disabled, foreign fields and impossible coverage before RPC", async () => {
  let calls = 0;
  const h = audienceHandler({
    rpcCall: async () => {
      calls++;
      throw Error();
    },
  });
  await env(enabled, async () => {
    assert.equal(
      (
        await h(
          req(
            { action: "share", content_id: UUID, kind: "copy" },
            { "x-veyrnox-auth-id": "" },
          ),
        )
      ).status,
      401,
    );
    for (const b of [
      { action: "watch", session_id: UUID, seconds: 5, ranges: [[0, 60]] },
      {
        action: "watch",
        session_id: UUID,
        seconds: 30,
        ranges: [[0, 30]],
        score: 100,
      },
      { action: "share", content_id: UUID, kind: "external_success" },
    ])
      assert.equal((await h(req(b))).status, 400);
  });
  await env({ ...enabled, CINEMA_AUDIENCE_ENABLED: "false" }, async () =>
    assert.equal(
      (await h(req({ action: "share", content_id: UUID, kind: "copy" })))
        .status,
      503,
    ),
  );
  assert.equal(calls, 0);
});
test("watch calls bind the server verified actor and stable key, public winner projections exclude private fields", async () => {
  const calls = [];
  await env(enabled, async () => {
    const h = audienceHandler({
      rpcCall: async (n, a) => {
        calls.push({ n, a });
        return n === "consume_account_read_request"
          ? { ok: true }
          : { ok: true, seconds: 20, idempotent: false, secret: "private" };
      },
    });
    const r = await h(
      req({
        action: "watch",
        session_id: UUID,
        seconds: 30,
        ranges: [[0, 30]],
      }),
    );
    assert.deepEqual(await r.json(), {
      ok: true,
      idempotent: false,
      seconds: 20,
    });
    assert.equal(calls[1].a.p_auth_id, UUID);
    assert.equal(calls[1].a.p_key, KEY);
    const w = winnersHandler({
      rpcCall: async (n, a) => {
        assert.equal(n, "list_cinema_winners");
        assert.deepEqual(a, {});
        return [
          {
            id: UUID,
            name: "Week",
            ends_at: "2026-10-10T12:00:00Z",
            published_at: "2026-10-11T12:00:00Z",
            model_version: "weighted-v1",
            private_note: "private",
            titles: [
              {
                id: UUID,
                root_id: UUID,
                title: "Film",
                content_type: "FILM",
                rank: 1,
                score: 65.12,
                creator_id: UUID,
                signals: { viewers: 10 },
              },
            ],
          },
        ];
      },
    });
    const result = await w(
      new Request("https://app.test/api/cinema/winners", {
        headers: { "x-veyrnox-auth-id": UUID },
      }),
    );
    assert.equal(result.headers.get("cache-control"), "no-store");
    const body = await result.json();
    assert.equal(body.weeks[0].private_note, undefined);
    assert.equal(body.weeks[0].titles[0].signals, undefined);
  });
});
test("ranking moderation requires fresh MFA and a person Access assertion, never accepts supplied scores", async () => {
  let calls = 0,
    access = 0;
  const h = rankingsHandler({
    now: () => 1760000000000,
    accessVerifier: async () => {
      access++;
    },
    rpcCall: async () => {
      calls++;
      return { ok: true };
    },
  });
  await env(enabled, async () => {
    const base = {
      "x-veyrnox-auth-aal": "aal2",
      "x-veyrnox-auth-mfa-at": "1760000000",
      "cf-access-jwt-assertion": "fixture",
    };
    assert.equal(
      (
        await h(
          req(
            { action: "prepare", id: UUID, reason: "review" },
            { ...base, "x-veyrnox-auth-mfa-at": "1759999000" },
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h(
          req(
            { action: "prepare", id: UUID, reason: "review" },
            { ...base, "cf-access-jwt-assertion": "" },
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h(
          req(
            { action: "prepare", id: UUID, reason: "review", score: 100 },
            base,
          ),
        )
      ).status,
      400,
    );
  });
  assert.equal(calls, 0);
  assert.equal(access, 1);
});
