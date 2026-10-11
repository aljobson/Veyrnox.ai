import { rpc, envConfig } from "../../packages/db/supabase-client.js";
import { cinemaFeatures } from "./features.js";
import { limitRequestBody } from "../requestBodyLimit.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors = {
  profile_required: 403,
  account_not_active: 403,
  content_not_found: 404,
  session_not_found: 404,
  session_expired: 409,
  idempotency_conflict: 409,
  invalid_progress: 400,
  invalid_action: 400,
  locked: 402,
  rate_limited: 429,
};
export function audienceHandler({ rpcCall = rpc } = {}) {
  return async (req) => {
    const reply = (body, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const auth = req.headers.get("x-veyrnox-auth-id");
    if (!UUID.test(auth || ""))
      return reply({ error: "not_authenticated" }, 401);
    if (!cinemaFeatures(process.env).audience)
      return reply({ error: "audience_not_open" }, 503);
    try {
      if (new URL(req.url).searchParams.size)
        return reply({ error: "invalid_request" }, 400);
      if (
        req.headers.get("content-type")?.split(";")[0].trim() !==
        "application/json"
      )
        return reply({ error: "invalid_content_type" }, 415);
      const key = req.headers.get("idempotency-key");
      if (!UUID.test(key || ""))
        return reply({ error: "invalid_idempotency_key" }, 400);
      const limited = await limitRequestBody(req);
      if (limited.response)
        return reply({ error: "invalid_body" }, limited.response.status);
      let b;
      try {
        b = await limited.request.json();
      } catch {
        return reply({ error: "invalid_body" }, 400);
      }
      if (!b || typeof b !== "object" || Array.isArray(b))
        return reply({ error: "invalid_request" }, 400);
      let name, args;
      if (b.action === "watch") {
        if (
          Object.keys(b).some(
            (k) => !["action", "session_id", "seconds", "ranges"].includes(k),
          ) ||
          !UUID.test(b.session_id || "") ||
          !Number.isInteger(b.seconds) ||
          b.seconds < 1 ||
          b.seconds > 60 ||
          !Array.isArray(b.ranges) ||
          b.ranges.length < 1 ||
          b.ranges.length > 60 ||
          b.ranges.some(
            (r) =>
              !Array.isArray(r) ||
              r.length !== 2 ||
              !r.every((n) => Number.isInteger(n) && n >= 0 && n <= 600) ||
              r[1] <= r[0],
          ) ||
          b.ranges.reduce((n, r) => n + r[1] - r[0], 0) > b.seconds
        )
          return reply({ error: "invalid_request" }, 400);
        name = "record_cinema_watch_progress";
        args = {
          p_auth_id: auth,
          p_session_id: b.session_id.toLowerCase(),
          p_key: key.toLowerCase(),
          p_seconds: b.seconds,
          p_ranges: b.ranges,
        };
      } else if (b.action === "share") {
        if (
          Object.keys(b).some(
            (k) => !["action", "content_id", "kind"].includes(k),
          ) ||
          !UUID.test(b.content_id || "") ||
          !["copy", "share"].includes(b.kind)
        )
          return reply({ error: "invalid_request" }, 400);
        name = "record_cinema_share_action";
        args = {
          p_auth_id: auth,
          p_content_id: b.content_id.toLowerCase(),
          p_key: key.toLowerCase(),
          p_kind: b.kind,
        };
      } else return reply({ error: "invalid_request" }, 400);
      const cfg = envConfig();
      const rate = await rpcCall(
        "consume_account_read_request",
        { p_auth_id: auth },
        cfg,
      );
      if (rate?.code === "RATE_LIMITED")
        return reply({ error: "rate_limited" }, 429);
      if (rate?.ok !== true)
        return reply({ error: "temporarily_unavailable" }, 503);
      const r = await rpcCall(name, args, cfg);
      if (r?.error)
        return reply(
          {
            error: Object.hasOwn(errors, r.error)
              ? r.error
              : "temporarily_unavailable",
          },
          errors[r.error] || 503,
        );
      if (
        r?.ok !== true ||
        typeof r.idempotent !== "boolean" ||
        (b.action === "watch" &&
          (!Number.isInteger(r.seconds) ||
            r.seconds < 0 ||
            r.seconds > b.seconds))
      )
        return reply({ error: "temporarily_unavailable" }, 503);
      return reply({
        ok: true,
        idempotent: r.idempotent,
        ...(b.action === "watch" ? { seconds: r.seconds } : {}),
      });
    } catch {
      return reply({ error: "temporarily_unavailable" }, 503);
    }
  };
}
