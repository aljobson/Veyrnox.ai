import test from "node:test";
import assert from "node:assert/strict";
import {
  storyPollsHandler,
  validStoryPollAction,
} from "../lib/cinema/storyPollsApi.js";
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  option = "33333333-3333-4333-8333-333333333333";
const NOW = Date.UTC(2026, 9, 10, 12);
Object.assign(process.env, {
  CINEMA_ENABLED: "true",
  SOCIAL_CINEMA_PROFILES_ENABLED: "true",
  CINEMA_VIEWING_ENABLED: "true",
  STORY_POLLS_ENABLED: "true",
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ACCESS_AUD: "aud",
});
const headers = {
  "x-veyrnox-auth-id": id,
  "content-type": "application/json",
  "idempotency-key": id,
};
const admin = {
  "x-veyrnox-auth-aal": "aal2",
  "x-veyrnox-auth-mfa-at": String(NOW / 1000),
  "cf-access-jwt-assertion": "synthetic",
};
const get = (query = `?content_id=${other}`, extra = {}) =>
  new Request(`https://test.invalid/api/v1/cinema/story-polls${query}`, {
    headers: { ...headers, ...extra },
  });
const post = (body, extra = {}) =>
  new Request("https://test.invalid/api/v1/cinema/story-choices", {
    method: "POST",
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
  });
