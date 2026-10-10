import { rpc, envConfig } from "../../packages/db/supabase-client.js";
import { verifyAccessLogin } from "../accessJwt.js";
import { limitRequestBody } from "../requestBodyLimit.js";
import { cinemaFeatures } from "./features.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v, min, max) =>
  typeof v === "string" &&
  [...v.trim()].length >= min &&
  [...v.trim()].length <= max;
const instant = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
    v,
  ) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v.slice(0, 10);
const statuses = ["qualified", "under_review", "rejected"];
const errors = {
  profile_required: 403,
  account_not_active: 403,
  not_authorized: 403,
  self_review_forbidden: 403,
  content_not_found: 404,
  poll_not_found: 404,
  choice_not_found: 404,
  poll_closed: 409,
  choice_already_recorded: 409,
  idempotency_conflict: 409,
  poll_overlap: 409,
  poll_capacity: 409,
  invalid_poll: 400,
  invalid_choice: 400,
  invalid_action: 400,
  rate_limited: 429,
};
const fields = {
  create_story_poll: [
    "action",
    "content_id",
    "question",
    "options",
    "opens_at",
    "closes_at",
    "reason",
  ],
  close_story_poll: ["action", "id", "reason"],
  review_story_choice: ["action", "id", "decision", "reason"],
};
export function validStoryPollAction(body) {
  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== "object" ||
    typeof body.action !== "string" ||
    !Object.hasOwn(fields, body.action) ||
    Object.keys(body).some((k) => !fields[body.action].includes(k)) ||
    !text(body.reason, 3, 500)
  )
    return false;
  if (body.action === "create_story_poll")
    return (
      UUID.test(body.content_id || "") &&
      text(body.question, 1, 240) &&
      Array.isArray(body.options) &&
      body.options.length >= 2 &&
      body.options.length <= 6 &&
      body.options.every((o) => text(o, 1, 120)) &&
      new Set(body.options.map((o) => o.trim().toLowerCase())).size ===
        body.options.length &&
      instant(body.opens_at) &&
      body.opens_at.endsWith("Z") &&
      instant(body.closes_at) &&
      body.closes_at.endsWith("Z") &&
      Date.parse(body.closes_at) > Date.parse(body.opens_at) &&
      Date.parse(body.closes_at) - Date.parse(body.opens_at) <= 31 * 86400000
    );
  return (
    UUID.test(body.id || "") &&
    (body.action !== "review_story_choice" || statuses.includes(body.decision))
  );
}
function validPoll(p) {
  return (
    p &&
    UUID.test(p.id || "") &&
    text(p.question, 1, 240) &&
    instant(p.opens_at) &&
    instant(p.closes_at) &&
    typeof p.is_open === "boolean" &&
    Array.isArray(p.options) &&
    p.options.length >= 2 &&
    p.options.length <= 6 &&
    new Set(p.options.map((o) => o.id)).size === p.options.length &&
    p.options.every(
      (o) =>
        UUID.test(o.id || "") &&
        text(o.label, 1, 120) &&
        Number.isSafeInteger(o.votes) &&
        o.votes >= 0,
    ) &&
    (!p.my_choice ||
      (UUID.test(p.my_choice.id || "") &&
        statuses.includes(p.my_choice.status) &&
        p.options.some((o) => o.id === p.my_choice.option_id)))
  );
}
export function storyPollsHandler({
  action = "read",
  authed = true,
  rpcCall = rpc,
  accessVerifier = verifyAccessLogin,
  now = () => Date.now(),
} = {}) {
  if (!["read", "choice", "queue", "manage"].includes(action))
    throw Error("Invalid story poll action");
  const admin = ["queue", "manage"].includes(action),
    write = ["choice", "manage"].includes(action);
  return async (req) => {
    const requestId = crypto.randomUUID(),
      auth = authed ? req.headers.get("x-veyrnox-auth-id") : null;
    const reply = (body, status = 200) => {
      console.info(
        JSON.stringify({
          event: "cinema.story_poll",
          request_id: requestId,
          actor_id: UUID.test(auth || "") ? auth : undefined,
          action,
          status,
          code: body.error || "ok",
        }),
      );
      return Response.json(
        { ...body, request_id: requestId },
        {
          status,
          headers: {
            "Cache-Control": "no-store",
            "x-request-id": requestId,
            ...(status === 429 ? { "Retry-After": "60" } : {}),
          },
        },
      );
    };
    if (authed && !UUID.test(auth || ""))
      return reply({ error: "not_authenticated" }, 401);
    const flags = cinemaFeatures(process.env);
    if (!flags.viewing || !flags.storyPolls)
      return reply({ error: "story_polls_not_open" }, 503);
    try {
      const cfg = envConfig();
      let mfaAt;
      if (admin) {
        const raw = req.headers.get("x-veyrnox-auth-mfa-at");
        mfaAt = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
        const current = Math.floor(now() / 1000);
        if (
          req.headers.get("x-veyrnox-auth-aal") !== "aal2" ||
          !Number.isSafeInteger(mfaAt) ||
          mfaAt < current - 300 ||
          mfaAt > current + 5
        )
          return reply({ error: "recent_mfa_required" }, 403);
        if (!process.env.ACCESS_TEAM_DOMAIN || !process.env.ACCESS_AUD)
          return reply({ error: "temporarily_unavailable" }, 503);
        const assertion = req.headers.get("cf-access-jwt-assertion");
        if (!assertion) {
          console.error(
            "[access] refused: no assertion on a Cinema administrator request",
          );
          return reply({ error: "access_required" }, 403);
        }
        try {
          await accessVerifier(assertion, {
            teamDomain: process.env.ACCESS_TEAM_DOMAIN,
            aud: process.env.ACCESS_AUD,
          });
        } catch (err) {
          console.error("[access] refused:", err?.reason || "invalid");
          return reply({ error: "access_required" }, 403);
        }
      }
      const query = new URL(req.url).searchParams;
      let body = {},
        key,
        contentId;
      if (action === "read") {
        if (
          query.size !== 1 ||
          query.getAll("content_id").length !== 1 ||
          !UUID.test(query.get("content_id") || "")
        )
          return reply({ error: "invalid_query" }, 400);
        contentId = query.get("content_id");
      } else if (query.size) return reply({ error: "invalid_query" }, 400);
      if (write) {
        key = req.headers.get("idempotency-key");
        if (!UUID.test(key || ""))
          return reply({ error: "invalid_idempotency_key" }, 400);
        if (
          req.headers.get("content-type")?.split(";")[0].trim() !==
          "application/json"
        )
          return reply({ error: "invalid_content_type" }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response)
          return reply({ error: "invalid_body" }, limited.response.status);
        body = await limited.request.json().catch(() => null);
        if (
          action === "choice" &&
          (!body ||
            Array.isArray(body) ||
            Object.keys(body).some(
              (k) => !["poll_id", "option_id"].includes(k),
            ) ||
            !UUID.test(body.poll_id || "") ||
            !UUID.test(body.option_id || ""))
        )
          return reply({ error: "invalid_choice" }, 400);
        if (action === "manage" && !validStoryPollAction(body))
          return reply({ error: "invalid_action" }, 400);
      }
      if (authed) {
        const rate = await rpcCall(
          "consume_account_read_request",
          { p_auth_id: auth },
          cfg,
        );
        if (rate?.code === "RATE_LIMITED")
          return reply({ error: "rate_limited" }, 429);
        if (rate?.ok !== true)
          return reply({ error: "temporarily_unavailable" }, 503);
      }
      const gate = { p_auth_id: auth, p_aal: "aal2", p_mfa_at: mfaAt };
      const call =
        action === "read"
          ? [
              "read_cinema_story_polls",
              { p_auth_id: auth, p_content_id: contentId },
            ]
          : action === "choice"
            ? [
                "cast_cinema_story_choice",
                {
                  p_auth_id: auth,
                  p_idempotency_key: key,
                  p_poll_id: body.poll_id,
                  p_option_id: body.option_id,
                },
              ]
            : action === "queue"
              ? ["list_cinema_story_polls_review", gate]
              : [
                  "manage_cinema_story_polls",
                  {
                    ...gate,
                    p_idempotency_key: key,
                    p_payload: body,
                    p_request_id: requestId,
                  },
                ];
      const result = await rpcCall(call[0], call[1], cfg);
      if (result?.error)
        return reply(
          {
            error: errors[result.error]
              ? result.error
              : "temporarily_unavailable",
          },
          errors[result.error] || 503,
        );
      if (action === "read") {
        if (
          !Array.isArray(result?.polls) ||
          result.polls.length > 5 ||
          result.polls.some((p) => !validPoll(p))
        )
          return reply({ error: "temporarily_unavailable" }, 503);
        return reply({
          polls: result.polls.map((p) => ({
            id: p.id,
            question: p.question,
            opens_at: p.opens_at,
            closes_at: p.closes_at,
            is_open: p.is_open,
            options: p.options.map((o) => ({
              id: o.id,
              label: o.label,
              votes: o.votes,
            })),
            my_choice:
              authed && p.my_choice
                ? {
                    id: p.my_choice.id,
                    option_id: p.my_choice.option_id,
                    status: p.my_choice.status,
                  }
                : null,
          })),
        });
      }
      if (action === "queue") {
        if (
          !Array.isArray(result?.polls) ||
          result.polls.length > 50 ||
          !Array.isArray(result?.choices) ||
          result.choices.length > 100
        )
          return reply({ error: "temporarily_unavailable" }, 503);
        return reply({
          polls: result.polls.map((p) => ({
            id: p.id,
            content_id: p.content_id,
            question: p.question,
            opens_at: p.opens_at,
            closes_at: p.closes_at,
            status: p.status,
            created_at: p.created_at,
            title: p.title,
            options: p.options?.map((o) => ({ id: o.id, label: o.label })),
          })),
          choices: result.choices.map((v) => ({
            id: v.id,
            poll_id: v.poll_id,
            status: v.status,
            created_at: v.created_at,
            question: v.question,
            label: v.label,
            title: v.title,
            username: v.username,
            display_name: v.display_name,
          })),
        });
      }
      if (
        !UUID.test(result?.id || "") ||
        typeof result.idempotent !== "boolean" ||
        !(
          action === "choice" ? statuses : ["open", "closed", ...statuses]
        ).includes(result.status)
      )
        return reply({ error: "temporarily_unavailable" }, 503);
      return reply(
        { id: result.id, status: result.status, idempotent: result.idempotent },
        result.idempotent ? 200 : 201,
      );
    } catch {
      return reply({ error: "temporarily_unavailable" }, 503);
    }
  };
}
