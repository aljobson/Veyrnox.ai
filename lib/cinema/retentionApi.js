import { rpc, envConfig } from "../../packages/db/supabase-client.js";
import { cinemaFeatures } from "./features.js";
import { limitRequestBody } from "../requestBodyLimit.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = ["saved", "creator", "series"];
const errors = {
  profile_required: 403,
  account_not_active: 403,
  self_follow_forbidden: 403,
  content_not_found: 404,
  invalid_action: 400,
  invalid_query: 400,
  invalid_cursor: 400,
  idempotency_conflict: 409,
  collection_limit: 429,
  rate_limited: 429,
};
const exact = (value, fields) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  fields.every((k) => Object.hasOwn(value, k));
const text = (v, max) =>
  typeof v === "string" && [...v].length > 0 && [...v].length <= max;
export function retentionHandler({ write = false, rpcCall = rpc } = {}) {
  return async (req) => {
    const requestId = crypto.randomUUID(),
      auth = req.headers.get("x-veyrnox-auth-id");
    const reply = (body, status = 200) => {
      const log =
        status === 401 || status === 403 ? console.error : console.info;
      log(
        JSON.stringify({
          event: "cinema.retention",
          request_id: requestId,
          action: write ? "mutate" : "read",
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
    if (!UUID.test(auth || ""))
      return reply({ error: "not_authenticated" }, 401);
    if (!cinemaFeatures(process.env).retention)
      return reply({ error: "retention_not_open" }, 503);
    const query = new URL(req.url).searchParams;
    let name, args, kind, limit;
    try {
      if (write) {
        if (query.size) return reply({ error: "invalid_query" }, 400);
        const key = req.headers.get("idempotency-key");
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
        const body = await limited.request.json().catch(() => null);
        if (
          !exact(body, ["kind", "target_id", "active"]) ||
          !kinds.includes(body.kind) ||
          !UUID.test(body.target_id || "") ||
          typeof body.active !== "boolean"
        )
          return reply({ error: "invalid_action" }, 400);
        kind = body.kind;
        name = "mutate_cinema_retention";
        args = {
          p_auth_id: auth,
          p_key: key,
          p_kind: kind,
          p_target_id: body.target_id.toLowerCase(),
          p_active: body.active,
        };
      } else {
        if ([...query.keys()].some((k) => query.getAll(k).length !== 1))
          return reply({ error: "invalid_query" }, 400);
        if (query.has("content_id")) {
          if (query.size !== 1 || !UUID.test(query.get("content_id") || ""))
            return reply({ error: "invalid_query" }, 400);
          name = "read_cinema_retention";
          args = {
            p_auth_id: auth,
            p_content_id: query.get("content_id").toLowerCase(),
          };
        } else {
          kind = query.get("kind");
          limit = query.has("limit") ? Number(query.get("limit")) : 20;
          if (
            [...query.keys()].some(
              (k) => !["kind", "before_id", "limit"].includes(k),
            ) ||
            !kinds.includes(kind) ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 40 ||
            (query.has("before_id") && !UUID.test(query.get("before_id") || ""))
          )
            return reply({ error: "invalid_query" }, 400);
          name = "list_cinema_retention";
          args = {
            p_auth_id: auth,
            p_kind: kind,
            p_before_id: query.get("before_id")?.toLowerCase() || null,
            p_limit: limit,
          };
        }
      }
      const cfg = envConfig(),
        rate = await rpcCall(
          "consume_account_read_request",
          { p_auth_id: auth },
          cfg,
        );
      if (rate?.code === "RATE_LIMITED")
        return reply({ error: "rate_limited" }, 429);
      if (rate?.ok !== true)
        return reply({ error: "temporarily_unavailable" }, 503);
      const data = await rpcCall(name, args, cfg);
      if (data?.error && Object.hasOwn(errors, data.error))
        return reply({ error: data.error }, errors[data.error]);
      if (write) {
        if (
          data?.kind !== kind ||
          data.target_id !== args.p_target_id ||
          data.active !== args.p_active ||
          typeof data.idempotent !== "boolean"
        )
          return reply({ error: "temporarily_unavailable" }, 503);
        return reply({
          kind,
          target_id: data.target_id,
          active: data.active,
          idempotent: data.idempotent,
        });
      }
      if (name === "read_cinema_retention") {
        if (
          data?.content_id !== args.p_content_id ||
          !UUID.test(data.creator_id || "") ||
          (data.series_id !== null && data.series_id !== data.content_id) ||
          [
            "own_creator",
            "saved",
            "following_creator",
            "following_series",
          ].some((k) => typeof data[k] !== "boolean")
        )
          return reply({ error: "temporarily_unavailable" }, 503);
        return reply(
          Object.fromEntries(
            [
              "content_id",
              "creator_id",
              "series_id",
              "own_creator",
              "saved",
              "following_creator",
              "following_series",
            ].map((k) => [k, data[k]]),
          ),
        );
      }
      if (
        data?.kind !== kind ||
        !Array.isArray(data.items) ||
        data.items.length > limit + 1 ||
        data.items.some(
          (i) =>
            !UUID.test(i.target_id || "") ||
            !UUID.test(i.content_id || "") ||
            !text(i.title, 160) ||
            !text(i.username, 30) ||
            !text(i.display_name, 80),
        )
      )
        return reply({ error: "temporarily_unavailable" }, 503);
      const items = data.items.slice(0, limit).map((i) => ({
        target_id: i.target_id,
        content_id: i.content_id,
        title: i.title,
        username: i.username,
        display_name: i.display_name,
      }));
      return reply({
        kind,
        items,
        next: data.items.length > limit ? items.at(-1).target_id : null,
      });
    } catch {
      return reply({ error: "temporarily_unavailable" }, 503);
    }
  };
}