const setup = (
  action,
  result,
  { authed = true, rate = { ok: true }, access = async () => ({}) } = {},
) => {
  const calls = [];
  return {
    calls,
    handle: storyPollsHandler({
      action,
      authed,
      now: () => NOW,
      accessVerifier: access,
      rpcCall: async (name, args) => {
        calls.push({ name, args });
        return name === "consume_account_read_request" ? rate : result;
      },
    }),
  };
};
const row = {
  id: other,
  question: "Which way next?",
  opens_at: "2026-10-10T11:00:00+00:00",
  closes_at: "2026-10-11T11:00:00+00:00",
  is_open: true,
  options: [
    { id, label: "Left", votes: 2, private: "secret" },
    { id: option, label: "Right", votes: 0 },
  ],
  my_choice: { id, option_id: id, status: "qualified", voter_id: "secret" },
  private: "secret",
};
test("public read ignores spoofed identity and projects counts without account or internal fields", async () => {
  const s = setup("read", { polls: [row] }, { authed: false }),
    r = await s.handle(get());
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.polls[0].my_choice, null);
  assert.equal(d.polls[0].private, undefined);
  assert.equal(d.polls[0].options[0].private, undefined);
  assert.equal(s.calls[0].args.p_auth_id, null);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
test("signed-in read exposes only the current account choice", async () => {
  const r = await setup("read", { polls: [row] }).handle(get());
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).polls[0].my_choice, {
    id,
    option_id: id,
    status: "qualified",
  });
});
test("identity, exact feature values and query allowlist gate all RPCs", async () => {
  const s = setup("read", { polls: [] });
  assert.equal(
    (await s.handle(get("", { "x-veyrnox-auth-id": "" }))).status,
    401,
  );
  for (const k of [
    "CINEMA_ENABLED",
    "SOCIAL_CINEMA_PROFILES_ENABLED",
    "CINEMA_VIEWING_ENABLED",
    "STORY_POLLS_ENABLED",
  ]) {
    process.env[k] = "false";
    assert.equal((await s.handle(get())).status, 503);
    process.env[k] = "true";
  }
  for (const q of [
    "",
    `?content_id=${id}&content_id=${other}`,
    `?content_id=${id}&owner=${id}`,
    "?content_id=x",
  ])
    assert.equal((await s.handle(get(q))).status, 400);
  assert.equal(s.calls.length, 0);
});
test("choices reject extra fields and invalid retry keys before RPCs, then forward exact fields", async () => {
  const s = setup("choice", {
    id: other,
    status: "under_review",
    idempotent: false,
  });
  for (const b of [
    null,
    [],
    { poll_id: id, option_id: other, qualified: true },
    { poll_id: "x", option_id: other },
  ])
    assert.equal((await s.handle(post(b))).status, 400);
  assert.equal(
    (
      await s.handle(
        post({ poll_id: id, option_id: other }, { "idempotency-key": "x" }),
      )
    ).status,
    400,
  );
  assert.equal(s.calls.length, 0);
  assert.equal(
    (await s.handle(post({ poll_id: id, option_id: other }))).status,
    201,
  );
  assert.deepEqual(s.calls[1].args, {
    p_auth_id: id,
    p_idempotency_key: id,
    p_poll_id: id,
    p_option_id: other,
  });
  assert.equal(
    (
      await setup("choice", {
        id: other,
        status: "qualified",
        idempotent: true,
      }).handle(post({ poll_id: id, option_id: other }))
    ).status,
    200,
  );
});
test("a changed choice and a closed window produce explicit conflict responses", async () => {
  for (const error of [
    "choice_already_recorded",
    "poll_closed",
    "idempotency_conflict",
  ])
    assert.equal(
      (
        await setup("choice", { error }).handle(
          post({ poll_id: id, option_id: other }),
        )
      ).status,
      409,
    );
});
test("malformed public rows and unrecognized failures fail closed", async () => {
  for (const polls of [
    [{ ...row, is_open: 1 }],
    [{ ...row, options: [row.options[0], row.options[0]] }],
    [{ ...row, my_choice: { id, option_id: other, status: "qualified" } }],
    [{ ...row, options: [{ ...row.options[0], votes: -1 }, row.options[1]] }],
    Array(6).fill(row),
  ])
    assert.equal((await setup("read", { polls }).handle(get())).status, 503);
  assert.equal(
    (await setup("read", { error: "private_provider_detail" }).handle(get()))
      .status,
    503,
  );
  assert.equal(
    (await setup("read", {}, { rate: { code: "RATE_LIMITED" } }).handle(get()))
      .status,
    429,
  );
  assert.equal(
    (await setup("read", {}, { rate: { ok: false } }).handle(get())).status,
    503,
  );
});
const create = {
  action: "create_story_poll",
  content_id: id,
  question: "Next step?",
  options: ["Left", "Right"],
  opens_at: "2026-10-10T11:00:00Z",
  closes_at: "2026-10-11T11:00:00Z",
  reason: "Reviewed question",
};
test("moderator action schema bounds immutable questions, distinct answers and windows", () => {
  assert.equal(validStoryPollAction(create), true);
  for (const patch of [
    { options: null },
    { options: ["One"] },
    { options: [" Left ", "left"] },
    { options: [1, "Two"] },
    { options: Array(7).fill("Option") },
    { question: 3 },
    { question: "x".repeat(241) },
    { opens_at: "infinity" },
    { closes_at: "2026-02-30T11:00:00Z" },
    { action: "__proto__" },
    { action: "constructor" },
    { owner: id },
    { reason: 12 },
  ])
    assert.equal(
      validStoryPollAction({ ...create, ...patch }),
      false,
      JSON.stringify(patch),
    );
  assert.equal(
    validStoryPollAction({ action: "close_story_poll", id, reason: "Closed" }),
    true,
  );
  assert.equal(
    validStoryPollAction({
      action: "close_story_poll",
      id,
      reason: "Closed",
      decision: "qualified",
    }),
    false,
  );
});
test("admin requires fresh MFA and a verified person Access assertion before any database access", async () => {
  const s = setup("queue", { polls: [], choices: [] });
  for (const extra of [
    {},
    { ...admin, "x-veyrnox-auth-aal": "aal1" },
    { ...admin, "x-veyrnox-auth-mfa-at": String(NOW / 1000 - 301) },
    { ...admin, "x-veyrnox-auth-mfa-at": String(NOW / 1000 + 6) },
    { ...admin, "cf-access-jwt-assertion": "" },
  ])
    assert.equal((await s.handle(get("", extra))).status, 403);
  assert.equal(s.calls.length, 0);
  const bad = setup(
    "queue",
    { polls: [], choices: [] },
    {
      access: async () => {
        throw { reason: "service_token" };
      },
    },
  );
  assert.equal((await bad.handle(get("", admin))).status, 403);
  assert.equal(bad.calls.length, 0);
  assert.equal((await s.handle(get("", admin))).status, 200);
  assert.equal(s.calls[1].args.p_mfa_at, NOW / 1000);
});
test("admin mutation passes verified identity, fresh MFA and a bounded audited action", async () => {
  const s = setup("manage", { id: other, status: "open", idempotent: false });
  assert.equal((await s.handle(post(create, admin))).status, 201);
  const call = s.calls[1];
  assert.equal(call.name, "manage_cinema_story_polls");
  assert.equal(call.args.p_auth_id, id);
  assert.equal(call.args.p_aal, "aal2");
  assert.deepEqual(call.args.p_payload, create);
  assert.match(call.args.p_request_id, /^[0-9a-f-]{36}$/);
});
