import { rpc, envConfig } from "../../packages/db/supabase-client.js";
import { cinemaFeatures } from "./features.js";
import { limitRequestBody } from "../requestBodyLimit.js";
// Continue watching (ADR-0232): the caller's own resume positions, nothing else.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors = {
  profile_required: 403,
  account_not_active: 403,
  locked: 403,
  content_not_found: 404,
  not_ready: 409,
  invalid_position: 400,
  invalid_query: 400,
  invalid_cursor: 400,
  rate_limited: 429,
};
const text = (v, max) =>
  typeof v === "string" && [...v].length > 0 && [...v].length <= max;
const count = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
export function watchProgressHandler({ method, rpcCall = rpc }) {
  return async (req) => {
    const requestId = crypto.randomUUID(),
      auth = req.headers.get("x-veyrnox-auth-id");
    const reply = (body, status = 200) => {
      const log =
        status === 401 || status === 403 ? console.error : console.info;
      log(
        JSON.stringify({
          event: "cinema.watch_progress",
          request_id: requestId,
          action: method,
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
    if (!cinemaFeatures(process.env).watchProgress)
      return reply({ error: "watch_progress_not_open" }, 503);
    const query = new URL(req.url).searchParams;
    if ([...query.keys()].some((k) => query.getAll(k).length !== 1))
      return reply({ error: "invalid_query" }, 400);
    let name, args, limit;
    try {
      if (method === "PUT") {
        if (query.size) return reply({ error: "invalid_query" }, 400);
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
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length !== 2 ||
          !UUID.test(body.content_id || "") ||
          !count(body.position_seconds, 600)
        )
          return reply({ error: "invalid_request" }, 400);
        name = "save_cinema_watch_resume";
        args = {
          p_auth_id: auth,
          p_content_id: body.content_id.toLowerCase(),
          p_position: body.position_seconds,
        };
      } else if (method === "DELETE") {
        if (query.size !== 1 || !UUID.test(query.get("content_id") || ""))
          return reply({ error: "invalid_query" }, 400);
        name = "remove_cinema_watch_resume";
        args = {
          p_auth_id: auth,
          p_content_id: query.get("content_id").toLowerCase(),
        };
      } else {
        limit = query.has("limit") ? Number(query.get("limit")) : 20;
        if (
          [...query.keys()].some((k) => !["before_id", "limit"].includes(k)) ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 40 ||
          (query.has("before_id") && !UUID.test(query.get("before_id") || ""))
        )
          return reply({ error: "invalid_query" }, 400);
        name = "list_cinema_watch_resume";
        args = {
          p_auth_id: auth,
          p_before_id: query.get("before_id")?.toLowerCase() || null,
          p_limit: limit,
        };
      }
      const cfg = envConfig(),
        rate = await rpcCall(
          "consume_account_read_request",
          { p_auth_id: auth },
          cfg,
        );
      if (rate?.code === "RATE_LIMITED")
        return reply({ error: "rate_limited" }, 429);
      if (rate?.ok !== true) return reply({ error: "temporarily_unavailable" }, 503);
      const data = await rpcCall(name, args, cfg);
      if (data?.error && Object.hasOwn(errors, data.error))
        return reply({ error: data.error }, errors[data.error]);
      if (method === "DELETE") {
        if (data?.content_id !== args.p_content_id || data.removed !== true)
          return reply({ error: "temporarily_unavailable" }, 503);
        return reply({ content_id: data.content_id, removed: true });
      }
      if (method === "PUT") {
        if (
          data?.content_id !== args.p_content_id ||
          typeof data.recorded !== "boolean" ||
          typeof data.completed !== "boolean" ||
          !count(data.position_seconds, 600) ||
          !Number.isSafeInteger(data.duration_seconds) ||
          data.duration_seconds < 1 ||
          data.duration_seconds > 600
        )
          return reply({ error: "temporarily_unavailable" }, 503);
        return reply({
          recorded: data.recorded,
          content_id: data.content_id,
          position_seconds: data.position_seconds,
          duration_seconds: data.duration_seconds,
          completed: data.completed,
        });
      }
      if (
        !Array.isArray(data?.items) ||
        data.items.length > limit + 1 ||
        data.items.some(
          (i) =>
            !UUID.test(i.content_id || "") ||
            !text(i.title, 160) ||
            !text(i.username, 30) ||
            !text(i.display_name, 80) ||
            !count(i.position_seconds, 600) ||
            !Number.isSafeInteger(i.duration_seconds) ||
            i.duration_seconds < 1 ||
            i.duration_seconds > 600 ||
            i.position_seconds > i.duration_seconds ||
            Number.isNaN(Date.parse(i.updated_at)),
        )
      )
        return reply({ error: "temporarily_unavailable" }, 503);
      const items = data.items.slice(0, limit).map((i) => ({
        content_id: i.content_id,
        title: i.title,
        username: i.username,
        display_name: i.display_name,
        position_seconds: i.position_seconds,
        duration_seconds: i.duration_seconds,
        updated_at: i.updated_at,
      }));
      return reply({
        items,
        next: data.items.length > limit ? items.at(-1).content_id : null,
      });
    } catch {
      return reply({ error: "temporarily_unavailable" }, 503);
    }
  };
}
